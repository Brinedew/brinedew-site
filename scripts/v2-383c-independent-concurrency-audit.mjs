import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { ensureDiscoveryDictionaryForNames } from "../workers/iconoplasm/discovery-ordinal-store.js"
import { createCompactDiscoveryMigrationCostAdapter } from "../workers/iconoplasm/operation-cost-compact-discovery-migration-adapter.js"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"

// Diagnostic only. Imports unmodified application code at 383c0046.
// Native workerd/D1 database, no production credentials or remote operations.
const evidence = { source: "383c0046e85856ebb3523cc33d4f0e8ad4d84844", checks: {} }
function record(name, value) {
  evidence.checks[name] = value
  writeFileSync("v2-383c-concurrency-evidence.json", JSON.stringify(evidence, null, 2))
  console.log("V2_383C_AUDIT", name, JSON.stringify(value))
}
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function barrier(participants) {
  let arrivals = 0
  const ready = deferred()
  return async () => {
    if (++arrivals === participants) ready.resolve()
    await ready.promise
  }
}
function statements(path) {
  return readFileSync(new URL("../migrations-iconoplasm/" + path, import.meta.url), "utf8")
    .split("\n")
    .map((x) => x.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean)
}
async function withD1(run, { catalogRows = 2, extraTables = 0 } = {}) {
  const req = createRequire(import.meta.url)
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    req.resolve("wrangler/package.json"),
  )("miniflare")
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('isolated')}}",
      compatibilityDate: "2026-08-01",
      d1Databases: ["DB"],
    }),
  )
  try {
    const db = await runtime.getD1Database("DB")
    for (const name of [
      "0007_add_gene_catalog.sql",
      "0018_add_gene_catalog_aliases.sql",
      "0023_add_gene_discoveries.sql",
      "0041_shared_gene_discovery_rollup.sql",
    ])
      for (const sql of statements(name)) await db.prepare(sql).run()
    await db
      .prepare(
        "CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TEXT NOT NULL DEFAULT (datetime('now')))",
      )
      .run()
    if (catalogRows === 2)
      await db
        .prepare(
          "INSERT INTO icono_gene_catalog(gene_symbol,full_name) VALUES ('TP53','TP53'),('LMNA','LMNA')",
        )
        .run()
    else
      await db
        .prepare(
          `WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM seq WHERE n<${catalogRows}) INSERT INTO icono_gene_catalog(gene_symbol,full_name) SELECT printf('AUDIT%06d',n),printf('Audit gene %d',n) FROM seq`,
        )
        .run()
    for (let start = 0; start < extraTables; start += 50)
      await db.batch(
        Array.from({ length: Math.min(50, extraTables - start) }, (_, i) =>
          db.prepare(`CREATE TABLE audit_fixture_${start + i}(id INTEGER PRIMARY KEY)`),
        ),
      )
    const schemaCount = Number(
      await db.prepare("SELECT COUNT(*) AS total FROM sqlite_schema").first("total"),
    )
    const adapter = createCompactDiscoveryMigrationCostAdapter({ db, ...OPERATION_COST_IDENTITIES })
    const prepared = await adapter.prepare({})
    let migration
    try {
      migration = await adapter.dispatch(prepared)
    } catch (error) {
      record("adapter_error_" + extraTables, {
        error: error.message,
        schemaCount,
        bound: prepared.bound,
      })
      throw error
    }
    return await run(db, { migration, prepared, schemaCount })
  } finally {
    await runtime.dispose()
  }
}
function client(
  db,
  { afterMax = async () => {}, beforeBatch = async () => {}, batches = [] } = {},
) {
  const wrap = (sql, raw) => ({
    raw,
    bind(...values) {
      return wrap(sql, raw.bind(...values))
    },
    all() {
      return raw.all()
    },
    run() {
      return raw.run()
    },
    async first(column) {
      const result = await raw.first(column)
      if (sql.includes("MAX(ordinal)")) await afterMax(result)
      return result
    },
  })
  return {
    prepare(sql) {
      return wrap(sql, db.prepare(sql))
    },
    async batch(items) {
      await beforeBatch()
      const result = await db.batch(items.map((x) => x.raw))
      batches.push({
        last_statement_result: result.at(-1)?.results,
        rows_written: result.reduce((sum, x) => sum + Number(x.meta?.rows_written || 0), 0),
      })
      return result
    },
  }
}
async function snapshot(db) {
  return (
    await db
      .prepare(
        "SELECT name,ordinal,canonical,active FROM icono_discovery_ordinals_v2 ORDER BY name",
      )
      .all()
  ).results
}
function assertDistinct(rows) {
  assert.equal(
    new Set(rows.map((row) => Number(row.ordinal))).size,
    2,
    "Two different catalog genes received the same discovery ordinal",
  )
}

test("control: admitted migration cost at 19023 catalog rows", { timeout: 60000 }, async () =>
  withD1(
    async (db, { migration, prepared, schemaCount }) => {
      record("migration_19023", {
        schemaCount,
        actual: migration.actual,
        bound: prepared.bound,
        ordinal_count: await db
          .prepare("SELECT COUNT(*) AS total FROM icono_discovery_ordinals_v2")
          .first("total"),
      })
      assert.equal(migration.result.applied, true)
      assert.ok(migration.actual.rows_read <= prepared.bound.rows_read)
      assert.ok(migration.actual.rows_written <= prepared.bound.rows_written)
    },
    { catalogRows: 19023 },
  ),
)

test(
  "control: sequential first discoveries have distinct stable ordinals",
  { timeout: 60000 },
  async () =>
    withD1(async (db) => {
      await ensureDiscoveryDictionaryForNames(db, ["TP53"])
      await ensureDiscoveryDictionaryForNames(db, ["LMNA"])
      const before = await snapshot(db)
      await ensureDiscoveryDictionaryForNames(db, ["TP53", "LMNA"])
      const after = await snapshot(db)
      record("sequential_control", { before, after })
      assertDistinct(after)
      assert.deepEqual(after, before)
    }),
)

test(
  "overlapping first discoveries remain distinct when one CAS loses",
  { timeout: 60000 },
  async () =>
    withD1(async (db) => {
      const afterMax = barrier(2),
        beforeBatch = barrier(2),
        batches = []
      const first = client(db, { afterMax, beforeBatch, batches }),
        second = client(db, { afterMax, beforeBatch, batches })
      const result = await Promise.all([
        ensureDiscoveryDictionaryForNames(first, ["TP53"]),
        ensureDiscoveryDictionaryForNames(second, ["LMNA"]),
      ])
      const rows = await snapshot(db)
      record("same_version_race", {
        rows,
        batches,
        returned_ordinals: result.map((r) => [...r.byName.entries()]),
      })
      assertDistinct(rows)
    }),
)

test(
  "a fresh late version read cannot validate an already stale maximum",
  { timeout: 60000 },
  async () =>
    withD1(async (db) => {
      const maxRead = deferred(),
        resume = deferred(),
        batches = []
      const first = client(db, {
        afterMax: async () => {
          maxRead.resolve()
          await resume.promise
        },
        batches,
      })
      const pending = ensureDiscoveryDictionaryForNames(first, ["TP53"])
      await maxRead.promise
      const other = await ensureDiscoveryDictionaryForNames(db, ["LMNA"])
      resume.resolve()
      const result = await pending
      const rows = await snapshot(db)
      record("late_version_race", {
        rows,
        batches,
        returned_ordinals: [[...other.byName.entries()], [...result.byName.entries()]],
      })
      assertDistinct(rows)
    }),
)

test(
  "admission bound covers schema cardinalities its guard accepts",
  { timeout: 60000 },
  async () =>
    withD1(
      async (db, { migration, prepared, schemaCount }) => {
        record("accepted_schema_size", {
          schemaCount,
          extra_unrelated_tables: 300,
          actual: migration.actual,
          bound: prepared.bound,
          scope: "Supported-size fixture; not a production schema inventory",
        })
        assert.ok(schemaCount <= 1024)
        assert.ok(
          migration.actual.rows_read <= prepared.bound.rows_read,
          `Guard accepts ${schemaCount} schema rows but dispatch reads ${migration.actual.rows_read}, over bound ${prepared.bound.rows_read}`,
        )
      },
      { extraTables: 300 },
    ),
)
