import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"
import {
  readIconoplasmReleaseState,
  requireReaderRecoveryCompatibleState,
} from "./read-iconoplasm-release-state.mjs"

const SCRIPT_NAME = "geneguessr-api"
const MAX_ATTEMPTS = 3
const DEPLOY_TIMEOUT_MS = 80_000

export function isTransientDeploymentFailure(error) {
  const details = `${error?.message || ""}\n${error?.stdout || ""}\n${error?.stderr || ""}`
  return /\b(?:408|429|500|502|503|504)\b|upstream connect error|connection termination|network error|fetch failed/iu.test(
    details,
  )
}

export function assertUnchangedReaderRecovery({ before, after, initialState, currentState }) {
  requireReaderRecoveryCompatibleState(currentState)
  if (
    currentState.schema_transition !== initialState.schema_transition ||
    currentState.reader_recovery !== initialState.reader_recovery
  )
    throw new Error("COST_READER_RECOVERY_RETRY_STATE_CHANGED")
  if (currentState.origin_run_id !== initialState.origin_run_id)
    throw new Error("COST_READER_RECOVERY_RETRY_ORIGIN_CHANGED")
  if (!before?.id || !after?.id || before.id !== after.id)
    throw new Error("COST_READER_RECOVERY_RETRY_DEPLOYMENT_AMBIGUOUS")
}

export async function readActiveDeployment({
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  token = process.env.CLOUDFLARE_API_TOKEN,
  fetcher = fetch,
} = {}) {
  if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token)
    throw new Error("COST_READER_RECOVERY_CREDENTIALS_REQUIRED")
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${SCRIPT_NAME}/deployments`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!response.ok) throw new Error("COST_READER_RECOVERY_DEPLOYMENT_STATE_UNAVAILABLE")
  const payload = await response.json()
  const deployment = payload?.success === true ? payload.result?.deployments?.[0] : null
  if (!deployment || typeof deployment.id !== "string")
    throw new Error("COST_READER_RECOVERY_DEPLOYMENT_STATE_UNAVAILABLE")
  return { id: deployment.id, created_on: deployment.created_on || "" }
}

export function run(command, args, { timeoutMs = DEPLOY_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let stdout = ""
    let stderr = ""
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      windowsHide: true,
    })
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGTERM")
      const error = new Error(`Reader recovery deploy timed out after ${timeoutMs}ms`)
      error.stdout = stdout
      error.stderr = stderr
      reject(error)
    }, timeoutMs)
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
        const error = new Error(`Reader recovery deploy exited ${code}`)
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      }
    })
  })
}

export async function deployReaderRecovery({
  wranglerArgs,
  execute = run,
  readState = readIconoplasmReleaseState,
  readDeployment = readActiveDeployment,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  log = console.log,
} = {}) {
  if (!Array.isArray(wranglerArgs)) throw new Error("COST_READER_RECOVERY_ARGUMENTS_REQUIRED")
  const initialState = requireReaderRecoveryCompatibleState(await readState())
  const before = await readDeployment()
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm"
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const result = await execute(command, ["exec", "wrangler", "deploy", ...wranglerArgs])
      for (const line of `${result.stdout}\n${result.stderr}`.split(/\r?\n/u).filter(Boolean))
        log(line)
      return { attempts: attempt, deployment_before: before.id }
    } catch (error) {
      if (!isTransientDeploymentFailure(error) || attempt === MAX_ATTEMPTS) throw error
      const [after, currentState] = await Promise.all([readDeployment(), readState()])
      assertUnchangedReaderRecovery({ before, after, initialState, currentState })
      const delay = attempt * 3_000
      log(
        `Reader recovery deploy had a transient provider failure; contained state is unchanged. Retrying in ${delay / 1000}s (${attempt + 1}/${MAX_ATTEMPTS}).`,
      )
      await sleep(delay)
    }
  }
  throw new Error("COST_READER_RECOVERY_RETRY_EXHAUSTED")
}

async function main() {
  const result = await deployReaderRecovery({ wranglerArgs: process.argv.slice(2) })
  console.log(JSON.stringify(result))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
