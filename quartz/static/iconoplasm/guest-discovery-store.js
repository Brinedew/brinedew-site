import {
  WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE,
} from "./guest-discovery-contract.js"

export {
  WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE,
} from "./guest-discovery-contract.js"

export const WEBSITE_GUEST_DISCOVERY_STORAGE_KEY = "iconoplasm.website-guest-discoveries.v1"

const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9-]{0,63}$/

function normalizeSymbol(value) {
  const symbol = String(value || "")
    .trim()
    .toUpperCase()
  return SYMBOL_PATTERN.test(symbol) ? symbol : ""
}

function normalizeTimestamp(value, fallback) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const timestamp = new Date(value)
    if (Number.isFinite(timestamp.getTime())) return timestamp.toISOString()
  }
  const parsed = Date.parse(String(value || ""))
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  return fallback
}

function normalizeEncounterCount(value) {
  const count = Number.parseInt(String(value || "1"), 10)
  return Number.isFinite(count) ? Math.max(1, count) : 1
}

export function normalizeWebsiteGuestDiscoveries(value, maxEntries) {
  const resolvedMax = Math.max(
    1,
    Number.parseInt(String(maxEntries || WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES), 10) ||
      WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  )
  const source = Array.isArray(value)
    ? value
    : value && Array.isArray(value.discoveries)
      ? value.discoveries
      : []
  const bySymbol = new Map()
  const order = []

  for (const raw of source) {
    const compact = Array.isArray(raw)
    const symbol = normalizeSymbol(compact ? raw[0] : raw && (raw.gene_symbol || raw.symbol || raw))
    if (!symbol) continue
    const fallbackTimestamp = new Date(0).toISOString()
    const firstDiscoveredAt = normalizeTimestamp(
      compact ? raw[1] : raw && raw.first_discovered_at,
      fallbackTimestamp,
    )
    const lastEncounteredAt = normalizeTimestamp(
      compact ? raw[2] : raw && raw.last_encountered_at,
      firstDiscoveredAt,
    )
    const encounterCount = normalizeEncounterCount(compact ? raw[3] : raw && raw.encounter_count)
    const existing = bySymbol.get(symbol)
    if (!existing) {
      order.push(symbol)
      bySymbol.set(symbol, {
        gene_symbol: symbol,
        first_discovered_at: firstDiscoveredAt,
        last_encountered_at: lastEncounteredAt,
        encounter_count: encounterCount,
      })
      continue
    }
    if (Date.parse(firstDiscoveredAt) < Date.parse(existing.first_discovered_at)) {
      existing.first_discovered_at = firstDiscoveredAt
    }
    if (Date.parse(lastEncounteredAt) > Date.parse(existing.last_encountered_at)) {
      existing.last_encountered_at = lastEncounteredAt
    }
    existing.encounter_count += encounterCount
  }

  return order
    .slice(-resolvedMax)
    .map((symbol) => bySymbol.get(symbol))
    .filter(Boolean)
}

export function createWebsiteGuestDiscoveryStore(options) {
  const opts = options || {}
  const storage = opts.storage || null
  const key = String(opts.key || WEBSITE_GUEST_DISCOVERY_STORAGE_KEY)
  const maxEntries = Math.max(
    1,
    Number.parseInt(String(opts.maxEntries || WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES), 10) ||
      WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  )
  const now = typeof opts.now === "function" ? opts.now : () => new Date()
  let entries = []

  try {
    const raw = storage && storage.getItem ? storage.getItem(key) : null
    entries = normalizeWebsiteGuestDiscoveries(raw ? JSON.parse(raw) : [], maxEntries)
  } catch (_error) {
    entries = []
  }

  function persist() {
    if (!storage || typeof storage.setItem !== "function") return
    try {
      storage.setItem(
        key,
        JSON.stringify({
          version: 2,
          discoveries: entries.map((entry) => [
            entry.gene_symbol,
            Date.parse(entry.first_discovered_at),
            Date.parse(entry.last_encountered_at),
            entry.encounter_count,
          ]),
        }),
      )
    } catch (_error) {
      // The in-memory shelf remains useful for the current tab when browser
      // storage is unavailable or full. A failed write must not break the page.
    }
  }

  function listEntries() {
    return entries.map((entry) => ({ ...entry }))
  }

  function pendingSymbols(limit) {
    const resolvedLimit =
      limit === undefined ? entries.length : Math.max(0, Math.floor(Number(limit) || 0))
    return entries.slice(0, resolvedLimit).map((entry) => entry.gene_symbol)
  }

  function remember(symbol) {
    const normalized = normalizeSymbol(symbol)
    if (!normalized) return null
    const timestampValue = now()
    const timestamp = normalizeTimestamp(
      timestampValue instanceof Date ? timestampValue.toISOString() : timestampValue,
      new Date().toISOString(),
    )
    const existing = entries.find((entry) => entry.gene_symbol === normalized)
    if (existing) {
      existing.last_encountered_at = timestamp
      existing.encounter_count += 1
      persist()
      return { ...existing }
    }
    const entry = {
      gene_symbol: normalized,
      first_discovered_at: timestamp,
      last_encountered_at: timestamp,
      encounter_count: 1,
    }
    entries.push(entry)
    if (entries.length > maxEntries) {
      entries = entries.slice(entries.length - maxEntries)
    }
    persist()
    return { ...entry }
  }

  function remove(symbols) {
    const removals = new Set((Array.isArray(symbols) ? symbols : []).map(normalizeSymbol))
    removals.delete("")
    if (!removals.size) return
    const next = entries.filter((entry) => !removals.has(entry.gene_symbol))
    if (next.length === entries.length) return
    entries = next
    persist()
  }

  return {
    listEntries,
    pendingSymbols,
    remember,
    remove,
  }
}
