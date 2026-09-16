import { recordCompactDiscoveryBatch } from "./discovery-compact-service.js"
import { readCompactDiscoveryChronology, readCompactUserState } from "./discovery-compact-store.js"

// One-time per-user import of legacy `icono_gene_discoveries` rows into the
// compact representation. Runs only while a user has no compact state, is
// deterministic (membership is skipped, so an interrupted import resumes), and
// never fabricates a discoverer the legacy shelf did not already have.

export const DISCOVERY_IMPORT_MAX_EVENTS_PER_GENE = 32
export const DISCOVERY_IMPORT_BATCH_ENCOUNTERS = 256

export function parseLegacyDiscoveryTimestamp(value) {
  const text = String(value || "").trim()
  if (!text) return null
  let iso = text
  if (!iso.includes("T")) iso = iso.replace(" ", "T")
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) iso += "Z"
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : null
}

function legacyDwell(value) {
  if (value == null || value === "") return null
  const n = Number(value)
  return Number.isFinite(n) ? Math.max(0, Math.min(86_400_000, Math.floor(n))) : null
}

// First/last provenance plus repeated-encounter count become a bounded, exact
// event tape. Counts above the per-gene cap keep first/last and honest
// membership; only the collapsed middle repeats are elided.
export function legacyRowsToCompactEncounters(rows, { nowSeconds } = {}) {
  const now = Number.isFinite(Number(nowSeconds)) ? Math.floor(Number(nowSeconds)) : 0
  const encounters = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const symbol = String(row?.gene_symbol || "")
      .trim()
      .toUpperCase()
    if (!symbol) continue
    const count = Math.max(1, Number(row?.encounter_count) || 1)
    const first = parseLegacyDiscoveryTimestamp(row?.first_discovered_at) ?? now
    const last = parseLegacyDiscoveryTimestamp(row?.last_encountered_at) ?? first
    encounters.push({
      symbol,
      at: first,
      source: String(row?.first_source || ""),
      trigger: String(row?.first_trigger || ""),
      dwell_ms: legacyDwell(row?.first_dwell_ms),
    })
    const repeats = Math.min(count - 1, DISCOVERY_IMPORT_MAX_EVENTS_PER_GENE - 1)
    for (let index = 0; index < repeats; index++) {
      encounters.push({
        symbol,
        at: last,
        source: String(row?.last_source || ""),
        trigger: String(row?.last_trigger || ""),
        dwell_ms: legacyDwell(row?.last_dwell_ms),
      })
    }
  }
  return encounters
}

// Deterministic per-content batch identity: a receipt exists only after that
// exact slice committed, so re-runs of a different pending set still apply.
function importBatchId(slice) {
  const marker = [...new Set(slice.map((encounter) => encounter.symbol))].slice(0, 3).join(".")
  return `migrate.import.${marker}.${slice.length}`
}

export async function importLegacyDiscoveryUser({
  db,
  userId,
  dictionary,
  legacyRows,
  isAdmin = false,
  nowSeconds = Math.floor(Date.now() / 1000),
  batchLimit = 32,
}) {
  const existing = await readCompactUserState(db, userId)
  let applied = new Set()
  if (existing) {
    const chronology = await readCompactDiscoveryChronology(db, userId)
    for (const chunk of chronology.chunks) {
      for (const event of chunk.events) applied.add(String(event?.symbol || "").toUpperCase())
    }
    for (const event of chronology.active_events)
      applied.add(String(event?.symbol || "").toUpperCase())
  }
  const pending = (Array.isArray(legacyRows) ? legacyRows : []).filter(
    (row) => !applied.has(String(row?.gene_symbol || "").toUpperCase()),
  )
  if (!pending.length) return { ok: true, imported: 0, events: 0, batches: 0 }

  const encounters = legacyRowsToCompactEncounters(pending, { nowSeconds })
  const eventsBySymbol = new Map()
  for (const encounter of encounters) {
    if (!eventsBySymbol.has(encounter.symbol)) eventsBySymbol.set(encounter.symbol, [])
    eventsBySymbol.get(encounter.symbol).push(encounter)
  }
  const symbols = [...eventsBySymbol.keys()]
  let cursor = 0
  let batches = 0
  let events = 0
  while (cursor < symbols.length && batches < batchLimit) {
    const slice = []
    while (cursor < symbols.length) {
      const geneEvents = eventsBySymbol.get(symbols[cursor])
      if (slice.length && slice.length + geneEvents.length > DISCOVERY_IMPORT_BATCH_ENCOUNTERS)
        break
      slice.push(...geneEvents)
      cursor += 1
    }
    await recordCompactDiscoveryBatch(db, {
      userId,
      isAdmin,
      batchId: importBatchId(slice),
      dictionary,
      encounters: slice,
    })
    events += slice.length
    batches += 1
  }
  return {
    ok: true,
    imported: Math.min(cursor, symbols.length),
    events,
    batches,
    remaining: Math.max(0, symbols.length - cursor),
  }
}
