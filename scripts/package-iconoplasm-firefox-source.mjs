import { spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const repoRoot = resolve(__filename, "..", "..")
const extensionRoot = resolve(repoRoot, "iconoplasm-extension")
const distRoot = resolve(extensionRoot, "dist")
const stageRoot = resolve(distRoot, "firefox-source-package")
const manifest = JSON.parse(readFileSync(resolve(extensionRoot, "manifest.json"), "utf8"))
const packageVersion = String(manifest.version || "0.0.0").trim() || "0.0.0"
const zipPath = resolve(distRoot, `iconoplasm-firefox-source-v${packageVersion}.zip`)

const includeFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  "wxt.config.ts",
  "scripts/sync-iconoplasm-shared.mjs",
  "scripts/package-iconoplasm-extension.mjs",
  "iconoplasm-extension/AMO-SOURCE-README.md",
  "iconoplasm-extension/README.md",
  "iconoplasm-extension/manifest.json",
  "iconoplasm-extension/blocklist-defaults.js",
  "iconoplasm-extension/content-api.js",
  "iconoplasm-extension/content-settings.js",
  "iconoplasm-extension/content-matcher.js",
  "iconoplasm-extension/content-scanner.js",
  "iconoplasm-extension/content-tooltip.js",
  "iconoplasm-extension/content-portrait-cache.js",
  "iconoplasm-extension/content-detail-cache.js",
  "iconoplasm-extension/content-vote-bridge.js",
  "iconoplasm-extension/content-visibility-scheduler.js",
  "iconoplasm-extension/content.css",
  "iconoplasm-extension/content.js",
  "iconoplasm-extension/highlight-runtime.js",
  "iconoplasm-extension/lit-archival-frame.html",
  "iconoplasm-extension/lit-archival-frame.js",
  "iconoplasm-extension/popup.css",
  "iconoplasm-extension/popup.html",
  "iconoplasm-extension/popup.js",
  "iconoplasm-extension/publication-alias-overlay.js",
  "iconoplasm-extension/service-worker.js",
  "iconoplasm-extension/site-bridge.js",
]

const includeDirs = [
  "shared/iconoplasm-card",
  "iconoplasm-extension/icons",
  "iconoplasm-extension/store-assets",
]

function fail(message) {
  console.error(`[package-iconoplasm-firefox-source] ${message}`)
  process.exit(1)
}

function ensureExists(path, kind) {
  if (!existsSync(path)) fail(`Missing ${kind}: ${relative(repoRoot, path)}`)
}

function copyFile(relPath) {
  const src = resolve(repoRoot, relPath)
  const dest = resolve(stageRoot, relPath)
  ensureExists(src, "file")
  mkdirSync(resolve(dest, ".."), { recursive: true })
  cpSync(src, dest)
}

function copyDir(relPath) {
  const src = resolve(repoRoot, relPath)
  const dest = resolve(stageRoot, relPath)
  ensureExists(src, "directory")
  cpSync(src, dest, { recursive: true, force: true })
}

function removeIfExists(relPath) {
  const target = resolve(stageRoot, relPath)
  rmSync(target, { recursive: true, force: true })
}

function listRelativeFiles(rootDir) {
  const files = []
  const stack = [rootDir]
  while (stack.length) {
    const current = stack.pop()
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) stack.push(fullPath)
      else if (entry.isFile()) files.push(relative(rootDir, fullPath))
    }
  }
  return files.sort((a, b) => a.localeCompare(b))
}

function zipPayload() {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `$zipPath = ${JSON.stringify(zipPath)}`,
    `$stagePath = ${JSON.stringify(stageRoot)}`,
    "if (Test-Path $zipPath) { Remove-Item $zipPath -Force }",
    "Compress-Archive -Path (Join-Path $stagePath '*') -DestinationPath $zipPath -Force",
  ].join("; ")

  const result = spawnSync("pwsh", ["-NoLogo", "-NoProfile", "-Command", command], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
  })

  if (result.status !== 0) {
    fail(`Zip creation failed. ${result.stderr || result.stdout || "No output"}`)
  }
}

rmSync(stageRoot, { recursive: true, force: true })
mkdirSync(stageRoot, { recursive: true })

for (const file of includeFiles) copyFile(file)
for (const dir of includeDirs) copyDir(dir)

removeIfExists("iconoplasm-extension/store-assets/node_modules")
removeIfExists("iconoplasm-extension/store-assets/package-lock.json")
removeIfExists("iconoplasm-extension/dist")

const stagedFiles = listRelativeFiles(stageRoot)
zipPayload()

console.log(`[package-iconoplasm-firefox-source] Created ${relative(repoRoot, zipPath)}`)
console.log("[package-iconoplasm-firefox-source] Included files:")
for (const file of stagedFiles) {
  console.log(`  - ${file}`)
}
