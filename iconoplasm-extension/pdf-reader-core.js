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

  root.IconoplasmPdfReaderCore = Object.freeze({
    normalizeTextRunMatches,
    boundsFromClientRect,
    containsPointInBounds,
  })
})(typeof globalThis !== "undefined" ? globalThis : this)
