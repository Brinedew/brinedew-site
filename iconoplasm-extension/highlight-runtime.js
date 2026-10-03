;(function (global) {
  "use strict"

  // Give the rough loop one full character of extra horizontal room overall.
  // Anything tighter starts to look like the outline got shrink-wrapped to the glyphs.
  const ELLIPSE_INLINE_BLEED_CHARS_PER_SIDE = 0.5
  // Rough.js deliberately perturbs both strokes. A tighter loop can cut through
  // italic cap-height ink even when the nominal ellipse encloses the text box.
  const ELLIPSE_VERTICAL_BLEED_EM = 0.35
  const ELLIPSE_CROSS_TO_INLINE_TRANSFER_RATIO = 0.2
  const ELLIPSE_STROKE_WIDTH = 1.9
  const ELLIPSE_ROUGHNESS = 1.28
  const ELLIPSE_BOWING = 0.62
  const ELLIPSE_RANDOMNESS = 1.08
  const ELLIPSE_CURVE_FITTING = 0.9
  const ELLIPSE_CURVE_STEP_COUNT = 8
  const CANVAS_SHAPE_CONTRACTS = Object.freeze({
    underline: Object.freeze({
      kind: "underline",
      thicknessEm: 0.16,
      bottomInsetEm: 0.01,
    }),
    pill: Object.freeze({
      kind: "pill",
      radiusEm: 0.18,
      fillSpreadEm: 0.1,
      fillAlpha: 0.72,
      ringSpreadEm: 0.145,
      ringColor: "rgba(22, 18, 16, 0.58)",
      recolorGlyphs: true,
    }),
    "pill-outline": Object.freeze({
      kind: "pill-outline",
      radiusEm: 0.18,
      outerSpreadEm: 0.11,
      outerAlpha: 0.76,
      innerSpreadEm: 0.08,
      innerColor: "rgba(255, 255, 255, 0.3)",
    }),
    ellipse: Object.freeze({
      kind: "ellipse",
      inlineBleedCharsPerSide: ELLIPSE_INLINE_BLEED_CHARS_PER_SIDE,
      verticalBleedEm: ELLIPSE_VERTICAL_BLEED_EM,
      crossToInlineTransferRatio: ELLIPSE_CROSS_TO_INLINE_TRANSFER_RATIO,
      strokeWidthPx: ELLIPSE_STROKE_WIDTH,
      roughness: ELLIPSE_ROUGHNESS,
      bowing: ELLIPSE_BOWING,
      maxRandomnessOffset: ELLIPSE_RANDOMNESS,
      curveFitting: ELLIPSE_CURVE_FITTING,
      curveStepCount: ELLIPSE_CURVE_STEP_COUNT,
    }),
  })

  function createHighlightRuntime(options = {}) {
    const resolveTextColors =
      typeof options.textColors === "function"
        ? options.textColors
        : () => ({
            primary: "rgb(24, 22, 20)",
            separator: "rgba(24, 22, 20, 0.16)",
          })

    let highlightMode = "underline"
    let roughEllipseSerial = 0

    function normalizeHighlightMode(raw) {
      const value = String(raw || "")
        .trim()
        .toLowerCase()
      if (value === "pill") return "pill"
      if (value === "pill-outline") return "pill-outline"
      if (value === "ellipse") return "ellipse"
      return "underline"
    }

    function setMode(raw) {
      highlightMode = normalizeHighlightMode(raw)
      return highlightMode
    }

    function getMode() {
      return highlightMode
    }

    function resolveRough() {
      return global && global.rough && typeof global.rough.svg === "function" ? global.rough : null
    }

    function buildFallbackEllipseNode(svg, width, height) {
      const svgNs = "http://www.w3.org/2000/svg"
      const ellipse = document.createElementNS(svgNs, "ellipse")
      ellipse.setAttribute("cx", String(width / 2))
      ellipse.setAttribute("cy", String(height / 2))
      ellipse.setAttribute("rx", String(Math.max(1, width / 2 - 1)))
      ellipse.setAttribute("ry", String(Math.max(1, height / 2 - 1)))
      ellipse.setAttribute("fill", "none")
      ellipse.setAttribute("stroke", "currentColor")
      ellipse.setAttribute("stroke-width", String(ELLIPSE_STROKE_WIDTH))
      ellipse.setAttribute("stroke-linecap", "round")
      ellipse.setAttribute("stroke-linejoin", "round")
      ellipse.setAttribute("vector-effect", "non-scaling-stroke")
      svg.appendChild(ellipse)
    }

    function buildMeasuredRoughEllipseSvgNode(widthPx, heightPx, options = {}) {
      const svgNs = "http://www.w3.org/2000/svg"
      const svg = document.createElementNS(svgNs, "svg")
      const width = Math.max(4, Number(widthPx || 0))
      const height = Math.max(4, Number(heightPx || 0))
      const requestedSeed = Number(options.seed)
      let loopSeed
      if (Number.isFinite(requestedSeed) && requestedSeed > 0) {
        loopSeed = Math.trunc(requestedSeed)
      } else {
        roughEllipseSerial += 1
        loopSeed = 9001 + roughEllipseSerial * 97
      }

      svg.setAttribute("class", "iconoplasm-gene-rough-loop")
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
      svg.setAttribute("preserveAspectRatio", "none")
      svg.setAttribute("aria-hidden", "true")

      const roughImpl = resolveRough()
      if (!roughImpl) {
        buildFallbackEllipseNode(svg, width, height)
        return svg
      }

      const roughSvg = roughImpl.svg(svg)
      const ellipse = roughSvg.ellipse(width / 2, height / 2, width - 2, height - 2, {
        stroke: "currentColor",
        fill: "none",
        seed: loopSeed,
        strokeWidth: ELLIPSE_STROKE_WIDTH,
        roughness: ELLIPSE_ROUGHNESS,
        bowing: ELLIPSE_BOWING,
        maxRandomnessOffset: ELLIPSE_RANDOMNESS,
        curveFitting: ELLIPSE_CURVE_FITTING,
        curveStepCount: ELLIPSE_CURVE_STEP_COUNT,
      })
      ellipse.setAttribute("fill", "none")
      ellipse.setAttribute("stroke-linecap", "round")
      ellipse.setAttribute("stroke-linejoin", "round")
      ellipse.setAttribute("vector-effect", "non-scaling-stroke")
      svg.appendChild(ellipse)
      return svg
    }

    return Object.freeze({
      normalizeHighlightMode,
      setMode,
      getMode,
      getTextColors: resolveTextColors,
      getCanvasShape(mode = highlightMode) {
        return CANVAS_SHAPE_CONTRACTS[normalizeHighlightMode(mode)]
      },
      createRoughEllipseNode(widthPx, heightPx, options) {
        return buildMeasuredRoughEllipseSvgNode(widthPx, heightPx, options)
      },
    })
  }

  global.IconoplasmHighlightRuntime = Object.freeze({
    createHighlightRuntime,
  })
})(globalThis)
