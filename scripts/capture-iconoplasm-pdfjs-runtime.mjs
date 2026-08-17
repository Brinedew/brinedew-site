import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = resolve(fileURLToPath(import.meta.url), "..", "..")
const sourceRoot = resolve(
  repoRoot,
  "iconoplasm-extension",
  "vendor",
  "pdfjs-src",
  "build",
  "generic",
  "build",
)
const runtimeRoot = resolve(repoRoot, "iconoplasm-extension", "vendor", "pdfjs-runtime")
const expectedVersion = "6.2.108"

mkdirSync(runtimeRoot, { recursive: true })
for (const file of ["pdf.mjs", "pdf.worker.mjs"]) {
  const source = resolve(sourceRoot, file)
  if (!existsSync(source)) throw new Error(`Missing patched PDF.js build output: ${source}`)
  const sourceText = readFileSync(source, "utf8")
  if (!sourceText.includes(`pdfjsVersion = ${expectedVersion}`)) {
    throw new Error(
      `Patched PDF.js ${file} is not ${expectedVersion}. A shallow source checkout ` +
        "produces the wrong build number; fetch history through pdfjs.config baseVersion first.",
    )
  }
  cpSync(source, resolve(runtimeRoot, file))
}

console.log("[capture-iconoplasm-pdfjs-runtime] Captured pinned patched runtime")
