import { spawn } from "node:child_process"
import { pathToFileURL } from "node:url"

export const DEFAULT_RETRY_DELAYS_MS = Object.freeze([3000, 5000, 8000, 12000, 15000])

const MAX_CAPTURED_CHARS = 65_536
const TRANSIENT_VERSION_DEPLOY_PATTERNS = [
  /No deployable version found with tag/i,
  /The requested Worker version could not be found/i,
  /\[code:\s*100146\]/i,
]

/** Return whether `wrangler versions deploy` failed due to Cloudflare version-propagation lag. */
export function isTransientVersionDeployError(output) {
  const text = String(output || "")
  return TRANSIENT_VERSION_DEPLOY_PATTERNS.some((pattern) => pattern.test(text))
}

function appendTail(current, chunk) {
  const next = current + chunk
  return next.length <= MAX_CAPTURED_CHARS ? next : next.slice(next.length - MAX_CAPTURED_CHARS)
}

/** Spawn a command once, mirroring stdio live while returning `{ status, output }`. */
export function runCommandCapture(command, args, { spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(command, args, { stdio: ["inherit", "pipe", "pipe"] })
    let output = ""
    child.stdout?.on("data", (chunk) => {
      process.stdout.write(chunk)
      output = appendTail(output, chunk.toString("utf8"))
    })
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk)
      output = appendTail(output, chunk.toString("utf8"))
    })
    child.once("error", reject)
    child.once("close", (code, signal) => {
      resolve({ status: typeof code === "number" ? code : 1, signal, output })
    })
  })
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Run `wrangler versions deploy` and retry only when Cloudflare's control plane lags behind upload. */
export async function deployVersionWithRetry(
  commandArgs,
  {
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    runAttempt = (args) => runCommandCapture(args[0], args.slice(1)),
    sleepImpl = defaultSleep,
    logError = (line) => console.error(line),
  } = {},
) {
  if (!Array.isArray(commandArgs) || commandArgs.length === 0) {
    throw new Error(
      "Usage: node scripts/wrangler-versions-deploy-with-retry.mjs <command> [args...]",
    )
  }
  const totalAttempts = retryDelaysMs.length + 1
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    const result = await runAttempt(commandArgs)
    const status = typeof result?.status === "number" ? result.status : 1
    if (status === 0) return 0
    const hasRetryLeft = attempt < retryDelaysMs.length
    if (!hasRetryLeft || !isTransientVersionDeployError(result?.output)) {
      return status
    }
    const delayMs = retryDelaysMs[attempt]
    logError(
      `wrangler versions deploy hit Cloudflare version lookup lag (attempt ${attempt + 1}/${totalAttempts}); retrying in ${delayMs}ms...`,
    )
    await sleepImpl(delayMs)
  }
  return 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await deployVersionWithRetry(process.argv.slice(2))
  process.exit(exitCode)
}
