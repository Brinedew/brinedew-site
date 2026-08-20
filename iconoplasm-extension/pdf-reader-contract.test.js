import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const readerSource = readFileSync(new URL("./pdf-reader.mjs", import.meta.url), "utf8")
const readerStyles = readFileSync(new URL("./pdf-reader.css", import.meta.url), "utf8")
const streamBootstrapSource = readFileSync(
  new URL("./pdf-stream-bootstrap.js", import.meta.url),
  "utf8",
)
const packagerSource = readFileSync(
  new URL("../scripts/package-iconoplasm-extension.mjs", import.meta.url),
  "utf8",
)
const maintainedPatch = readFileSync(
  new URL("./vendor/pdfjs-patch/pdfjs-v6.2.108-iconoplasm.patch", import.meta.url),
  "utf8",
)
const generatedRuntime = readFileSync(new URL("./generated/pdfjs/pdf.mjs", import.meta.url), "utf8")

test("PDF.js exposes the maintained source-level text renderer adapter", () => {
  assert.match(maintainedPatch, /src\/display\/api\.js/u)
  assert.match(maintainedPatch, /src\/display\/canvas\.js/u)
  assert.match(maintainedPatch, /textRenderAdapter/u)
  assert.match(maintainedPatch, /fill-rounded-ring/u)
  assert.match(maintainedPatch, /decorationsByOperationOrdinal/u)
  assert.match(maintainedPatch, /ctx\.fillText\(character, scaledX, scaledY\)/u)
  assert.match(generatedRuntime, /textRenderAdapter/u)
  assert.match(generatedRuntime, /fill-rounded-ring/u)
  assert.match(generatedRuntime, /decorationsByOperationOrdinal/u)
})

test("exact PDF highlighting uses survey and paint renders with an atomic candidate swap", () => {
  assert.match(readerSource, /mode: "survey"/u)
  assert.match(readerSource, /mode: "paint"/u)
  assert.match(readerSource, /core\.renderFingerprint/u)
  assert.match(readerSource, /globalCompositeOperation = "copy"/u)
  assert.match(readerSource, /buildExactPaintPlan/u)
  assert.match(readerSource, /decorationsByOperationOrdinal/u)
  assert.match(readerSource, /createSharedRoughEllipseDecorations/u)
  assert.match(readerSource, /state\.visible = pageIsInWorkingSet\(state\.pageElement\)/u)
  assert.match(readerSource, /enableDetailCanvas: false/u)
  assert.doesNotMatch(readerSource, /PDF_(?:ZOOM_TRACE|SCAN_)/u)
})

test("rejected approximate renderers cannot silently return", () => {
  for (const rejected of [
    /operationsFilter/u,
    /getClientRects/u,
    /dualBackgroundCoverage/u,
    /nearestInkBounds/u,
    /advanceWindowForMatch/u,
    /Range\.getBoundingClientRect/u,
    /dispatchEvent\(new MouseEvent/u,
  ]) {
    assert.doesNotMatch(readerSource, rejected)
  }
})

test("PDF rough ellipses reuse HTML SVG in the canvas-wrapper coordinate system", () => {
  assert.match(readerSource, /const wrapper = sourceCanvas\?\.parentElement/u)
  assert.match(
    readerSource,
    /sourceRect\.left - wrapperRect\.left \+ deviceBounds\.left \* scaleX/u,
  )
  assert.match(readerSource, /highlightRuntime\.createRoughEllipseNode\(rect\.width, rect\.height/u)
  assert.match(readerSource, /refreshEllipseDecorationGeometry\(state\)/u)
  assert.doesNotMatch(readerSource, /roughImpl\.canvas/u)
  assert.doesNotMatch(readerSource, /new Path2D/u)
  assert.doesNotMatch(readerSource, /createImageBitmap|new XMLSerializer/u)
})

test("rough ellipses use the HTML document-order seed sequence", () => {
  assert.match(readerSource, /function roughSeedForMatchOrdinal\(matchOrdinal\)/u)
  assert.match(readerSource, /9001 \+ \(Math\.max\(0, Number\(matchOrdinal\)/u)
  assert.match(readerSource, /for \(const \[matchOrdinal, match\] of matches\.entries\(\)\)/u)
  assert.doesNotMatch(readerSource, /2166136261/u)
})

test("PDF hover anchors remain glyph-owned rather than decoration-owned", () => {
  assert.match(readerSource, /anchor\._iconoplasmDeviceBounds = match\.bounds/u)
  assert.doesNotMatch(readerSource, /disableMultiStroke/u)
})

test("PDF hover is geometric and does not counterfeit HTML gene elements", () => {
  assert.match(readerSource, /containsPointInPolygon/u)
  assert.match(readerSource, /_iconoplasmDevicePolygons/u)
  assert.match(readerSource, /if \(cssTransform && state\.exactPaintApplied/u)
  assert.match(readerSource, /refreshHitAnchorGeometry\(state\)/u)
  assert.doesNotMatch(readerSource, /className = "iconoplasm-gene"/u)
})

test("PDF highlight timing uses the shared policy and exact retained renders", () => {
  const contentSource = readFileSync(new URL("./content.js", import.meta.url), "utf8")
  assert.match(contentSource, /getHighlightVisibility\(\)/u)
  assert.match(contentSource, /iconoplasm-reader-highlight-visibility-changed/u)
  assert.match(readerSource, /settings\.normalizeHighlightVisibility/u)
  assert.match(readerSource, /state\.canonicalCanvas = canonical/u)
  assert.match(readerSource, /state\.highlightedCanvas = candidate/u)
  assert.match(readerSource, /cloneCanvasPixels\(sourceCanvas\)/u)
  assert.match(readerSource, /copyCanvasRegion\(/u)
  assert.match(readerSource, /core\.paintBoundsForMatch\(match\)/u)
  assert.match(readerSource, /decoration\.hidden =/u)
  assert.match(
    readerStyles,
    /\.iconoplasm-pdf-ellipse-decoration\[hidden\]\s*\{\s*display:\s*none;/u,
  )
  assert.doesNotMatch(readerSource, /iconoplasm-highlight-on-hover/u)
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
