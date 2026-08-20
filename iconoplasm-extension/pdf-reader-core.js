;(function (root) {
  "use strict"

  function transformPoint(transform, x, y) {
    const [a, b, c, d, e, f] = Array.isArray(transform) ? transform : []
    if (![a, b, c, d, e, f, x, y].every(Number.isFinite)) return null
    return [a * x + c * y + e, b * x + d * y + f]
  }

  function polygonForGlyphRecord(record) {
    const [left, top, right, bottom] = Array.isArray(record?.cell) ? record.cell : []
    if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
      return null
    }
    const points = [
      transformPoint(record.transform, left, top),
      transformPoint(record.transform, right, top),
      transformPoint(record.transform, right, bottom),
      transformPoint(record.transform, left, bottom),
    ]
    return points.every(Boolean) ? points : null
  }

  function boundsForPolygons(polygons) {
    const points = (Array.isArray(polygons) ? polygons : []).flat()
    if (!points.length) return null
    const xs = points.map((point) => Number(point?.[0])).filter(Number.isFinite)
    const ys = points.map((point) => Number(point?.[1])).filter(Number.isFinite)
    if (!xs.length || !ys.length) return null
    return {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys),
    }
  }

  function containsPointInPolygon(points, x, y) {
    if (!Array.isArray(points) || points.length < 3 || !Number.isFinite(x) || !Number.isFinite(y)) {
      return false
    }
    let inside = false
    for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
      const xi = points[i][0]
      const yi = points[i][1]
      const xj = points[j][0]
      const yj = points[j][1]
      const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
      if (crosses) inside = !inside
    }
    return inside
  }

  function expandBounds(bounds, amount) {
    const spread = Math.max(0, Number(amount) || 0)
    return {
      left: bounds.left - spread,
      top: bounds.top - spread,
      right: bounds.right + spread,
      bottom: bounds.bottom + spread,
    }
  }

  function contractBounds(bounds, amount) {
    const inset = Math.max(0, Number(amount) || 0)
    return {
      left: Math.min(bounds.right, bounds.left + inset),
      top: Math.min(bounds.bottom, bounds.top + inset),
      right: Math.max(bounds.left, bounds.right - inset),
      bottom: Math.max(bounds.top, bounds.bottom - inset),
    }
  }

  function unionBounds(boundsList) {
    const valid = (Array.isArray(boundsList) ? boundsList : []).filter(
      (bounds) =>
        bounds && [bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite),
    )
    if (!valid.length) return null
    return {
      left: Math.min(...valid.map((bounds) => bounds.left)),
      top: Math.min(...valid.map((bounds) => bounds.top)),
      right: Math.max(...valid.map((bounds) => bounds.right)),
      bottom: Math.max(...valid.map((bounds) => bounds.bottom)),
    }
  }

  function paintBoundsForMatch(match) {
    const decoration = match?.decoration
    const commandBounds = []
    for (const command of Array.isArray(decoration?.commands) ? decoration.commands : []) {
      if (command?.bounds) commandBounds.push(command.bounds)
      if (command?.outerBounds) commandBounds.push(command.outerBounds)
    }
    return unionBounds([match?.bounds, decoration?.bounds, ...commandBounds])
  }

  function buildDecorationCommands(presentation, bounds, label) {
    const shape = presentation?.shape
    const kind = String(shape?.kind || "")
    const em = Math.max(1, bounds.bottom - bounds.top)
    const radius = Math.max(0, Number(shape?.radiusEm) || 0) * em
    const color = String(presentation?.color || "")
    if (!color || !kind) return null

    if (kind === "underline") {
      const thickness = Math.max(1, em * Number(shape.thicknessEm || 0))
      const inset = Math.max(0, em * Number(shape.bottomInsetEm || 0))
      return {
        kind,
        commands: [
          {
            kind: "fill-rect",
            bounds: {
              left: bounds.left,
              top: bounds.bottom - inset - thickness,
              right: bounds.right,
              bottom: bounds.bottom - inset,
            },
            color,
          },
        ],
      }
    }

    if (kind === "pill") {
      const fillSpread = em * Number(shape.fillSpreadEm || 0)
      const ringSpread = em * Number(shape.ringSpreadEm || 0)
      return {
        kind,
        commands: [
          {
            kind: "fill-rounded-rect",
            bounds: expandBounds(bounds, ringSpread),
            radius: radius + ringSpread,
            color: String(shape.ringColor || "rgba(22, 18, 16, 0.58)"),
          },
          {
            kind: "fill-rounded-rect",
            bounds: expandBounds(bounds, fillSpread),
            radius: radius + fillSpread,
            color,
            alpha: Number(shape.fillAlpha || 1),
          },
        ],
      }
    }

    if (kind === "pill-outline") {
      const outerSpread = em * Number(shape.outerSpreadEm || 0)
      const innerSpread = em * Number(shape.innerSpreadEm || 0)
      return {
        kind,
        commands: [
          {
            kind: "fill-rounded-ring",
            outerBounds: expandBounds(bounds, outerSpread),
            innerBounds: bounds,
            outerRadius: radius + outerSpread,
            innerRadius: radius,
            color,
            alpha: Number(shape.outerAlpha || 1),
          },
          {
            kind: "fill-rounded-ring",
            outerBounds: bounds,
            innerBounds: contractBounds(bounds, innerSpread),
            outerRadius: radius,
            innerRadius: Math.max(0, radius - innerSpread),
            color: String(shape.innerColor || "rgba(255, 255, 255, 0.3)"),
          },
        ],
      }
    }

    if (kind === "ellipse") {
      const text = String(label || "")
      const averageCharWidth = Math.max(
        em * 0.24,
        (bounds.right - bounds.left) / Math.max(1, text.length),
      )
      const inlineBleed = Math.max(2, averageCharWidth * Number(shape.inlineBleedCharsPerSide || 0))
      const verticalBleed = Math.max(2, em * Number(shape.verticalBleedEm || 0))
      return {
        kind,
        baseBounds: { ...bounds },
        bounds: {
          left: bounds.left - inlineBleed,
          top: bounds.top - verticalBleed,
          right: bounds.right + inlineBleed,
          bottom: bounds.bottom + verticalBleed,
        },
        color,
        rough: shape,
        commands: [],
      }
    }
    return null
  }

  function separateAdjacentEllipseDecorations(matches) {
    const byOperation = new Map()
    for (const match of Array.isArray(matches) ? matches : []) {
      const decoration = match?.decoration
      if (decoration?.kind !== "ellipse" || !decoration.bounds || !decoration.baseBounds) continue
      const group = byOperation.get(match.operationOrdinal) || []
      group.push(decoration)
      byOperation.set(match.operationOrdinal, group)
    }

    for (const group of byOperation.values()) {
      group.sort((left, right) => left.baseBounds.left - right.baseBounds.left)
      for (let index = 0; index < group.length - 1; index += 1) {
        const current = group[index]
        const next = group[index + 1]
        const verticallySeparate =
          current.baseBounds.bottom <= next.baseBounds.top ||
          next.baseBounds.bottom <= current.baseBounds.top
        if (verticallySeparate) continue

        const availableGap = next.baseBounds.left - current.baseBounds.right
        if (availableGap <= 0) continue
        const desiredGutter = Math.max(
          2,
          Number(current.rough?.strokeWidthPx || 0),
          Number(next.rough?.strokeWidthPx || 0),
        )
        const gutter = Math.min(availableGap, desiredGutter)
        const midpoint = (current.baseBounds.right + next.baseBounds.left) / 2
        current.bounds.right = Math.min(current.bounds.right, midpoint - gutter / 2)
        next.bounds.left = Math.max(next.bounds.left, midpoint + gutter / 2)
      }
    }
  }

  function buildExactPaintPlan(records, findMatches, getPresentation) {
    const foregroundByGlyphOrdinal = []
    const decorationsByOperationOrdinal = []
    const accepted = []
    const rejected = []
    const byOperation = new Map()
    const claimedGlyphOrdinals = new Set()

    for (const record of Array.isArray(records) ? records : []) {
      const operationOrdinal = Number(record?.operationOrdinal)
      if (!Number.isInteger(operationOrdinal) || operationOrdinal < 0) continue
      const group = byOperation.get(operationOrdinal) || []
      group.push(record)
      byOperation.set(operationOrdinal, group)
    }

    for (const [operationOrdinal, operationRecords] of byOperation) {
      let text = ""
      const entries = operationRecords.map((record) => {
        const unicode = String(record?.unicode ?? "")
        const entry = { record, start: text.length, end: text.length + unicode.length }
        text += unicode
        return entry
      })

      for (const match of typeof findMatches === "function" ? findMatches(text) : []) {
        const start = Number(match?.index)
        const end = start + Number(match?.length)
        const selected = entries.filter((entry) => entry.end > start && entry.start < end)
        const symbol = String(match?.symbol || "")
          .trim()
          .toUpperCase()
        const presentation = typeof getPresentation === "function" ? getPresentation(symbol) : null
        const exactBoundaries =
          selected.length > 0 && selected[0].start === start && selected.at(-1).end === end
        const supported = exactBoundaries && selected.every((entry) => entry.record?.supported)
        const collision = selected.some((entry) =>
          claimedGlyphOrdinals.has(entry.record.glyphOrdinal),
        )
        const polygons = supported
          ? selected.map((entry) => polygonForGlyphRecord(entry.record)).filter(Boolean)
          : []

        const bounds = boundsForPolygons(polygons)
        const decoration = bounds
          ? buildDecorationCommands(presentation, bounds, String(match?.text || symbol))
          : null

        if (
          !presentation ||
          !supported ||
          collision ||
          polygons.length !== selected.length ||
          !decoration
        ) {
          rejected.push({
            symbol,
            operationOrdinal,
            reason: !presentation
              ? "missing-presentation"
              : !exactBoundaries
                ? "partial-glyph"
                : !supported
                  ? "unsupported-render-branch"
                  : collision
                    ? "overlapping-match"
                    : !decoration
                      ? "missing-shape-contract"
                      : "invalid-geometry",
          })
          continue
        }

        if (presentation.shape?.recolorGlyphs) {
          for (const entry of selected) {
            foregroundByGlyphOrdinal[entry.record.glyphOrdinal] = presentation.foreground
          }
        }
        for (const entry of selected) claimedGlyphOrdinals.add(entry.record.glyphOrdinal)
        decorationsByOperationOrdinal[operationOrdinal] ||= []
        decorationsByOperationOrdinal[operationOrdinal].push(...decoration.commands)
        accepted.push({
          symbol,
          label: String(match?.text || symbol),
          operationOrdinal,
          glyphOrdinals: selected.map((entry) => entry.record.glyphOrdinal),
          polygons,
          bounds,
          decoration,
        })
      }
    }

    separateAdjacentEllipseDecorations(accepted)
    return { foregroundByGlyphOrdinal, decorationsByOperationOrdinal, accepted, rejected }
  }

  function renderFingerprint(records) {
    return JSON.stringify(
      (Array.isArray(records) ? records : []).map((record) => [
        record.glyphOrdinal,
        record.operationOrdinal,
        record.operationIndex,
        record.localGlyphIndex,
        record.unicode,
        record.fontCharacter,
        record.fontId,
        record.supported,
        record.transform,
        record.cell,
      ]),
    )
  }

  root.IconoplasmPdfReaderCore = Object.freeze({
    transformPoint,
    polygonForGlyphRecord,
    boundsForPolygons,
    containsPointInPolygon,
    paintBoundsForMatch,
    buildDecorationCommands,
    separateAdjacentEllipseDecorations,
    buildExactPaintPlan,
    renderFingerprint,
  })
})(typeof globalThis !== "undefined" ? globalThis : this)
