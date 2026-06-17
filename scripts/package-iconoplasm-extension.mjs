import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, "..", "..")
const repoRoot = __dirname
const extensionRoot = resolve(repoRoot, "iconoplasm-extension")
const distRoot = resolve(extensionRoot, "dist")
const manifestPath = resolve(extensionRoot, "manifest.json")
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
const packageVersion = String(manifest.version || "0.0.0").trim() || "0.0.0"

function resolveTarget(argv) {
  for (const arg of argv) {
    if (arg === "--firefox") return "firefox"
    if (arg === "--edge") return "edge"
    if (arg === "--safari") return "safari"
    if (arg === "--generic") return "generic"
    if (arg.startsWith("--target=")) {
      const value = String(arg.slice("--target=".length) || "")
        .trim()
        .toLowerCase()
      if (value === "firefox" || value === "edge" || value === "safari" || value === "generic") {
        return value
      }
    }
  }
  return "generic"
}

const packageTarget = resolveTarget(process.argv.slice(2))
const targetConfig =
  packageTarget === "firefox"
    ? {
        browser: "firefox",
        stageDir: "firefox-package",
        zipName: `iconoplasm-firefox-v${packageVersion}.zip`,
      }
    : packageTarget === "edge"
      ? {
          browser: "edge",
          stageDir: "edge-package",
          zipName: `iconoplasm-edge-v${packageVersion}.zip`,
        }
      : packageTarget === "safari"
        ? {
            browser: "safari",
            stageDir: "safari-package",
            zipName: `iconoplasm-safari-webext-v${packageVersion}.zip`,
          }
        : {
            browser: "chrome",
            stageDir: "package",
            zipName: `iconoplasm-extension-v${packageVersion}.zip`,
          }

const stageRoot = resolve(distRoot, targetConfig.stageDir)
const zipPath = resolve(distRoot, targetConfig.zipName)
const wxtWorkRoot = resolve(extensionRoot, `.wxt-${targetConfig.browser}`)
const wxtPublicRoot = resolve(wxtWorkRoot, "public")
const wxtSrcRoot = resolve(wxtWorkRoot, "src")
const wxtEntrypointsRoot = resolve(wxtSrcRoot, "entrypoints")
const wxtOutRoot = resolve(distRoot, "wxt")
const wxtBuildRoot = resolve(wxtOutRoot, `${targetConfig.browser}-mv3`)
const wxtZipPath = resolve(wxtOutRoot, `iconoplasm-${targetConfig.browser}-v${packageVersion}.zip`)

const runtimeFiles = [
  "manifest.json",
  "blocklist-defaults.js",
  "content-api.js",
  "content-settings.js",
  "content-matcher.js",
  "content-scanner.js",
  "content-tooltip.js",
  "content-portrait-cache.js",
  "content-detail-cache.js",
  "content-vote-bridge.js",
  "content-visibility-scheduler.js",
  "content.css",
  "highlight-runtime.js",
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
const removableRuntimeFiles = ["generated/lit-archival-card.js"]

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
  rmSync(wxtPublicRoot, { recursive: true, force: true })
  rmSync(wxtSrcRoot, { recursive: true, force: true })
  mkdirSync(wxtPublicRoot, { recursive: true })
  mkdirSync(wxtEntrypointsRoot, { recursive: true })
  writeFileSync(
    resolve(wxtEntrypointsRoot, "wxt-package-anchor.js"),
    [
      "import { defineUnlistedScript } from 'wxt/utils/define-unlisted-script';",
      "// WXT requires at least one entrypoint. Iconoplasm's runtime files are static assets",
      "// listed in manifest.json, so this unlisted module is only a packaging anchor.",
      "export default defineUnlistedScript({",
      "  exclude: ['chrome', 'firefox', 'edge', 'safari'],",
      "  main() {},",
      "});",
      "",
    ].join("\n"),
    "utf8",
  )

  for (const file of runtimeFiles) {
    if (file === "manifest.json") continue
    const src = resolve(extensionRoot, file)
    ensureExists(src, "runtime file")
    cpSync(src, resolve(wxtPublicRoot, file))
  }

  for (const dir of runtimeDirs) {
    const src = resolve(extensionRoot, dir)
    ensureExists(src, "runtime directory")
    cpSync(src, resolve(wxtPublicRoot, dir), { recursive: true })
  }
}

function stripUnusedRuntimeFiles() {
  for (const relativePath of removableRuntimeFiles) {
    rmSync(resolve(wxtPublicRoot, relativePath), { force: true })
  }
}

function applyTargetSpecificOverrides() {
  stripUnusedRuntimeFiles()
}

function scanPayload(rootDir) {
  const stagedFiles = listRelativeFiles(rootDir)
  for (const filePath of stagedFiles) {
    const relativePath = relative(rootDir, filePath)
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
  return stagedFiles.map((filePath) => relative(rootDir, filePath))
}

function runWxtZip() {
  rmSync(wxtBuildRoot, { recursive: true, force: true })
  rmSync(wxtZipPath, { force: true })
  rmSync(stageRoot, { recursive: true, force: true })
  rmSync(zipPath, { force: true })

  const wxtArgs = ["exec", "wxt", "zip", "--browser", targetConfig.browser, "--mv3"]
  const command = process.platform === "win32" ? "cmd.exe" : "pnpm"
  const args =
    process.platform === "win32" ? ["/d", "/s", "/c", ["pnpm", ...wxtArgs].join(" ")] : wxtArgs
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      ICONOPLASM_WXT_BROWSER: targetConfig.browser,
    },
    timeout: 120_000,
  })

  if (result.error || result.status !== 0) {
    const details =
      result.error?.message ||
      result.stderr ||
      result.stdout ||
      `process exited with status ${result.status ?? "unknown"}`
    fail(`WXT zip creation failed. ${details}`)
  }
  ensureExists(wxtBuildRoot, "WXT unpacked extension output")
  ensureExists(wxtZipPath, "WXT extension ZIP")

  cpSync(wxtBuildRoot, stageRoot, { recursive: true })
  copyFileSync(wxtZipPath, zipPath)
}

function main() {
  ensureExists(extensionRoot, "extension root")
  ensureExists(manifestPath, "manifest")
  checkForbiddenRootEntries()
  copyRuntimePayload()
  applyTargetSpecificOverrides()
  scanPayload(wxtPublicRoot)
  runWxtZip()
  const stagedFiles = scanPayload(stageRoot)

  console.log(`[package-iconoplasm-extension] Created ${relative(repoRoot, zipPath)}`)
  console.log(`[package-iconoplasm-extension] Target: ${packageTarget}`)
  console.log(`[package-iconoplasm-extension] WXT browser: ${targetConfig.browser}`)
  console.log("[package-iconoplasm-extension] Packaged runtime files:")
  for (const file of stagedFiles) {
    console.log(`  - ${file}`)
  }
  console.log(
    "[package-iconoplasm-extension] store-assets/, docs, and other dev-only files were excluded on purpose.",
  )
}

main()
