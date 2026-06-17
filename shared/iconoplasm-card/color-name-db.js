import calibratedPalette from "./data/RAL-designs-colors-ral-black-minus-15.json" with { type: "json" }

var calibratedEntries = null
var calibratedNameCache = new Map()
var calibratedNameSet = null

export function normalizeHexColor(hex) {
  var value = String(hex || "").trim()
  if (!/^[a-f0-9]{6}$/i.test(value) && !/^#[a-f0-9]{6}$/i.test(value)) return ""
  if (value.charAt(0) !== "#") value = "#" + value
  return value.toUpperCase()
}

function normalizeDisplayName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
}

export function isKnownCalibratedColorName(name) {
  var normalized = normalizeDisplayName(name)
  if (!normalized) return false
  if (!calibratedNameSet) {
    calibratedNameSet = new Set(
      calibratedPaletteEntries().map(function (entry) {
        return normalizeDisplayName(entry.name)
      }),
    )
  }
  return calibratedNameSet.has(normalized)
}

function hexToRgb(hex) {
  var value = normalizeHexColor(hex)
  if (!value) return null
  return {
    r: parseInt(value.slice(1, 3), 16),
    g: parseInt(value.slice(3, 5), 16),
    b: parseInt(value.slice(5, 7), 16),
  }
}

function srgbChannelToLinear(channel) {
  var value = Number(channel) / 255
  if (value <= 0.04045) return value / 12.92
  return Math.pow((value + 0.055) / 1.055, 2.4)
}

function rgbToXyz(rgb) {
  if (!rgb) return null
  var r = srgbChannelToLinear(rgb.r)
  var g = srgbChannelToLinear(rgb.g)
  var b = srgbChannelToLinear(rgb.b)

  return {
    x: (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) * 100,
    y: (r * 0.2126729 + g * 0.7151522 + b * 0.072175) * 100,
    z: (r * 0.0193339 + g * 0.119192 + b * 0.9503041) * 100,
  }
}

function xyzPivot(value) {
  if (value > 0.008856451679035631) return Math.cbrt(value)
  return value * 7.787037037037037 + 16 / 116
}

function xyzToLab(xyz) {
  if (!xyz) return null
  var x = xyzPivot(xyz.x / 95.047)
  var y = xyzPivot(xyz.y / 100)
  var z = xyzPivot(xyz.z / 108.883)
  return {
    l: 116 * y - 16,
    a: 500 * (x - y),
    b: 200 * (y - z),
  }
}

function hexToLab(hex) {
  return xyzToLab(rgbToXyz(hexToRgb(hex)))
}

function degreesToRadians(value) {
  return (Number(value) * Math.PI) / 180
}

function radiansToDegrees(value) {
  return (Number(value) * 180) / Math.PI
}

function deltaE2000(left, right) {
  if (!left || !right) return Number.POSITIVE_INFINITY

  var l1 = Number(left.l)
  var a1 = Number(left.a)
  var b1 = Number(left.b)
  var l2 = Number(right.l)
  var a2 = Number(right.a)
  var b2 = Number(right.b)

  var avgLp = (l1 + l2) / 2
  var c1 = Math.sqrt(a1 * a1 + b1 * b1)
  var c2 = Math.sqrt(a2 * a2 + b2 * b2)
  var avgC = (c1 + c2) / 2
  var avgCPow7 = Math.pow(avgC, 7)
  var g = 0.5 * (1 - Math.sqrt(avgCPow7 / (avgCPow7 + Math.pow(25, 7))))

  var a1Prime = (1 + g) * a1
  var a2Prime = (1 + g) * a2
  var c1Prime = Math.sqrt(a1Prime * a1Prime + b1 * b1)
  var c2Prime = Math.sqrt(a2Prime * a2Prime + b2 * b2)
  var avgCPrime = (c1Prime + c2Prime) / 2

  var h1Prime = Math.atan2(b1, a1Prime)
  if (h1Prime < 0) h1Prime += 2 * Math.PI
  var h2Prime = Math.atan2(b2, a2Prime)
  if (h2Prime < 0) h2Prime += 2 * Math.PI

  var deltaLPrime = l2 - l1
  var deltaCPrime = c2Prime - c1Prime
  var deltaHPrime = 0
  if (c1Prime !== 0 && c2Prime !== 0) {
    var hueDiff = h2Prime - h1Prime
    if (Math.abs(hueDiff) <= Math.PI) deltaHPrime = hueDiff
    else if (hueDiff > Math.PI) deltaHPrime = hueDiff - 2 * Math.PI
    else deltaHPrime = hueDiff + 2 * Math.PI
  }

  var deltaBigHPrime = 2 * Math.sqrt(c1Prime * c2Prime) * Math.sin(deltaHPrime / 2)

  var avgHPrime = h1Prime + h2Prime
  if (c1Prime === 0 || c2Prime === 0) {
    avgHPrime = h1Prime + h2Prime
  } else if (Math.abs(h1Prime - h2Prime) > Math.PI) {
    avgHPrime = (h1Prime + h2Prime + 2 * Math.PI) / 2
  } else {
    avgHPrime = (h1Prime + h2Prime) / 2
  }

  var avgHPrimeDegrees = radiansToDegrees(avgHPrime)
  if (avgHPrimeDegrees < 0) avgHPrimeDegrees += 360

  var t =
    1 -
    0.17 * Math.cos(degreesToRadians(avgHPrimeDegrees - 30)) +
    0.24 * Math.cos(degreesToRadians(2 * avgHPrimeDegrees)) +
    0.32 * Math.cos(degreesToRadians(3 * avgHPrimeDegrees + 6)) -
    0.2 * Math.cos(degreesToRadians(4 * avgHPrimeDegrees - 63))

  var deltaTheta = 30 * Math.exp(-Math.pow((avgHPrimeDegrees - 275) / 25, 2))
  var rc = 2 * Math.sqrt(Math.pow(avgCPrime, 7) / (Math.pow(avgCPrime, 7) + Math.pow(25, 7)))
  var sl = 1 + (0.015 * Math.pow(avgLp - 50, 2)) / Math.sqrt(20 + Math.pow(avgLp - 50, 2))
  var sc = 1 + 0.045 * avgCPrime
  var sh = 1 + 0.015 * avgCPrime * t
  var rt = -Math.sin(degreesToRadians(2 * deltaTheta)) * rc

  var deltaLTerm = deltaLPrime / sl
  var deltaCTerm = deltaCPrime / sc
  var deltaHTerm = deltaBigHPrime / sh

  return Math.sqrt(
    deltaLTerm * deltaLTerm +
      deltaCTerm * deltaCTerm +
      deltaHTerm * deltaHTerm +
      rt * deltaCTerm * deltaHTerm,
  )
}

function calibratedPaletteEntries() {
  if (calibratedEntries) return calibratedEntries
  calibratedEntries = (Array.isArray(calibratedPalette) ? calibratedPalette : [])
    .map(function (entry) {
      var name = String((entry && entry.name) || "").trim()
      var hex = normalizeHexColor(entry && entry.hex)
      var lab = hexToLab(hex)
      if (!name || !hex || !lab) return null
      return {
        name: name,
        hex: hex,
        lab: lab,
      }
    })
    .filter(Boolean)
  return calibratedEntries
}

export function getCalibratedColorName(hex) {
  var normalized = normalizeHexColor(hex)
  if (!normalized) return ""
  if (calibratedNameCache.has(normalized)) return calibratedNameCache.get(normalized) || ""

  var targetLab = hexToLab(normalized)
  if (!targetLab) return ""

  var bestName = ""
  var bestDistance = Number.POSITIVE_INFINITY
  var palette = calibratedPaletteEntries()
  for (var i = 0; i < palette.length; i++) {
    var entry = palette[i]
    var distance = deltaE2000(targetLab, entry.lab)
    if (distance < bestDistance) {
      bestDistance = distance
      bestName = entry.name
      if (distance < 0.1) break
    }
  }

  calibratedNameCache.set(normalized, bestName)
  return bestName
}

export function resolveDisplayedColorName(displayHex, essence) {
  var normalizedDisplayHex = normalizeHexColor(displayHex)
  if (!normalizedDisplayHex) return ""

  var safeEssence = essence && typeof essence === "object" ? essence : {}
  var syncedHex = normalizeHexColor(safeEssence.skin_hex)
  var syncedName = String(safeEssence.skin_name || "").trim()

  // Guardrail: only trust synced names that are actually present in the calibrated palette file.
  // That lets legitimate database labels like "Light Teal" through while rejecting invented
  // fallback labels that are not in the source dataset.
  if (
    syncedName &&
    syncedHex &&
    syncedHex === normalizedDisplayHex &&
    isKnownCalibratedColorName(syncedName)
  ) {
    return syncedName
  }

  return getCalibratedColorName(normalizedDisplayHex)
}
