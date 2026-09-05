;(function (global) {
  "use strict"

  const DEFAULT_PLACEHOLDER_COLOR = "#6B6B78"
  const HIGHLIGHT_RENDER_CONTRACT = "paint-only-no-inline-metrics"
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
    const resolveColor =
      typeof options.resolveColor === "function"
        ? options.resolveColor
        : () => DEFAULT_PLACEHOLDER_COLOR
    const placeholderColor = String(options.placeholderColor || DEFAULT_PLACEHOLDER_COLOR)

    let highlightMode = "underline"
    let highlightGeometryFrame = 0
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

    function ensureHighlightTextWrapper(el) {
      if (!el) return null
      let copy = el.querySelector(".iconoplasm-gene-copy")
      if (copy) return copy
      const text = String((el.dataset && el.dataset.geneLabel) || el.textContent || "")
      el.textContent = ""
      copy = document.createElement("span")
      copy.className = "iconoplasm-gene-copy"
      copy.setAttribute("data-icono-rough-copy", "true")
      copy.textContent = text
      el.appendChild(copy)
      return copy
    }

    function ensureHighlightPaintLayer(el, layerName = "active") {
      if (!el || !layerName) return null
      const className = "iconoplasm-gene-paint-layer--" + String(layerName || "").trim()
      let layer = el.querySelector("." + className)
      if (layer) return layer
      layer = document.createElement("span")
      layer.className = "iconoplasm-gene-paint-layer " + className
      layer.setAttribute("aria-hidden", "true")
      el.appendChild(layer)
      return layer
    }

    function clearHighlightPaintLayer(el, layerName = "active") {
      if (!el || !layerName) return null
      const className = ".iconoplasm-gene-paint-layer--" + String(layerName || "").trim()
      const layer = el.querySelector(className)
      if (!layer) return null
      layer.replaceChildren()
      return layer
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

    function collectHighlightFragments(copy, hostRect) {
      if (!copy || !hostRect) return []
      return Array.from(copy.getClientRects())
        .filter((rect) => {
          if (!rect || rect.width <= 0.5 || rect.height <= 0.5) return false
          if (rect.right < hostRect.left - 1 || rect.left > hostRect.right + 1) return false
          if (rect.bottom < hostRect.top - 1 || rect.top > hostRect.bottom + 1) return false
          return true
        })
        .map((rect) => ({
          left: rect.left - hostRect.left,
          top: rect.top - hostRect.top,
          width: rect.width,
          height: rect.height,
        }))
    }

    function measureHighlightScene(el) {
      if (!el) return null
      const copy = ensureHighlightTextWrapper(el)
      if (!copy) return null
      const hostRect = el.getBoundingClientRect()
      const copyStyle = window.getComputedStyle(copy)
      const fontSizePx = Math.max(1, Number.parseFloat(copyStyle.fontSize) || 16)
      const text = String(copy.textContent || "").trim()
      const charCount = Math.max(text.length, 1)
      const averageCharWidth = Math.max(fontSizePx * 0.24, hostRect.width / charCount || 0)
      const fragments = collectHighlightFragments(copy, hostRect)
      return {
        copy,
        hostRect,
        copyStyle,
        fontSizePx,
        averageCharWidth,
        fragments,
      }
    }

    function appendEllipseFragmentsToScene(sceneLayer, scene, color) {
      if (!sceneLayer || !scene || !Array.isArray(scene.fragments) || !scene.fragments.length)
        return
      const bleedInlinePx = Math.max(
        2,
        scene.averageCharWidth * ELLIPSE_INLINE_BLEED_CHARS_PER_SIDE,
      )
      const bleedVerticalPx = Math.max(2, scene.fontSizePx * ELLIPSE_VERTICAL_BLEED_EM)
      for (const rect of scene.fragments) {
        const rawWidth = rect.width + bleedInlinePx * 2
        const rawHeight = rect.height + bleedVerticalPx * 2
        const transferredSpan = rawHeight * ELLIPSE_CROSS_TO_INLINE_TRANSFER_RATIO
        const width = rawWidth + transferredSpan
        const height = rawHeight - transferredSpan
        const fragment = document.createElement("span")
        fragment.className =
          "iconoplasm-gene-paint-fragment iconoplasm-gene-paint-fragment--ellipse"
        fragment.style.left = rect.left - bleedInlinePx - transferredSpan / 2 + "px"
        fragment.style.top = rect.top - bleedVerticalPx + transferredSpan / 2 + "px"
        fragment.style.width = width + "px"
        fragment.style.height = height + "px"
        fragment.style.setProperty("--iconoplasm-gene-color", color || placeholderColor)
        fragment.appendChild(buildMeasuredRoughEllipseSvgNode(width, height))
        sceneLayer.appendChild(fragment)
      }
    }

    function highlightSceneRenderKey(mode, scene, context) {
      const fragments = Array.isArray(scene && scene.fragments) ? scene.fragments : []
      const geometry = fragments
        .map((rect) =>
          [
            Math.round(Number(rect.left || 0) * 10) / 10,
            Math.round(Number(rect.top || 0) * 10) / 10,
            Math.round(Number(rect.width || 0) * 10) / 10,
            Math.round(Number(rect.height || 0) * 10) / 10,
          ].join(","),
        )
        .join("|")
      return [
        String(mode || ""),
        String((context && context.symbol) || ""),
        String((context && context.color) || ""),
        Math.round(Number((scene && scene.fontSizePx) || 0) * 10) / 10,
        geometry,
      ].join("::")
    }

    const HIGHLIGHT_RENDERERS = Object.freeze({
      underline: Object.freeze({
        className: "iconoplasm-gene--underline",
        contract: HIGHLIGHT_RENDER_CONTRACT,
        family: "underline",
        substrate: "host-paint",
        variant: "underline",
        canvasShape: CANVAS_SHAPE_CONTRACTS.underline,
        render() {},
      }),
      pill: Object.freeze({
        className: "iconoplasm-gene--pill",
        contract: HIGHLIGHT_RENDER_CONTRACT,
        family: "pill",
        substrate: "host-paint",
        variant: "filled",
        canvasShape: CANVAS_SHAPE_CONTRACTS.pill,
        render() {},
      }),
      "pill-outline": Object.freeze({
        className: "iconoplasm-gene--pill-outline",
        contract: HIGHLIGHT_RENDER_CONTRACT,
        family: "pill",
        substrate: "host-paint",
        variant: "outline",
        canvasShape: CANVAS_SHAPE_CONTRACTS["pill-outline"],
        render() {},
      }),
      ellipse: Object.freeze({
        className: "iconoplasm-gene--ellipse",
        contract: HIGHLIGHT_RENDER_CONTRACT,
        family: "ellipse",
        substrate: "anchored-scene",
        variant: "ellipse",
        canvasShape: CANVAS_SHAPE_CONTRACTS.ellipse,
        render(sceneLayer, scene, context) {
          appendEllipseFragmentsToScene(sceneLayer, scene, context.color)
        },
      }),
    })

    function syncHighlightRendererState(el, rendererContext) {
      const activeRenderer = HIGHLIGHT_RENDERERS[highlightMode] || HIGHLIGHT_RENDERERS.underline
      for (const [mode, renderer] of Object.entries(HIGHLIGHT_RENDERERS)) {
        el.classList.toggle(renderer.className, highlightMode === mode)
      }
      const sceneLayer = ensureHighlightPaintLayer(el, "active")
      if (!sceneLayer) return
      if (activeRenderer.substrate !== "anchored-scene") {
        if (sceneLayer.dataset.iconoRenderKey) delete sceneLayer.dataset.iconoRenderKey
        sceneLayer.replaceChildren()
        return
      }
      const scene = measureHighlightScene(el)
      if (!scene || !scene.fragments.length) {
        if (sceneLayer.dataset.iconoRenderKey) delete sceneLayer.dataset.iconoRenderKey
        sceneLayer.replaceChildren()
        return
      }
      const renderKey = highlightSceneRenderKey(highlightMode, scene, rendererContext)
      if (sceneLayer.dataset.iconoRenderKey === renderKey) return
      sceneLayer.dataset.iconoRenderKey = renderKey
      sceneLayer.replaceChildren()
      activeRenderer.render(sceneLayer, scene, rendererContext)
    }

    function applyHighlightStyle(el, symbol, color) {
      if (!el) return
      const resolvedColor = color || resolveColor(symbol) || placeholderColor
      const tc = resolveTextColors(resolvedColor)
      ensureHighlightTextWrapper(el)
      el.dataset.gene = symbol
      el.style.setProperty("--iconoplasm-gene-color", resolvedColor)
      el.style.setProperty("--iconoplasm-gene-fg", tc.primary)
      el.style.setProperty("--iconoplasm-gene-muted-separator", tc.separator)
      // Fence: renderers can paint around the text or behind it, but they are not allowed to edit
      // the inline text box itself. If a future effect needs padding, borders, inline-block, or
      // other metric hacks on the live text, that effect is architecturally invalid here.
      syncHighlightRendererState(el, { symbol, color: resolvedColor })
    }

    function refreshHighlightStyles(root = document) {
      const scope = root && root.querySelectorAll ? root : document
      const genes = scope.querySelectorAll(".iconoplasm-gene")
      for (const el of genes) {
        const symbol = el.dataset ? el.dataset.gene : ""
        applyHighlightStyle(el, symbol, resolveColor(symbol))
      }
    }

    function scheduleHighlightGeometryRefresh() {
      if (highlightGeometryFrame) return
      highlightGeometryFrame = window.requestAnimationFrame(() => {
        highlightGeometryFrame = 0
        refreshHighlightStyles()
      })
    }

    return Object.freeze({
      contract: HIGHLIGHT_RENDER_CONTRACT,
      renderers: HIGHLIGHT_RENDERERS,
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
      ensureHighlightTextWrapper,
      ensureHighlightPaintLayer,
      applyHighlightStyle,
      refreshHighlightStyles,
      scheduleHighlightGeometryRefresh,
    })
  }

  global.IconoplasmHighlightRuntime = Object.freeze({
    HIGHLIGHT_RENDER_CONTRACT,
    createHighlightRuntime,
  })
})(globalThis)
