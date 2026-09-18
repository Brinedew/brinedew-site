import { execFileSync } from "node:child_process"
import { pathToFileURL } from "node:url"

// A repair is any reviewed diff that cannot touch schema or data: no migration,
// seed, data or dependency path, and at least one non-test Worker source file.
// Review and the exact-CI gate provide the "reviewed" half; this rule refuses
// only the categories that could mutate D1 or change the deploy contract.
const FORBIDDEN_PATH = /(^|\/)(migrations[^/]*|seeds?|data)\//i
const FORBIDDEN_EXTENSION = /\.(sql|sqlite|sqlite3|db|db3)$/i
const FORBIDDEN_FILES = /^(wrangler[^/]*\.toml|package\.json|pnpm-lock\.yaml)$/i
const WORKER_SOURCE = /^workers\/.*\.js$/i
const TEST_FILE = /\.test\.js$/i

export function verifyWorkerRepairPaths(paths) {
  const actual = [
    ...new Set(paths.map((value) => String(value || "").trim()).filter(Boolean)),
  ].sort()
  const refused =
    !actual.length ||
    actual.some(
      (path) =>
        FORBIDDEN_PATH.test(path) ||
        FORBIDDEN_EXTENSION.test(path) ||
        FORBIDDEN_FILES.test(path),
    ) ||
    !actual.some((path) => WORKER_SOURCE.test(path) && !TEST_FILE.test(path))
  if (refused) throw new Error("COST_WORKER_REPAIR_SCOPE_REFUSED")
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
