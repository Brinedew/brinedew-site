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

test("page borders do not shift decorations or hit targets away from glyphs", () => {
  const pageBorderRect = { left: 559, top: 75 }
  const pageOrigin = core.contentOriginFromBorderRect(pageBorderRect, { left: 9, top: 9 })
  const glyphRect = {
    left: 941.71875,
    top: 149.625,
    right: 1012.890625,
    bottom: 177.625,
  }

  assert.deepEqual(pageOrigin, { left: 568, top: 84 })
  const localBounds = core.boundsFromClientRect(glyphRect, pageOrigin)
  assert.deepEqual(localBounds, {
    left: 373.71875,
    top: 65.625,
    right: 444.890625,
    bottom: 93.625,
  })
  assert.deepEqual(
    {
      left: pageOrigin.left + localBounds.left,
      top: pageOrigin.top + localBounds.top,
      right: pageOrigin.left + localBounds.right,
      bottom: pageOrigin.top + localBounds.bottom,
    },
    glyphRect,
  )
  assert.equal(
    core.containsPointInBounds(
      localBounds,
      (glyphRect.left + glyphRect.right) / 2 - pageOrigin.left,
      (glyphRect.top + glyphRect.bottom) / 2 - pageOrigin.top,
    ),
    true,
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

test("underline uses the font line box so it clears measured glyph ink", () => {
  const inkBounds = { left: 20, top: 36, right: 70, bottom: 59 }
  const selectionBounds = { left: 20, top: 30, right: 70, bottom: 66 }
  const geometry = core.computeDecorationGeometry(
    inkBounds,
    5,
    { kind: "underline", thicknessEm: 0.16, bottomInsetEm: 0.01 },
    { selectionBounds },
  )

  assert.deepEqual(geometry.bounds, {
    left: 20,
    top: 59.88,
    right: 70,
    bottom: 65.64,
  })
  assert.ok(geometry.bounds.top > inkBounds.bottom)
})

test("rough ellipse uses the font line box instead of crossing tightened glyph ink", () => {
  const inkBounds = { left: 20, top: 36, right: 70, bottom: 51 }
  const selectionBounds = { left: 20, top: 30, right: 70, bottom: 54 }
  const geometry = core.computeDecorationGeometry(
    inkBounds,
    5,
    {
      kind: "ellipse",
      inlineBleedCharsPerSide: 0.5,
      verticalBleedEm: 0.2,
      crossToInlineTransferRatio: 0.2,
    },
    { selectionBounds },
  )

  assert.deepEqual(geometry.bounds, {
    left: 11.64,
    top: 28.56,
    right: 78.36,
    bottom: 55.44,
  })
  assert.ok(geometry.bounds.top < inkBounds.top)
  assert.ok(geometry.bounds.bottom > inkBounds.bottom)
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
  const geometry = core.computeDecorationGeometry(
    { left: 20, top: 30, right: 46, bottom: 130 },
    5,
    { kind: "pill-outline", outerSpreadEm: 0.11, innerSpreadEm: 0.08, radiusEm: 0.1 },
    { crossAxis: "x", crossAxisDirection: -1 },
  )
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(geometry, (_key, value) =>
        typeof value === "number" ? Number(value.toFixed(6)) : value,
      ),
    ),
    {
      bounds: { left: 15.06, top: 25.06, right: 50.94, bottom: 134.94 },
      borderRadius: 7.54,
      borderWidth: 2.86,
      innerClearance: 2.08,
    },
  )
})

test("outline pills preserve visible clearance between the border and glyph ink", () => {
  const inkBounds = { left: 373.71875, top: 71.625, right: 444.890625, bottom: 90.625 }
  const geometry = core.computeDecorationGeometry(inkBounds, 5, {
    kind: "pill-outline",
    outerSpreadEm: 0.11,
    innerSpreadEm: 0.08,
    radiusEm: 0.18,
  })
  const borderInnerBounds = {
    left: geometry.bounds.left + geometry.borderWidth,
    top: geometry.bounds.top + geometry.borderWidth,
    right: geometry.bounds.right - geometry.borderWidth,
    bottom: geometry.bounds.bottom - geometry.borderWidth,
  }

  const epsilon = 1e-9
  assert.ok(inkBounds.left - borderInnerBounds.left >= geometry.innerClearance - epsilon)
  assert.ok(inkBounds.top - borderInnerBounds.top >= geometry.innerClearance - epsilon)
  assert.ok(borderInnerBounds.right - inkBounds.right >= geometry.innerClearance - epsilon)
  assert.ok(borderInnerBounds.bottom - inkBounds.bottom >= geometry.innerClearance - epsilon)
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
  const geometry = core.computeDecorationGeometry(
    { left: 20, top: 30, right: 46, bottom: 130 },
    5,
    {
      kind: "ellipse",
      inlineBleedCharsPerSide: 0.2,
      verticalBleedEm: 0.1,
      crossToInlineTransferRatio: 0.2,
    },
    { crossAxis: "x", crossAxisDirection: -1 },
  )
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(geometry, (_key, value) =>
        typeof value === "number" ? Number(value.toFixed(6)) : value,
      ),
    ),
    {
      bounds: { left: 20.52, top: 22.88, right: 45.48, bottom: 137.12 },
      transferredSpan: 6.24,
    },
  )
})
