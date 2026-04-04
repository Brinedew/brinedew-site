var HOME_COLLECTION_DEFAULT_ORDER = "recent"

export var HOME_COLLECTION_ORDERS = [
  { value: "recent", label: "Recently discovered" },
  { value: "symbol", label: "A–Z" },
  { value: "shortest", label: "Shortest name first" },
]

export function normalizeHomeCollectionOrder(value) {
  var candidate = String(value || "")
    .trim()
    .toLowerCase()
  for (var i = 0; i < HOME_COLLECTION_ORDERS.length; i++) {
    if (HOME_COLLECTION_ORDERS[i].value === candidate) return candidate
  }
  return HOME_COLLECTION_DEFAULT_ORDER
}

function parseIsoTimestamp(value) {
  var parsed = Date.parse(String(value || ""))
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeDiscoveryFullName(value, fallbackSymbol) {
  var trimmed = String(value || "").trim()
  if (trimmed) return trimmed
  return String(fallbackSymbol || "").trim().toUpperCase()
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
    })
  }
  return normalized
}

export function sortDiscoveryEntries(entries, order) {
  var sorted = (Array.isArray(entries) ? entries : []).slice()
  var resolvedOrder = normalizeHomeCollectionOrder(order)
  sorted.sort(function (a, b) {
    if (resolvedOrder === "symbol") {
      return String(a.gene_symbol || "").localeCompare(String(b.gene_symbol || ""))
    }
    if (resolvedOrder === "shortest") {
      var aName = normalizeDiscoveryFullName(a && a.full_name, a && a.gene_symbol)
      var bName = normalizeDiscoveryFullName(b && b.full_name, b && b.gene_symbol)
      var aLength = aName.length
      var bLength = bName.length
      if (aLength !== bLength) return aLength - bLength
      var byName = aName.localeCompare(bName, undefined, { sensitivity: "base" })
      if (byName) return byName
      return String(a.gene_symbol || "").localeCompare(String(b.gene_symbol || ""))
    }
    var aTime = parseIsoTimestamp(a.last_encountered_at || a.first_discovered_at)
    var bTime = parseIsoTimestamp(b.last_encountered_at || b.first_discovered_at)
    if (aTime !== bTime) return bTime - aTime
    return String(a.gene_symbol || "").localeCompare(String(b.gene_symbol || ""))
  })
  return sorted
}