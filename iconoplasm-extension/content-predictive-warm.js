;(function (root) {
  "use strict"

  // ARCHITECTURE FENCE [IPD-008]: predictive warming is page-local, bounded,
  // connection-aware, and ranks real geometry without creating another data authority.

  function finiteNumber(value, fallback = 0) {
    const number = Number(value)
    return Number.isFinite(number) ? number : fallback
  }

  function predictionPolicy(connection = {}, deviceMemory = 0) {
    const effectiveType = String(connection?.effectiveType || "").toLowerCase()
    const saveData = Boolean(connection?.saveData)
    const rtt = Math.max(0, finiteNumber(connection?.rtt))
    const downlink = Math.max(0, finiteNumber(connection?.downlink))
    const memory = Math.max(0, finiteNumber(deviceMemory))
    if (saveData || effectiveType === "slow-2g" || effectiveType === "2g") {
      return Object.freeze({
        enabled: false,
        startupLimit: 0,
        neighborLimit: 0,
        approachLimit: 0,
        scrollPortraitLimit: 0,
        pointerRadius: 0,
      })
    }

    const constrained =
      effectiveType === "3g" || (rtt > 0 && rtt >= 300) || (downlink > 0 && downlink < 1.5)
    const generous =
      effectiveType === "4g" &&
      rtt > 0 &&
      rtt <= 100 &&
      downlink >= 8 &&
      (memory === 0 || memory >= 4)
    if (constrained || (memory > 0 && memory <= 2)) {
      return Object.freeze({
        enabled: true,
        startupLimit: 10,
        neighborLimit: 2,
        approachLimit: 1,
        scrollPortraitLimit: 2,
        pointerRadius: 96,
      })
    }
    if (generous) {
      return Object.freeze({
        enabled: true,
        startupLimit: 10,
        neighborLimit: 6,
        approachLimit: 3,
        scrollPortraitLimit: 6,
        pointerRadius: 144,
      })
    }
    return Object.freeze({
      enabled: true,
      startupLimit: 10,
      neighborLimit: 4,
      approachLimit: 2,
      scrollPortraitLimit: 4,
      pointerRadius: 120,
    })
  }

  function centerOf(rect) {
    return {
      x: finiteNumber(rect?.left) + finiteNumber(rect?.width) / 2,
      y: finiteNumber(rect?.top) + finiteNumber(rect?.height) / 2,
    }
  }

  function normalizeVector(vector) {
    const x = finiteNumber(vector?.x)
    const y = finiteNumber(vector?.y)
    const magnitude = Math.hypot(x, y)
    return magnitude >= 2 ? { x: x / magnitude, y: y / magnitude } : null
  }

  function rankSpatialCandidates(candidates, pointer, vector, options = {}) {
    const origin = { x: finiteNumber(pointer?.x), y: finiteNumber(pointer?.y) }
    const direction = normalizeVector(vector)
    const radius = Math.max(0, finiteNumber(options.radius, Infinity)) || Infinity
    const limit = Math.max(0, finiteNumber(options.limit)) || Infinity
    const excludedSymbol = String(options.excludeSymbol || "")
      .trim()
      .toUpperCase()
    const seen = new Set()
    const ranked = []

    for (const [index, candidate] of (Array.isArray(candidates) ? candidates : []).entries()) {
      const symbol = String(candidate?.symbol || "")
        .trim()
        .toUpperCase()
      if (!symbol || symbol === excludedSymbol || seen.has(symbol)) continue
      const rect = candidate?.rect
      if (!rect || finiteNumber(rect.width) <= 0 || finiteNumber(rect.height) <= 0) continue
      const center = centerOf(rect)
      const dx = center.x - origin.x
      const dy = center.y - origin.y
      const distance = Math.hypot(dx, dy)
      if (distance > radius) continue
      const candidateDirection = distance > 0 ? { x: dx / distance, y: dy / distance } : null
      const alignment =
        direction && candidateDirection
          ? direction.x * candidateDirection.x + direction.y * candidateDirection.y
          : 0
      const directionFactor = alignment >= 0 ? 1 - 0.38 * alignment : 1 + 0.18 * -alignment
      ranked.push({
        symbol,
        trajectoryBucket: direction && alignment < -0.1 ? 1 : 0,
        score: distance * directionFactor,
        distance,
        index,
      })
      seen.add(symbol)
    }

    return ranked
      .sort((left, right) =>
        left.trajectoryBucket !== right.trajectoryBucket
          ? left.trajectoryBucket - right.trajectoryBucket
          : left.score !== right.score
            ? left.score - right.score
            : left.distance !== right.distance
              ? left.distance - right.distance
              : left.index - right.index,
      )
      .slice(0, limit)
      .map((entry) => entry.symbol)
  }

  function rankScrollCandidates(candidates, direction, viewportHeight, limit) {
    const normalizedDirection = direction < 0 ? -1 : direction > 0 ? 1 : 0
    if (!normalizedDirection) return []
    const viewport = Math.max(1, finiteNumber(viewportHeight, 1))
    const max = Math.max(0, finiteNumber(limit)) || Infinity
    const seen = new Set()
    const ranked = []
    for (const [index, candidate] of (Array.isArray(candidates) ? candidates : []).entries()) {
      const symbol = String(candidate?.symbol || "")
        .trim()
        .toUpperCase()
      if (!symbol || seen.has(symbol)) continue
      const rect = candidate?.rect
      if (!rect || finiteNumber(rect.width) <= 0 || finiteNumber(rect.height) <= 0) continue
      const edge = normalizedDirection > 0 ? finiteNumber(rect.top) : finiteNumber(rect.bottom)
      const isApproaching =
        normalizedDirection > 0 ? edge >= viewport * 0.55 : edge <= viewport * 0.45
      if (!isApproaching) continue
      const distance = normalizedDirection > 0 ? Math.abs(edge - viewport) : Math.abs(edge)
      ranked.push({ symbol, distance, index })
      seen.add(symbol)
    }
    return ranked
      .sort((left, right) =>
        left.distance !== right.distance
          ? left.distance - right.distance
          : left.index - right.index,
      )
      .slice(0, max)
      .map((entry) => entry.symbol)
  }

  root.IconoplasmPredictiveWarm = {
    predictionPolicy,
    rankSpatialCandidates,
    rankScrollCandidates,
  }
})(typeof globalThis !== "undefined" ? globalThis : this)
