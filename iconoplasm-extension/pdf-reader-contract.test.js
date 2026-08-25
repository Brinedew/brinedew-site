import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const readerSource = readFileSync(new URL("./pdf-reader.mjs", import.meta.url), "utf8")
const readerStyles = readFileSync(new URL("./pdf-reader.css", import.meta.url), "utf8")
const contentSource = readFileSync(new URL("./content.js", import.meta.url), "utf8")
const syncSource = readFileSync(
  new URL("../scripts/sync-iconoplasm-pdfjs.mjs", import.meta.url),
  "utf8",
)
const sourcePackager = readFileSync(
  new URL("../scripts/package-iconoplasm-firefox-source.mjs", import.meta.url),
  "utf8",
)
const streamBootstrapSource = readFileSync(
  new URL("./pdf-stream-bootstrap.js", import.meta.url),
  "utf8",
)
const packagerSource = readFileSync(
  new URL("../scripts/package-iconoplasm-extension.mjs", import.meta.url),
  "utf8",
)

test("PDF highlight behavior is cross-browser and preserves the stored mode", () => {
  assert.match(
    contentSource,
    /const pdfMode = highlightMode === "pill" \? "pill-outline" : highlightMode/u,
  )
  assert.match(contentSource, /requestedMode: highlightMode/u)
  assert.match(contentSource, /shape: highlightRuntime\.getCanvasShape\(pdfMode\)/u)
  assert.doesNotMatch(contentSource, /highlightMode = pdfMode/u)
})

test("the reader uses the official text layer and never mutates PDF glyph paint", () => {
  assert.match(readerSource, /querySelector\("\.textLayer"\)/u)
  assert.match(readerSource, /document\.createTreeWalker\(textLayer, NodeFilter\.SHOW_TEXT\)/u)
  assert.match(readerSource, /document\.createRange\(\)/u)
  assert.match(readerSource, /range\.getClientRects\(\)/u)
  assert.match(readerSource, /measureText\(String\(label/u)
  assert.match(readerSource, /tightenBoundsToTextMetrics/u)
  assert.match(readerSource, /textLayerStyle/u)
  assert.match(readerSource, /layerTransform\.multiply\(textTransform\)/u)
  assert.match(readerSource, /computeDecorationGeometry/u)
  assert.match(readerSource, /getPdfHighlightPresentation/u)
  assert.match(readerSource, /eventBus\.on\("textlayerrendered"/u)
  assert.doesNotMatch(readerSource, /textRenderAdapter|fillText|strokeText|copyCanvasPixels/u)
})

test("PDF decorations are first-party non-text layers", () => {
  assert.match(readerSource, /iconoplasm-pdf-decoration--\$\{kind\}/u)
  assert.match(readerStyles, /\.iconoplasm-pdf-decoration--pill-outline/u)
  assert.match(readerStyles, /\.iconoplasm-pdf-decoration--underline/u)
  assert.match(readerStyles, /pointer-events:\s*none/u)
  assert.doesNotMatch(readerSource, /textContent\s*=\s*match/u)
})

test("the packaged PDF.js runtime comes only from pinned pdfjs-dist", () => {
  assert.match(syncSource, /legacy\/build\/pdf\.mjs/u)
  assert.match(syncSource, /legacy\/build\/pdf\.worker\.mjs/u)
  assert.doesNotMatch(syncSource, /patchedRuntimeRoot|vendor.*pdfjs-runtime/u)
  assert.doesNotMatch(sourcePackager, /pdfjs-clean|pdfjs-patch|pdfjs-runtime/u)
  assert.match(sourcePackager, /FIREFOX-AMO-PDF-ARCHITECTURE\.md/u)
})

test("the MIME stream is consumed before native fallback when highlighting is off", () => {
  const fetchIndex = streamBootstrapSource.indexOf("await fetch(streamInfo.streamUrl)")
  const bytesIndex = streamBootstrapSource.indexOf("await response.arrayBuffer()")
  const preferenceFallbackIndex = readerSource.indexOf(
    'if (streamOutcome?.kind === "stream" && !highlightingEnabled)',
  )
  assert.ok(fetchIndex >= 0)
  assert.ok(bytesIndex > fetchIndex)
  assert.ok(preferenceFallbackIndex >= 0)
})

test("the MIME bootstrap precedes heavyweight reader dependencies and fails native", () => {
  const html = readFileSync(new URL("./pdf-reader.html", import.meta.url), "utf8")
  const bootstrapIndex = html.indexOf('src="pdf-stream-bootstrap.js"')
  const readerIndex = html.indexOf('src="pdf-reader.mjs"')
  assert.ok(bootstrapIndex >= 0)
  assert.ok(readerIndex > bootstrapIndex)
  assert.match(streamBootstrapSource, /abortAndFallbackToNativeHandler/u)
  assert.match(packagerSource, /"pdf-stream-bootstrap\.js"/u)
})
