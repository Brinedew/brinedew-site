import { spawnSync } from "node:child_process"
import {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join, resolve, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { assertIconoplasmPublisherAuthority } from "./lib/iconoplasm-publisher-authority.mjs"
import { createBuildIdentity } from "./lib/iconoplasm-build-identity.mjs"
import { syncIconoplasmPdfJs } from "./sync-iconoplasm-pdfjs.mjs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = resolve(__filename, "..", "..")
const repoRoot = __dirname
const extensionRoot = resolve(repoRoot, "iconoplasm-extension")
const outputArgs = process.argv.slice(2).filter((arg) => arg.startsWith("--out-dir="))
if (outputArgs.length > 1) throw new Error("Pass --out-dir only once")
const distRoot = resolve(
  outputArgs[0]?.slice("--out-dir=".length) || resolve(extensionRoot, "dist"),
)
const manifestPath = resolve(extensionRoot, "manifest.json")

function fail(message) {
  throw new Error(`[package-iconoplasm-extension] ${message}`)
}

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

function resolveBuildPurpose(argv) {
  const release = argv.includes("--release")
  const expectedVersionArgs = argv.filter((arg) => arg.startsWith("--expected-version="))
  if (expectedVersionArgs.length > 1) {
    fail("Pass --expected-version exactly once.")
  }
  const expectedVersion = String(
    expectedVersionArgs[0]?.slice("--expected-version=".length) || "",
  ).trim()
  if (release && !expectedVersion) {
    fail("Release packaging requires --expected-version=X.Y.Z.")
  }
  if (!release && expectedVersion) {
    fail("--expected-version is release-only; add --release or use the validation package command.")
  }
  return { release, expectedVersion: expectedVersion || undefined }
}

const packageArgs = process.argv.slice(2)
const packageTarget = resolveTarget(packageArgs)
const buildPurpose = resolveBuildPurpose(packageArgs)
const { manifest, version: packageVersion } = assertIconoplasmPublisherAuthority(repoRoot, {
  expectedVersion: buildPurpose.expectedVersion,
})
const supportsPdfReader = packageTarget !== "safari"
const usesGeckoPdfOwnership = packageTarget === "firefox"
const targetConfig =
  packageTarget === "firefox"
    ? {
        browser: "firefox",
        releaseZipName: `iconoplasm-firefox-v${packageVersion}.zip`,
        validationZipName: "iconoplasm-firefox-validation.zip",
      }
    : packageTarget === "edge"
      ? {
          browser: "edge",
          releaseZipName: `iconoplasm-edge-v${packageVersion}.zip`,
          validationZipName: "iconoplasm-edge-validation.zip",
        }
      : packageTarget === "safari"
        ? {
            browser: "safari",
            releaseZipName: `iconoplasm-safari-webext-v${packageVersion}.zip`,
            validationZipName: "iconoplasm-safari-webext-validation.zip",
          }
        : {
            browser: "chrome",
            releaseZipName: `iconoplasm-extension-v${packageVersion}.zip`,
            validationZipName: "iconoplasm-extension-validation.zip",
          }

const validationRoot = resolve(distRoot, "validation", packageTarget)
const workRoot = buildPurpose.release
  ? resolve(distRoot, "release-work", packageTarget)
  : validationRoot
const stageRoot = resolve(workRoot, "package")
const zipPath = buildPurpose.release
  ? resolve(distRoot, targetConfig.releaseZipName)
  : resolve(validationRoot, targetConfig.validationZipName)
// Vite resolves bare imports from the entrypoint's ancestors. Keep disposable
// inputs in this project so they use its locked dependencies, even for external output roots.
const wxtWorkRoot = mkdtempSync(resolve(extensionRoot, ".wxt-build-"))
const wxtPublicRoot = resolve(wxtWorkRoot, "public")
const wxtSrcRoot = resolve(wxtWorkRoot, "src")
const wxtEntrypointsRoot = resolve(wxtSrcRoot, "entrypoints")
const wxtOutRoot = resolve(workRoot, "wxt")
const wxtBuildRoot = resolve(wxtOutRoot, `${targetConfig.browser}-mv3`)
const wxtZipPath = resolve(wxtOutRoot, "wxt-build.zip")

const commonRuntimeFiles = [
  "metadata-delivery.js",
  "immutable-response-cache.js",
  "manifest.json",
  "blocklist-defaults.js",
  "content-api.js",
  "content-settings.js",
  "content-matcher.js",
  "content-scanner.js",
  "content-lifecycle.js",
  "content-tooltip.js",
  "content-portrait-cache.js",
  "content-detail-cache.js",
  "content-vote-bridge.js",
  "content-reading-session.js",
  "content.css",
  "highlight-runtime.js",
  "content.js",
  "lit-archival-frame.html",
  "lit-archival-frame.js",
  "popup.css",
  "popup.html",
  "popup.js",
  "publication-alias-overlay.js",
  "service-worker.js",
  "site-bridge.js",
]

const pdfReaderRuntimeFiles = [
  "pdf-reader.html",
  "pdf-reader.css",
  "pdf-stream-bootstrap.js",
  "pdf-reader.mjs",
  "pdf-reader-controls.mjs",
  "pdf-reader-core.js",
  "pdf-text-visibility.mjs",
]

const geckoPdfOwnershipFiles = [
  "pdf-byte-store.js",
  "pdf-gecko-ownership.js",
  "pdf-gecko-redirect.js",
]

const runtimeFiles = supportsPdfReader
  ? [
      ...commonRuntimeFiles,
      ...pdfReaderRuntimeFiles,
      ...(usesGeckoPdfOwnership ? geckoPdfOwnershipFiles : []),
    ]
  : commonRuntimeFiles

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
    cpSync(src, resolve(wxtPublicRoot, dir), {
      recursive: true,
      // PDF.js belongs to this build's private staging tree. Never read the
      // shared generated copy while a standalone sync may be replacing it.
      filter: (source) => source !== resolve(extensionRoot, "generated", "pdfjs"),
    })
  }
  if (supportsPdfReader) {
    syncIconoplasmPdfJs(resolve(wxtPublicRoot, "generated", "pdfjs"))
  }
  // Git may check out text as CRLF on Windows. Package the same UTF-8/LF payload
  // on the workstation, Linux CI and AMO's standalone reviewer environment.
  for (const path of listRelativeFiles(wxtPublicRoot)) {
    if (/\.(?:[cm]?js|json|html|css|svg|txt)$/i.test(path)) {
      const text = readFileSync(path, "utf8")
      if (text.includes("\r\n")) writeFileSync(path, text.replaceAll("\r\n", "\n"))
    }
  }
  writeFileSync(
    resolve(wxtPublicRoot, "build-info.json"),
    JSON.stringify(
      createBuildIdentity(wxtPublicRoot, manifest, buildPurpose.release, {
        browser: targetConfig.browser,
        wxtConfig: readFileSync(resolve(repoRoot, "wxt.config.ts"), "utf8").replaceAll(
          "\r\n",
          "\n",
        ),
        packager: readFileSync(__filename, "utf8").replaceAll("\r\n", "\n"),
        identityCode: readFileSync(
          resolve(repoRoot, "scripts/lib/iconoplasm-build-identity.mjs"),
          "utf8",
        ).replaceAll("\r\n", "\n"),
      }),
      null,
      2,
    ) + "\n",
  )
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
  if (buildPurpose.release && existsSync(zipPath)) {
    fail(`Refusing to overwrite release artifact ${relative(repoRoot, zipPath)}`)
  }
  if (!buildPurpose.release) rmSync(zipPath, { force: true })

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
      ICONOPLASM_WXT_SRC_DIR: wxtSrcRoot,
      ICONOPLASM_WXT_PUBLIC_DIR: wxtPublicRoot,
      ICONOPLASM_WXT_OUT_DIR: wxtOutRoot,
      ICONOPLASM_WXT_ARTIFACT_TEMPLATE: "wxt-build.zip",
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
  copyFileSync(wxtZipPath, zipPath, buildPurpose.release ? constants.COPYFILE_EXCL : 0)
}

function validatePackagedBackground() {
  const packagedManifestPath = resolve(stageRoot, "manifest.json")
  const packagedManifest = JSON.parse(readFileSync(packagedManifestPath, "utf8"))
  if (packageTarget === "firefox") {
    const expectedScripts = [
      "pdf-byte-store.js",
      "pdf-gecko-ownership.js",
      "generated/catalog-contract.js",
      "generated/portrait-delivery-core.js",
      "publication-alias-overlay.js",
      "content-settings.js",
      "metadata-delivery.js",
      "immutable-response-cache.js",
      "content-portrait-cache.js",
      "service-worker.js",
    ]
    const actualScripts = packagedManifest.background?.scripts
    if (JSON.stringify(actualScripts) !== JSON.stringify(expectedScripts)) {
      fail(
        `Firefox background dependency order is invalid: ${JSON.stringify(actualScripts || null)}`,
      )
    }
    for (const script of expectedScripts) {
      ensureExists(resolve(stageRoot, script), `Firefox background dependency ${script}`)
    }
    return
  }
  if (packagedManifest.background?.service_worker !== "service-worker.js") {
    fail(`${packageTarget} package lost the MV3 service worker entrypoint`)
  }
}

function validatePackagedPdfSurface() {
  const packagedManifestPath = resolve(stageRoot, "manifest.json")
  const packagedManifest = JSON.parse(readFileSync(packagedManifestPath, "utf8"))
  if (supportsPdfReader) {
    if (usesGeckoPdfOwnership) {
      if (packagedManifest.mime_types_handler) {
        fail("Firefox package retained the Chromium-only PDF MIME handler")
      }
      for (const permission of [
        "webRequest",
        "webRequestBlocking",
        "webRequestFilterResponse",
        "webNavigation",
      ]) {
        if (!packagedManifest.permissions?.includes(permission)) {
          fail(`Firefox package lost required ${permission} permission`)
        }
      }
      for (const file of geckoPdfOwnershipFiles) {
        ensureExists(resolve(stageRoot, file), `Firefox PDF ownership file ${file}`)
      }
    } else if (!packagedManifest.mime_types_handler?.["application/pdf"]) {
      fail(`${packageTarget} package lost the PDF MIME handler`)
    }
    for (const file of pdfReaderRuntimeFiles) {
      ensureExists(resolve(stageRoot, file), `${packageTarget} PDF reader runtime file`)
    }
    ensureExists(resolve(stageRoot, "generated", "pdfjs"), `${packageTarget} PDF.js runtime`)
    return
  }
  if (packagedManifest.mime_types_handler) {
    fail(`${packageTarget} package retained the unsupported PDF MIME handler`)
  }
  for (const file of pdfReaderRuntimeFiles) {
    if (existsSync(resolve(stageRoot, file))) {
      fail(`${packageTarget} package retained unused PDF reader file ${file}`)
    }
  }
  if (existsSync(resolve(stageRoot, "generated", "pdfjs"))) {
    fail(`${packageTarget} package retained the unused PDF.js runtime`)
  }
}

async function main() {
  ensureExists(extensionRoot, "extension root")
  ensureExists(manifestPath, "manifest")
  checkForbiddenRootEntries()
  copyRuntimePayload()
  scanPayload(wxtPublicRoot)
  runWxtZip()
  validatePackagedBackground()
  validatePackagedPdfSurface()
  const stagedFiles = scanPayload(stageRoot)

  console.log(`[package-iconoplasm-extension] Created ${relative(repoRoot, zipPath)}`)
  console.log(
    `[package-iconoplasm-extension] Purpose: ${buildPurpose.release ? "human-authorized release" : "replaceable validation"}`,
  )
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

try {
  await main()
} finally {
  rmSync(wxtWorkRoot, { recursive: true, force: true })
}
