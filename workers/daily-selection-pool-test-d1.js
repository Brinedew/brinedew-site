// Test support for the stored GeneGuessr selection pools (daily and practice).
//
// Opens a real local D1 (Miniflare) built from the real GeneGuessr migrations
// that define `proteins` and its search triggers, seeds a catalog with the
// production shape measured on 2026-10-02 (19,110 rows, 10,312 playable for the
// daily pool in 3,900 surname families, 17,513 playable for practice in 6,049
// families), and wraps the database so each statement's D1 receipt
// (`rows_read`, `rows_written`) is recorded.
import { createRequire } from "node:module"
import { readFileSync } from "node:fs"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

// The migrations that create and alter the tables the pool reads. Applied in
// journal order.
const SCHEMA_MIGRATIONS = [
  "0006_proper_schema.sql",
  "0013_add_neighbors.sql",
  "0015_add_gene_surname.sql",
  "0018_add_protein_search_fts.sql",
  "0025_add_daily_target_availability_pins.sql",
]

// Wrangler runs a migration file statement by statement; trigger bodies hold
// their own semicolons, so a statement ends at `END;` when it opened as a trigger.
function migrationStatements(file) {
  const source = readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8")
  const statements = []
  let current = ""
  let trigger = false
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("--")) continue
    if (!current && /^CREATE TRIGGER\b/.test(line)) trigger = true
    current += `${line}\n`
    if ((trigger && /^END;\s*$/.test(line)) || (!trigger && /;\s*$/.test(line))) {
      statements.push(current)
      current = ""
      trigger = false
    }
  }
  return statements
}

export async function openCatalogDb() {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('local')}}",
      compatibilityDate: "2026-08-01",
      d1Databases: ["DB"],
    }),
  )
  const db = await runtime.getD1Database("DB")
  for (const file of SCHEMA_MIGRATIONS) {
    await db.batch(migrationStatements(file).map((sql) => db.prepare(sql)))
  }
  await db
    .prepare("CREATE TABLE structure_failures(uniprot TEXT PRIMARY KEY, failed_at TEXT)")
    .run()
  return { db, dispose: () => runtime.dispose() }
}

// Deterministic catalog. Counts per (structure_source, has summary) are the
// production counts, and the 10,312 daily-playable rows (a curated structure and
// a summary) fall into 3,900 surnames with a heavy-tailed size distribution (a
// few large families, many singletons). Practice also plays the 7,201 AlphaFold
// rows that have a summary: 2,149 families exist only because of them, so
// practice draws from 6,049 families. Every row with a structure source carries
// the stored link its source needs, so the Worker can resolve its structure.
// `quirks` adds rows whose raw values need the normalization the pool applies:
// padded and lower-case surnames, an empty surname, a missing surname, and a
// lower-case accession. Stored URLs have the shape production stores (AlphaFold
// `.pdb` files on alphafold.ebi.ac.uk, SWISS-MODEL `.pdb` models with a range and
// template on swissmodel.expasy.org), because the Worker fetches only provider hosts.
export const PRODUCTION_SHAPE = Object.freeze({
  proteins: 19110,
  playable: 10312,
  families: 3900,
  practiceEligible: 17513,
  alphafoldEligible: 7201,
  practiceFamilies: 6049,
})

export function productionShapedCatalogRows({ quirks = false } = {}) {
  let seed = 20261002
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
  const surname = (index) => `FAM${String(index).padStart(4, "0")}`
  const groups = [
    ["swissmodel", true, 5389],
    ["pdb", true, 4923],
    ["alphafold", true, 7201],
    [null, true, 693],
    ["swissmodel", false, 501],
    ["alphafold", false, 281],
    ["pdb", false, 66],
    [null, false, 56],
  ]
  const rows = []
  let playable = 0
  let alphafoldSeated = 0
  const alphafoldOnlyFamilies = PRODUCTION_SHAPE.practiceFamilies - PRODUCTION_SHAPE.families
  for (const [source, hasSummary, count] of groups) {
    for (let index = 0; index < count; index += 1) {
      const id = rows.length + 1
      const isPlayable = source !== null && source !== "alphafold" && hasSummary
      let family
      if (isPlayable) {
        // The first 3,900 playable rows seat one member per family; the rest
        // pile onto low-numbered families.
        family = playable < PRODUCTION_SHAPE.families ? playable : Math.floor(next() ** 3 * 3900)
        playable += 1
      } else if (source === "alphafold" && hasSummary) {
        // The first AlphaFold rows seat one member in each AlphaFold-only family;
        // the rest spread over every family.
        const draw = next()
        family =
          alphafoldSeated < alphafoldOnlyFamilies
            ? PRODUCTION_SHAPE.families + alphafoldSeated
            : Math.floor(draw * PRODUCTION_SHAPE.practiceFamilies)
        alphafoldSeated += 1
      } else {
        family = Math.floor(next() * 3900)
      }
      const accession = `Q${String(id).padStart(5, "0")}`
      rows.push({
        id,
        uniprot: accession,
        gene: `GENE${id}`,
        gene_surname: surname(family),
        structure_source: source,
        gene_summary: hasSummary ? `Summary of protein ${id}` : null,
        pdb_id: source === "pdb" ? `1${String(id).padStart(5, "0")}` : null,
        swissmodel_url:
          source === "swissmodel"
            ? `https://swissmodel.expasy.org/repository/uniprot/${accession}.pdb?range=8-148&template=tmpl&provider=swissmodel`
            : null,
        swissmodel_template: source === "swissmodel" ? "tmpl" : null,
        alphafold_url:
          source === "alphafold"
            ? `https://alphafold.ebi.ac.uk/files/AF-${accession}-F1-model_v6.pdb`
            : null,
      })
    }
  }
  if (quirks) {
    const extra = [
      ["Q90001", " fam0007 ", "pdb"],
      ["Q90002", "fam0008", "swissmodel"],
      ["Q90003", "", "pdb"],
      ["Q90004", null, "swissmodel"],
      ["q90005", "FAM0009", "pdb"],
    ]
    for (const [uniprot, family, source] of extra) {
      rows.push({
        id: rows.length + 1,
        uniprot,
        gene: `GENE${rows.length + 1}`,
        gene_surname: family,
        structure_source: source,
        gene_summary: "Summary",
      })
    }
  }
  return rows
}

// D1 allows 100 bound parameters per statement, so each chunk travels as one
// JSON parameter.
export async function seedCatalog(db, rows) {
  await db.prepare("DELETE FROM proteins").run()
  const statements = []
  for (let start = 0; start < rows.length; start += 400) {
    statements.push(
      db
        .prepare(
          `INSERT INTO proteins (id, uniprot, gene, gene_surname, structure_source, gene_summary,
                                 pdb_id, swissmodel_url, swissmodel_template, alphafold_url)
           SELECT json_extract(value, '$.id'), json_extract(value, '$.uniprot'),
                  json_extract(value, '$.gene'), json_extract(value, '$.gene_surname'),
                  json_extract(value, '$.structure_source'), json_extract(value, '$.gene_summary'),
                  json_extract(value, '$.pdb_id'), json_extract(value, '$.swissmodel_url'),
                  json_extract(value, '$.swissmodel_template'), json_extract(value, '$.alphafold_url')
           FROM json_each(?)`,
        )
        .bind(JSON.stringify(rows.slice(start, start + 400))),
    )
  }
  if (statements.length) await db.batch(statements)
}

// Binary half precision, as the SaProt and ESM2 columns store it (round to nearest).
function toHalfBits(value) {
  const f32 = new Float32Array(1)
  const u32 = new Uint32Array(f32.buffer)
  f32[0] = value
  const x = u32[0]
  const sign = (x >>> 16) & 0x8000
  const exponent = ((x >>> 23) & 0xff) - 127 + 15
  const mantissa = x & 0x7fffff
  if (exponent <= 0) {
    if (exponent < -10) return sign
    return sign | ((((mantissa | 0x800000) >> (1 - exponent)) + 0x1000) >> 13)
  }
  if (exponent >= 31) return sign | 0x7c00
  return sign | (exponent << 10) | ((mantissa + 0x1000) >> 13)
}

// A gene's embeddings, in the byte layout and sizes production stores them (measured
// read-only on 2026-10-03: `protein_embeddings_old` holds `vector` as 200 float32, `saprot_vector`
// as 1,280 float16 and `esm2_vector` as 2,560 float16, 8,480 bytes a row). Deterministic per
// gene, unit length, so a cosine between two genes is stable across runs.
export function embeddingRow(gene, { saprot = true } = {}) {
  let seed = 2166136261
  for (const char of String(gene)) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619) >>> 0
  const next = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  }
  const unit = (dimension) => {
    const values = Array.from({ length: dimension }, next)
    const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0))
    return values.map((value) => value / norm)
  }
  const half = (values) => new Uint16Array(values.map(toHalfBits))
  return {
    gene_symbol: String(gene).toUpperCase(),
    dim: 200,
    vector: new Uint8Array(new Float32Array(unit(200)).buffer),
    saprot_dim: saprot ? 1280 : null,
    saprot_vector: saprot ? new Uint8Array(half(unit(1280)).buffer) : null,
    esm2_dim: 2560,
    esm2_vector: new Uint8Array(half(unit(2560)).buffer),
  }
}

// Creates the embeddings table with the columns the Worker reads and gives each gene its row.
// A guess's similarity is computed from these rows.
export async function seedEmbeddings(db, genes, options = {}) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS protein_embeddings_old (
         gene_symbol TEXT PRIMARY KEY,
         dim INTEGER NOT NULL DEFAULT 200,
         vector BLOB NOT NULL,
         esm2_dim INTEGER,
         esm2_vector BLOB,
         saprot_dim INTEGER,
         saprot_vector BLOB
       )`,
    )
    .run()
  const insert = db.prepare(
    `INSERT OR REPLACE INTO protein_embeddings_old
       (gene_symbol, dim, vector, esm2_dim, esm2_vector, saprot_dim, saprot_vector)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const statements = [...new Set(genes)].map((gene) => {
    const row = embeddingRow(gene, options)
    return insert.bind(
      row.gene_symbol,
      row.dim,
      row.vector,
      row.esm2_dim,
      row.esm2_vector,
      row.saprot_dim,
      row.saprot_vector,
    )
  })
  for (let start = 0; start < statements.length; start += 50) {
    await db.batch(statements.slice(start, start + 50))
  }
}

// The accounts the leaderboard reads: the columns of migrations 001 and 0016 that its query
// uses. Each entry is `{ id, username, streak, wins }`, public and played yesterday or today.
export async function seedLeaderboard(db, entries) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS users (
         discord_id TEXT PRIMARY KEY, username TEXT NOT NULL, email TEXT, avatar_url TEXT,
         tier TEXT NOT NULL DEFAULT 'guest', premium_until INTEGER,
         created_at INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0,
         leaderboard_opt_in INTEGER NOT NULL DEFAULT 0)`,
    )
    .run()
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS stats (
         user_id TEXT PRIMARY KEY, total_played INTEGER DEFAULT 0, total_wins INTEGER DEFAULT 0,
         current_streak INTEGER DEFAULT 0, best_streak INTEGER DEFAULT 0, last_played_date TEXT)`,
    )
    .run()
  const today = new Date().toISOString().slice(0, 10)
  const statements = []
  for (const entry of entries) {
    statements.push(
      db
        .prepare(
          `INSERT OR REPLACE INTO users (discord_id, username, leaderboard_opt_in) VALUES (?, ?, 1)`,
        )
        .bind(entry.id, entry.username),
      db
        .prepare(
          `INSERT OR REPLACE INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(entry.id, entry.wins, entry.wins, entry.streak, entry.streak, today),
    )
  }
  if (statements.length) await db.batch(statements)
}

// Removes the stored pools and the triggers, as on a database that has never run
// the pool code.
export async function dropPoolSchema(db) {
  const triggers = await db
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'daily_selection_pool%'",
    )
    .all()
  for (const { name } of triggers.results) await db.prepare(`DROP TRIGGER "${name}"`).run()
  await db.prepare("DROP TABLE IF EXISTS daily_selection_pool").run()
  await db.prepare("DROP TABLE IF EXISTS practice_selection_pool").run()
}

// Wraps a D1 database. Every statement's receipt lands in `receipts`, in order.
// `before(sql, args)` and `after(sql, args, result)` let a test run a concurrent
// write at an exact point inside the code under test.
export function meteredDb(db, { before, after } = {}) {
  const receipts = []
  async function execute(sql, args, run) {
    if (before) await before(sql, args)
    const result = await run()
    const meta = result?.meta || {}
    receipts.push({
      sql: sql.replace(/\s+/g, " ").trim(),
      rows_read: meta.rows_read ?? 0,
      rows_written: meta.rows_written ?? 0,
    })
    if (after) await after(sql, args, result)
    return result
  }
  function statement(sql, inner, args) {
    return {
      sql,
      inner,
      bind: (...bound) => statement(sql, inner.bind(...bound), bound),
      all: () => execute(sql, args, () => inner.all()),
      run: () => execute(sql, args, () => inner.run()),
      first: async (column) => {
        const result = await execute(sql, args, () => inner.all())
        const row = result.results[0] ?? null
        return column ? (row?.[column] ?? null) : row
      },
    }
  }
  return {
    receipts,
    prepare: (sql) => statement(sql, db.prepare(sql), []),
    async batch(statements) {
      if (before) for (const item of statements) await before(item.sql, [])
      const results = await db.batch(statements.map((item) => item.inner))
      results.forEach((result, index) => {
        const meta = result?.meta || {}
        receipts.push({
          sql: statements[index].sql.replace(/\s+/g, " ").trim(),
          rows_read: meta.rows_read ?? 0,
          rows_written: meta.rows_written ?? 0,
        })
      })
      return results
    },
    totalRead: () => receipts.reduce((sum, receipt) => sum + receipt.rows_read, 0),
    totalWritten: () => receipts.reduce((sum, receipt) => sum + receipt.rows_written, 0),
  }
}

// A Worker env for end-to-end requests, as production runs them: the given D1, a
// KV that remembers every key it was asked to put, and a GameSession stub that
// keeps each session's state in `sessions` (pass the same map to a second env to
// replay a returning player). No R2 bucket is bound, because the binding is
// commented out in the Worker's wrangler config, so every structure the Worker
// verifies or serves goes to its upstream. `failSessionReads` makes every session
// read answer 500, and `sessionReads` counts them. `kvEntries` pre-loads KV;
// `kvPuts` and `kvDeletes` list every key written or deleted, in order.
export function geneguessrWorkerEnv(
  db,
  { sessions = new Map(), failSessionReads = false, kvEntries = {} } = {},
) {
  const kv = new Map(Object.entries(kvEntries))
  const kvPuts = []
  const kvDeletes = []
  const sessionReads = []
  return {
    sessions,
    kv,
    kvPuts,
    kvDeletes,
    sessionReads,
    env: {
      DB: db,
      KV: {
        async get(key, options) {
          const value = kv.get(key) ?? null
          return options?.type === "json" && value ? JSON.parse(value) : value
        },
        async put(key, value) {
          kvPuts.push(key)
          kv.set(key, value)
        },
        async delete(key) {
          kvDeletes.push(key)
          kv.delete(key)
        },
      },
      GAME_SESSIONS: {
        idFromName: (name) => name,
        get(id) {
          return {
            async fetch(_url, init = {}) {
              if (init.method === "POST") {
                sessions.set(id, JSON.parse(init.body))
                return Response.json({ ok: true })
              }
              sessionReads.push(id)
              if (failSessionReads) return new Response("unavailable", { status: 500 })
              return Response.json(sessions.get(id) ?? null)
            },
          }
        },
      },
    },
  }
}
