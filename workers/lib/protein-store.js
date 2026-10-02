// THE ONLY GENEGUESSR PROTEIN READ BOUNDARY — DO NOT DUPLICATE.
// A successful empty read is null; a failed read must reach every caller as an error.
import { sanitizeProteinSummary } from "./structure-utils.js"

const MAX_CACHE_SIZE = 512
const proteinCache = new Map()
const DUAL_EMBEDDINGS_TABLE = "protein_embeddings_old"
const eligibleCache = {
  ids: null,
  fetchedAt: 0,
  ttl: 5 * 60 * 1000,
}
let structureFailureTableEnsured = false

export class ProteinReadUnavailableError extends Error {
  constructor(cause) {
    super(String(cause?.message || cause || "Protein database read failed"), { cause })
    this.name = "ProteinReadUnavailableError"
  }
}

async function readProteinRow(db, sql, key) {
  try {
    return await db.prepare(sql).bind(key).first()
  } catch (error) {
    throw new ProteinReadUnavailableError(error)
  }
}

function normalizeKey(uniprot) {
  return (uniprot || "").toUpperCase()
}

function prefixUpperBound(prefix) {
  return `${prefix}\uffff`
}

function clampSearchLimit(limit) {
  const parsed = Number.parseInt(String(limit || 20), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 20
  return Math.min(parsed, 100)
}

function toProteinSearchTokens(query) {
  return (
    String(query || "")
      .normalize("NFKC")
      .match(/[\p{L}\p{N}]+/gu)
      ?.filter(Boolean) || []
  )
}

function toProteinSearchMatchQuery(query) {
  const tokens = toProteinSearchTokens(query)
  if (!tokens.length) return ""
  return tokens.map((token) => `${token}*`).join(" ")
}

function rememberProtein(key, value) {
  if (!key || !value) {
    return
  }
  proteinCache.set(key, value)
  if (proteinCache.size > MAX_CACHE_SIZE) {
    const oldestKey = proteinCache.keys().next().value
    proteinCache.delete(oldestKey)
  }
}

function cloneArrayBuffer(value) {
  if (value instanceof ArrayBuffer) {
    return value.slice(0)
  }
  if (Array.isArray(value)) {
    const u8 = new Uint8Array(value.length)
    for (let i = 0; i < value.length; i += 1) {
      const byte = value[i]
      u8[i] = typeof byte === "number" && Number.isFinite(byte) ? byte & 0xff : 0
    }
    return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
  }
  if (ArrayBuffer.isView(value) && value?.buffer instanceof ArrayBuffer) {
    const { buffer, byteOffset = 0, byteLength } = value
    const length = typeof byteLength === "number" ? byteLength : buffer.byteLength
    return buffer.slice(byteOffset, byteOffset + length)
  }
  return null
}

function toFloat32Vector(row) {
  const vectorData = row?.vector
  if (!vectorData) {
    return null
  }
  let buffer = cloneArrayBuffer(vectorData)
  // Some D1 clients or drivers return BLOBs as hex or base64 strings.
  // If so, convert them into ArrayBuffer/Uint8Array for Float32Array view.
  if (!buffer && typeof vectorData === "string") {
    const s = vectorData.trim()
    // Hex string (even length, only hex chars)
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
      const len = s.length / 2
      const u8 = new Uint8Array(len)
      for (let i = 0; i < len; i += 1) {
        u8[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
      }
      buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
    } else {
      // Attempt base64 decode common in web contexts
      try {
        const bin = atob(s)
        const u8 = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) {
          u8[i] = bin.charCodeAt(i)
        }
        buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
      } catch (e) {
        buffer = null
      }
    }
  }
  if (!buffer || buffer.byteLength === 0) {
    return null
  }
  const vector = new Float32Array(buffer)
  const dim = Number(row.dim)
  if (Number.isFinite(dim) && dim > 0) {
    if (vector.length === dim) {
      return vector
    }
    if (vector.length > dim) {
      return vector.slice(0, dim)
    }
    return null
  }
  return vector
}

/**
 * Convert a float16 blob to Float32Array.
 * ESM2 embeddings are stored as float16 to save space.
 */
function float16ToFloat32(uint16) {
  const sign = (uint16 >> 15) & 0x1
  const exp = (uint16 >> 10) & 0x1f
  const frac = uint16 & 0x3ff

  if (exp === 0) {
    // Subnormal or zero
    if (frac === 0) return sign ? -0 : 0
    // Subnormal: value = (-1)^sign * 2^-14 * (frac/1024)
    return (sign ? -1 : 1) * Math.pow(2, -14) * (frac / 1024)
  } else if (exp === 31) {
    // Infinity or NaN
    return frac === 0 ? (sign ? -Infinity : Infinity) : NaN
  }
  // Normal: value = (-1)^sign * 2^(exp-15) * (1 + frac/1024)
  return (sign ? -1 : 1) * Math.pow(2, exp - 15) * (1 + frac / 1024)
}

function toFloat16ToFloat32Vector(blobData, expectedDim) {
  if (!blobData) {
    return null
  }
  let buffer = cloneArrayBuffer(blobData)
  // Handle hex or base64 strings
  if (!buffer && typeof blobData === "string") {
    const s = blobData.trim()
    if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
      const len = s.length / 2
      const u8 = new Uint8Array(len)
      for (let i = 0; i < len; i += 1) {
        u8[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
      }
      buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
    } else {
      try {
        const bin = atob(s)
        const u8 = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i += 1) {
          u8[i] = bin.charCodeAt(i)
        }
        buffer = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength)
      } catch (e) {
        buffer = null
      }
    }
  }
  if (!buffer || buffer.byteLength === 0) {
    return null
  }
  // Read as Uint16Array (float16 is 2 bytes per value)
  const uint16View = new Uint16Array(buffer)
  const dim = expectedDim || uint16View.length
  const float32 = new Float32Array(dim)
  for (let i = 0; i < dim && i < uint16View.length; i += 1) {
    float32[i] = float16ToFloat32(uint16View[i])
  }
  return float32
}

function toProteinObject(row) {
  if (!row) {
    return null
  }
  // Parse JSON array columns
  const parseJson = (str) => {
    if (!str) return []
    try {
      return JSON.parse(str)
    } catch {
      return []
    }
  }

  return {
    id: row.id,
    uniprot: row.uniprot,
    gene: row.gene,
    gene_surname: row.gene_surname,
    hgnc: row.gene, // alias for game engine compatibility
    full_name: row.full_name,
    length: row.length,
    mass: row.mass,
    tmh: Boolean(row.tmh),
    secreted: Boolean(row.secreted),
    tissue: { label: row.tissue_label, score: null },
    has_structure: Boolean(row.has_structure),
    structure_source: row.structure_source,
    pdb_id: row.pdb_id,
    pdb_chain_id: row.pdb_chain_id,
    pdb_coverage: row.pdb_coverage,
    pdb_resolution: row.pdb_resolution,
    pdb_method: row.pdb_method,
    pdb_chain_labels: row.pdb_chain_labels,
    swissmodel_coverage: row.swissmodel_coverage,
    swissmodel_qmean: row.swissmodel_qmean,
    swissmodel_template: row.swissmodel_template,
    swissmodel_url: row.swissmodel_url,
    swissmodel_chain_labels: row.swissmodel_chain_labels,
    alphafold_plddt: row.alphafold_plddt,
    alphafold_url: row.alphafold_url,
    gene_summary: row.gene_summary,
    origin_age: row.origin_age,
    first_pub_year: row.first_pub_year,
    // CATH architecture (JSON array)
    cath_architecture: parseJson(row.cath_architecture),
    // JSON arrays
    synonyms: parseJson(row.synonyms),
    domains: parseJson(row.domains),
    domain_names: parseJson(row.domains), // same as domains (already names)
    clans: parseJson(row.clans),
    subcell: parseJson(row.locations),
    // GO terms in expected structure
    go_terms: {
      bp: parseJson(row.go_bp),
      mf: parseJson(row.go_mf),
      cc: parseJson(row.go_cc),
    },
    go_terms_named: {
      bp: parseJson(row.go_bp),
      mf: parseJson(row.go_mf),
      cc: parseJson(row.go_cc),
    },
    // Pathways as expected structure
    reactome_pathways: parseJson(row.pathways),
    // Top-9 similar neighbors for ladder display
    neighbors: parseJson(row.neighbors),
  }
}

export async function fetchProteinByUniprot(db, uniprot) {
  const key = normalizeKey(uniprot)
  if (!key) {
    return null
  }
  if (proteinCache.has(key)) {
    return proteinCache.get(key)
  }
  const row = await readProteinRow(db, `SELECT * FROM proteins WHERE uniprot = ? LIMIT 1`, key)
  const protein = toProteinObject(row)
  if (protein) {
    rememberProtein(key, protein)
  }
  return protein || null
}

/**
 * Load the small protein projection used by schedule/admin views in one D1
 * statement. A year-long schedule must not issue one SELECT * per day: aside
 * from being wasteful, that can exhaust an invocation while leaving the tail
 * of an otherwise-200 response without identities.
 */
export async function fetchProteinSummaryMapByUniprotIds(db, uniprotIds) {
  const ids = Array.from(
    new Set((Array.isArray(uniprotIds) ? uniprotIds : []).map(normalizeKey).filter(Boolean)),
  )
  if (!ids.length) {
    return new Map()
  }

  const { results } = await db
    .prepare(
      `SELECT uniprot, gene, gene_surname, full_name, length
       FROM proteins
       WHERE uniprot IN (SELECT value FROM json_each(?))`,
    )
    .bind(JSON.stringify(ids))
    .all()

  return new Map(
    (results || []).map((row) => [normalizeKey(row.uniprot), sanitizeProteinSummary(row)]),
  )
}

export async function fetchProteinByGene(db, gene) {
  if (!gene || typeof gene !== "string") return null
  const key = gene.toUpperCase().trim()
  if (!key) return null
  // Check cache by gene
  for (const p of proteinCache.values()) {
    if (p && (p.gene || p.hgnc || "").toUpperCase() === key) return p
  }
  const row = await readProteinRow(db, `SELECT * FROM proteins WHERE gene = ? LIMIT 1`, key)
  const protein = toProteinObject(row)
  if (protein) {
    rememberProtein(normalizeKey(protein.uniprot), protein)
  }
  return protein || null
}

// Cache for dual embeddings (HiG2Vec + SaProt, with optional legacy ESM2 fallback)
const dualEmbeddingCache = new Map()
const MAX_DUAL_CACHE_SIZE = 256

function rememberDualEmbedding(key, value) {
  if (!key) return
  if (!value) {
    dualEmbeddingCache.delete(key)
    return
  }
  dualEmbeddingCache.set(key, value)
  if (dualEmbeddingCache.size > MAX_DUAL_CACHE_SIZE) {
    const oldestKey = dualEmbeddingCache.keys().next().value
    dualEmbeddingCache.delete(oldestKey)
  }
}

/**
 * Fetch HiG2Vec + SaProt embeddings for a gene (with optional legacy ESM2 fallback).
 * Returns { hig2vec: Float32Array|null, saprot: Float32Array|null, esm2: Float32Array|null }
 */
export async function fetchDualEmbeddings(db, geneSymbol) {
  if (!geneSymbol) {
    return { hig2vec: null, saprot: null, esm2: null }
  }
  const key = geneSymbol.toUpperCase()
  if (dualEmbeddingCache.has(key)) {
    return dualEmbeddingCache.get(key)
  }
  const row = await db
    .prepare(
      `SELECT vector, dim, esm2_vector, esm2_dim, saprot_vector, saprot_dim
     FROM ${DUAL_EMBEDDINGS_TABLE} WHERE gene_symbol = ? LIMIT 1`,
    )
    .bind(key)
    .first()

  const result = {
    hig2vec: toFloat32Vector(row),
    saprot: row?.saprot_vector ? toFloat16ToFloat32Vector(row.saprot_vector, row.saprot_dim) : null,
    esm2: row?.esm2_vector ? toFloat16ToFloat32Vector(row.esm2_vector, row.esm2_dim) : null,
  }
  rememberDualEmbedding(key, result)
  return result
}

async function ensureStructureFailureTable(db) {
  if (!db || structureFailureTableEnsured) {
    return
  }
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS structure_failures (
       uniprot TEXT PRIMARY KEY,
       failed_at DATETIME DEFAULT CURRENT_TIMESTAMP
     )`,
    )
    .run()
  structureFailureTableEnsured = true
}

export async function markStructureFailure(db, uniprot) {
  if (!db || !uniprot) {
    return
  }
  await ensureStructureFailureTable(db)
  await db
    .prepare(
      `INSERT INTO structure_failures (uniprot, failed_at)
     VALUES (upper(?), CURRENT_TIMESTAMP)
     ON CONFLICT(uniprot) DO UPDATE SET failed_at = excluded.failed_at`,
    )
    .bind(uniprot)
    .run()
}

export async function clearStructureFailure(db, uniprot) {
  if (!db || !uniprot) {
    return
  }
  await ensureStructureFailureTable(db)
  await db.prepare(`DELETE FROM structure_failures WHERE uniprot = upper(?)`).bind(uniprot).run()
}

export async function searchProteins(db, query, limit = 20, exclude = []) {
  if (!query || !query.trim()) {
    return []
  }
  const cleanedLimit = clampSearchLimit(limit)
  const exactUpper = query.trim().toUpperCase()
  const upperPrefixEnd = prefixUpperBound(exactUpper)
  const ftsQuery = toProteinSearchMatchQuery(query)
  if (!ftsQuery) return []
  if (query.length > 200 || exclude.length > 100) {
    throw new Error("Protein search accepts at most 200 query characters and 100 exclusions")
  }
  const candidateLimit = cleanedLimit + exclude.length + 128

  // Build exclusion clause if needed
  let excludeClause = ""
  const excludeBindings = []
  if (exclude.length > 0) {
    const placeholders = exclude.map(() => "?").join(",")
    excludeClause = `AND p.uniprot NOT IN (${placeholders})`
    excludeBindings.push(...exclude)
  }

  try {
    await ensureStructureFailureTable(db)
    // FTS5 can produce its relevance-ordered cursor without joining every
    // match to proteins/synonyms first. A CASE sort on the original full join
    // defeated that optimization (100k reads for 20 broad suggestions).
    // Indexed symbol/accession/alias lanes retain exact and prefix matches
    // even when common words would dominate the full-text shortlist.
    const statement = `
      WITH candidates(id) AS MATERIALIZED (
        SELECT rowid FROM (SELECT rowid FROM protein_search WHERE protein_search MATCH ? ORDER BY rank LIMIT ?)
        UNION
        SELECT id FROM (SELECT id FROM proteins WHERE gene >= ? AND gene < ? ORDER BY gene LIMIT ?)
        UNION
        SELECT id FROM (SELECT id FROM proteins WHERE uniprot >= ? AND uniprot < ? ORDER BY uniprot LIMIT ?)
        UNION
        SELECT protein_id FROM (SELECT protein_id FROM protein_synonyms WHERE normalized >= ? AND normalized < ? ORDER BY normalized LIMIT ?)
      )
      SELECT
        p.uniprot,
        p.gene,
        p.full_name,
        p.length,
        p.synonyms,
        CASE
          WHEN p.gene = ? THEN 0
          WHEN p.uniprot = ? THEN 1
          WHEN EXISTS (
            SELECT 1
            FROM protein_synonyms s
            WHERE s.protein_id = p.id
              AND s.normalized = ?
          ) THEN 2
          WHEN p.gene >= ? AND p.gene < ? THEN 3
          WHEN p.uniprot >= ? AND p.uniprot < ? THEN 4
          WHEN EXISTS (
            SELECT 1
            FROM protein_synonyms s
            WHERE s.protein_id = p.id
              AND s.normalized >= ?
              AND s.normalized < ?
          ) THEN 5
          ELSE 6
        END AS match_rank,
        bm25(protein_search) AS relevance
      FROM candidates
      CROSS JOIN protein_search ON protein_search.rowid = candidates.id
      CROSS JOIN proteins p
        ON p.id = protein_search.rowid
      LEFT JOIN structure_failures sf
        ON sf.uniprot = p.uniprot
      WHERE protein_search MATCH ?
        AND p.structure_source IS NOT NULL
        AND sf.uniprot IS NULL
        ${excludeClause}
      ORDER BY match_rank ASC, relevance ASC, p.gene ASC, p.uniprot ASC
      LIMIT ?`
    const response = await db
      .prepare(statement)
      .bind(
        ftsQuery,
        candidateLimit,
        exactUpper,
        upperPrefixEnd,
        candidateLimit,
        exactUpper,
        upperPrefixEnd,
        candidateLimit,
        exactUpper,
        upperPrefixEnd,
        candidateLimit,
        exactUpper,
        exactUpper,
        exactUpper,
        exactUpper,
        upperPrefixEnd,
        exactUpper,
        upperPrefixEnd,
        exactUpper,
        upperPrefixEnd,
        ftsQuery,
        ...excludeBindings,
        cleanedLimit,
      )
      .all()
    return (response?.results || []).map((row) => sanitizeProteinSummary(row))
  } catch (err) {
    console.warn("GeneGuessr: D1 searchProteins failed", err)
    throw new ProteinReadUnavailableError(err)
  }
}

export async function getEligibleProteinIds(db) {
  const now = Date.now()
  if (eligibleCache.ids && now - eligibleCache.fetchedAt < eligibleCache.ttl) {
    return eligibleCache.ids.slice()
  }
  await ensureStructureFailureTable(db)
  const fetchIds = async (clause) => {
    const statement = `
      SELECT p.uniprot
      FROM proteins p
      LEFT JOIN structure_failures sf ON sf.uniprot = p.uniprot
      ${clause}
    `
    const { results } = await db.prepare(statement).all()
    return (results || []).map((row) => row.uniprot)
  }
  let ids = []
  try {
    ids = await fetchIds(
      `WHERE p.structure_source IS NOT NULL
         AND p.gene_summary IS NOT NULL
         AND sf.uniprot IS NULL`,
    )
  } catch (err) {
    console.warn("GeneGuessr: D1 getEligibleProteinIds failed", err)
    ids = []
  }
  eligibleCache.ids = ids
  eligibleCache.fetchedAt = now
  return ids.slice()
}

// THE ONLY DAILY SELECTION POOL — DO NOT DUPLICATE.
//
// The playable pool is the set of proteins the daily lottery may pick from,
// grouped into surname families (ARCHITECTURE FENCE [GG-001]). Computing it
// scans the whole `proteins` table and sorts the result (about 1.5 rows read per
// protein), so it is computed once and stored as one row of
// `daily_selection_pool`. Every reader (the nightly pre-warm, the player path
// when no recorded pick exists, the admin schedule and cards views) reads that
// row: one row, whatever the table size, whichever isolate asks.
//
// `daily_selection_pool` is created by this code on first use, like the other
// tables the GeneGuessr worker owns. A normal deploy applies no migration to this
// database, and the maintenance release refuses a migration file that has no
// reviewed cost-plan entry, so a file here would block it. One batch creates
// the table, its single row and the three triggers.
//
// Freshness: any write to `proteins` that can change eligibility (an insert, a
// delete, or an update that changes one of DAILY_SELECTION_POOL_SOURCE_COLUMNS)
// fires a trigger that clears the stored pool and bumps `catalog_version`. The
// next reader rebuilds it. A rebuild reads `catalog_version` before it scans and
// stores its result only if the version is unchanged, so a write that lands
// during the scan can never leave a stale pool behind.
//
// To force a rebuild by hand: UPDATE daily_selection_pool SET families_json = NULL.
// A table rebuild that drops `proteins` also drops these triggers; run any
// reader (or delete the `daily_selection_pool` table and its triggers) afterwards.
export const DAILY_SELECTION_POOL_SOURCE_SQL = `SELECT p.uniprot, p.gene_surname
         FROM proteins p
         WHERE p.structure_source IS NOT NULL
           AND LOWER(TRIM(p.structure_source)) <> 'alphafold'
           AND p.gene_summary IS NOT NULL
         ORDER BY p.gene_surname ASC, p.uniprot ASC`

// Every `proteins` column the statement above reads. The triggers watch exactly
// these; a test fails if the statement and this list disagree.
export const DAILY_SELECTION_POOL_SOURCE_COLUMNS = Object.freeze([
  "uniprot",
  "gene_surname",
  "structure_source",
  "gene_summary",
])

const DAILY_SELECTION_POOL_STATE_SQL =
  "SELECT catalog_version, fingerprint, families_json FROM daily_selection_pool WHERE id = 1"
const DAILY_SELECTION_POOL_ROW_SQL = "INSERT OR IGNORE INTO daily_selection_pool (id) VALUES (1)"
const DAILY_SELECTION_POOL_INVALIDATE_SQL =
  "UPDATE daily_selection_pool SET catalog_version = catalog_version + 1, fingerprint = NULL, families_json = NULL, built_at = NULL WHERE id = 1;"
const DAILY_SELECTION_POOL_CHANGED_SQL = DAILY_SELECTION_POOL_SOURCE_COLUMNS.map(
  (column) => `OLD.${column} IS NOT NEW.${column}`,
).join(" OR ")

const DAILY_SELECTION_POOL_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS daily_selection_pool (
     id INTEGER PRIMARY KEY CHECK (id = 1),
     catalog_version INTEGER NOT NULL DEFAULT 0,
     fingerprint TEXT,
     families_json TEXT,
     built_at INTEGER
   )`,
  DAILY_SELECTION_POOL_ROW_SQL,
  `CREATE TRIGGER IF NOT EXISTS daily_selection_pool_proteins_ai
   AFTER INSERT ON proteins
   BEGIN ${DAILY_SELECTION_POOL_INVALIDATE_SQL} END`,
  `CREATE TRIGGER IF NOT EXISTS daily_selection_pool_proteins_ad
   AFTER DELETE ON proteins
   BEGIN ${DAILY_SELECTION_POOL_INVALIDATE_SQL} END`,
  `CREATE TRIGGER IF NOT EXISTS daily_selection_pool_proteins_au
   AFTER UPDATE OF ${DAILY_SELECTION_POOL_SOURCE_COLUMNS.join(", ")} ON proteins
   WHEN ${DAILY_SELECTION_POOL_CHANGED_SQL}
   BEGIN ${DAILY_SELECTION_POOL_INVALIDATE_SQL} END`,
]

async function readDailySelectionPoolState(db) {
  try {
    return await db.prepare(DAILY_SELECTION_POOL_STATE_SQL).first()
  } catch (error) {
    if (!/no such table/i.test(String(error?.message || error))) {
      throw error
    }
    await db.batch(DAILY_SELECTION_POOL_SCHEMA_SQL.map((sql) => db.prepare(sql)))
    return db.prepare(DAILY_SELECTION_POOL_STATE_SQL).first()
  }
}

// A stored row that does not parse into a non-empty list of named families with
// text members is as good as no row: it is rebuilt, never thrown.
function parseStoredDailySelectionPool(state) {
  if (!state?.families_json || !state?.fingerprint) {
    return null
  }
  try {
    const stored = JSON.parse(state.families_json)
    if (!Array.isArray(stored) || !stored.length) {
      return null
    }
    const families = stored.map((entry) => {
      const [surname, members] = Array.isArray(entry) ? entry : []
      if (
        typeof surname !== "string" ||
        !surname ||
        !Array.isArray(members) ||
        !members.length ||
        members.some((member) => typeof member !== "string" || !member)
      ) {
        throw new Error("invalid stored family")
      }
      return { surname, members }
    })
    return { families, fingerprint: state.fingerprint }
  } catch {
    return null
  }
}

async function storeDailySelectionPool(db, pool, catalogVersion) {
  try {
    const stored = await db
      .prepare(
        `UPDATE daily_selection_pool
         SET fingerprint = ?, families_json = ?, built_at = ?
         WHERE id = 1 AND catalog_version = ?`,
      )
      .bind(
        pool.fingerprint,
        JSON.stringify(pool.families.map((family) => [family.surname, family.members])),
        Date.now(),
        catalogVersion,
      )
      .run()
    if (!stored?.meta?.changes) {
      console.warn("GeneGuessr: the catalog changed during a pool rebuild; the pool was not stored")
    }
  } catch (err) {
    console.warn("GeneGuessr: D1 could not store the daily selection pool", err)
  }
}

// Requests that arrive while a load is in flight share it, so a rebuild costs one
// scan per isolate however many requests ask at once. Nothing is kept afterwards.
const dailySelectionPoolLoads = new WeakMap()

// The pool as { families, fingerprint }, or null when D1 cannot be read.
function loadDailySelectionPool(db) {
  if (!db) {
    console.warn("GeneGuessr: the daily selection pool needs a D1 binding")
    return Promise.resolve(null)
  }
  let load = dailySelectionPoolLoads.get(db)
  if (!load) {
    load = readOrBuildDailySelectionPool(db).finally(() => dailySelectionPoolLoads.delete(db))
    dailySelectionPoolLoads.set(db, load)
  }
  return load
}

async function readOrBuildDailySelectionPool(db) {
  try {
    // When the stored pool cannot be read or created (D1 refuses its schema),
    // the pool is still built from the catalog and returned, just not stored:
    // selection keeps working and the warning names the cost.
    let catalogVersion = null
    try {
      let state = await readDailySelectionPoolState(db)
      const stored = parseStoredDailySelectionPool(state)
      if (stored) {
        return stored
      }
      if (!state) {
        await db.prepare(DAILY_SELECTION_POOL_ROW_SQL).run()
        state = await db.prepare(DAILY_SELECTION_POOL_STATE_SQL).first()
      }
      catalogVersion = Number(state?.catalog_version ?? 0)
    } catch (err) {
      console.warn(
        "GeneGuessr: the stored daily selection pool is unavailable; building it from the catalog",
        err,
      )
    }
    const { results } = await db.prepare(DAILY_SELECTION_POOL_SOURCE_SQL).all()
    const rows = (results || []).map((row) => ({
      uniprot: normalizeKey(row.uniprot),
      gene_surname: String(row.gene_surname || "")
        .trim()
        .toUpperCase(),
    }))
    const families = buildDailySelectionFamilies(
      rows,
      rows.map((row) => row.uniprot),
    )
    const pool = { families, fingerprint: await buildDailySelectionPoolFingerprint(families) }
    if (families.length && catalogVersion !== null) {
      await storeDailySelectionPool(db, pool, catalogVersion)
    }
    return pool
  } catch (err) {
    console.warn("GeneGuessr: D1 daily selection pool failed", err)
    return null
  }
}

export async function getDailySelectionPoolFingerprint(db) {
  const pool = await loadDailySelectionPool(db)
  return pool ? pool.fingerprint : null
}

export async function buildDailySelectionPoolFingerprint(families) {
  const canonicalFamilies = (Array.isArray(families) ? families : [])
    .map((family) => ({
      surname: String(family?.surname || "")
        .trim()
        .toUpperCase(),
      members: Array.from(
        new Set(
          (Array.isArray(family?.members) ? family.members : []).map((member) =>
            normalizeKey(String(member || "").trim()),
          ),
        ),
      )
        .filter(Boolean)
        .sort(),
    }))
    .filter((family) => family.surname && family.members.length)
    .sort((left, right) =>
      left.surname < right.surname ? -1 : left.surname > right.surname ? 1 : 0,
    )
  const fingerprintSource = canonicalFamilies
    .map((family) => `${family.surname}\u0000${family.members.join(",")}`)
    .join("\n")
  const fingerprintBytes = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fingerprintSource)),
  )
  return Array.from(fingerprintBytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
}

const UINT64_MASK = (1n << 64n) - 1n

function readUint64BigEndian(bytes, offset) {
  let value = 0n
  for (let index = offset; index < offset + 8; index += 1) {
    value = (value << 8n) | BigInt(bytes[index] || 0)
  }
  return value
}

function mixUint64(value) {
  let mixed = (value + 0x9e3779b97f4a7c15n) & UINT64_MASK
  mixed = ((mixed ^ (mixed >> 30n)) * 0xbf58476d1ce4e5b9n) & UINT64_MASK
  mixed = ((mixed ^ (mixed >> 27n)) * 0x94d049bb133111ebn) & UINT64_MASK
  return (mixed ^ (mixed >> 31n)) & UINT64_MASK
}

function buildDailySelectionFamilies(rows, eligibleIds) {
  const eligible =
    Array.isArray(eligibleIds) && eligibleIds.length
      ? new Set(eligibleIds.map((id) => normalizeKey(id)).filter(Boolean))
      : null
  const familiesBySurname = new Map()
  const presentIds = new Set()

  for (const row of rows || []) {
    const uniprot = normalizeKey(row?.uniprot)
    if (!uniprot || (eligible && !eligible.has(uniprot))) {
      continue
    }
    const surname = String(row?.gene_surname || "")
      .trim()
      .toUpperCase()
    // Missing family metadata must not silently remove a playable protein.
    // Treat it as a one-member family until the data is repaired.
    const familyKey = surname || `__UNFAMILIED__:${uniprot}`
    if (!familiesBySurname.has(familyKey)) {
      familiesBySurname.set(familyKey, new Set())
    }
    familiesBySurname.get(familyKey).add(uniprot)
    presentIds.add(uniprot)
  }

  if (eligible) {
    for (const uniprot of eligible) {
      if (!presentIds.has(uniprot)) {
        familiesBySurname.set(`__UNFAMILIED__:${uniprot}`, new Set([uniprot]))
      }
    }
  }

  return Array.from(familiesBySurname, ([surname, members]) => ({
    surname,
    members: Array.from(members).sort(),
  })).sort((left, right) =>
    left.surname < right.surname ? -1 : left.surname > right.surname ? 1 : 0,
  )
}

/**
 * ARCHITECTURE FENCE [GG-001]
 *
 * Build a deterministic candidate sequence with exactly one representative
 * per surname. The representative varies by day, but a 400-member family still
 * occupies exactly the same one slot as a one-member family.
 */
export async function buildFamilyBalancedDailyCandidateIds(
  rows,
  eligibleIds,
  salt,
  date = new Date(),
) {
  const families = buildDailySelectionFamilies(rows, eligibleIds)
  return buildFamilyBalancedCandidateIdsFromFamilies(families, salt, date)
}

// ARCHITECTURE FENCE [GG-001]: automatic targets walk a deterministic
// without-replacement surname bag. For any window shorter than the number
// of playable surnames, no automatic family (and therefore no UniProt ID)
// can repeat. A new bag cycle rotates the representative inside each family.
async function buildFamilyBalancedCandidateIdsFromFamilies(families, salt, date) {
  if (!families.length) {
    return []
  }

  const day = typeof date === "string" ? date : date.toISOString().slice(0, 10)
  const dayTimestamp = Date.parse(`${day}T00:00:00.000Z`)
  if (!Number.isFinite(dayTimestamp)) {
    throw new Error(`Invalid daily selection date: ${day}`)
  }
  const dayOrdinal = Math.floor(dayTimestamp / 86_400_000)
  const { familyOrder, memberSeed } = await buildFamilyBalancedBag(families, salt)
  const familyCount = families.length
  const familyPosition = ((dayOrdinal % familyCount) + familyCount) % familyCount
  const familyCycle = Math.floor(dayOrdinal / familyCount)
  const candidateIds = []

  for (let familyOffset = 0; familyOffset < families.length; familyOffset += 1) {
    const familyIndex = familyOrder[(familyPosition + familyOffset) % familyCount]
    candidateIds.push(selectFamilyMember(families, familyIndex, familyCycle, memberSeed))
  }

  return candidateIds
}

async function buildFamilyBalancedBag(families, salt) {
  const seedBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt || ""}|family-balanced-shuffle-bag-v2`),
  )
  const seedBytes = new Uint8Array(seedBuffer)
  let familySeed = readUint64BigEndian(seedBytes, 0)
  const memberSeed = readUint64BigEndian(seedBytes, 8)
  const familyOrder = families.map((_, index) => index)
  for (let index = familyOrder.length - 1; index > 0; index -= 1) {
    familySeed = mixUint64(familySeed ^ BigInt(index))
    const swapIndex = Number(familySeed % BigInt(index + 1))
    ;[familyOrder[index], familyOrder[swapIndex]] = [familyOrder[swapIndex], familyOrder[index]]
  }

  return { familyOrder, memberSeed }
}

function selectFamilyMember(families, familyIndex, familyCycle, memberSeed) {
  const family = families[familyIndex]
  const memberStart = Number(
    mixUint64(memberSeed ^ BigInt(familyIndex)) % BigInt(family.members.length),
  )
  const memberIndex = (memberStart + familyCycle) % family.members.length
  return family.members[memberIndex]
}

// Cache for surname-based protein grouping (for balanced random selection)
const surnameCache = {
  surnames: null, // Array of unique surnames
  byName: null, // Map<surname, Array<uniprot>>
  fetchedAt: 0,
  ttl: 5 * 60 * 1000, // 5 minutes
}

/**
 * Get eligible proteins grouped by gene surname.
 * This enables balanced random selection that doesn't over-represent
 * large gene families like ZNF, OR, KRTAP, etc.
 */
export async function getEligibleProteinsBySurname(db) {
  const now = Date.now()
  if (surnameCache.surnames && now - surnameCache.fetchedAt < surnameCache.ttl) {
    return {
      surnames: surnameCache.surnames.slice(),
      byName: new Map(surnameCache.byName),
    }
  }

  await ensureStructureFailureTable(db)

  try {
    const statement = `
      SELECT p.uniprot, p.gene_surname
      FROM proteins p
      LEFT JOIN structure_failures sf ON sf.uniprot = p.uniprot
      WHERE p.structure_source IS NOT NULL
        AND p.gene_summary IS NOT NULL
        AND sf.uniprot IS NULL
        AND p.gene_surname IS NOT NULL
    `
    const { results } = await db.prepare(statement).all()

    // Group proteins by surname
    const byName = new Map()
    for (const row of results || []) {
      const surname = row.gene_surname
      if (!byName.has(surname)) {
        byName.set(surname, [])
      }
      byName.get(surname).push(row.uniprot)
    }

    const surnames = Array.from(byName.keys()).sort()

    surnameCache.surnames = surnames
    surnameCache.byName = byName
    surnameCache.fetchedAt = now

    console.log(`[SURNAME-CACHE] Loaded ${surnames.length} unique gene surnames`)

    return { surnames: surnames.slice(), byName: new Map(byName) }
  } catch (err) {
    console.warn("GeneGuessr: D1 getEligibleProteinsBySurname failed", err)
    return { surnames: [], byName: new Map() }
  }
}

/**
 * Pick a random protein using surname-based balancing.
 * 1. Pick a random surname
 * 2. Pick a random protein within that surname
 *
 * This ensures each gene family has equal representation regardless of size.
 * For example, the 400+ OR genes now have the same probability as the 1 TP53 gene.
 *
 * Returns: { protein, surname, familySize } or null
 */
export async function pickRandomProteinBalanced(db) {
  const { surnames, byName } = await getEligibleProteinsBySurname(db)

  if (!surnames.length) {
    console.warn("[BALANCED-PICK] No surnames available, falling back to unbalanced")
    return null
  }

  // Step 1: Pick random surname
  const surnameIdx = Math.floor(Math.random() * surnames.length)
  const surname = surnames[surnameIdx]
  const familyProteins = byName.get(surname) || []

  if (!familyProteins.length) {
    console.warn(`[BALANCED-PICK] Surname ${surname} has no proteins, retrying`)
    return pickRandomProteinBalanced(db) // Retry with different surname
  }

  // Step 2: Pick random protein within surname
  const proteinIdx = Math.floor(Math.random() * familyProteins.length)
  const uniprot = familyProteins[proteinIdx]

  const protein = await fetchProteinByUniprot(db, uniprot)

  if (!protein) {
    console.warn(`[BALANCED-PICK] Protein ${uniprot} not found, retrying`)
    return pickRandomProteinBalanced(db)
  }

  console.log(
    `[BALANCED-PICK] Picked ${protein.gene} from ${surname} family (${familyProteins.length} members)`,
  )

  return {
    protein,
    surname,
    familySize: familyProteins.length,
  }
}

export async function planDailyTarget(db, salt, date = new Date()) {
  const pool = await loadDailySelectionPool(db)
  if (!pool) {
    return null
  }
  const ids = await buildFamilyBalancedCandidateIdsFromFamilies(pool.families, salt, date)
  if (!ids.length) {
    return null
  }
  const today = typeof date === "string" ? date : date.toISOString().slice(0, 10)
  return {
    uniprot: ids[0],
    skippedAlphaFold: 0,
    date: today,
    candidateIds: ids,
    poolFingerprint: pool.fingerprint,
  }
}

/**
 * Compute primary targets for a schedule horizon with one shuffle and one
 * digest. This is exactly equivalent to taking candidateIds[0] from
 * planDailyTarget for each day, without rebuilding the entire candidate order
 * hundreds of times in one Worker invocation.
 */
export async function planDailyTargets(db, salt, dates) {
  const pool = await loadDailySelectionPool(db)
  if (!pool?.families.length) {
    return []
  }
  const families = pool.families
  const { familyOrder, memberSeed } = await buildFamilyBalancedBag(families, salt)
  const familyCount = families.length

  return (Array.isArray(dates) ? dates : []).map((value) => {
    const date = typeof value === "string" ? value : value.toISOString().slice(0, 10)
    const dayTimestamp = Date.parse(`${date}T00:00:00.000Z`)
    if (!Number.isFinite(dayTimestamp)) {
      throw new Error(`Invalid daily selection date: ${date}`)
    }
    const dayOrdinal = Math.floor(dayTimestamp / 86_400_000)
    const familyPosition = ((dayOrdinal % familyCount) + familyCount) % familyCount
    const familyCycle = Math.floor(dayOrdinal / familyCount)
    const familyIndex = familyOrder[familyPosition]
    return {
      uniprot: selectFamilyMember(families, familyIndex, familyCycle, memberSeed),
      skippedAlphaFold: 0,
      date,
      poolFingerprint: pool.fingerprint,
    }
  })
}

export async function pickDailyTarget(db, salt, date = new Date()) {
  const plan = await planDailyTarget(db, salt, date)
  if (!plan) {
    return null
  }
  const protein = await fetchProteinByUniprot(db, plan.uniprot)
  return { ...plan, protein }
}

function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || !vecA.length) {
    return null
  }
  let dot = 0
  let magA = 0
  let magB = 0
  for (let i = 0; i < vecA.length; i += 1) {
    const a = vecA[i]
    const b = vecB[i]
    dot += a * b
    magA += a * a
    magB += b * b
  }
  if (magA <= 0 || magB <= 0) {
    return null
  }
  return dot / (Math.sqrt(magA) * Math.sqrt(magB))
}

// Soft-OR calibration constants (q90, gamma=1.6).
// Notes:
// - `hig2vec` is computed on the isotropic HiG2Vec space (mean-center + remove top PCs + L2).
// - `saprot` is computed on isotropic SaProt (mean-center + L2).
// - `esm2` is legacy fallback for older rows that lack SaProt.
const SOFT_OR_CALIBRATION = {
  gamma: 1.6,
  hig2vec: { slope: 3.0523066887460613, midpoint: 0.11959530995180852 },
  saprot: { slope: 3.5181330442836676, midpoint: 0.2361672823590854 },
  esm2: { slope: 4.584771332415639, midpoint: 0.12455377192395384 },
}

/**
 * Stage 1: Compute metric similarity (internal, preserves discrimination).
 * Uses percentile-aligned linear transform: norm = scale * raw + offset.
 * Calibrated so median → 0.50, p99 → 0.90 for both embedding types.
 *
 * This ensures equal contribution from ESM2 and HiG2Vec in the 89-90% bracket,
 * where the ladder boundary sits. No clipping needed - blended metric naturally
 * stays in reasonable bounds (both inputs calibrated to [0, 1] at p0→p100).
 */
function sigmoid(value) {
  return 1 / (1 + Math.exp(-value))
}

function getSoftOrPercent(cosH, cosSeq, seqKey = "saprot") {
  if (!Number.isFinite(cosH) && !Number.isFinite(cosSeq)) {
    return null
  }
  const seq = SOFT_OR_CALIBRATION[seqKey] || SOFT_OR_CALIBRATION.saprot
  const h = Number.isFinite(cosH)
    ? sigmoid(SOFT_OR_CALIBRATION.hig2vec.slope * (cosH - SOFT_OR_CALIBRATION.hig2vec.midpoint))
    : 0
  const s = Number.isFinite(cosSeq) ? sigmoid(seq.slope * (cosSeq - seq.midpoint)) : 0
  const pOr = 1 - (1 - h) * (1 - s)
  const pDisplay = Math.pow(pOr, SOFT_OR_CALIBRATION.gamma)
  return Math.round(pDisplay * 100)
}

/**
 * Stage 2A: Beta calibration for display score (global fallback).
 * Used when guess is NOT in target's precomputed top-K neighbors.
 * Maps metric [0, 1] → display [0, ~90%].
 *
 * Formula: p_cal = σ(A*log(s) + B*log(1-s) + C)
 */
/**
 * Stage 2B: Rank-based display score for ladder neighbors.
 * If guess is in target's top-K neighbors, use discrete rank mapping:
 *   rank 1 → 99%, rank 2 → 98%, ..., rank K → (100-K)%
 *
 * This guarantees distinct integer percentages regardless of metric compression.
 */
/**
 * Legacy name - now just returns metric score (no display transform).
 * Display transform happens in getBlendedSimilarity with ladder support.
 */
export async function getHig2vecSimilarity(db, guessId, targetId) {
  const guessKey = normalizeKey(guessId)
  const targetKey = normalizeKey(targetId)
  if (!guessKey || !targetKey) {
    return null
  }
  const [{ hig2vec: guessVec }, { hig2vec: targetVec }] = await Promise.all([
    fetchDualEmbeddings(db, guessKey),
    fetchDualEmbeddings(db, targetKey),
  ])
  if (!guessVec || !targetVec) {
    return null
  }
  const cosine = cosineSimilarity(guessVec, targetVec)
  return getSoftOrPercent(cosine, null, "saprot")
}

/**
 * Find the rank of a guess in the target's neighbor list (1-indexed).
 * Returns null if guess is not in neighbors.
 */
function getLadderRank(neighbors, guessKey) {
  if (!neighbors || !Array.isArray(neighbors)) return null
  for (let i = 0; i < neighbors.length; i++) {
    if (neighbors[i].gene?.toUpperCase() === guessKey) {
      return i + 1 // 1-indexed rank
    }
  }
  return null
}

/**
 * Compute similarity using calibrated soft-OR on HiG2Vec + isotropic SaProt.
 * Returns integer percentage (0-100).
 *
 * @param {D1Database} db - The D1 database binding
 * @param {string} guessId - Gene symbol or UniProt ID of the guess
 * @param {string} targetId - Gene symbol or UniProt ID of the target
 * @param {object} options - Configuration options
 * @param {Array} options.targetNeighbors - Pre-fetched neighbors array from target protein
 * @returns {Promise<{blended: number|null, isLadder: boolean, ladderRank: number|null}>}
 */
export async function getBlendedSimilarity(db, guessId, targetId, options = {}) {
  const targetNeighbors = options.targetNeighbors || null
  const guessKey = normalizeKey(guessId)
  const targetKey = normalizeKey(targetId)

  if (!guessKey || !targetKey) {
    return { blended: null, isLadder: false, ladderRank: null }
  }

  // Check if guess is in target's precomputed neighbors for ladder display
  const ladderRank = getLadderRank(targetNeighbors, guessKey)
  const isLadder = ladderRank !== null && ladderRank <= 9

  const [guessEmbeddings, targetEmbeddings] = await Promise.all([
    fetchDualEmbeddings(db, guessKey),
    fetchDualEmbeddings(db, targetKey),
  ])

  const cosH =
    guessEmbeddings?.hig2vec && targetEmbeddings?.hig2vec
      ? cosineSimilarity(guessEmbeddings.hig2vec, targetEmbeddings.hig2vec)
      : null
  const cosS =
    guessEmbeddings?.saprot && targetEmbeddings?.saprot
      ? cosineSimilarity(guessEmbeddings.saprot, targetEmbeddings.saprot)
      : null
  const cosE =
    guessEmbeddings?.esm2 && targetEmbeddings?.esm2
      ? cosineSimilarity(guessEmbeddings.esm2, targetEmbeddings.esm2)
      : null

  const cosSeq = Number.isFinite(cosS) ? cosS : cosE
  const seqKey = Number.isFinite(cosS) ? "saprot" : "esm2"
  const percent = getSoftOrPercent(cosH, cosSeq, seqKey)
  return { blended: percent, isLadder, ladderRank }
}
