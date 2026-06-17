import {
  ICONOPLASM_DISCOVERY_DEFAULT_ORDER,
  ICONOPLASM_HOME_ORDERS,
  normalizeIconoplasmHomeOrder,
} from "./home-orders.js"

var HOME_COLLECTION_DEFAULT_ORDER = ICONOPLASM_DISCOVERY_DEFAULT_ORDER

export var HOME_COLLECTION_ORDERS = ICONOPLASM_HOME_ORDERS

export function normalizeHomeCollectionOrder(value, fallback) {
  return normalizeIconoplasmHomeOrder(value, fallback || HOME_COLLECTION_DEFAULT_ORDER)
}

function parseIsoTimestamp(value) {
  var parsed = Date.parse(String(value || ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeDiscoveryFullName(value, fallbackSymbol) {
  var trimmed = String(value || "").trim()
  if (trimmed) return trimmed
  return String(fallbackSymbol || "")
    .trim()
    .toUpperCase()
}

function parseSortableNumber(value, allowZero) {
  var parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  if (!allowZero && parsed <= 0) return null
  if (allowZero && parsed < 0) return null
  return parsed
}

function randomRank(seed, symbol) {
  var input = String(seed || "iconoplasm") + "|" + String(symbol || "")
  var hash = 2166136261
  for (var i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function compareTextAsc(left, right) {
  return String(left || "").localeCompare(String(right || ""), undefined, {
    sensitivity: "base",
  })
}

function compareTextDesc(left, right) {
  return compareTextAsc(right, left)
}

function compareNumberDesc(left, right) {
  return Number(right || 0) - Number(left || 0)
}

function compareNullableNumberDescWithNullBottom(left, right) {
  var leftValue = Number(left)
  var rightValue = Number(right)
  var leftPresent = Number.isFinite(leftValue)
  var rightPresent = Number.isFinite(rightValue)
  if (!leftPresent && !rightPresent) return 0
  if (!leftPresent) return 1
  if (!rightPresent) return -1
  return rightValue - leftValue
}

function compareNullableNumberAscWithNullBottom(left, right) {
  var leftValue = Number(left)
  var rightValue = Number(right)
  var leftPresent = Number.isFinite(leftValue)
  var rightPresent = Number.isFinite(rightValue)
  if (!leftPresent && !rightPresent) return 0
  if (!leftPresent) return 1
  if (!rightPresent) return -1
  return leftValue - rightValue
}

function compareDiscoveryNewestFallback(left, right) {
  return (
    compareTextDesc(left.first_discovered_at, right.first_discovered_at) ||
    compareTextAsc(left.gene_symbol, right.gene_symbol)
  )
}

function compareDiscoveryPopularityFallback(left, right) {
  return (
    Number((right && right.popularity_score) || 0) - Number((left && left.popularity_score) || 0) ||
    Number((right && right.image_score) || 0) - Number((left && left.image_score) || 0) ||
    Number((right && right.image_upvotes) || 0) - Number((left && left.image_upvotes) || 0) ||
    compareTextDesc(
      left.published_at || left.asset_created_at,
      right.published_at || right.asset_created_at,
    ) ||
    compareDiscoveryNewestFallback(left, right)
  )
}

export function normalizeDiscoveryEntries(entries) {
  var source = Array.isArray(entries) ? entries : []
  var uniqueSymbols = Object.create(null)
  var normalized = []
  for (var i = 0; i < source.length; i++) {
    var raw = source[i]
    var symbol = String(raw && (raw.gene_symbol || raw.symbol || ""))
      .trim()
      .toUpperCase()
    if (!symbol || uniqueSymbols[symbol]) continue
    uniqueSymbols[symbol] = true
    normalized.push({
      gene_symbol: symbol,
      full_name: normalizeDiscoveryFullName(raw && raw.full_name, symbol),
      first_discovered_at: String((raw && raw.first_discovered_at) || "").trim(),
      last_encountered_at: String((raw && raw.last_encountered_at) || "").trim(),
      encounter_count: Math.max(0, Number((raw && raw.encounter_count) || 0) || 0),
      weight_kg: parseSortableNumber(raw && raw.weight_kg, false),
      age_years: parseSortableNumber(raw && raw.age_years, true),
      uniqueness_rank: parseSortableNumber(raw && raw.uniqueness_rank, true),
      popularity_score: Math.max(0, Number((raw && raw.popularity_score) || 0) || 0),
      image_upvotes: Math.max(0, Number((raw && raw.image_upvotes) || 0) || 0),
      image_downvotes: Math.max(0, Number((raw && raw.image_downvotes) || 0) || 0),
      image_score: Number((raw && raw.image_score) || 0) || 0,
      published_at: String((raw && raw.published_at) || "").trim(),
      asset_created_at: String((raw && raw.asset_created_at) || "").trim(),
    })
  }
  return normalized
}

export function sortDiscoveryEntries(entries, order) {
  var sorted = (Array.isArray(entries) ? entries : []).slice()
  var resolvedOrder = normalizeHomeCollectionOrder(order)
  sorted.sort(function (a, b) {
    if (resolvedOrder === "votes") {
      return (
        Number(b.image_score || 0) - Number(a.image_score || 0) ||
        Number(b.image_upvotes || 0) - Number(a.image_upvotes || 0) ||
        compareDiscoveryPopularityFallback(a, b)
      )
    }
    if (resolvedOrder === "uniqueness") {
      return (
        compareNullableNumberAscWithNullBottom(a.uniqueness_rank, b.uniqueness_rank) ||
        compareDiscoveryPopularityFallback(a, b)
      )
    }
    if (resolvedOrder === "popularity") {
      return compareDiscoveryPopularityFallback(a, b)
    }
    if (resolvedOrder === "heaviest") {
      return (
        compareNullableNumberDescWithNullBottom(a.weight_kg, b.weight_kg) ||
        compareDiscoveryPopularityFallback(a, b)
      )
    }
    if (resolvedOrder === "lightest") {
      return (
        compareNullableNumberAscWithNullBottom(a.weight_kg, b.weight_kg) ||
        compareDiscoveryPopularityFallback(a, b)
      )
    }
    if (resolvedOrder === "oldest") {
      return (
        compareNullableNumberDescWithNullBottom(a.age_years, b.age_years) ||
        compareDiscoveryPopularityFallback(a, b)
      )
    }
    if (resolvedOrder === "youngest") {
      return (
        compareNullableNumberAscWithNullBottom(a.age_years, b.age_years) ||
        compareDiscoveryPopularityFallback(a, b)
      )
    }
    if (resolvedOrder === "symbol") {
      return compareTextAsc(a.gene_symbol, b.gene_symbol)
    }
    if (resolvedOrder === "shortest") {
      var aName = normalizeDiscoveryFullName(a && a.full_name, a && a.gene_symbol)
      var bName = normalizeDiscoveryFullName(b && b.full_name, b && b.gene_symbol)
      var aLength = aName.length
      var bLength = bName.length
      if (aLength !== bLength) return aLength - bLength
      var byName = compareTextAsc(aName, bName)
      if (byName) return byName
      return compareTextAsc(a.gene_symbol, b.gene_symbol)
    }
    if (resolvedOrder === "random") {
      return (
        randomRank(a.random_seed || "iconoplasm", a.gene_symbol) -
          randomRank(b.random_seed || "iconoplasm", b.gene_symbol) ||
        compareTextAsc(a.gene_symbol, b.gene_symbol)
      )
    }
    var aTime = parseIsoTimestamp(a.first_discovered_at)
    var bTime = parseIsoTimestamp(b.first_discovered_at)
    if (aTime !== bTime) return bTime - aTime
    return compareTextAsc(a.gene_symbol, b.gene_symbol)
  })
  return sorted
}
