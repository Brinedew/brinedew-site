import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createSchemaDropMigrationCostAdapter } from "./operation-cost-schema-drop-migration-adapter.js"
import {
  VOTE_PROJECTION_JOBS_RETIREMENT_MIGRATION_NAME,
  VOTE_PROJECTION_JOBS_RETIREMENT_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const identities = { executable_sha256: "a".repeat(64), schema_sha256: "b".repeat(64) }

// B-921. The maintenance runner applies a reviewed migration through its cost
// adapter, never through caller SQL. Failure modes, written before the code:
// 1. An adapter accepts a statement that is not a reviewed DROP of one named
//    object, so a caller or a typo reaches data.
// 2. A schema larger than the admitted bound is migrated anyway, or is only
//    half migrated (the table gone, its journal row missing).
// 3. The drop takes anything besides the table and its own index, or leaves
//    either behind, or does not journal the migration.
// 4. The measured provider cost is above the bound the plan was reviewed at.
test("a schema-drop adapter takes only reviewed DROP statements", () => {
  const make = (statements) =>
    createSchemaDropMigrationCostAdapter({
      db: {},
      name: "0114_retire_vote_projection_jobs.sql",
      statements,
      ...identities,
    })
  for (const statements of [
    [],
    ["DELETE FROM icono_image_votes;"],
    ["DROP TABLE icono_image_votes;"],
    ["DROP TABLE IF EXISTS icono_image_votes; DELETE FROM icono_image_votes;"],
    [
      "DROP TABLE IF EXISTS a;",
      "DROP TABLE IF EXISTS b;",
      "DROP TABLE IF EXISTS c;",
      "DROP TABLE IF EXISTS d;",
      "DROP TABLE IF EXISTS e;",
    ],
  ])
    assert.throws(() => make(statements), TypeError, JSON.stringify(statements))
  assert.doesNotThrow(() => make(VOTE_PROJECTION_JOBS_RETIREMENT_MIGRATION_STATEMENTS))
})

test(
  "retiring the vote projection job table removes only it and its indexes, within the measured bound",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('vote jobs retirement')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["original"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const root = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(root)
        .filter(
          (name) => name.endsWith(".sql") && name < VOTE_PROJECTION_JOBS_RETIREMENT_MIGRATION_NAME,
        )
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
      const objects = async () =>
        (
          await db.prepare("SELECT type, name FROM sqlite_schema ORDER BY type, name").all()
        ).results.map(({ type, name }) => `${type}:${name}`)
      const retired = [
        "table:icono_vote_projection_refresh_jobs",
        "index:idx_icono_vote_projection_refresh_jobs_next_attempt",
        "index:sqlite_autoindex_icono_vote_projection_refresh_jobs_1",
      ]
      const before = await objects()
      for (const name of retired) assert.ok(before.includes(name), name)

      const adapter = createSchemaDropMigrationCostAdapter({
        db,
        name: VOTE_PROJECTION_JOBS_RETIREMENT_MIGRATION_NAME,
        statements: VOTE_PROJECTION_JOBS_RETIREMENT_MIGRATION_STATEMENTS,
        ...identities,
      })
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
      assert.deepEqual(
        await objects(),
        before.filter((name) => !retired.includes(name)),
        "only the job table and its own indexes are removed",
      )
      assert.equal(
        (
          await db
            .prepare("SELECT COUNT(*) AS n FROM d1_migrations WHERE name = ?")
            .bind(VOTE_PROJECTION_JOBS_RETIREMENT_MIGRATION_NAME)
            .first()
        ).n,
        1,
        "the migration is journaled",
      )
      t.diagnostic(JSON.stringify({ actual, bound: prepared.bound }))
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
