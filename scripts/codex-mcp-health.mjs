#!/usr/bin/env node
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const reset = process.argv.includes("--reset")

const query = String.raw`
$ErrorActionPreference = 'Stop'
$rows = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node_repl.exe' -or
    ($_.Name -in @('node.exe','cmd.exe') -and $_.CommandLine -match '@playwright\\mcp|@playwright/mcp|playwright-mcp')
  } |
  Select-Object ProcessId,Name,CommandLine
$rows | ConvertTo-Json -Depth 3
`

const kill = String.raw`
$ErrorActionPreference = 'Stop'
$targets = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node_repl.exe' -or
    ($_.Name -in @('node.exe','cmd.exe') -and $_.CommandLine -match '@playwright\\mcp|@playwright/mcp|playwright-mcp')
  }
foreach ($p in $targets) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 1
$remaining = Get-CimInstance Win32_Process |
  Where-Object {
    $_.Name -eq 'node_repl.exe' -or
    ($_.Name -in @('node.exe','cmd.exe') -and $_.CommandLine -match '@playwright\\mcp|@playwright/mcp|playwright-mcp')
  } |
  Select-Object ProcessId,Name,CommandLine
$remaining | ConvertTo-Json -Depth 3
`

function normalizeProcessRows(stdout) {
  const trimmed = stdout.trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed)
  return Array.isArray(parsed) ? parsed : [parsed]
}

async function runPowerShell(script) {
  const { stdout } = await execFileAsync("pwsh.exe", ["-NoProfile", "-Command", script], {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  })
  return normalizeProcessRows(stdout)
}

function summarize(rows) {
  const playwrightRows = rows.filter((row) =>
    /@playwright[\\/]+mcp|playwright-mcp/i.test(row.CommandLine || ""),
  )
  const nodeReplRows = rows.filter((row) => row.Name === "node_repl.exe")
  const launchForms = new Set(
    playwrightRows.map((row) =>
      /playwright-mcp/i.test(row.CommandLine || "") &&
      !/@playwright[\\/]+mcp/i.test(row.CommandLine || "")
        ? "playwright-mcp"
        : "@playwright/mcp",
    ),
  )

  const issues = []
  if (playwrightRows.length > 1) {
    issues.push(`multiple Playwright MCP process rows (${playwrightRows.length})`)
  }
  if (launchForms.size > 1) {
    issues.push("mixed Playwright MCP launch forms")
  }
  if (nodeReplRows.length > 1) {
    issues.push(`multiple node_repl processes (${nodeReplRows.length})`)
  }

  return { playwrightRows, nodeReplRows, launchForms, issues }
}

const before = await runPowerShell(query)
const beforeSummary = summarize(before)

console.log(`Codex MCP child processes: ${before.length}`)
console.log(`Playwright MCP rows: ${beforeSummary.playwrightRows.length}`)
console.log(`Node REPL rows: ${beforeSummary.nodeReplRows.length}`)
if (beforeSummary.issues.length) {
  console.log(`Issues: ${beforeSummary.issues.join("; ")}`)
}

for (const row of before) {
  console.log(`- ${row.ProcessId} ${row.Name}: ${row.CommandLine}`)
}

if (reset) {
  const after = await runPowerShell(kill)
  console.log("")
  console.log(`Reset complete. Remaining MCP child processes: ${after.length}`)
  for (const row of after) {
    console.log(`- ${row.ProcessId} ${row.Name}: ${row.CommandLine}`)
  }
} else {
  console.log("")
  console.log("Use --reset to kill only Codex MCP child processes and let Codex respawn them.")
}
