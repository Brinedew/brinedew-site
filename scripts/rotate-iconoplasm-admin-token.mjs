#!/usr/bin/env node
import { spawn } from "node:child_process"

const flagsWithValues = new Set(["--base-url", "--edge-verify-symbol"])
const booleanFlags = new Set(["--verify-only", "--include-staging"])

function readFlagValue(flag) {
  const index = process.argv.indexOf(flag)
  if (index === -1) return ""
  const value = process.argv[index + 1]
  if (!value || value.startsWith("--")) fail(`${flag} requires a value.`)
  return String(value).trim()
}

for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index]
  if (flagsWithValues.has(arg)) {
    index += 1
    continue
  }
  if (booleanFlags.has(arg)) continue
  fail(`Unknown argument: ${arg}`)
}

const args = new Set(process.argv.slice(2))
const verifyOnly = args.has("--verify-only")
const includeStaging = args.has("--include-staging")
const baseUrl = readFlagValue("--base-url") || "https://iconoplasm.brinedew.bio"
const edgeVerifySymbol = readFlagValue("--edge-verify-symbol") || "GLYAT"

function fail(message) {
  console.error(`[iconoplasm-admin-token] ${message}`)
  process.exit(1)
}

const token = String(process.env.ICONOPLASM_ADMIN_TOKEN || "").trim()
if (!token) fail("ICONOPLASM_ADMIN_TOKEN is missing.")
if (token.length < 32) fail("ICONOPLASM_ADMIN_TOKEN is too short to be an operational token.")

const targets = [
  {
    label: "public edge production",
    config: "wrangler.the-only-allowed-public-edge-worker-upload-only.toml",
  },
  {
    label: "stateful production",
    config: "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  },
]

if (includeStaging) {
  targets.push(
    {
      label: "public edge staging",
      config: "wrangler.the-only-allowed-public-edge-worker-upload-only.toml",
      env: "staging",
    },
    {
      label: "stateful staging",
      config: "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
      env: "staging",
    },
  )
}

function run(command, commandArgs, { input = "", timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    const child = spawn(command, commandArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGTERM")
      const error = new Error(`${command} ${commandArgs.join(" ")} timed out after ${timeoutMs}ms`)
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    }, timeoutMs)
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })
    child.stderr.on("data", (chunk) => {
      stderr += chunk
    })
    child.on("error", (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve({ stdout, stderr })
      else {
        const error = new Error(`${command} ${commandArgs.join(" ")} exited ${code}`)
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      }
    })
    if (input) child.stdin.end(input)
    else child.stdin.end()
  })
}

function summarizeWranglerOutput(label, output) {
  const lines = String(output || "")
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((line) => !line.includes("Already up to date"))
    .filter((line) => !line.startsWith("Done in "))
    .slice(-12)
  console.log(`[iconoplasm-admin-token] ${label}`)
  for (const line of lines) console.log(line)
}

async function putSecret(target) {
  const commandArgs = [
    "exec",
    "wrangler",
    "secret",
    "put",
    "ICONOPLASM_ADMIN_TOKEN",
    "--config",
    target.config,
  ]
  if (target.env) commandArgs.push("--env", target.env)
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  const result = await run(pnpmCommand, commandArgs, { input: `${token}\n` })
  summarizeWranglerOutput(target.label, `${result.stdout}\n${result.stderr}`)
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: "application/json",
      "x-iconoplasm-admin-token": token,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  let payload = null
  try {
    payload = text ? JSON.parse(text) : null
  } catch {
    payload = { parse_error: text.slice(0, 500) }
  }
  return { response, payload }
}

async function verifyToken() {
  const adminUrl = new URL("/api/iconoplasm/admin/mutation-limiter/policy", baseUrl)
  const adminResult = await fetchJson(adminUrl)
  if (!adminResult.response.ok || !adminResult.payload?.ok) {
    fail(
      `stateful admin verification failed: HTTP ${adminResult.response.status} ${JSON.stringify(
        adminResult.payload,
      ).slice(0, 500)}`,
    )
  }

  const richGeneUrl = new URL(
    `/api/iconoplasm/site/genes/${encodeURIComponent(edgeVerifySymbol)}`,
    baseUrl,
  )
  const edgeResult = await fetchJson(richGeneUrl)
  if (!edgeResult.response.ok) {
    fail(
      `public edge token-gated rich detail verification failed: HTTP ${
        edgeResult.response.status
      } ${JSON.stringify(edgeResult.payload).slice(0, 500)}`,
    )
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        verified: {
          stateful_admin_policy: adminResult.response.status,
          public_edge_rich_detail: edgeResult.response.status,
          edge_verify_symbol: edgeVerifySymbol,
        },
      },
      null,
      2,
    ),
  )
}

for (const target of targets) {
  if (!verifyOnly) await putSecret(target)
}
await verifyToken()
