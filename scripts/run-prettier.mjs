import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const PRETTIER_CLI = fileURLToPath(
  new URL("../node_modules/prettier/bin/prettier.cjs", import.meta.url),
)

export function parseArguments(arguments_) {
  const modes = arguments_.filter((argument) => argument === "--check" || argument === "--write")
  const unknown = arguments_.filter(
    (argument) => argument !== "--check" && argument !== "--write" && argument !== "--changed",
  )

  if (modes.length !== 1 || unknown.length > 0) {
    throw new Error("Usage: node scripts/run-prettier.mjs (--check|--write) [--changed]")
  }

  return { mode: modes[0], changed: arguments_.includes("--changed") }
}

export function parseNullDelimitedPaths(output) {
  return output.split("\0").filter(Boolean)
}

function gitPaths(arguments_) {
  return parseNullDelimitedPaths(
    execFileSync("git", arguments_, {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    }),
  )
}

export function changedFiles() {
  const candidates = [
    ...gitPaths(["diff", "--name-only", "--diff-filter=ACMRTUXB", "-z", "HEAD", "--"]),
    ...gitPaths(["ls-files", "--others", "--exclude-standard", "-z", "--"]),
  ]

  return [...new Set(candidates)].filter((candidate) => {
    const absolutePath = path.join(REPOSITORY_ROOT, candidate)
    return existsSync(absolutePath) && statSync(absolutePath).isFile()
  })
}

export function prettierArguments({ mode, files }) {
  return [PRETTIER_CLI, mode, "--ignore-unknown", "--", ...files]
}

function main() {
  const options = parseArguments(process.argv.slice(2))
  const files = options.changed ? changedFiles() : ["."]

  if (files.length === 0) {
    console.log("No changed files to format.")
    return
  }

  const result = spawnSync(process.execPath, prettierArguments({ mode: options.mode, files }), {
    cwd: REPOSITORY_ROOT,
    stdio: "inherit",
  })

  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : ""
if (invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) main()
