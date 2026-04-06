import { spawnSync } from "node:child_process"
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs"
import { join, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, "..", "..")
const repoRoot = __dirname
const extensionRoot = resolve(repoRoot, "iconoplasm-extension")
const distRoot = resolve(extensionRoot, "dist")
const stageRoot = resolve(distRoot, "package")
const manifestPath = resolve(extensionRoot, "manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const packageVersion = String(manifest.version || "0.0.0").trim() || "0.0.0"
const zipPath = resolve(distRoot, `iconoplasm-extension-v${packageVersion}.zip`)

const runtimeFiles = [
  "manifest.json",
  "blocklist-defaults.js",
  "content-matcher.js",
  "content-visibility-scheduler.js",
  "content.css",
  "content.js",
  "lit-archival-frame.html",
  "lit-archival-frame.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "service-worker.js",
  "site-bridge.js",
]

const runtimeDirs = ["fonts", "generated", "icons"]

const forbiddenRootEntries = [
  "store-assets",
  "README.md",
  "API_COMPAT.md",
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "dist",
]

const suspiciousFileNamePatterns = [
  /(^|[\\/])\.env(\..+)?$/i,
  /\.(pem|key|crt|p12|pfx)$/i,
  /(^|[\\/])(id_rsa|id_dsa|id_ecdsa|id_ed25519)$/i,
]

const suspiciousContentPatterns = [
  { label: "Google API key", pattern: /AIza[0-9A-Za-z\-_]{35}/ },
  { label: "OpenAI key", pattern: /sk-[A-Za-z0-9]{20,}/ },
  { label: "GitHub token", pattern: /ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{20,}/ },
  { label: "Slack token", pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { label: "Bearer token", pattern: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { label: "PEM private key", pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
]

function fail(message) {
  console.error(`[package-iconoplasm-extension] ${message}`)
  process.exit(1)
}

function ensureExists(path, kind) {
  if (!existsSync(path)) {
    fail(`Expected ${kind} at ${relative(repoRoot, path) || path}`)
  }
}

function listRelativeFiles(rootDir) {
  const files = []
  const stack = [rootDir]
  while (stack.length) {
    const current = stack.pop()
    const entries = readdirSync(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(fullPath)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b))
  return files
}

function checkForbiddenRootEntries() {
  for (const entry of forbiddenRootEntries) {
    const fullPath = resolve(extensionRoot, entry)
    if (!existsSync(fullPath)) continue
    if (entry === "store-assets" || entry === "dist") continue
    if (suspiciousFileNamePatterns.some((pattern) => pattern.test(fullPath))) {
      fail(`Sensitive-looking root entry present: ${relative(repoRoot, fullPath)}`)
    }
  }
}

function copyRuntimePayload() {
  rmSync(distRoot, { recursive: true, force: true })
  mkdirSync(stageRoot, { recursive: true })

  for (const file of runtimeFiles) {
    const src = resolve(extensionRoot, file)
    ensureExists(src, "runtime file")
    cpSync(src, resolve(stageRoot, file))
  }

  for (const dir of runtimeDirs) {
    const src = resolve(extensionRoot, dir)
    ensureExists(src, "runtime directory")
    cpSync(src, resolve(stageRoot, dir), { recursive: true })
  }
}

function scanStagedPayload() {
  const stagedFiles = listRelativeFiles(stageRoot)
  for (const filePath of stagedFiles) {
    const relativePath = relative(stageRoot, filePath)
    for (const pattern of suspiciousFileNamePatterns) {
      if (pattern.test(filePath)) {
        fail(`Refusing to package sensitive-looking file name: ${relativePath}`)
      }
    }
    const contents = readFileSync(filePath, "utf8")
    for (const { label, pattern } of suspiciousContentPatterns) {
      if (pattern.test(contents)) {
        fail(`Refusing to package ${relativePath}: matched ${label}`)
      }
    }
  }
  return stagedFiles.map((filePath) => relative(stageRoot, filePath))
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
  })

  if (result.status !== 0) {
    fail(`Zip creation failed. ${result.stderr || result.stdout || "No output"}`)
  }
}

function main() {
  if (process.platform !== "win32") {
    fail("This packaging script currently expects Windows PowerShell because the repo is using a Windows packaging flow.")
  }

  ensureExists(extensionRoot, "extension root")
  ensureExists(manifestPath, "manifest")
  checkForbiddenRootEntries()
  copyRuntimePayload()
  const stagedFiles = scanStagedPayload()
  zipPayload()

  console.log(`[package-iconoplasm-extension] Created ${relative(repoRoot, zipPath)}`)
  console.log("[package-iconoplasm-extension] Packaged runtime files:")
  for (const file of stagedFiles) {
    console.log(`  - ${file}`)
  }
  console.log("[package-iconoplasm-extension] store-assets/, docs, and other dev-only files were excluded on purpose.")
}

main()