import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { join, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertIconoplasmPublisherAuthority } from "./lib/iconoplasm-publisher-authority.mjs"
import JSZip from "jszip"

const __filename = fileURLToPath(import.meta.url)
const repoRoot = resolve(__filename, "..", "..")
const extensionRoot = resolve(repoRoot, "iconoplasm-extension")
const outputArgs = process.argv.slice(2).filter((arg) => arg.startsWith("--out-dir="))
if (outputArgs.length > 1) throw new Error("Pass --out-dir only once")
const distRoot = resolve(
  outputArgs[0]?.slice("--out-dir=".length) || resolve(extensionRoot, "dist"),
)

function fail(message) {
  console.error(`[package-iconoplasm-firefox-source] ${message}`)
  process.exit(1)
}

function resolveBuildPurpose(argv) {
  const release = argv.includes("--release")
  const expectedVersionArgs = argv.filter((arg) => arg.startsWith("--expected-version="))
  if (expectedVersionArgs.length > 1) fail("Pass --expected-version exactly once.")
  const expectedVersion = String(
    expectedVersionArgs[0]?.slice("--expected-version=".length) || "",
  ).trim()
  if (release && !expectedVersion) {
    fail("Release packaging requires --expected-version=X.Y.Z.")
  }
  if (!release && expectedVersion) {
    fail("--expected-version is release-only; add --release or build reviewer validation source.")
  }
  return { release, expectedVersion: expectedVersion || undefined }
}

const buildPurpose = resolveBuildPurpose(process.argv.slice(2))
const { version: packageVersion } = assertIconoplasmPublisherAuthority(repoRoot, {
  expectedVersion: buildPurpose.expectedVersion,
})
const validationRoot = resolve(distRoot, "validation", "firefox-source")
const workRoot = buildPurpose.release
  ? resolve(distRoot, "release-work", "firefox-source")
  : validationRoot
const stageRoot = resolve(workRoot, "package")
const zipPath = buildPurpose.release
  ? resolve(distRoot, `iconoplasm-firefox-source-v${packageVersion}.zip`)
  : resolve(validationRoot, "iconoplasm-firefox-source-validation.zip")

const rootTemplateFiles = [
  ["iconoplasm-extension/amo-source/package.json", "package.json"],
  ["iconoplasm-extension/amo-source/pnpm-lock.yaml", "pnpm-lock.yaml"],
  ["iconoplasm-extension/amo-source/pnpm-workspace.yaml", "pnpm-workspace.yaml"],
  ["iconoplasm-extension/amo-source/.npmrc", ".npmrc"],
  ["iconoplasm-extension/amo-source/tsconfig.json", "tsconfig.json"],
]

const reviewerBuildTools = ["esbuild", "pdfjs-dist", "roughjs", "typescript", "wxt"]

function readJson(path, kind) {
  ensureExists(path, kind)
  return JSON.parse(readFileSync(path, "utf8"))
}

function validateReviewerBuildToolParity() {
  const repositoryPackage = readJson(
    resolve(repoRoot, "package.json"),
    "repository package manifest",
  )
  const reviewerPackage = readJson(
    resolve(extensionRoot, "amo-source", "package.json"),
    "reviewer package manifest",
  )
  const repositoryVersions = {
    ...(repositoryPackage.dependencies || {}),
    ...(repositoryPackage.devDependencies || {}),
  }
  const reviewerVersions = {
    ...(reviewerPackage.dependencies || {}),
    ...(reviewerPackage.devDependencies || {}),
  }
  for (const dependency of reviewerBuildTools) {
    if (!repositoryVersions[dependency]) {
      fail(`Repository build is missing reviewer dependency ${dependency}.`)
    }
    if (reviewerVersions[dependency] !== repositoryVersions[dependency]) {
      fail(
        `Reviewer dependency ${dependency} must match the repository build exactly: ` +
          `${reviewerVersions[dependency] || "<missing>"} != ${repositoryVersions[dependency]}.`,
      )
    }
  }
}

const includeFiles = [
  "wxt.config.ts",
  "scripts/sync-iconoplasm-shared.mjs",
  "scripts/sync-iconoplasm-pdfjs.mjs",
  "scripts/package-iconoplasm-extension.mjs",
  "scripts/verify-iconoplasm-publisher-authority.mjs",
  "scripts/verify-iconoplasm-pdf-release-gate.mjs",
  "scripts/lib/iconoplasm-publisher-authority.mjs",
  "scripts/lib/iconoplasm-build-identity.mjs",
  "scripts/lib/iconoplasm-build-identity.d.mts",
  "iconoplasm-extension/AMO-SOURCE-README.md",
  "iconoplasm-extension/FIREFOX-AMO-PDF-ARCHITECTURE.md",
  "iconoplasm-extension/README.md",
  "iconoplasm-extension/manifest.json",
  "iconoplasm-extension/publisher-release.json",
  "iconoplasm-extension/candidate-contract.json",
  "iconoplasm-extension/pdf-ownership-certification.json",
  "iconoplasm-extension/blocklist-defaults.js",
  "iconoplasm-extension/content-api.js",
  "iconoplasm-extension/content-settings.js",
  "iconoplasm-extension/content-matcher.js",
  "iconoplasm-extension/content-scanner.js",
  "iconoplasm-extension/content-lifecycle.js",
  "iconoplasm-extension/content-tooltip.js",
  "iconoplasm-extension/content-portrait-cache.js",
  "iconoplasm-extension/content-detail-cache.js",
  "iconoplasm-extension/content-vote-bridge.js",
  "iconoplasm-extension/content-reading-session.js",
  "iconoplasm-extension/content.css",
  "iconoplasm-extension/content.js",
  "iconoplasm-extension/highlight-runtime.js",
  "iconoplasm-extension/pdf-byte-store.js",
  "iconoplasm-extension/pdf-gecko-ownership.js",
  "iconoplasm-extension/pdf-gecko-redirect.js",
  "iconoplasm-extension/pdf-reader.html",
  "iconoplasm-extension/pdf-reader.css",
  "iconoplasm-extension/pdf-reader.mjs",
  "iconoplasm-extension/pdf-reader-controls.mjs",
  "iconoplasm-extension/pdf-reader-core.js",
  "iconoplasm-extension/pdf-text-visibility.mjs",
  "iconoplasm-extension/pdf-stream-bootstrap.js",
  "iconoplasm-extension/lit-archival-frame.html",
  "iconoplasm-extension/lit-archival-frame.js",
  "iconoplasm-extension/popup.css",
  "iconoplasm-extension/popup.html",
  "iconoplasm-extension/popup.js",
  "iconoplasm-extension/publication-alias-overlay.js",
  "iconoplasm-extension/service-worker.js",
  "iconoplasm-extension/metadata-delivery.js",
  "iconoplasm-extension/immutable-response-cache.js",
  "iconoplasm-extension/site-bridge.js",
]

const includeDirs = [
  "shared/iconoplasm-card",
  "shared/iconoplasm-portrait",
  "iconoplasm-extension/icons",
  "iconoplasm-extension/store-assets",
]

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

function copyRootTemplate(sourcePath, destinationPath) {
  const src = resolve(repoRoot, sourcePath)
  const dest = resolve(stageRoot, destinationPath)
  ensureExists(src, "reviewer build file")
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

async function zipPayload() {
  if (buildPurpose.release && existsSync(zipPath)) {
    fail(`Refusing to overwrite release artifact ${relative(repoRoot, zipPath)}`)
  }
  const archive = new JSZip()
  for (const name of listRelativeFiles(stageRoot))
    archive.file(name.replaceAll("\\", "/"), readFileSync(resolve(stageRoot, name)))
  const bytes = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
  // Includes dotfiles on every platform and uses atomic exclusive creation for
  // versioned artifacts. No shell interpolation or platform ZIP implementation.
  writeFileSync(zipPath, bytes, { flag: buildPurpose.release ? "wx" : "w" })
}

validateReviewerBuildToolParity()
rmSync(stageRoot, { recursive: true, force: true })
mkdirSync(stageRoot, { recursive: true })

for (const [source, destination] of rootTemplateFiles) copyRootTemplate(source, destination)
for (const file of includeFiles) copyFile(file)
for (const dir of includeDirs) copyDir(dir)

removeIfExists("iconoplasm-extension/store-assets/node_modules")
removeIfExists("iconoplasm-extension/store-assets/package-lock.json")
removeIfExists("iconoplasm-extension/dist")

const stagedFiles = listRelativeFiles(stageRoot)
await zipPayload()

console.log(`[package-iconoplasm-firefox-source] Created ${relative(repoRoot, zipPath)}`)
console.log(
  `[package-iconoplasm-firefox-source] Purpose: ${buildPurpose.release ? "human-authorized release" : "replaceable validation"}`,
)
console.log("[package-iconoplasm-firefox-source] Included files:")
for (const file of stagedFiles) {
  console.log(`  - ${file}`)
}
