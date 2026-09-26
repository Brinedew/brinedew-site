// Append-only discovery ordinals live in normal rows so hot paths resolve a
// bounded symbol set with point reads instead of loading a 19k-entry blob.
// The meta row is the only version authority; rows are changed only for names
// whose canonical/ordinal/aliases actually moved, so routine evolution writes
// nothing when the catalog is unchanged.

const META_SELECT_SQL = `SELECT version FROM icono_discovery_dictionary_meta_v2 WHERE singleton = 1`
const META_ENSURE_SQL = `INSERT INTO icono_discovery_dictionary_meta_v2 (singleton, version, updated_at)
VALUES (1, 1, CURRENT_TIMESTAMP)
ON CONFLICT(singleton) DO NOTHING`
const META_CAS_SQL = `UPDATE icono_discovery_dictionary_meta_v2
SET version = ?, writer = ?, updated_at = CURRENT_TIMESTAMP
WHERE singleton = 1 AND version = ?
RETURNING version`
// The returned rows feed name/ordinal maps, so no SQL ordering is required.
// Keeping the filter on the name primary key avoids an ordinal-index walk
// across unrelated rows (read amplification measured 2026-09-17, B-774).
const NAMES_SELECT_SQL = `SELECT name, ordinal, canonical, active
FROM icono_discovery_ordinals_v2
WHERE name IN (SELECT value FROM json_each(?))`
const ORDINALS_SELECT_SQL = `SELECT DISTINCT ordinal, canonical FROM icono_discovery_ordinals_v2
WHERE ordinal IN (SELECT value FROM json_each(?))
ORDER BY ordinal`
// Every ordinal mutation in the on-demand resolver is gated by the same
// dictionary version AND writer token that its accompanying conditional
// version update must have installed. A batch whose version update matched
// nothing therefore writes nothing at all, instead of committing candidate
// rows and reporting failure afterwards.
const GUARDED_ROW_UPSERT_SQL = `INSERT INTO icono_discovery_ordinals_v2 (name, ordinal, canonical, active)
SELECT ?, ?, ?, ?
WHERE EXISTS (
  SELECT 1 FROM icono_discovery_dictionary_meta_v2
  WHERE singleton = 1 AND version = ? AND writer = ?
)
ON CONFLICT(name) DO UPDATE SET
  ordinal = excluded.ordinal,
  canonical = excluded.canonical,
  active = excluded.active`
const MAX_ORDINAL_SELECT_SQL = `SELECT COALESCE(MAX(ordinal), -1) AS max_ordinal
FROM icono_discovery_ordinals_v2`
const CATALOG_BY_NAME_SQL = `SELECT gene_symbol, aliases_json FROM icono_gene_catalog
WHERE gene_symbol IN (SELECT value FROM json_each(?))`
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
// touches acquire ordinals: exact catalog-symbol probes and (for legacy
// imports) historical names that left the catalog. A first
// discovery therefore never reads or writes one row per catalog gene, while
// existing ordinals are preserved, a rename keeps the prior ordinal and a
// retired symbol stays resolvable as an inactive entry. Writes are guarded by
// a dictionary-version CAS, so concurrent resolvers cannot mint duplicate
// ordinals; a lost race simply re-reads and retries.
export async function ensureDiscoveryDictionaryForNames(
  db,
  names,
  { preserveHistorical = false, maxMutationWrites = null } = {},
) {
  const wanted = normalizeNames(names)
  if (!wanted.length) return loadDiscoveryDictionaryForNames(db, wanted)
  for (let attempt = 1; attempt <= 4; attempt++) {
    const lookup = await loadDiscoveryDictionaryForNames(db, wanted)
    const unresolved = wanted.filter((name) => !lookup.byName.has(name))
    if (!unresolved.length) return lookup
    if (lookup.version < 1) await db.prepare(META_ENSURE_SQL).run()
    // The version that protected every allocation input this attempt. It is
    // never re-read later: a fresh read could pair a stale maximum with a
    // newer version and validate an already-invalid ordinal.
    const expectedVersion = Math.max(lookup.version, 1)
    // Exact-symbol probes only. Never resolve aliases by scanning the
    // catalog: the aliases_json EXISTS form measured 0.5M-2.1M reads per call
    // and matched nothing (2026-09-18, B-774). The compact dictionary is the
    // alias authority; unresolved names become inactive entries below.
    const catalogRows = rows(
      await db.prepare(CATALOG_BY_NAME_SQL).bind(JSON.stringify(unresolved)).all(),
    )
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
    const pending = []
    for (const [name, entry] of planned) {
      const prior = current.get(name)
      if (
        prior &&
        prior.ordinal === entry.ordinal &&
        prior.canonical === entry.canonical &&
        prior.active === entry.active
      )
        continue
      pending.push([name, entry])
    }
    if (!pending.length) return lookup
    // A rename moves one ordinal from its old canonical identity to the new
    // one; the old identity must leave the index before the new one enters.
    const leavesCanonicalIdentity = ([name, entry]) => {
      const prior = current.get(name)
      return prior && prior.canonical === name && entry.canonical !== name ? 0 : 1
    }
    pending.sort((left, right) => leavesCanonicalIdentity(left) - leavesCanonicalIdentity(right))
    const mutationWrites = 1 + pending.length
    if (
      maxMutationWrites !== null &&
      (!Number.isInteger(maxMutationWrites) ||
        maxMutationWrites < 0 ||
        mutationWrites > maxMutationWrites)
    ) {
      const error = new Error("Discovery dictionary mutation exceeds its admitted write bound")
      error.code = "DISCOVERY_DICTIONARY_WRITE_BOUND_EXCEEDED"
      throw error
    }
    // One attempt, one writer token. The conditional version update runs first
    // and every row upsert is gated on the version and token it installs, so a
    // rejected version aborts all related mutations inside the same database
    // transaction. A concurrent resolver can never commit a duplicate ordinal,
    // and this attempt never persists a partial write it did not validate.
    const writerToken = crypto.randomUUID()
    const upserts = pending.map(([name, entry]) =>
      db
        .prepare(GUARDED_ROW_UPSERT_SQL)
        .bind(name, entry.ordinal, entry.canonical, entry.active, expectedVersion + 1, writerToken),
    )
    const results = await db.batch([
      db.prepare(META_CAS_SQL).bind(expectedVersion + 1, writerToken, expectedVersion),
      ...upserts,
    ])
    const updated = rows(results[0])[0]
    if (Number(updated?.version) !== expectedVersion + 1) continue
    return loadDiscoveryDictionaryForNames(db, wanted)
  }
  throw new Error("Discovery dictionary resolution remained contended")
}
