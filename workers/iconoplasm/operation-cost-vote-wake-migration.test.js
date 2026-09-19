import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createVoteWakeMigrationCostAdapter } from "./operation-cost-vote-wake-migration-adapter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "vote wake migration preserves dirty generations and has a measured provider bound",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('vote wake migration')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["original"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const root = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(root)
        .filter((name) => name.endsWith(".sql") && parseInt(name) < 107)
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
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
           INSERT INTO icono_vote_projection_refresh_jobs(gene_symbol,reason,job_version,attempts,last_error)
           SELECT 'G'||n,'durable dirty generation',77,3,'provider retry' FROM ids`,
        )
        .run()

      const adapter = createVoteWakeMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      await assert.rejects(adapter.prepare({ caller_sql: "ALTER TABLE unsafe" }), {
        code: "COST_MIGRATION_ARGUMENTS_INVALID",
      })
      const prepared = await adapter.prepare({})
      const { actual } = await adapter.dispatch(prepared)
      assert.ok(actual.rows_read <= prepared.bound.rows_read, JSON.stringify(actual))
      assert.ok(actual.rows_written <= prepared.bound.rows_written, JSON.stringify(actual))
      assert.deepEqual(
        await db
          .prepare(
            "SELECT COUNT(*) AS n,MIN(job_version) AS min_version,MAX(job_version) AS max_version,MIN(wake_outstanding) AS min_wake,MAX(wake_outstanding) AS max_wake,MIN(wake_version) AS min_wake_version,MAX(wake_version) AS max_wake_version FROM icono_vote_projection_refresh_jobs",
          )
          .first(),
        {
          n: 20000,
          min_version: 77,
          max_version: 77,
          min_wake: 0,
          max_wake: 0,
          min_wake_version: 0,
          max_wake_version: 0,
        },
      )
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM d1_migrations WHERE name='0107_vote_projection_wake_generation.sql'",
            )
            .first()
        ).n,
        1,
      )
      t.diagnostic(JSON.stringify({ actual, bound: prepared.bound }))
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
