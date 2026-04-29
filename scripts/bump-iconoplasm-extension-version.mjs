import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const repoRoot = resolve(__filename, "..", "..")
const manifestPath = resolve(repoRoot, "iconoplasm-extension", "manifest.json")

function fail(message) {
  console.error(`[bump-iconoplasm-extension-version] ${message}`)
  process.exit(1)
}

function parseVersion(version) {
  const match = String(version || "").trim().match(/^(\d+)\.(\d+)\.(\d+)$/)
  if (!match) {
    fail(`Expected manifest version to be x.y.z, got ${JSON.stringify(version)}`)
  }
  return match.slice(1).map((part) => Number.parseInt(part, 10))
}

function resolveNextVersion(currentVersion, argv) {
  const explicit = argv.find((arg) => arg.startsWith("--set="))
  if (explicit) {
    const nextVersion = explicit.slice("--set=".length).trim()
    parseVersion(nextVersion)
    return nextVersion
  }

  const [major, minor, patch] = parseVersion(currentVersion)
  if (argv.includes("--major")) return `${major + 1}.0.0`
  if (argv.includes("--minor")) return `${major}.${minor + 1}.0`
  if (argv.includes("--patch") || argv.length === 0) return `${major}.${minor}.${patch + 1}`
  fail("Use --patch, --minor, --major, or --set=x.y.z")
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const currentVersion = String(manifest.version || "").trim()
const nextVersion = resolveNextVersion(currentVersion, process.argv.slice(2))
manifest.version = nextVersion
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
console.log(`[bump-iconoplasm-extension-version] ${currentVersion} -> ${nextVersion}`)
