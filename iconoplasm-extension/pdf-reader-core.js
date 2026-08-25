;(function (root) {
  "use strict"

  const PDF_SHAPES = new Set(["underline", "pill-outline", "ellipse"])

  function normalizeTextRunMatches(text, findMatches, getPresentation) {
    const source = String(text || "")
    const accepted = []
    const rejected = []
    let claimedUntil = 0

    for (const rawMatch of typeof findMatches === "function" ? findMatches(source) : []) {
      const start = Number(rawMatch?.index)
      const length = Number(rawMatch?.length)
      const end = start + length
      const symbol = String(rawMatch?.symbol || "")
        .trim()
        .toUpperCase()
      const presentation = typeof getPresentation === "function" ? getPresentation(symbol) : null
      const shapeKind = String(presentation?.shape?.kind || "")
      const validRange =
        Number.isInteger(start) &&
        Number.isInteger(length) &&
        start >= 0 &&
        length > 0 &&
        end <= source.length
      const collision = validRange && start < claimedUntil
      const supportedShape = PDF_SHAPES.has(shapeKind)

      if (!validRange || collision || !presentation || !supportedShape) {
        rejected.push({
          symbol,
          reason: !validRange
            ? "invalid-range"
            : collision
              ? "overlapping-match"
              : !presentation
                ? "missing-presentation"
                : shapeKind === "pill"
                  ? "filled-pill-not-supported-in-pdf"
                  : "missing-shape-contract",
        })
        continue
      }

      claimedUntil = end
      accepted.push({
        symbol,
        label: String(rawMatch?.text || source.slice(start, end) || symbol),
        start,
        end,
        presentation,
      })
    }

    return { accepted, rejected }
  }

  function boundsFromClientRect(rect, pageRect) {
    const left = Number(rect?.left)
    const top = Number(rect?.top)
    const right = Number(rect?.right)
    const bottom = Number(rect?.bottom)
    const pageLeft = Number(pageRect?.left)
    const pageTop = Number(pageRect?.top)
    if (
      ![left, top, right, bottom, pageLeft, pageTop].every(Number.isFinite) ||
      right <= left ||
      bottom <= top
    ) {
      return null
    }
    return {
      left: left - pageLeft,
      top: top - pageTop,
      right: right - pageLeft,
      bottom: bottom - pageTop,
    }
  }

  function containsPointInBounds(bounds, x, y) {
    return Boolean(
      bounds &&
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      x >= bounds.left &&
      x <= bounds.right &&
      y >= bounds.top &&
      y <= bounds.bottom,
    )
  }

  function tightenBoundsToTextMetrics(bounds, metrics, options = {}) {
    const fontAscent = Number(metrics?.fontBoundingBoxAscent)
    const fontDescent = Number(metrics?.fontBoundingBoxDescent)
    const actualAscent = Number(metrics?.actualBoundingBoxAscent)
    const actualDescent = Number(metrics?.actualBoundingBoxDescent)
    const fontExtent = fontAscent + fontDescent
    const actualExtent = actualAscent + actualDescent
    if (
      !bounds ||
      ![fontAscent, fontDescent, actualAscent, actualDescent, fontExtent, actualExtent].every(
        Number.isFinite,
      ) ||
      fontExtent <= 0 ||
      actualExtent <= 0 ||
      actualExtent > fontExtent * 1.1
    ) {
      return bounds
    }

    const verticalText = options.crossAxis === "x"
    const minimum = verticalText ? bounds.left : bounds.top
    const maximum = verticalText ? bounds.right : bounds.bottom
    const extent = maximum - minimum
    if (!Number.isFinite(extent) || extent <= 0) return bounds
    const scale = extent / fontExtent
    const positiveDirection = Number(options.crossAxisDirection || 1) >= 0
    const baseline = positiveDirection ? minimum + fontAscent * scale : maximum - fontAscent * scale
    const tightMinimum = positiveDirection
      ? baseline - actualAscent * scale
      : baseline - actualDescent * scale
    const tightMaximum = positiveDirection
      ? baseline + actualDescent * scale
      : baseline + actualAscent * scale

    return verticalText
      ? { ...bounds, left: tightMinimum, right: tightMaximum }
      : { ...bounds, top: tightMinimum, bottom: tightMaximum }
  }

  function computeDecorationGeometry(bounds, labelLength, shape, options = {}) {
    const width = Number(bounds?.right) - Number(bounds?.left)
    const height = Number(bounds?.bottom) - Number(bounds?.top)
    if (!bounds || width <= 0 || height <= 0) return null

    const verticalText = options.crossAxis === "x"
    const crossExtent = verticalText ? width : height
    const inlineExtent = verticalText ? height : width
    const kind = shape?.kind

    if (kind === "underline") {
      const thickness = Math.max(1, crossExtent * Number(shape.thicknessEm || 0))
      const inset = Math.max(0, crossExtent * Number(shape.bottomInsetEm || 0))
      if (!verticalText) {
        return {
          bounds: {
            left: bounds.left,
            top: bounds.bottom - inset - thickness,
            right: bounds.right,
            bottom: bounds.bottom - inset,
          },
        }
      }

      const positiveDirection = Number(options.crossAxisDirection || 1) >= 0
      const edge = positiveDirection ? bounds.right - inset : bounds.left + inset
      return {
        bounds: {
          left: positiveDirection ? edge - thickness : edge,
          top: bounds.top,
          right: positiveDirection ? edge : edge + thickness,
          bottom: bounds.bottom,
        },
      }
    }

    if (kind === "pill-outline") {
      const spread = Math.max(1, crossExtent * Number(shape.outerSpreadEm || 0))
      const radius = Math.max(1, crossExtent * Number(shape.radiusEm || 0) + spread)
      return {
        bounds: {
          left: bounds.left - spread,
          top: bounds.top - spread,
          right: bounds.right + spread,
          bottom: bounds.bottom + spread,
        },
        borderRadius: radius,
        borderWidth: spread,
      }
    }

    if (kind === "ellipse") {
      const averageCharExtent = inlineExtent / Math.max(1, Number(labelLength) || 0)
      const inlineBleed = Math.max(
        2,
        averageCharExtent * Number(shape.inlineBleedCharsPerSide || 0),
      )
      const crossBleed = Math.max(2, crossExtent * Number(shape.verticalBleedEm || 0))
      return {
        bounds: verticalText
          ? {
              left: bounds.left - crossBleed,
              top: bounds.top - inlineBleed,
              right: bounds.right + crossBleed,
              bottom: bounds.bottom + inlineBleed,
            }
          : {
              left: bounds.left - inlineBleed,
              top: bounds.top - crossBleed,
              right: bounds.right + inlineBleed,
              bottom: bounds.bottom + crossBleed,
            },
      }
    }

    return null
  }

  root.IconoplasmPdfReaderCore = Object.freeze({
    normalizeTextRunMatches,
    boundsFromClientRect,
    containsPointInBounds,
    tightenBoundsToTextMetrics,
    computeDecorationGeometry,
  })
})(typeof globalThis !== "undefined" ? globalThis : this)
