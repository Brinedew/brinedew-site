import assert from "node:assert/strict"
import { createRequire } from "node:module"
import test from "node:test"
import { createSchemaIndexMigrationCostAdapter } from "./operation-cost-schema-index-migration-adapter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const identities = { executable_sha256: "a".repeat(64), schema_sha256: "b".repeat(64) }
const NAME = "9002_synthetic_index.sql"
const INDEX =
  "CREATE INDEX IF NOT EXISTS idx_probe_unread ON probe (owner, at DESC) WHERE unread = 1;"

// An index migration reads its whole table, so its admission is the table's size.
// Failure modes, written before the code:
// 1. The adapter accepts anything but one reviewed CREATE INDEX IF NOT EXISTS,
//    so a caller or a typo reaches data.
// 2. A table larger than the admitted bound is indexed anyway, or half migrated
//    (the index made, its journal row missing).
// 3. The measured provider cost is above the bound the plan was reviewed at.
test("a schema-index adapter takes only one reviewed CREATE INDEX", () => {
  const make = (statements) =>
    createSchemaIndexMigrationCostAdapter({ db: {}, name: NAME, statements, ...identities })
  for (const candidate of [
    [],
    [INDEX, INDEX],
    ["DELETE FROM probe;"],
    ["CREATE INDEX idx_probe_unread ON probe (owner);"],
    ["CREATE INDEX IF NOT EXISTS i ON probe (owner); DELETE FROM probe;"],
    ["CREATE INDEX IF NOT EXISTS i ON probe ((SELECT 1));"],
  ])
    assert.throws(() => make(candidate), TypeError)
  assert.doesNotThrow(() => make([INDEX]))
})

test(
  "a schema-index migration refuses an oversized table whole and costs no more than its bound",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('index migration')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["original"],
      }),
    )
    try {
      const db = await runtime.getD1Database("original")
      await db.batch([
        db.prepare(
          "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)",
        ),
        db.prepare(
          "CREATE TABLE probe(id INTEGER PRIMARY KEY, owner TEXT, at TEXT, unread INTEGER)",
        ),
        db.prepare(`WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<3000)
          INSERT INTO probe SELECT n, 'u' || (n % 30), n, n % 50 = 0 FROM ids`),
      ])
      const indexed = async () =>
        (
          await db
            .prepare("SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='idx_probe_unread'")
            .first()
        ).n
      const adapter = createSchemaIndexMigrationCostAdapter({
        db,
        name: NAME,
        statements: [INDEX],
        ...identities,
      })
      await assert.rejects(adapter.prepare({ max_schema_rows: 512 }), {
        code: "COST_MIGRATION_ARGUMENTS_INVALID",
      })
      await assert.rejects(adapter.dispatch(await adapter.prepare({ max_table_rows: 2999 })))
      assert.equal(await indexed(), 0, "a refused migration makes no index")
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first()).n, 0)

      const prepared = await adapter.prepare({ max_table_rows: 3000 })
      const { actual } = await adapter.dispatch(prepared)
      assert.equal(await indexed(), 1)
      assert.equal(
        (await db.prepare("SELECT name FROM d1_migrations").first()).name,
        NAME,
        "the migration journals itself",
      )
      assert.ok(actual.rows_read <= prepared.bound.rows_read, JSON.stringify(actual))
      assert.ok(actual.rows_written <= prepared.bound.rows_written, JSON.stringify(actual))
      t.diagnostic(JSON.stringify({ actual, bound: prepared.bound }))
    } finally {
      await runtime.dispose()
    }
  },
)
