import { evolveDiscoveryOrdinalDictionary } from "./discovery-ordinal-dictionary.js"

// Append-only discovery ordinals live in normal rows so hot paths resolve a
// bounded symbol set with point reads instead of loading a 19k-entry blob.
// The meta row is the only version authority; rows are changed only for names
// whose canonical/ordinal/aliases actually moved, so routine evolution writes
// nothing when the catalog is unchanged.

const META_SELECT_SQL = `SELECT version FROM icono_discovery_dictionary_meta_v2 WHERE singleton = 1`
const META_UPSERT_SQL = `INSERT INTO icono_discovery_dictionary_meta_v2 (singleton, version, updated_at)
VALUES (1, ?, CURRENT_TIMESTAMP)
ON CONFLICT(singleton) DO UPDATE SET version = excluded.version, updated_at = CURRENT_TIMESTAMP`
const NAMES_SELECT_SQL = `SELECT name, ordinal, canonical, active
FROM icono_discovery_ordinals_v2
WHERE name IN (SELECT value FROM json_each(?))
ORDER BY ordinal, name`
const ALL_ROWS_SELECT_SQL = `SELECT name, ordinal, canonical, active
FROM icono_discovery_ordinals_v2
ORDER BY ordinal, name`
const ORDINALS_SELECT_SQL = `SELECT DISTINCT ordinal, canonical FROM icono_discovery_ordinals_v2
WHERE ordinal IN (SELECT value FROM json_each(?))
ORDER BY ordinal`
const ROW_UPSERT_SQL = `INSERT INTO icono_discovery_ordinals_v2 (name, ordinal, canonical, active)
VALUES (?, ?, ?, ?)
ON CONFLICT(name) DO UPDATE SET
  ordinal = excluded.ordinal,
  canonical = excluded.canonical,
  active = excluded.active`

function rows(result) {
  return Array.isArray(result?.results) ? result.results : []
}

function normalizeNames(names) {
  return [
    ...new Set((Array.isArray(names) ? names : []).map((name) => String(name || "").toUpperCase())),
  ]
    .filter(Boolean)
    .sort()
}

export async function readDiscoveryDictionaryMeta(db) {
  const row = await db.prepare(META_SELECT_SQL).first()
  if (!row) return null
  const version = Number(row.version || 0)
  return version >= 1 ? { version } : null
}

// Resolves every requested name (canonical or historical alias) to its stable
// ordinal. Names that are not in the dictionary are reported, never invented.
export async function loadDiscoveryDictionaryForNames(db, names) {
  const wanted = normalizeNames(names)
  const byName = new Map()
  const byOrdinal = new Map()
  if (!wanted.length) return { version: 0, byName, byOrdinal, names: wanted }
  const result = await db.prepare(NAMES_SELECT_SQL).bind(JSON.stringify(wanted)).all()
  for (const row of rows(result)) {
    const name = String(row.name || "").toUpperCase()
    const ordinal = Number(row.ordinal)
    byName.set(name, ordinal)
    if (name === String(row.canonical || "").toUpperCase()) byOrdinal.set(ordinal, name)
  }
  const meta = await readDiscoveryDictionaryMeta(db)
  return { version: meta?.version || 0, byName, byOrdinal, names: wanted }
}

export async function readCanonicalSymbolsForOrdinals(db, ordinals) {
  const wanted = [
    ...new Set((Array.isArray(ordinals) ? ordinals : []).map((value) => Number(value))),
  ]
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 1_000_000)
    .sort((left, right) => left - right)
  const byOrdinal = new Map()
  for (let offset = 0; offset < wanted.length; offset += 500) {
    const chunk = wanted.slice(offset, offset + 500)
    const result = await db.prepare(ORDINALS_SELECT_SQL).bind(JSON.stringify(chunk)).all()
    for (const row of rows(result)) {
      const ordinal = Number(row.ordinal)
      if (!byOrdinal.has(ordinal)) byOrdinal.set(ordinal, String(row.canonical || ""))
    }
  }
  return byOrdinal
}

export function discoveryDictionaryEntriesFromRows(rawRows) {
  const byOrdinal = new Map()
  for (const row of rawRows) {
    const ordinal = Number(row.ordinal)
    const name = String(row.name || "").toUpperCase()
    const canonical = String(row.canonical || "").toUpperCase()
    if (!Number.isInteger(ordinal) || !name || !canonical) continue
    let entry = byOrdinal.get(ordinal)
    if (!entry) {
      entry = { ordinal, symbol: canonical, aliases: [], active: false }
      byOrdinal.set(ordinal, entry)
    }
    if (name === canonical) {
      entry.active = Number(row.active || 0) === 1
    } else if (!entry.aliases.includes(name)) {
      entry.aliases.push(name)
    }
  }
  return [...byOrdinal.values()].sort((left, right) => left.ordinal - right.ordinal)
}

// One reviewed evolution point for the append-only dictionary. The catalog is
// the only symbol authority; aliases map historical names onto current ones.
// Existing rows are honored even if the meta row is missing so a partially
// applied seed can never renumber live ordinals.
export async function evolveAndPersistDiscoveryDictionary(db, { symbols = [], aliases = {} } = {}) {
  const meta = await readDiscoveryDictionaryMeta(db)
  const allRows = rows(await db.prepare(ALL_ROWS_SELECT_SQL).all())
  const existingEntries = discoveryDictionaryEntriesFromRows(allRows)
  const previous = existingEntries.length
    ? { version: meta?.version || 1, entries: existingEntries }
    : null
  const next = evolveDiscoveryOrdinalDictionary({ previous, symbols, aliases })
  const changed = next.version !== (meta?.version || 0)

  const existing = new Map(
    allRows
      .map((row) => [
        String(row.name || "").toUpperCase(),
        {
          ordinal: Number(row.ordinal),
          canonical: String(row.canonical || "").toUpperCase(),
          active: Number(row.active || 0),
        },
      ])
      .filter(([name]) => name),
  )
  const pendingWrites = []
  for (const entry of next.entries) {
    const active = entry.active ? 1 : 0
    const names = [entry.symbol, ...entry.aliases]
    for (const name of names) {
      const prior = existing.get(name)
      if (
        prior &&
        prior.ordinal === entry.ordinal &&
        prior.canonical === entry.symbol &&
        prior.active === active
      )
        continue
      pendingWrites.push([name, entry.ordinal, entry.symbol, active])
    }
  }

  let writes = 0
  for (let offset = 0; offset < pendingWrites.length; offset += 250) {
    const chunk = pendingWrites.slice(offset, offset + 250)
    await db.batch(
      chunk.map(([name, ordinal, canonical, active]) =>
        db.prepare(ROW_UPSERT_SQL).bind(name, ordinal, canonical, active),
      ),
    )
    writes += chunk.length
  }
  if (!meta || meta.version !== next.version) {
    await db.prepare(META_UPSERT_SQL).bind(next.version).run()
  }
  return { version: next.version, changed, writes, entries: next.entries.length }
}
