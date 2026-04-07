;(function (global) {
  "use strict"

  const DEFAULT_PLACEHOLDER_COLOR = "#6B6B78"
  const HIGHLIGHT_RENDER_CONTRACT = "paint-only-no-inline-metrics"
  const PILL_INLINE_BLEED_CHARS_PER_SIDE = 0.25
  const PILL_INLINE_BLEED_EM_FLOOR = 0.1
  const PILL_TOP_BLEED_EM = 0.06
  const PILL_BOTTOM_BLEED_EM = 0.05
  const PILL_RADIUS_EM = 0.18
  const PILL_RING_WIDTH_EM = 0.14
  // Give the rough loop one full character of extra horizontal room overall.
  // Anything tighter starts to look like the outline got shrink-wrapped to the glyphs.
  const ELLIPSE_INLINE_BLEED_CHARS_PER_SIDE = 0.5
  const ELLIPSE_VERTICAL_BLEED_EM = 0.2
  const ELLIPSE_STROKE_WIDTH = 1.9
  const ELLIPSE_ROUGHNESS = 1.28
  const ELLIPSE_BOWING = 0.62
  const ELLIPSE_RANDOMNESS = 1.08
  const ELLIPSE_CURVE_FITTING = 0.9
  const ELLIPSE_CURVE_STEP_COUNT = 8

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

    function clampRoundedRectRadius(width, height, radius) {
      return Math.max(
        0,
        Math.min(Number(radius || 0), Number(width || 0) / 2, Number(height || 0) / 2),
      )
    }

    function buildRoundedRectPath(x, y, width, height, radius) {
      const safeX = Number(x || 0)
      const safeY = Number(y || 0)
      const safeWidth = Math.max(0, Number(width || 0))
      const safeHeight = Math.max(0, Number(height || 0))
      const safeRadius = clampRoundedRectRadius(safeWidth, safeHeight, radius)
      const right = safeX + safeWidth
      const bottom = safeY + safeHeight
      if (safeRadius <= 0) {
        return `M ${safeX} ${safeY} H ${right} V ${bottom} H ${safeX} Z`
      }
      return [
        `M ${safeX + safeRadius} ${safeY}`,
        `H ${right - safeRadius}`,
        `A ${safeRadius} ${safeRadius} 0 0 1 ${right} ${safeY + safeRadius}`,
        `V ${bottom - safeRadius}`,
        `A ${safeRadius} ${safeRadius} 0 0 1 ${right - safeRadius} ${bottom}`,
        `H ${safeX + safeRadius}`,
        `A ${safeRadius} ${safeRadius} 0 0 1 ${safeX} ${bottom - safeRadius}`,
        `V ${safeY + safeRadius}`,
        `A ${safeRadius} ${safeRadius} 0 0 1 ${safeX + safeRadius} ${safeY}`,
        "Z",
      ].join(" ")
    }

    function buildRoundedRectSvgNode(className, x, y, width, height, radius) {
      const svgNs = "http://www.w3.org/2000/svg"
      const rect = document.createElementNS(svgNs, "rect")
      rect.setAttribute("class", className)
      rect.setAttribute("x", String(x))
      rect.setAttribute("y", String(y))
      rect.setAttribute("width", String(width))
      rect.setAttribute("height", String(height))
      rect.setAttribute("rx", String(clampRoundedRectRadius(width, height, radius)))
      rect.setAttribute("ry", String(clampRoundedRectRadius(width, height, radius)))
      return rect
    }

    function buildPillPaintSvgNode(variant, widthPx, heightPx, radiusPx, ringWidthPx) {
      const svgNs = "http://www.w3.org/2000/svg"
      const svg = document.createElementNS(svgNs, "svg")
      const width = Math.max(2, Number(widthPx || 0))
      const height = Math.max(2, Number(heightPx || 0))
      const outerInset = 0.5
      const outerWidth = Math.max(1, width - outerInset * 2)
      const outerHeight = Math.max(1, height - outerInset * 2)
      const outerRadius = clampRoundedRectRadius(outerWidth, outerHeight, radiusPx - outerInset)

      svg.setAttribute("class", "iconoplasm-gene-paint-svg iconoplasm-gene-paint-svg--pill")
      svg.setAttribute("viewBox", `0 0 ${width} ${height}`)
      svg.setAttribute("preserveAspectRatio", "none")
      svg.setAttribute("aria-hidden", "true")

      if (variant === "outline") {
        const bandInset = Math.max(1.5, Number(ringWidthPx || 0) + 0.5)
        const innerWidth = Math.max(0, width - bandInset * 2)
        const innerHeight = Math.max(0, height - bandInset * 2)
        const innerRadius = clampRoundedRectRadius(innerWidth, innerHeight, outerRadius - bandInset)
        if (innerWidth > 1 && innerHeight > 1) {
          const band = document.createElementNS(svgNs, "path")
          band.setAttribute("class", "iconoplasm-gene-paint-svg-pill__band")
          band.setAttribute(
            "d",
            [
              buildRoundedRectPath(outerInset, outerInset, outerWidth, outerHeight, outerRadius),
              buildRoundedRectPath(bandInset, bandInset, innerWidth, innerHeight, innerRadius),
            ].join(" "),
          )
          band.setAttribute("fill-rule", "evenodd")
          svg.appendChild(band)
          svg.appendChild(
            buildRoundedRectSvgNode(
              "iconoplasm-gene-paint-svg-pill__inner-highlight",
              bandInset + 0.5,
              bandInset + 0.5,
              Math.max(0, width - (bandInset + 0.5) * 2),
              Math.max(0, height - (bandInset + 0.5) * 2),
              Math.max(0, innerRadius - 0.5),
            ),
          )
        } else {
          svg.appendChild(
            buildRoundedRectSvgNode(
              "iconoplasm-gene-paint-svg-pill__fill",
              outerInset,
              outerInset,
              outerWidth,
              outerHeight,
              outerRadius,
            ),
          )
        }
      } else {
        svg.appendChild(
          buildRoundedRectSvgNode(
            "iconoplasm-gene-paint-svg-pill__fill",
            outerInset,
            outerInset,
            outerWidth,
            outerHeight,
            outerRadius,
          ),
        )
        svg.appendChild(
          buildRoundedRectSvgNode(
            "iconoplasm-gene-paint-svg-pill__inner-highlight",
            1.5,
            1.5,
            Math.max(0, width - 3),
            Math.max(0, height - 3),
            Math.max(0, outerRadius - 1),
          ),
        )
      }

      svg.appendChild(
        buildRoundedRectSvgNode(
          "iconoplasm-gene-paint-svg-pill__outer-stroke",
          outerInset,
          outerInset,
          outerWidth,
          outerHeight,
          outerRadius,
        ),
      )
      return svg
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

    function buildMeasuredRoughEllipseSvgNode(widthPx, heightPx) {
      const svgNs = "http://www.w3.org/2000/svg"
      const svg = document.createElementNS(svgNs, "svg")
      const width = Math.max(4, Number(widthPx || 0))
      const height = Math.max(4, Number(heightPx || 0))
      roughEllipseSerial += 1
      const loopSeed = 9001 + roughEllipseSerial * 97

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
        .filter((rect) => rect && rect.width > 0.5 && rect.height > 0.5)
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

    function appendPillFragmentsToScene(sceneLayer, scene, variant, color) {
      if (!sceneLayer || !scene || !Array.isArray(scene.fragments) || !scene.fragments.length) return
      const normalizedVariant = String(variant || "").trim().toLowerCase()
      if (normalizedVariant !== "filled" && normalizedVariant !== "outline") return

      const bleedInlinePx = Math.max(
        1,
        scene.fontSizePx * PILL_INLINE_BLEED_EM_FLOOR,
        scene.averageCharWidth * PILL_INLINE_BLEED_CHARS_PER_SIDE,
      )
      const bleedTopPx = Math.max(1, scene.fontSizePx * PILL_TOP_BLEED_EM)
      const bleedBottomPx = Math.max(1, scene.fontSizePx * PILL_BOTTOM_BLEED_EM)
      const radiusPx = Math.max(2, scene.fontSizePx * PILL_RADIUS_EM)
      const ringWidthPx = Math.max(2, Math.min(4, scene.fontSizePx * PILL_RING_WIDTH_EM))

      for (const rect of scene.fragments) {
        const fragmentWidth = rect.width + bleedInlinePx * 2
        const fragmentHeight = rect.height + bleedTopPx + bleedBottomPx
        const fragment = document.createElement("span")
        fragment.className =
          "iconoplasm-gene-paint-fragment iconoplasm-gene-paint-fragment--pill iconoplasm-gene-paint-fragment--pill-" +
          normalizedVariant
        fragment.style.left = rect.left - bleedInlinePx + "px"
        fragment.style.top = rect.top - bleedTopPx + "px"
        fragment.style.width = fragmentWidth + "px"
        fragment.style.height = fragmentHeight + "px"
        fragment.style.setProperty("--iconoplasm-gene-color", color || placeholderColor)
        fragment.appendChild(
          buildPillPaintSvgNode(normalizedVariant, fragmentWidth, fragmentHeight, radiusPx, ringWidthPx),
        )
        sceneLayer.appendChild(fragment)
      }
    }

    function appendEllipseFragmentsToScene(sceneLayer, scene, color) {
      if (!sceneLayer || !scene || !Array.isArray(scene.fragments) || !scene.fragments.length) return
      const bleedInlinePx = Math.max(2, scene.averageCharWidth * ELLIPSE_INLINE_BLEED_CHARS_PER_SIDE)
      const bleedVerticalPx = Math.max(2, scene.fontSizePx * ELLIPSE_VERTICAL_BLEED_EM)
      for (const rect of scene.fragments) {
        const width = rect.width + bleedInlinePx * 2
        const height = rect.height + bleedVerticalPx * 2
        const fragment = document.createElement("span")
        fragment.className = "iconoplasm-gene-paint-fragment iconoplasm-gene-paint-fragment--ellipse"
        fragment.style.left = rect.left - bleedInlinePx + "px"
        fragment.style.top = rect.top - bleedVerticalPx + "px"
        fragment.style.width = width + "px"
        fragment.style.height = height + "px"
        fragment.style.setProperty("--iconoplasm-gene-color", color || placeholderColor)
        fragment.appendChild(buildMeasuredRoughEllipseSvgNode(width, height))
        sceneLayer.appendChild(fragment)
      }
    }

    const HIGHLIGHT_RENDERERS = Object.freeze({
      underline: Object.freeze({
        className: "iconoplasm-gene--underline",
        contract: HIGHLIGHT_RENDER_CONTRACT,
        family: "underline",
        substrate: "host-paint",
        variant: "underline",
        render() {},
      }),
      pill: Object.freeze({
        className: "iconoplasm-gene--pill",
        contract: HIGHLIGHT_RENDER_CONTRACT,
        family: "pill",
        substrate: "anchored-scene",
        variant: "filled",
        render(sceneLayer, scene, context) {
          appendPillFragmentsToScene(sceneLayer, scene, "filled", context.color)
        },
      }),
      "pill-outline": Object.freeze({
        className: "iconoplasm-gene--pill-outline",
        contract: HIGHLIGHT_RENDER_CONTRACT,
        family: "pill",
        substrate: "anchored-scene",
        variant: "outline",
        render(sceneLayer, scene, context) {
          appendPillFragmentsToScene(sceneLayer, scene, "outline", context.color)
        },
      }),
      ellipse: Object.freeze({
        className: "iconoplasm-gene--ellipse",
        contract: HIGHLIGHT_RENDER_CONTRACT,
        family: "ellipse",
        substrate: "anchored-scene",
        variant: "ellipse",
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
      const sceneLayer = clearHighlightPaintLayer(el, "active") || ensureHighlightPaintLayer(el, "active")
      if (!sceneLayer || activeRenderer.substrate !== "anchored-scene") return
      const scene = measureHighlightScene(el)
      if (!scene || !scene.fragments.length) return
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
