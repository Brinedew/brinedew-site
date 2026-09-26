import { readSharedDiscoveryOrdinalSummaries } from "./discovery-compact-state.js"

// Read models for compact discovery state. These are pure derivations from the
// durable bitmap/chronology/shared arrays plus the ordinal dictionary; no
// legacy `icono_gene_discoveries` membership scan is involved.

export function isoFromEpochSeconds(value) {
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return ""
  // Second precision keeps compact chronology strings byte-identical to the
  // legacy CURRENT_TIMESTAMP shape while staying valid ISO-8601.
  return new Date(Math.floor(seconds) * 1000).toISOString().replace(".000Z", "Z")
}

function eventAt(event) {
  const at = Number(event?.at)
  return Number.isFinite(at) && at >= 0 ? Math.floor(at) : 0
}

function applyEvent(bySymbol, event) {
  const symbol = String(event?.symbol || "")
    .trim()
    .toUpperCase()
  if (!symbol) return
  const at = eventAt(event)
  const source = String(event?.source || "").slice(0, 64)
  const trigger = String(event?.trigger || "").slice(0, 64)
  const dwell =
    event?.dwell_ms == null ? null : Math.max(0, Math.floor(Number(event.dwell_ms) || 0))
  const prior = bySymbol.get(symbol)
  if (!prior) {
    bySymbol.set(symbol, {
      gene_symbol: symbol,
      first_at: at,
      last_at: at,
      encounter_count: 1,
      first_source: source,
      last_source: source,
      first_trigger: trigger,
      last_trigger: trigger,
      first_dwell_ms: dwell,
      last_dwell_ms: dwell,
    })
    return
  }
  prior.encounter_count += 1
  if (at < prior.first_at) {
    prior.first_at = at
    prior.first_source = source
    prior.first_trigger = trigger
    prior.first_dwell_ms = dwell
  }
  if (at >= prior.last_at) {
    prior.last_at = at
    prior.last_source = source
    prior.last_trigger = trigger
    prior.last_dwell_ms = dwell
  }
}

// One aggregate row per discovered symbol, oldest first-discovered first.
// The chronology is complete (sealed chunks plus the active tail), so this
// preserves repeat encounters and exact first/last timestamps.
export function compactShelfRowsFromChronology({ chunks = [], active_events = [] } = {}) {
  const bySymbol = new Map()
  const ordered = [...chunks].sort(
    (left, right) => Number(left.chunk_seq) - Number(right.chunk_seq),
  )
  for (const chunk of ordered) {
    for (const event of Array.isArray(chunk?.events) ? chunk.events : [])
      applyEvent(bySymbol, event)
  }
  for (const event of Array.isArray(active_events) ? active_events : []) applyEvent(bySymbol, event)
  const rows = [...bySymbol.values()]
  rows.sort(
    (left, right) =>
      left.first_at - right.first_at || left.gene_symbol.localeCompare(right.gene_symbol),
  )
  return rows.map((row) => ({
    ...row,
    first_discovered_at: isoFromEpochSeconds(row.first_at),
    last_encountered_at: isoFromEpochSeconds(row.last_at),
  }))
}

export function compactSharedSummaries(rawState) {
  return readSharedDiscoveryOrdinalSummaries(rawState)
}

// Shared aggregate rows for every ordinal with at least one non-admin
// discoverer, mapped back through the append-only dictionary.
export function compactSharedRowsFromSummaries(summaries, symbolByOrdinal) {
  const rows = []
  for (const summary of Array.isArray(summaries) ? summaries : []) {
    const symbol = String(symbolByOrdinal?.get?.(Number(summary.ordinal)) || "")
      .trim()
      .toUpperCase()
    if (!symbol) continue
    rows.push({
      gene_symbol: symbol,
      first_discovered_at: isoFromEpochSeconds(summary.first_at),
      last_encountered_at: isoFromEpochSeconds(summary.latest_at),
      encounter_count: Number(summary.encounter_count || 0),
      first_source: "shared",
      last_source: "shared",
      first_trigger: "shared",
      last_trigger: "shared",
      first_dwell_ms: null,
      last_dwell_ms: null,
    })
  }
  rows.sort(
    (left, right) =>
      (left.first_discovered_at || "").localeCompare(right.first_discovered_at || "") ||
      left.gene_symbol.localeCompare(right.gene_symbol),
  )
  return rows
}
