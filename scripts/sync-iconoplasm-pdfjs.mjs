import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..")
const packageRoot = resolve(repoRoot, "node_modules", "pdfjs-dist")
const defaultTargetRoot = resolve(repoRoot, "iconoplasm-extension", "generated", "pdfjs")

const files = [
  ["legacy/build/pdf.mjs", "pdf.mjs"],
  ["legacy/build/pdf.worker.mjs", "pdf.worker.mjs"],
  ["legacy/web/pdf_viewer.mjs", "pdf_viewer.mjs"],
  ["legacy/web/pdf_viewer.css", "pdf_viewer.css"],
  ["LICENSE", "LICENSE"],
]
const directories = [
  ["cmaps", "cmaps"],
  ["standard_fonts", "standard_fonts"],
  ["wasm", "wasm"],
  ["image_decoders", "image_decoders"],
  ["web/images", "images"],
]

function requirePath(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing pinned pdfjs-dist input: ${path}`)
  }
}

function pdfJsVersion(path) {
  const match = readFileSync(path, "utf8").match(/pdfjsVersion = ([0-9.]+)/u)
  if (!match) throw new Error(`Could not read PDF.js version from ${path}`)
  return match[1]
}

export function syncIconoplasmPdfJs(targetRoot) {
  if (typeof targetRoot !== "string" || !targetRoot) {
    throw new Error("PDF.js synchronization requires an explicit output directory")
  }
  requirePath(packageRoot)
  const runtimeVersion = pdfJsVersion(resolve(packageRoot, "legacy", "build", "pdf.mjs"))
  const viewerVersion = pdfJsVersion(resolve(packageRoot, "legacy", "web", "pdf_viewer.mjs"))
  if (runtimeVersion !== viewerVersion) {
    throw new Error(`PDF.js API ${runtimeVersion} does not match viewer ${viewerVersion}`)
  }
  rmSync(targetRoot, { recursive: true, force: true })
  mkdirSync(targetRoot, { recursive: true })
  for (const [source, destination] of files) {
    const sourcePath = resolve(packageRoot, source)
    requirePath(sourcePath)
    cpSync(sourcePath, resolve(targetRoot, destination))
  }
  for (const [source, destination] of directories) {
    const sourcePath = resolve(packageRoot, source)
    requirePath(sourcePath)
    cpSync(sourcePath, resolve(targetRoot, destination), { recursive: true })
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  syncIconoplasmPdfJs(defaultTargetRoot)
  console.log("[sync-iconoplasm-pdfjs] Synced unmodified pinned pdfjs-dist runtime")
}
