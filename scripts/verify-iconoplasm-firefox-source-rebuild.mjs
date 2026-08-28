import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..")
const release = process.argv.slice(2).includes("--release")
const outputArgs = process.argv.slice(2).filter((arg) => arg.startsWith("--out-dir="))
if (outputArgs.length > 1) throw new Error("Pass --out-dir only once")
const distRoot = resolve(
  outputArgs[0]?.slice("--out-dir=".length) || resolve(repoRoot, "iconoplasm-extension", "dist"),
)
const candidateRoot = release
  ? resolve(distRoot, "release-work", "firefox", "package")
  : resolve(distRoot, "validation", "firefox", "package")
const reviewerRoot = release
  ? resolve(distRoot, "release-work", "firefox-source", "package")
  : resolve(distRoot, "validation", "firefox-source", "package")
const reviewerBuildRoot = resolve(
  reviewerRoot,
  "iconoplasm-extension",
  "dist",
  release ? "release-work" : "validation",
  "firefox",
  "package",
)

function fail(message) {
  console.error(`[verify-iconoplasm-firefox-source-rebuild] ${message}`)
  process.exit(1)
}

function ensureDirectory(path, label) {
  if (!existsSync(path)) fail(`Missing ${label}: ${relative(repoRoot, path)}`)
}

function runPnpm(args) {
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm"
  const commandArgs =
    process.platform === "win32" ? ["/d", "/s", "/c", ["pnpm", ...args].join(" ")] : args
  const result = spawnSync(command, commandArgs, {
    cwd: reviewerRoot,
    encoding: "utf8",
    timeout: 300_000,
  })
  if (result.error || result.status !== 0) {
    fail(
      `Reviewer command failed: pnpm ${args.join(" ")}\n` +
        (result.error?.message || result.stderr || result.stdout || `status ${result.status}`),
    )
  }
}

function fileMap(root) {
  const result = new Map()
  const stack = [root]
  while (stack.length) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = resolve(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        const name = relative(root, fullPath).replaceAll("\\", "/")
        result.set(name, createHash("sha256").update(readFileSync(fullPath)).digest("hex"))
      }
    }
  }
  return result
}

ensureDirectory(candidateRoot, "Firefox submission package")
ensureDirectory(reviewerRoot, "AMO reviewer source package")
runPnpm(["install", "--frozen-lockfile"])
runPnpm(["run", "sync:iconoplasm-extension"])
const version = JSON.parse(readFileSync(resolve(candidateRoot, "manifest.json"), "utf8")).version
runPnpm([
  "run",
  "package:iconoplasm-firefox",
  ...(release ? ["--release", `--expected-version=${version}`] : []),
])
ensureDirectory(reviewerBuildRoot, "reviewer-rebuilt Firefox package")

const candidate = fileMap(candidateRoot)
const rebuilt = fileMap(reviewerBuildRoot)
const names = [...new Set([...candidate.keys(), ...rebuilt.keys()])].sort()
const differences = names.filter((name) => candidate.get(name) !== rebuilt.get(name))
if (differences.length) {
  fail(
    `Reviewer rebuild differs from the submission payload in ${differences.length} file(s):\n` +
      differences
        .slice(0, 50)
        .map((name) => `- ${name}`)
        .join("\n"),
  )
}

console.log(
  `[verify-iconoplasm-firefox-source-rebuild] ${candidate.size} files reproduced with zero content differences`,
)
