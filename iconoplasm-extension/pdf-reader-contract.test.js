import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const readerSource = readFileSync(new URL("./pdf-reader.mjs", import.meta.url), "utf8")
const readerControlsSource = readFileSync(
  new URL("./pdf-reader-controls.mjs", import.meta.url),
  "utf8",
)
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
const visualBridgeSource = readFileSync(new URL("./e2e/visual-bridge.js", import.meta.url), "utf8")
const repositoryPackage = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
)
const reviewerPackage = JSON.parse(
  readFileSync(new URL("./amo-source/package.json", import.meta.url), "utf8"),
)

test("PDF pointer exits use the same transition as movement, including toolbar and window exit", () => {
  assert.match(
    readerSource,
    /container\.addEventListener\("pointerleave", \(event\) => \{\s*transitionActiveAnchor\(null, event\.relatedTarget\)/u,
  )
  assert.match(readerSource, /core\.transitionReaderAnchor\(/u)
  assert.match(readerSource, /window\.addEventListener\("blur", closeActiveCard\)/u)
})

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

test("the Chrome visual fixture renders one explicitly requested PDF mode", () => {
  assert.match(visualBridgeSource, /searchParams\.get\("mode"\)/u)
  assert.match(visualBridgeSource, /requestedMode === "pill" \? "pill-outline" : requestedMode/u)
  assert.match(visualBridgeSource, /shape: runtime\.getCanvasShape\(pdfMode\)/u)
})

test("the packaged PDF.js runtime comes only from pinned pdfjs-dist", () => {
  assert.match(syncSource, /legacy\/build\/pdf\.mjs/u)
  assert.match(syncSource, /legacy\/build\/pdf\.worker\.mjs/u)
  assert.doesNotMatch(syncSource, /patchedRuntimeRoot|vendor.*pdfjs-runtime/u)
  assert.doesNotMatch(sourcePackager, /pdfjs-clean|pdfjs-patch|pdfjs-runtime/u)
  assert.match(sourcePackager, /FIREFOX-AMO-PDF-ARCHITECTURE\.md/u)
})

test("the AMO reviewer build pins the same direct build tools as the submission build", () => {
  const repositoryVersions = {
    ...repositoryPackage.dependencies,
    ...repositoryPackage.devDependencies,
  }
  const reviewerVersions = {
    ...reviewerPackage.dependencies,
    ...reviewerPackage.devDependencies,
  }
  for (const dependency of ["esbuild", "pdfjs-dist", "roughjs", "typescript", "wxt"]) {
    assert.equal(reviewerVersions[dependency], repositoryVersions[dependency], dependency)
  }
})

test("the MIME stream is consumed before native fallback when highlighting is off", () => {
  const fetchIndex = streamBootstrapSource.indexOf("await fetch(streamInfo.streamUrl)")
  const bytesIndex = streamBootstrapSource.indexOf("await readResponseBytes(response)")
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

test("Firefox local PDFs route to the private File API reader instead of failing silently", () => {
  const geckoOwnershipSource = readFileSync(
    new URL("./pdf-gecko-ownership.js", import.meta.url),
    "utf8",
  )
  const html = readFileSync(new URL("./pdf-reader.html", import.meta.url), "utf8")
  assert.match(geckoOwnershipSource, /webNavigation\?\.onBeforeNavigate/u)
  assert.match(geckoOwnershipSource, /geckoLocalFile/u)
  assert.match(streamBootstrapSource, /ownership: "firefox-local-file-picker"/u)
  assert.match(readerSource, /Choose \$\{requestedFileName\} once/u)
  assert.match(readerSource, /navigator\.clipboard\.writeText\(localPath\)/u)
  assert.match(readerSource, /press Ctrl\+V, then Open/u)
  assert.match(readerSource, /core\.localFileSystemPath/u)
  assert.match(readerSource, /"iconoplasm-reader-bridge-ready"/u)
  assert.match(readerSource, /bridge = globalThis\.IconoplasmReaderBridge \|\| null/u)
  assert.match(readerSource, /refreshVisiblePages\(\)/u)
  assert.match(html, /<button id="reader-open-file-action" type="button">/u)
})

test("the PDF reader exposes download, parse, and first-render progress without an empty-state flash", () => {
  const html = readFileSync(new URL("./pdf-reader.html", import.meta.url), "utf8")
  assert.match(html, /id="reader-progress"[\s\S]*role="progressbar"/u)
  assert.match(html, /id="reader-status-message"[\s\S]*Loading PDF…/u)
  assert.doesNotMatch(html, />Open or drop a PDF<\/div>/u)
  assert.match(streamBootstrapSource, /response\.body\.getReader/u)
  assert.match(streamBootstrapSource, /iconoplasm-pdf-stream-progress/u)
  assert.match(readerSource, /loadingTask\.onProgress/u)
  assert.match(readerSource, /Rendering first page…/u)
  assert.match(readerSource, /eventBus\.on\("pagerendered"/u)
})

test("the PDF reader keeps controls inert until rendering and offers recovery on failure", () => {
  const html = readFileSync(new URL("./pdf-reader.html", import.meta.url), "utf8")
  assert.match(html, /id="zoom-out"[\s\S]*?disabled/u)
  assert.match(html, /id="reader-retry"/u)
  assert.match(html, /id="reader-native-fallback"/u)
  assert.match(readerSource, /function setControlsEnabled/u)
  assert.match(readerSource, /function setReaderError/u)
  assert.match(readerSource, /activeLoadId/u)
  assert.match(readerStyles, /prefers-reduced-motion/u)
})

test("the PDF reader provides the vanilla control surface shared by approved viewers", () => {
  const html = readFileSync(new URL("./pdf-reader.html", import.meta.url), "utf8")
  for (const id of [
    "previous-page",
    "next-page",
    "page-number",
    "fit-width",
    "find-previous",
    "find-next",
    "print",
    "sidebar-toggle",
    "thumbnail-view",
    "outline-view",
    "presentation-mode",
    "document-properties",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`, "u"), id)
  }
  assert.match(readerControlsSource, /IntersectionObserver/u)
  assert.match(readerControlsSource, /getOutline\(\)/u)
  assert.match(readerControlsSource, /intent: "print"/u)
  assert.match(readerControlsSource, /requestFullscreen/u)
  assert.match(readerControlsSource, /getMetadata\(\)/u)
  assert.match(readerControlsSource, /history\.replaceState/u)
  assert.match(packagerSource, /"pdf-reader-controls\.mjs"/u)
  assert.match(sourcePackager, /pdf-reader-controls\.mjs/u)
})
