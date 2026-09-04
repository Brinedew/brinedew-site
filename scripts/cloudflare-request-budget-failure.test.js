import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { test } from "node:test"

const executable =
  process.platform === "win32" ? "C:\\Program Files\\PowerShell\\7\\pwsh.exe" : "pwsh"
const helper = fileURLToPath(new URL("./lib/CloudflareWorkerRequestBudget.ps1", import.meta.url))
const quote = (value) => `'${value.replaceAll("'", "''")}'`

for (const failedCommand of ["Set-Content", "Move-Item"]) {
  test(`request reservation fails closed when ${failedCommand} emits a nonterminating error`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "request-budget-write-failure-"))
    const ledger = join(directory, "ledger.json")
    const command = [
      `. ${quote(helper)}`,
      `Reserve-CloudflareWorkerRequests -Count 1 -DailyLimit 3 -StatePath ${quote(ledger)} -Operation baseline | Out-Null`,
      `function ${failedCommand} { [CmdletBinding()] param([string] $LiteralPath, [string] $Destination, [string] $Encoding, [switch] $Force, [Parameter(ValueFromPipeline)] $Value) process { Write-Error 'injected persistence failure' } }`,
      `$failed = $false; $result = $null`,
      `try { $result = Reserve-CloudflareWorkerRequests -Count 1 -DailyLimit 3 -StatePath ${quote(ledger)} -Operation failure } catch { $failed = $true }`,
      `@{ failed = $failed; acknowledged = $null -ne $result } | ConvertTo-Json -Compress`,
    ].join("; ")
    try {
      const result = spawnSync(executable, ["-NoProfile", "-NonInteractive", "-Command", command], {
        encoding: "utf8",
        timeout: 15_000,
      })
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(JSON.parse(result.stdout), { failed: true, acknowledged: false })
      assert.equal(JSON.parse(await readFile(ledger, "utf8")).requests_reserved, 1)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
}
