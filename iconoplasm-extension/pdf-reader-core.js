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

  function contentOriginFromBorderRect(rect, clientInsets = {}) {
    const left = Number(rect?.left)
    const top = Number(rect?.top)
    const clientLeft = Number(clientInsets?.left)
    const clientTop = Number(clientInsets?.top)
    if (![left, top, clientLeft, clientTop].every(Number.isFinite)) return null
    return { left: left + clientLeft, top: top + clientTop }
  }

  function boundsFromClientRect(rect, pageOrigin) {
    const left = Number(rect?.left)
    const top = Number(rect?.top)
    const right = Number(rect?.right)
    const bottom = Number(rect?.bottom)
    const pageLeft = Number(pageOrigin?.left)
    const pageTop = Number(pageOrigin?.top)
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
    const kind = shape?.kind
    const lineBoxShape = kind === "underline" || kind === "ellipse"
    const sourceBounds = lineBoxShape && options.selectionBounds ? options.selectionBounds : bounds
    const width = Number(sourceBounds?.right) - Number(sourceBounds?.left)
    const height = Number(sourceBounds?.bottom) - Number(sourceBounds?.top)
    if (!sourceBounds || width <= 0 || height <= 0) return null

    const verticalText = options.crossAxis === "x"
    const crossExtent = verticalText ? width : height
    const inlineExtent = verticalText ? height : width

    if (kind === "underline") {
      const thickness = Math.max(1, crossExtent * Number(shape.thicknessEm || 0))
      const inset = Math.max(0, crossExtent * Number(shape.bottomInsetEm || 0))
      if (!verticalText) {
        return {
          bounds: {
            left: sourceBounds.left,
            top: sourceBounds.bottom - inset - thickness,
            right: sourceBounds.right,
            bottom: sourceBounds.bottom - inset,
          },
        }
      }

      const positiveDirection = Number(options.crossAxisDirection || 1) >= 0
      const edge = positiveDirection ? sourceBounds.right - inset : sourceBounds.left + inset
      return {
        bounds: {
          left: positiveDirection ? edge - thickness : edge,
          top: sourceBounds.top,
          right: positiveDirection ? edge : edge + thickness,
          bottom: sourceBounds.bottom,
        },
      }
    }

    if (kind === "pill-outline") {
      const spread = Math.max(1, crossExtent * Number(shape.outerSpreadEm || 0))
      const requestedInnerClearance = crossExtent * Number(shape.innerSpreadEm || 0)
      const innerClearance = requestedInnerClearance > 0 ? Math.max(1, requestedInnerClearance) : 0
      const totalBleed = spread + innerClearance
      const radius = Math.max(1, crossExtent * Number(shape.radiusEm || 0) + totalBleed)
      return {
        bounds: {
          left: bounds.left - totalBleed,
          top: bounds.top - totalBleed,
          right: bounds.right + totalBleed,
          bottom: bounds.bottom + totalBleed,
        },
        borderRadius: radius,
        borderWidth: spread,
        innerClearance,
      }
    }

    if (kind === "ellipse") {
      const averageCharExtent = inlineExtent / Math.max(1, Number(labelLength) || 0)
      const inlineBleed = Math.max(
        2,
        averageCharExtent * Number(shape.inlineBleedCharsPerSide || 0),
      )
      const crossBleed = Math.max(2, crossExtent * Number(shape.verticalBleedEm || 0))
      const transferRatio = Math.min(
        0.8,
        Math.max(0, Number(shape.crossToInlineTransferRatio || 0)),
      )
      const rawBounds = verticalText
        ? {
            left: sourceBounds.left - crossBleed,
            top: sourceBounds.top - inlineBleed,
            right: sourceBounds.right + crossBleed,
            bottom: sourceBounds.bottom + inlineBleed,
          }
        : {
            left: sourceBounds.left - inlineBleed,
            top: sourceBounds.top - crossBleed,
            right: sourceBounds.right + inlineBleed,
            bottom: sourceBounds.bottom + crossBleed,
          }
      const rawCrossSpan = verticalText
        ? rawBounds.right - rawBounds.left
        : rawBounds.bottom - rawBounds.top
      const transferredSpan = rawCrossSpan * transferRatio
      const halfTransfer = transferredSpan / 2
      return {
        bounds: verticalText
          ? {
              left: rawBounds.left + halfTransfer,
              top: rawBounds.top - halfTransfer,
              right: rawBounds.right - halfTransfer,
              bottom: rawBounds.bottom + halfTransfer,
            }
          : {
              left: rawBounds.left - halfTransfer,
              top: rawBounds.top + halfTransfer,
              right: rawBounds.right + halfTransfer,
              bottom: rawBounds.bottom - halfTransfer,
            },
        transferredSpan,
      }
    }

    return null
  }

  root.IconoplasmPdfReaderCore = Object.freeze({
    normalizeTextRunMatches,
    contentOriginFromBorderRect,
    boundsFromClientRect,
    containsPointInBounds,
    tightenBoundsToTextMetrics,
    computeDecorationGeometry,
  })
})(typeof globalThis !== "undefined" ? globalThis : this)
