import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

export const B749_WORKER_REPAIR_FILES = Object.freeze([
  ".github/workflows/deploy-quartz.yml",
  "scripts/verify-exhausted-capacity-worker-repair.mjs",
  "scripts/verify-exhausted-capacity-worker-repair.test.js",
  "scripts/verify-exhausted-capacity-worker-state.mjs",
  "workers/generated/operation-cost-identities.js",
  "workers/iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js",
  "workers/iconoplasm-gene-card-materialization.test.js",
  "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
])

export function verifyWorkerRepairPaths(paths) {
  const actual = [
    ...new Set(paths.map((value) => String(value || "").trim()).filter(Boolean)),
  ].sort()
  const allowed = new Set(B749_WORKER_REPAIR_FILES)
  if (!actual.length || actual.some((path) => !allowed.has(path)))
    throw new Error("COST_WORKER_REPAIR_SCOPE_REFUSED")
  if (
    !actual.includes(
      "workers/iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js",
    ) ||
    !actual.includes(
      "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
    )
  )
    throw new Error("COST_WORKER_REPAIR_SCOPE_REFUSED")
  return actual
}

function main() {
  const baseSha = String(process.env.ICONOPLASM_WORKER_REPAIR_BASE_SHA || "").trim()
  if (!/^[a-f0-9]{40}$/.test(baseSha)) throw new Error("COST_WORKER_REPAIR_BASE_REQUIRED")
  execFileSync("git", ["merge-base", "--is-ancestor", baseSha, "HEAD"], { stdio: "ignore" })
  const paths = execFileSync("git", ["diff", "--name-only", `${baseSha}..HEAD`], {
    encoding: "utf8",
  }).split(/\r?\n/)
  console.log(JSON.stringify({ base_sha: baseSha, paths: verifyWorkerRepairPaths(paths) }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.error(String(error?.message || "COST_WORKER_REPAIR_SCOPE_REFUSED"))
    process.exitCode = 1
  }
}
