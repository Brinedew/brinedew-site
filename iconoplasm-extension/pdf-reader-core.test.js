import assert from "node:assert/strict"
import test from "node:test"

await import("./pdf-reader-core.js")

const core = globalThis.IconoplasmPdfReaderCore
const shapes = {
  underline: { kind: "underline" },
  pill: { kind: "pill", recolorGlyphs: true },
  "pill-outline": { kind: "pill-outline" },
  ellipse: { kind: "ellipse" },
}

const presentation = (mode) => () => ({ color: "#234567", shape: shapes[mode] })

test("text-layer matches retain exact offsets without creating visible text", () => {
  const plan = core.normalizeTextRunMatches(
    "A HER2 result",
    () => [{ index: 2, length: 4, symbol: "HER2", text: "HER2" }],
    presentation("pill-outline"),
  )
  assert.deepEqual(plan.rejected, [])
  assert.deepEqual(plan.accepted[0], {
    symbol: "HER2",
    label: "HER2",
    start: 2,
    end: 6,
    presentation: { color: "#234567", shape: shapes["pill-outline"] },
  })
})

test("PDF plans accept underline, outline pill, and ellipse", () => {
  for (const mode of ["underline", "pill-outline", "ellipse"]) {
    const plan = core.normalizeTextRunMatches(
      "BRCA1",
      () => [{ index: 0, length: 5, symbol: "BRCA1" }],
      presentation(mode),
    )
    assert.equal(plan.accepted.length, 1, mode)
    assert.equal(plan.rejected.length, 0, mode)
  }
})

test("an unresolved filled pill fails closed in PDFs", () => {
  const plan = core.normalizeTextRunMatches(
    "BRCA1",
    () => [{ index: 0, length: 5, symbol: "BRCA1" }],
    presentation("pill"),
  )
  assert.equal(plan.accepted.length, 0)
  assert.deepEqual(plan.rejected, [{ symbol: "BRCA1", reason: "filled-pill-not-supported-in-pdf" }])
})

test("invalid and overlapping ranges fail closed", () => {
  const plan = core.normalizeTextRunMatches(
    "BRCA1",
    () => [
      { index: 0, length: 4, symbol: "BRCA" },
      { index: 2, length: 3, symbol: "CA1" },
      { index: 9, length: 1, symbol: "X" },
    ],
    presentation("underline"),
  )
  assert.equal(plan.accepted.length, 1)
  assert.deepEqual(plan.rejected, [
    { symbol: "CA1", reason: "overlapping-match" },
    { symbol: "X", reason: "invalid-range" },
  ])
})

test("client rectangles become stable page-local bounds", () => {
  assert.deepEqual(
    core.boundsFromClientRect(
      { left: 120, top: 80, right: 170, bottom: 96 },
      { left: 100, top: 50 },
    ),
    { left: 20, top: 30, right: 70, bottom: 46 },
  )
  assert.equal(
    core.containsPointInBounds({ left: 20, top: 30, right: 70, bottom: 46 }, 30, 40),
    true,
  )
  assert.equal(
    core.containsPointInBounds({ left: 20, top: 30, right: 70, bottom: 46 }, 80, 40),
    false,
  )
})

test("font metrics remove selection-box leading without moving the baseline", () => {
  const bounds = { left: 20, top: 30, right: 70, bottom: 54 }
  const metrics = {
    fontBoundingBoxAscent: 18,
    fontBoundingBoxDescent: 6,
    actualBoundingBoxAscent: 12,
    actualBoundingBoxDescent: 3,
  }
  assert.deepEqual(core.tightenBoundsToTextMetrics(bounds, metrics), {
    left: 20,
    top: 36,
    right: 70,
    bottom: 51,
  })
})

test("rotated text tightens the cross-axis and respects reversed direction", () => {
  const bounds = { left: 20, top: 30, right: 44, bottom: 80 }
  const metrics = {
    fontBoundingBoxAscent: 18,
    fontBoundingBoxDescent: 6,
    actualBoundingBoxAscent: 12,
    actualBoundingBoxDescent: 3,
  }
  assert.deepEqual(
    core.tightenBoundsToTextMetrics(bounds, metrics, {
      crossAxis: "x",
      crossAxisDirection: -1,
    }),
    { left: 23, top: 30, right: 38, bottom: 80 },
  )
})

test("rotated pill geometry uses glyph thickness rather than inline length", () => {
  assert.deepEqual(
    core.computeDecorationGeometry(
      { left: 20, top: 30, right: 46, bottom: 130 },
      5,
      { kind: "pill-outline", outerSpreadEm: 0.11, radiusEm: 0.1 },
      { crossAxis: "x", crossAxisDirection: -1 },
    ),
    {
      bounds: { left: 17.14, top: 27.14, right: 48.86, bottom: 132.86 },
      borderRadius: 5.46,
      borderWidth: 2.86,
    },
  )
})

test("rotated underline follows the transformed baseline edge", () => {
  const geometry = core.computeDecorationGeometry(
    { left: 20, top: 30, right: 46, bottom: 130 },
    5,
    { kind: "underline", thicknessEm: 0.08, bottomInsetEm: 0.04 },
    { crossAxis: "x", crossAxisDirection: -1 },
  )
  assert.deepEqual(
    { ...geometry.bounds, right: Number(geometry.bounds.right.toFixed(2)) },
    { left: 21.04, top: 30, right: 23.12, bottom: 130 },
  )
})

test("rotated ellipse applies character bleed along the inline axis", () => {
  assert.deepEqual(
    core.computeDecorationGeometry(
      { left: 20, top: 30, right: 46, bottom: 130 },
      5,
      { kind: "ellipse", inlineBleedCharsPerSide: 0.2, verticalBleedEm: 0.1 },
      { crossAxis: "x", crossAxisDirection: -1 },
    ),
    {
      bounds: { left: 17.4, top: 26, right: 48.6, bottom: 134 },
    },
  )
})
