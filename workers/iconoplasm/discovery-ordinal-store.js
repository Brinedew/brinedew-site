import { evolveDiscoveryOrdinalDictionary } from "./discovery-ordinal-dictionary.js"

// Append-only discovery ordinals live in normal rows so hot paths resolve a
// bounded symbol set with point reads instead of loading a 19k-entry blob.
// The meta row is the only version authority; rows are changed only for names
// whose canonical/ordinal/aliases actually moved, so routine evolution writes
// nothing when the catalog is unchanged.

const META_SELECT_SQL = `SELECT version FROM icono_discovery_dictionary_meta_v2 WHERE singleton = 1`
const META_CAS_SQL = `UPDATE icono_discovery_dictionary_meta_v2
SET version = ?, updated_at = CURRENT_TIMESTAMP
WHERE singleton = 1 AND version = ?
RETURNING version`
const META_INSERT_SQL = `INSERT INTO icono_discovery_dictionary_meta_v2 (singleton, version, updated_at)
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
const MAX_ORDINAL_SELECT_SQL = `SELECT COALESCE(MAX(ordinal), -1) AS max_ordinal
FROM icono_discovery_ordinals_v2`
const CATALOG_BY_NAME_SQL = `SELECT gene_symbol, aliases_json FROM icono_gene_catalog
WHERE gene_symbol IN (SELECT value FROM json_each(?))`
const CATALOG_BY_ALIAS_SQL = `SELECT gene_symbol, aliases_json FROM icono_gene_catalog
WHERE EXISTS (
  SELECT 1 FROM json_each(icono_gene_catalog.aliases_json)
  WHERE value IN (SELECT value FROM json_each(?))
)`
const ROWS_FOR_ORDINAL_SQL = `SELECT name FROM icono_discovery_ordinals_v2
WHERE ordinal = ? ORDER BY name`

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
    await db.prepare(META_INSERT_SQL).bind(next.version).run()
  }
  return { version: next.version, changed, writes, entries: next.entries.length }
}

const SYMBOL_NAME = /^[A-Z0-9][A-Z0-9._-]{0,63}$/

function catalogAliasNames(raw, canonical) {
  let parsed = []
  try {
    const value = JSON.parse(String(raw || "[]"))
    if (Array.isArray(value)) parsed = value
  } catch {
    parsed = []
  }
  return [
    ...new Set(
      parsed
        .map((value) =>
          String(value || "")
            .trim()
            .toUpperCase(),
        )
        .filter((name) => name && name !== canonical && SYMBOL_NAME.test(name)),
    ),
  ].sort()
}

// Bounded append-only dictionary resolver. Only the names a caller actually
// touches acquire ordinals: direct catalog matches, optional catalog aliases
// and (for legacy imports) historical names that left the catalog. A first
// discovery therefore never reads or writes one row per catalog gene, while
// existing ordinals are preserved, a rename keeps the prior ordinal and a
// retired symbol stays resolvable as an inactive entry. Writes are guarded by
// a dictionary-version CAS, so concurrent resolvers cannot mint duplicate
// ordinals; a lost race simply re-reads and retries.
export async function ensureDiscoveryDictionaryForNames(
  db,
  names,
  { preserveHistorical = false, resolveCatalogAliases = false } = {},
) {
  const wanted = normalizeNames(names)
  if (!wanted.length) return loadDiscoveryDictionaryForNames(db, wanted)
  for (let attempt = 1; attempt <= 4; attempt++) {
    const lookup = await loadDiscoveryDictionaryForNames(db, wanted)
    const unresolved = wanted.filter((name) => !lookup.byName.has(name))
    if (!unresolved.length) return lookup
    const catalogRows = rows(
      await db.prepare(CATALOG_BY_NAME_SQL).bind(JSON.stringify(unresolved)).all(),
    )
    if (resolveCatalogAliases) {
      catalogRows.push(
        ...rows(await db.prepare(CATALOG_BY_ALIAS_SQL).bind(JSON.stringify(unresolved)).all()),
      )
    }
    const maxRow = await db.prepare(MAX_ORDINAL_SELECT_SQL).first()
    let nextOrdinal = Number(maxRow?.max_ordinal ?? -1) + 1
    const planned = new Map()
    const resolvedNames = new Set()
    for (const row of catalogRows) {
      const symbol = String(row?.gene_symbol || "")
        .trim()
        .toUpperCase()
      if (!symbol || !SYMBOL_NAME.test(symbol)) continue
      const aliases = catalogAliasNames(row?.aliases_json, symbol)
      const claimed = [symbol, ...aliases].filter((name) => unresolved.includes(name))
      if (!claimed.length) continue
      for (const name of claimed) {
        if (resolvedNames.has(name))
          throw new TypeError(`Discovery dictionary name is ambiguous: ${name}`)
      }
      const aliasRows = aliases.length
        ? rows(await db.prepare(NAMES_SELECT_SQL).bind(JSON.stringify(aliases)).all())
        : []
      const standaloneOrdinals = new Set(
        aliasRows
          .filter(
            (aliasRow) =>
              String(aliasRow.name || "").toUpperCase() ===
              String(aliasRow.canonical || "").toUpperCase(),
          )
          .map((aliasRow) => Number(aliasRow.ordinal)),
      )
      if (standaloneOrdinals.size > 1)
        throw new TypeError(`Discovery dictionary rename is ambiguous: ${symbol}`)
      const canonicalRow = rows(
        await db
          .prepare(NAMES_SELECT_SQL)
          .bind(JSON.stringify([symbol]))
          .all(),
      ).find(
        (row) => String(row.name || "").toUpperCase() === String(row.canonical || "").toUpperCase(),
      )
      let ordinal
      if (standaloneOrdinals.size === 1) {
        ordinal = [...standaloneOrdinals][0]
        for (const nameRow of rows(await db.prepare(ROWS_FOR_ORDINAL_SQL).bind(ordinal).all())) {
          const name = String(nameRow.name || "")
            .trim()
            .toUpperCase()
          if (!name) continue
          resolvedNames.add(name)
          planned.set(name, { ordinal, canonical: symbol, active: 1 })
        }
      } else if (canonicalRow) {
        ordinal = Number(canonicalRow.ordinal)
      } else {
        ordinal = nextOrdinal++
      }
      for (const name of claimed) {
        resolvedNames.add(name)
        planned.set(name, { ordinal, canonical: symbol, active: 1 })
      }
    }
    if (preserveHistorical) {
      for (const name of unresolved) {
        if (resolvedNames.has(name)) continue
        planned.set(name, { ordinal: nextOrdinal++, canonical: name, active: 0 })
      }
    }
    if (!planned.size) return lookup

    const plannedNames = [...planned.keys()]
    const current = new Map(
      rows(await db.prepare(NAMES_SELECT_SQL).bind(JSON.stringify(plannedNames)).all()).map(
        (row) => [
          String(row.name || "").toUpperCase(),
          {
            ordinal: Number(row.ordinal),
            canonical: String(row.canonical || "").toUpperCase(),
            active: Number(row.active || 0),
          },
        ],
      ),
    )
    const statements = []
    for (const [name, entry] of planned) {
      const prior = current.get(name)
      if (
        prior &&
        prior.ordinal === entry.ordinal &&
        prior.canonical === entry.canonical &&
        prior.active === entry.active
      )
        continue
      statements.push(
        db.prepare(ROW_UPSERT_SQL).bind(name, entry.ordinal, entry.canonical, entry.active),
      )
    }
    const meta = await readDiscoveryDictionaryMeta(db)
    if (!statements.length && meta) return lookup
    let casIndex = -1
    if (meta) {
      casIndex = statements.length
      statements.push(db.prepare(META_CAS_SQL).bind(meta.version + 1, meta.version))
    } else {
      statements.push(db.prepare(META_INSERT_SQL).bind(1))
    }
    const results = await db.batch(statements)
    if (casIndex >= 0) {
      const updated = rows(results[casIndex])[0]
      if (Number(updated?.version) !== meta.version + 1) continue
    }
    return loadDiscoveryDictionaryForNames(db, wanted)
  }
  throw new Error("Discovery dictionary resolution remained contended")
}
