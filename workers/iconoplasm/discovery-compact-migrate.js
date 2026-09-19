import { recordCompactDiscoveryBatch } from "./discovery-compact-service.js"
import { readCompactDiscoveryChronology, readCompactUserState } from "./discovery-compact-store.js"
import {
  ensureDiscoveryDictionaryForNames,
  loadDiscoveryDictionaryForNames,
} from "./discovery-ordinal-store.js"
import { createDiscoveryOrdinalDictionary } from "./discovery-compact-state.js"

// One-time per-user import of legacy `icono_gene_discoveries` rows into the
// compact representation. Runs only while a user has no compact state, is
// deterministic (membership is skipped, so an interrupted import resumes), and
// never fabricates a discoverer the legacy shelf did not already have.

export const DISCOVERY_IMPORT_MAX_EVENTS_PER_GENE = 32
export const DISCOVERY_IMPORT_BATCH_ENCOUNTERS = 256
export const DISCOVERY_MIGRATION_USER_PAGE_LIMIT = 25

export async function readCompactDiscoveryActivation(db) {
  const row = await db
    .prepare(
      `SELECT status, cursor_user_id, migrated_users, completed_at
       FROM icono_discovery_compact_activation_v2 WHERE singleton = 1`,
    )
    .first()
  return row
    ? {
        status: String(row.status || "pending"),
        cursor_user_id: String(row.cursor_user_id || ""),
        migrated_users: Math.max(0, Number(row.migrated_users || 0) || 0),
        completed_at: row.completed_at ? String(row.completed_at) : null,
      }
    : null
}

export async function assertCompactDiscoveryActivated(db) {
  const activation = await readCompactDiscoveryActivation(db)
  if (activation?.status !== "complete") {
    const error = new Error(
      "Compact discovery activation is blocked until the bounded legacy migration completes",
    )
    error.code = "DISCOVERY_COMPACT_MIGRATION_INCOMPLETE"
    error.activation = activation
    throw error
  }
  return activation
}

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

export async function migrateLegacyDiscoveryPage({
  db,
  userLimit = DISCOVERY_MIGRATION_USER_PAGE_LIMIT,
  nowSeconds = Math.floor(Date.now() / 1000),
}) {
  const activation = await readCompactDiscoveryActivation(db)
  if (!activation) throw new Error("Compact discovery activation schema is missing")
  if (activation.status === "complete") return { ok: true, complete: true, migrated_users: 0 }
  const limit = Math.max(1, Math.min(100, Number.parseInt(String(userLimit), 10) || 25))
  const users = await db
    .prepare(
      `SELECT DISTINCT user_id
       FROM icono_gene_discoveries
       WHERE user_id > ?
       ORDER BY user_id
       LIMIT ?`,
    )
    .bind(activation.cursor_user_id, limit + 1)
    .all()
  const page = (Array.isArray(users?.results) ? users.results : []).slice(0, limit)
  let migratedUsers = 0
  let cursor = activation.cursor_user_id
  let partialUser = false
  for (const entry of page) {
    const userId = String(entry?.user_id || "")
    const legacy = await db
      .prepare(`SELECT * FROM icono_gene_discoveries WHERE user_id = ? ORDER BY gene_symbol`)
      .bind(userId)
      .all()
    const legacyRows = Array.isArray(legacy?.results) ? legacy.results : []
    await ensureDiscoveryDictionaryForNames(
      db,
      legacyRows.map((row) => row.gene_symbol),
      { preserveHistorical: true },
    )
    const lookup = await loadDiscoveryDictionaryForNames(
      db,
      legacyRows.map((row) => row.gene_symbol),
    )
    const dictionary = createDiscoveryOrdinalDictionary(
      [...lookup.byOrdinal.entries()].map(([ordinal, symbol]) => ({ symbol, ordinal })),
      { version: lookup.version },
    )
    const result = await importLegacyDiscoveryUser({
      db,
      userId,
      dictionary,
      legacyRows,
      nowSeconds,
      batchLimit: 32,
    })
    if (result.remaining > 0) {
      partialUser = true
      break
    }
    cursor = userId
    migratedUsers += 1
  }
  const hasMore =
    partialUser || page.length < (Array.isArray(users?.results) ? users.results : []).length
  const complete = !hasMore && page.length < limit
  await db
    .prepare(
      `UPDATE icono_discovery_compact_activation_v2
       SET status = ?, cursor_user_id = ?, migrated_users = migrated_users + ?,
           completed_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
       WHERE singleton = 1 AND status = 'pending'`,
    )
    .bind(complete ? "complete" : "pending", cursor, migratedUsers, complete ? 1 : 0)
    .run()
  return { ok: true, complete, migrated_users: migratedUsers, cursor_user_id: cursor }
}
