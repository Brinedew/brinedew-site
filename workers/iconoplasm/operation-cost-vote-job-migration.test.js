import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFileSync, readdirSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { createVoteJobVersionMigrationCostAdapter } from "./operation-cost-vote-job-migration-adapter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")

test(
  "vote job migration admits old and runtime-upgraded schemas without rewriting job generations",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('vote job migration')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["original", "legacy"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      const root = new URL("../../migrations-iconoplasm/", import.meta.url)
      for (const file of readdirSync(root)
        .filter((name) => name.endsWith(".sql") && parseInt(name) < 98)
        .sort())
        schema.exec(readFileSync(new URL(file, root), "utf8"))
      const definitions = schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all()
      for (const legacy of [false, true]) {
        const db = await runtime.getD1Database(legacy ? "legacy" : "original")
        for (let offset = 0; offset < definitions.length; offset += 20)
          await db.batch(definitions.slice(offset, offset + 20).map(({ sql }) => db.prepare(sql)))
        await db
          .prepare(
            "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)",
          )
          .run()
        if (legacy)
          await db
            .prepare(
              "ALTER TABLE icono_vote_projection_refresh_jobs ADD COLUMN job_version INTEGER NOT NULL DEFAULT 1",
            )
            .run()
        await db
          .prepare(
            `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
        INSERT INTO icono_vote_projection_refresh_jobs(gene_symbol,reason,attempts,last_error)
        SELECT 'G'||n,'durable recovery',3,'provider retry' FROM ids`,
          )
          .run()
        if (legacy)
          await db.prepare("UPDATE icono_vote_projection_refresh_jobs SET job_version=77").run()
        const adapter = createVoteJobVersionMigrationCostAdapter({
          db,
          executable_sha256: "a".repeat(64),
          schema_sha256: "b".repeat(64),
        })
        const args = { job_version_exists: legacy, max_schema_rows: 512 }
        for (const invalid of [
          null,
          { ...args, caller_sql: "SELECT 1" },
          { ...args, job_version_exists: 1 },
        ])
          await assert.rejects(adapter.prepare(invalid), {
            code: "COST_MIGRATION_ARGUMENTS_INVALID",
          })
        await assert.rejects(
          adapter.dispatch(await adapter.prepare({ ...args, job_version_exists: !legacy })),
        )
        await assert.rejects(
          adapter.dispatch(await adapter.prepare({ ...args, max_schema_rows: 1 })),
        )
        assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first()).n, 0)
        const prepared = await adapter.prepare(args)
        const { actual } = await adapter.dispatch(prepared)
        assert.ok(actual.rows_read <= prepared.bound.rows_read, JSON.stringify(actual))
        assert.ok(actual.rows_written <= prepared.bound.rows_written, JSON.stringify(actual))
        const summary = await db
          .prepare(
            "SELECT COUNT(*) AS n,MIN(job_version) AS min_version,MAX(job_version) AS max_version,MIN(attempts) AS attempts,MIN(last_error) AS error FROM icono_vote_projection_refresh_jobs",
          )
          .first()
        assert.deepEqual(summary, {
          n: 20000,
          min_version: legacy ? 77 : 1,
          max_version: legacy ? 77 : 1,
          attempts: 3,
          error: "provider retry",
        })
        assert.equal(
          (
            await db
              .prepare(
                "SELECT COUNT(*) AS n FROM d1_migrations WHERE name='0098_vote_projection_job_version.sql'",
              )
              .first()
          ).n,
          1,
        )
        t.diagnostic(JSON.stringify({ legacy, actual, bound: prepared.bound }))
      }
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
