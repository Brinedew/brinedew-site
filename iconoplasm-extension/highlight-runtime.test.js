import assert from "node:assert/strict"
import test from "node:test"

await import("./highlight-runtime.js")

const runtime = globalThis.IconoplasmHighlightRuntime.createHighlightRuntime()

test("the shared HTML and PDF runtime exposes all four canonical shape contracts", () => {
  assert.deepEqual(runtime.getCanvasShape("underline"), {
    kind: "underline",
    thicknessEm: 0.16,
    bottomInsetEm: 0.01,
  })
  assert.deepEqual(runtime.getCanvasShape("pill"), {
    kind: "pill",
    radiusEm: 0.18,
    fillSpreadEm: 0.1,
    fillAlpha: 0.72,
    ringSpreadEm: 0.145,
    ringColor: "rgba(22, 18, 16, 0.58)",
    recolorGlyphs: true,
  })
  assert.deepEqual(runtime.getCanvasShape("pill-outline"), {
    kind: "pill-outline",
    radiusEm: 0.18,
    outerSpreadEm: 0.11,
    outerAlpha: 0.76,
    innerSpreadEm: 0.08,
    innerColor: "rgba(255, 255, 255, 0.3)",
  })
  assert.deepEqual(runtime.getCanvasShape("ellipse"), {
    kind: "ellipse",
    inlineBleedCharsPerSide: 0.5,
    verticalBleedEm: 0.2,
    strokeWidthPx: 1.9,
    roughness: 1.28,
    bowing: 0.62,
    maxRandomnessOffset: 1.08,
    curveFitting: 0.9,
    curveStepCount: 8,
  })
})

test("mode selection changes the PDF shape without inventing extra states", () => {
  for (const mode of ["underline", "pill", "pill-outline", "ellipse"]) {
    assert.equal(runtime.setMode(mode), mode)
    assert.equal(runtime.getMode(), mode)
    assert.equal(runtime.getCanvasShape().kind, mode)
  }
  assert.equal(runtime.setMode("unknown"), "underline")
})
