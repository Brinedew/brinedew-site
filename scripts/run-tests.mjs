import { execFileSync, spawnSync } from "node:child_process"
import { readdirSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const explicitTestArgs = process.argv.slice(2)

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
const result = spawnSync(process.execPath, [tsxCliPath, "--test", ...testFiles], {
  cwd: process.cwd(),
  stdio: "inherit",
})

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}

process.exit(result.status ?? 1)
