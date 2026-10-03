import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createSchemaDropMigrationCostAdapter } from "./operation-cost-schema-drop-migration-adapter.js"
import { createSchemaTableMigrationCostAdapter } from "./operation-cost-schema-table-migration-adapter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const identities = { executable_sha256: "a".repeat(64), schema_sha256: "b".repeat(64) }
const NAME = "9001_synthetic_probe.sql"
const TABLE = "icono_synthetic_probe"

// The maintenance runner applies a reviewed migration through its cost
// adapter, never through caller SQL. These two adapters serve migrations that
// only drop schema objects nothing reads or only create small empty tables.
// Failure modes, written before the code:
// 1. An adapter accepts a statement that is not a reviewed DROP ... IF EXISTS
//    or CREATE TABLE IF NOT EXISTS of one named object, so a caller or a typo
//    reaches data.
// 2. A schema larger than the admitted bound is migrated anyway, or is only
//    half migrated (the table gone or made, its journal row missing).
// 3. The migration changes anything besides the named table and its own
//    indexes, or does not journal itself.
// 4. The measured provider cost is above the bound the plan was reviewed at.
const KINDS = [
  {
    kind: "schema-drop",
    create: createSchemaDropMigrationCostAdapter,
    statements: [`DROP TABLE IF EXISTS ${TABLE};`],
    rejected: [
      [],
      ["DELETE FROM icono_image_votes;"],
      ["DROP TABLE icono_image_votes;"],
      ["DROP TABLE IF EXISTS icono_image_votes; DELETE FROM icono_image_votes;"],
      Array.from({ length: 5 }, (_, index) => `DROP TABLE IF EXISTS t${index};`),
    ],
    existing: [
      `table:${TABLE}`,
      "index:idx_icono_synthetic_probe_name",
      `index:sqlite_autoindex_${TABLE}_1`,
    ],
    added: [],
    expectedRowsWritten: 32,
  },
  {
    kind: "schema-table",
    create: createSchemaTableMigrationCostAdapter,
    statements: [`CREATE TABLE IF NOT EXISTS ${TABLE} (id INTEGER PRIMARY KEY, name TEXT);`],
    rejected: [
      [],
      ["DELETE FROM icono_image_votes;"],
      ["CREATE TABLE icono_image_votes (id INTEGER);"],
      [`CREATE INDEX IF NOT EXISTS idx_x ON ${TABLE}(name);`],
      ["CREATE TABLE IF NOT EXISTS a (id INTEGER); DELETE FROM icono_image_votes;"],
      Array.from({ length: 5 }, (_, index) => `CREATE TABLE IF NOT EXISTS t${index} (id INTEGER);`),
    ],
    existing: [],
    added: [`table:${TABLE}`],
    expectedRowsWritten: 16,
  },
]

for (const { kind, create, statements, rejected } of KINDS)
  test(`a ${kind} adapter takes only reviewed statements`, () => {
    const make = (candidate) => create({ db: {}, name: NAME, statements: candidate, ...identities })
    for (const candidate of rejected) assert.throws(() => make(candidate), TypeError)
    assert.doesNotThrow(() => make(statements))
    assert.throws(() => create({ db: {}, statements, ...identities }), TypeError)
  })

for (const { kind, create, statements, existing, added, expectedRowsWritten } of KINDS)
  test(
    `a ${kind} migration changes only its named objects, refuses an oversized schema, and costs no more than its bound`,
    { timeout: 120000 },
    async (t) => {
      const runtime = new Miniflare(
        convertV4MiniflareOptions({
          modules: true,
          script: "export default {fetch(){return new Response('schema migration')}}",
          compatibilityDate: "2026-08-01",
          d1Databases: ["original"],
        }),
      )
      const schema = new DatabaseSync(":memory:")
      try {
        // The complete current schema, so the adapter's schema scan is measured
        // at the size production has.
        const root = new URL("../../migrations-iconoplasm/", import.meta.url)
        for (const file of readdirSync(root)
          .filter((name) => name.endsWith(".sql"))
          .sort())
          schema.exec(readFileSync(new URL(file, root), "utf8"))
        const definitions = schema
          .prepare(
            "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
          )
          .all()
        const db = await runtime.getD1Database("original")
        for (let offset = 0; offset < definitions.length; offset += 20)
          await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
        await db
          .prepare(
            "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)",
          )
          .run()
        if (existing.length) {
          await db.prepare(`CREATE TABLE ${TABLE} (id INTEGER PRIMARY KEY, name TEXT UNIQUE)`).run()
          await db
            .prepare(`CREATE INDEX idx_icono_synthetic_probe_name ON ${TABLE}(name, id)`)
            .run()
        }
        const objects = async () =>
          (
            await db.prepare("SELECT type, name FROM sqlite_schema ORDER BY type, name").all()
          ).results.map(({ type, name }) => `${type}:${name}`)
        const before = await objects()
        for (const name of existing) assert.ok(before.includes(name), name)

        const adapter = create({ db, name: NAME, statements, ...identities })
        await assert.rejects(adapter.prepare({ caller_sql: "DROP TABLE icono_image_votes" }), {
          code: "COST_MIGRATION_ARGUMENTS_INVALID",
        })
        await assert.rejects(
          adapter.dispatch(await adapter.prepare({ max_schema_rows: 1 })),
          "a schema larger than the admitted bound must refuse the whole batch",
        )
        assert.deepEqual(await objects(), before, "a refused migration changes nothing")
        assert.equal(
          (await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first()).n,
          0,
          "a refused migration is not journaled",
        )

        const prepared = await adapter.prepare({ max_schema_rows: 512 })
        const { actual } = await adapter.dispatch(prepared)
        assert.ok(actual.rows_read <= prepared.bound.rows_read, JSON.stringify(actual))
        assert.ok(actual.rows_written <= prepared.bound.rows_written, JSON.stringify(actual))
        assert.equal(prepared.bound.rows_written, expectedRowsWritten)
        assert.deepEqual(
          await objects(),
          [...before.filter((name) => !existing.includes(name)), ...added].sort(),
          "only the named table and its own indexes change",
        )
        assert.equal(
          (
            await db
              .prepare("SELECT COUNT(*) AS n FROM d1_migrations WHERE name = ?")
              .bind(NAME)
              .first()
          ).n,
          1,
          "the migration is journaled",
        )
        t.diagnostic(JSON.stringify({ kind, actual, bound: prepared.bound }))
      } finally {
        schema.close()
        await runtime.dispose()
      }
    },
  )
