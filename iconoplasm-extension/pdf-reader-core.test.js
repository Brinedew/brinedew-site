import assert from "node:assert/strict"
import test from "node:test"

await import("./pdf-reader-core.js")

const core = globalThis.IconoplasmPdfReaderCore

function glyph(glyphOrdinal, unicode, left, options = {}) {
  return {
    glyphOrdinal,
    operationOrdinal: options.operationOrdinal ?? 0,
    operationIndex: options.operationIndex ?? 8,
    localGlyphIndex: glyphOrdinal,
    unicode,
    fontCharacter: unicode,
    fontId: "g_font_1",
    supported: options.supported ?? true,
    transform: options.transform ?? [2, 0, 0, 2, 10, 20],
    cell: [left, -8, left + 5, 2],
  }
}

const shapes = {
  underline: { kind: "underline", thicknessEm: 0.16, bottomInsetEm: 0.01 },
  pill: {
    kind: "pill",
    radiusEm: 0.18,
    fillSpreadEm: 0.1,
    fillAlpha: 0.72,
    ringSpreadEm: 0.145,
    ringColor: "rgba(22, 18, 16, 0.58)",
    recolorGlyphs: true,
  },
  "pill-outline": {
    kind: "pill-outline",
    radiusEm: 0.18,
    outerSpreadEm: 0.11,
    outerAlpha: 0.76,
    innerSpreadEm: 0.08,
    innerColor: "rgba(255, 255, 255, 0.3)",
  },
  ellipse: {
    kind: "ellipse",
    inlineBleedCharsPerSide: 0.5,
    verticalBleedEm: 0.2,
    strokeWidthPx: 1.9,
  },
}

const presentation = (mode = "pill") => () => ({
  color: "#234567",
  foreground: "#ffffff",
  shape: shapes[mode],
})

test("glyph cells are transformed by the authoritative canvas matrix", () => {
  assert.deepEqual(core.polygonForGlyphRecord(glyph(0, "H", 0)), [
    [10, 4],
    [20, 4],
    [20, 24],
    [10, 24],
  ])
})

test("an exact complete-glyph match creates one immutable paint plan", () => {
  const records = [glyph(0, "H", 0), glyph(1, "E", 5), glyph(2, "R", 10), glyph(3, "2", 15)]
  const plan = core.buildExactPaintPlan(
    records,
    (text) => [{ index: 0, length: text.length, symbol: "HER2", text }],
    presentation(),
  )

  assert.equal(plan.accepted.length, 1)
  assert.equal(plan.rejected.length, 0)
  assert.deepEqual(plan.foregroundByGlyphOrdinal, ["#ffffff", "#ffffff", "#ffffff", "#ffffff"])
  assert.equal(plan.decorationsByOperationOrdinal[0].length, 2)
  assert.equal(plan.decorationsByOperationOrdinal[0][0].kind, "fill-rounded-rect")
  assert.deepEqual(plan.accepted[0].bounds, { left: 10, top: 4, right: 50, bottom: 24 })
})

test("partial ligature matches fail closed", () => {
  const plan = core.buildExactPaintPlan(
    [glyph(0, "HER2", 0)],
    () => [{ index: 0, length: 3, symbol: "HER", text: "HER" }],
    presentation(),
  )
  assert.equal(plan.accepted.length, 0)
  assert.deepEqual(plan.rejected, [{ symbol: "HER", operationOrdinal: 0, reason: "partial-glyph" }])
  assert.equal(plan.decorationsByOperationOrdinal.length, 0)
})

test("unsupported renderer branches never receive color or hit geometry", () => {
  const plan = core.buildExactPaintPlan(
    [glyph(0, "P", 0), glyph(1, "53", 5, { supported: false })],
    () => [{ index: 0, length: 3, symbol: "P53", text: "P53" }],
    presentation(),
  )
  assert.equal(plan.accepted.length, 0)
  assert.equal(plan.rejected[0].reason, "unsupported-render-branch")
  assert.equal(plan.foregroundByGlyphOrdinal.length, 0)
})

test("matching never concatenates separate paint operations", () => {
  const records = [
    glyph(0, "BR", 0, { operationOrdinal: 0 }),
    glyph(1, "CA2", 5, { operationOrdinal: 1 }),
  ]
  const plan = core.buildExactPaintPlan(
    records,
    (text) => (text === "BRCA2" ? [{ index: 0, length: 5, symbol: "BRCA2" }] : []),
    presentation(),
  )
  assert.equal(plan.accepted.length, 0)
})

test("all four HTML modes produce one axis-aligned match decoration", () => {
  const records = [glyph(0, "B", 0), glyph(1, "R", 5), glyph(2, "C", 10), glyph(3, "A", 15)]
  for (const mode of ["underline", "pill", "pill-outline", "ellipse"]) {
    const plan = core.buildExactPaintPlan(
      records,
      () => [{ index: 0, length: 4, symbol: "BRCA", text: "BRCA" }],
      presentation(mode),
    )
    assert.equal(plan.accepted.length, 1, mode)
    assert.equal(plan.accepted[0].decoration.kind, mode)
    assert.deepEqual(plan.accepted[0].bounds, { left: 10, top: 4, right: 50, bottom: 24 })
    if (mode === "pill") {
      assert.deepEqual(plan.foregroundByGlyphOrdinal, ["#ffffff", "#ffffff", "#ffffff", "#ffffff"])
    } else {
      assert.equal(plan.foregroundByGlyphOrdinal.length, 0)
    }
  }
})

test("hover paint bounds include each mode's complete renderer-owned decoration", () => {
  const records = [glyph(0, "H", 0), glyph(1, "E", 5), glyph(2, "R", 10), glyph(3, "2", 15)]
  for (const mode of ["underline", "pill", "pill-outline", "ellipse"]) {
    const plan = core.buildExactPaintPlan(
      records,
      () => [{ index: 0, length: 4, symbol: "HER2", text: "HER2" }],
      presentation(mode),
    )
    const match = plan.accepted[0]
    const paintBounds = core.paintBoundsForMatch(match)
    assert.ok(paintBounds.left <= match.bounds.left, mode)
    assert.ok(paintBounds.top <= match.bounds.top, mode)
    assert.ok(paintBounds.right >= match.bounds.right, mode)
    assert.ok(paintBounds.bottom >= match.bounds.bottom, mode)
    if (mode === "pill" || mode === "pill-outline" || mode === "ellipse") {
      assert.ok(paintBounds.left < match.bounds.left, mode)
      assert.ok(paintBounds.right > match.bounds.right, mode)
    }
  }
})

test("adjacent rough ellipses keep separate owned contours", () => {
  const text = "BRCA1 BRCA2"
  const records = Array.from(text, (unicode, index) => glyph(index, unicode, index * 4))
  const plan = core.buildExactPaintPlan(
    records,
    () => [
      { index: 0, length: 5, symbol: "BRCA1", text: "BRCA1" },
      { index: 6, length: 5, symbol: "BRCA2", text: "BRCA2" },
    ],
    presentation("ellipse"),
  )

  const [first, second] = plan.accepted.map((match) => match.decoration)
  assert.equal(plan.accepted.length, 2)
  assert.ok(first.bounds.right < second.bounds.left)
  assert.ok(first.bounds.right <= first.baseBounds.right + 3.1)
  assert.ok(second.bounds.left >= second.baseBounds.left - 3.1)
})

test("hover uses polygon ownership rather than DOM range rectangles", () => {
  const polygon = [
    [10, 10],
    [20, 10],
    [20, 20],
    [10, 20],
  ]
  assert.equal(core.containsPointInPolygon(polygon, 15, 15), true)
  assert.equal(core.containsPointInPolygon(polygon, 25, 15), false)
})

test("render fingerprints reject survey and paint drift", () => {
  const records = [glyph(0, "H", 0)]
  assert.equal(core.renderFingerprint(records), core.renderFingerprint(structuredClone(records)))
  const changed = structuredClone(records)
  changed[0].cell[0] += 0.01
  assert.notEqual(core.renderFingerprint(records), core.renderFingerprint(changed))
})
