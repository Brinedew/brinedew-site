import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { availableParallelism } from "node:os"

const explicitTestArgs = process.argv.slice(2)

// tsx can silently omit a nonexistent explicit path while running other files.
// A green partial run is not evidence that the requested regression suite ran.
const missingExplicitPaths = explicitTestArgs.filter((file) => !existsSync(file))
if (missingExplicitPaths.length) {
  console.error(`Test paths do not exist: ${missingExplicitPaths.join(", ")}`)
  process.exit(1)
}

function trackedFiles() {
  try {
    const output = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      },
    )
    return output.split("\0").filter(Boolean)
  } catch {
    return walk(process.cwd()).map((file) =>
      path.relative(process.cwd(), file).replaceAll(path.sep, "/"),
    )
  }
}

function walk(root) {
  const entries = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "public") continue
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      entries.push(...walk(fullPath))
    } else if (entry.isFile()) {
      entries.push(fullPath)
    }
  }
  return entries
}

function isSourceTest(file) {
  if (file.startsWith("public/")) return false
  const basename = path.posix.basename(file)
  if (/\.(test|spec)\.(?:[cm]?js|tsx?)$/.test(basename)) return true
  return file.startsWith("scripts/test-") && /\.(?:[cm]?js|tsx?)$/.test(basename)
}

const testFiles =
  explicitTestArgs.length > 0 ? explicitTestArgs : trackedFiles().filter(isSourceTest)

if (testFiles.length === 0) {
  console.error("No test files found.")
  process.exit(1)
}

const tsxCliPath = fileURLToPath(new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url))
// Workerd and PowerShell integration files spawn their own processes. Starting
// one test process per host CPU starves bounded child startup checks on Windows.
const concurrency = Math.min(4, availableParallelism())
// CI splits the suite across runners: TEST_SHARD=1/3 runs a third of the files.
// Dealt in name order, as `--test-shard` does, the thirds summed 345 s, 94 s
// and 171 s of tests on 2026-10-29 (B-1187): the slow files start a real
// runtime (Miniflare's D1, workerd, a child process, a browser) and several sat
// in one third. So those are dealt out first, in turn, and the rest after them.
function shardFiles(files, spec) {
  const [index, total] = spec.split("/").map(Number)
  if (!(index >= 1 && index <= total)) throw new Error(`TEST_SHARD must be i/n, not ${spec}`)
  const startsRuntime = (file) =>
    /Miniflare|getD1Database|workerd|spawnSync|execFileSync|execFile\(|spawn\(|chromium|launchChrome/.test(
      readFileSync(file, "utf8"),
    )
  const sorted = [...files].sort()
  const dealt = [...sorted.filter(startsRuntime), ...sorted.filter((file) => !startsRuntime(file))]
  return dealt.filter((_, position) => position % total === index - 1)
}
const shardedFiles = process.env.TEST_SHARD
  ? shardFiles(testFiles, process.env.TEST_SHARD)
  : testFiles
const result = spawnSync(
  process.execPath,
  [tsxCliPath, "--test", `--test-concurrency=${concurrency}`, ...shardedFiles],
  {
    cwd: process.cwd(),
    stdio: "inherit",
  },
)

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
