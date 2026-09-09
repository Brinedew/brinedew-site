import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  GLOBAL_RUNNING_FINALIZATION_SQL,
  GLOBAL_DUE_FINALIZATION_SQL,
  GLOBAL_PENDING_FINALIZATION_SQL,
} from "./sync-finalization-global-selection.js"
import { createFinalizationQueueMigrationCostAdapter } from "./operation-cost-finalization-queue-migration-adapter.js"
const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const source = (name) =>
  readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8")
const now = "2026-09-09T03:00:00.000Z"
const fixture = `INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase,next_attempt_at,requested_at,last_attempt_at) VALUES
 ('V1','queued','vision_rollups','2026-09-08','2026-09-01','2026-09-01'),
 ('V0','retrying','vision_rollups','2026-09-07','2026-09-02','2026-09-02'),
 ('G','queued','gene_rollups','2026-09-06','2026-09-01','2026-09-01'),
 ('S','queued','vote_summaries','2026-09-06','2026-09-01','2026-09-01'),
 ('R','queued','reconcile','2026-09-06','2026-09-01','2026-09-01'),
 ('F','retrying','vision_rollups','2026-09-10','2026-09-01','2026-09-01'),
 ('RUN','running','reconcile','2026-09-06','2026-09-01','2026-09-02'),
 ('READY','queued','completed_pending_finalize','2026-09-06','2026-09-01','2026-09-01'),
 ('DONE','completed','completed','2026-09-06','2026-09-01','2026-09-01')`
const queries = [
  [GLOBAL_RUNNING_FINALIZATION_SQL, [250]],
  [GLOBAL_DUE_FINALIZATION_SQL, [now, 25]],
  [GLOBAL_PENDING_FINALIZATION_SQL, [now]],
]

test("global dispatch retains phase priority, orders by due time and probes bounded index ranges", () => {
  const db = new DatabaseSync(":memory:")
  try {
    db.exec(source("0028_add_finalization_jobs.sql"))
    db.exec(source("0094_finalization_summary.sql"))
    db.exec(source("0099_finalization_queue_indexes.sql"))
    db.exec(fixture)
    const values = queries.map(([sql, args]) => {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args)
      const jobs = plan.filter((row) => row.detail.includes("icono_sync_finalization_jobs"))
      assert.ok(jobs.length > 0)
      assert.ok(
        jobs.every((row) => row.detail.includes("idx_icono_finalization_")),
        JSON.stringify(plan),
      )
      return db.prepare(sql).all(...args)
    })
    assert.deepEqual(
      values[0].map((row) => row.gene_symbol),
      ["RUN"],
    )
    assert.deepEqual(
      values[1].map((row) => row.gene_symbol),
      ["V0", "V1", "G", "S", "R"],
    )
    assert.deepEqual(
      { ...values[2][0] },
      { remaining: 8, has_runnable: 1, next_attempt_at: "2026-09-10" },
    )
    db.exec(
      "UPDATE icono_sync_finalization_jobs SET next_attempt_at='2026-09-11' WHERE status IN ('queued','retrying')",
    )
    assert.deepEqual(
      { ...db.prepare(GLOBAL_PENDING_FINALIZATION_SQL).get(now) },
      { remaining: 8, has_runnable: 0, next_attempt_at: "2026-09-11" },
    )
  } finally {
    db.close()
  }
})

test(
  "workerd migration and global dispatch stay within bounds across large runnable and future backlogs",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('global finalization')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      schema.exec(source("0028_add_finalization_jobs.sql"))
      schema.exec(source("0094_finalization_summary.sql"))
      const db = await runtime.getD1Database("DB")
      for (const { sql } of schema
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END,rowid",
        )
        .all())
        await db.prepare(sql).run()
      await db.prepare("INSERT INTO icono_sync_finalization_summary VALUES(1,0,0,0,0,0,0)").run()
      await db
        .prepare(
          "CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE)",
        )
        .run()
      await db.prepare(fixture).run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<24991)
    INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase,next_attempt_at)
    SELECT 'OLD'||n,CASE WHEN n<=4992 THEN 'retrying' ELSE 'completed' END,'reconcile','2099-01-01' FROM ids`,
        )
        .run()
      const adapter = createFinalizationQueueMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      await assert.rejects(
        adapter.dispatch(await adapter.prepare({ max_rows: 24999, max_unfinished: 5000 })),
      )
      await assert.rejects(
        adapter.dispatch(await adapter.prepare({ max_rows: 25000, max_unfinished: 4999 })),
      )
      assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM d1_migrations").first()).n, 0)
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='idx_icono_finalization_due'",
            )
            .first()
        ).n,
        0,
      )
      const prepared = await adapter.prepare({ max_rows: 25000, max_unfinished: 5000 })
      const { actual } = await adapter.dispatch(prepared)
      for (const meter of ["rows_read", "rows_written"])
        assert.ok(
          actual[meter] <= prepared.bound[meter],
          JSON.stringify({ actual, bound: prepared.bound }),
        )
      const measure = async (limit = 25) => {
        const result = []
        for (const [sql, originalArgs] of queries) {
          const args = sql === GLOBAL_DUE_FINALIZATION_SQL ? [now, limit] : originalArgs
          const receipt = await db
            .prepare(sql)
            .bind(...args)
            .all()
          assert.equal(receipt.meta.rows_written, 0)
          result.push(receipt)
        }
        assert.ok(result[0].meta.rows_read <= 1008, JSON.stringify(result[0].meta))
        assert.ok(result[1].meta.rows_read <= 32 * limit + 8, JSON.stringify(result[1].meta))
        assert.ok(result[2].meta.rows_read <= 40, JSON.stringify(result[2].meta))
        return result
      }
      const before = await measure()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<60000)
   INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase,next_attempt_at,last_attempt_at)
   SELECT 'MORE'||n,CASE n%3 WHEN 0 THEN 'running' WHEN 1 THEN 'queued' ELSE 'completed' END,
    CASE n%4 WHEN 0 THEN 'vision_rollups' WHEN 1 THEN 'gene_rollups' WHEN 2 THEN 'vote_summaries' ELSE 'reconcile' END,
    CASE WHEN (n/4)%2=0 THEN '2026-09-08' ELSE '2099-01-01' END,'2026-09-08' FROM ids`,
        )
        .run()
      const after = await measure()
      assert.equal(after[0].results.length, 250)
      assert.equal(after[1].results.length, 25)
      assert.equal(after[2].results[0].remaining, 45000)
      const maximum = await measure(250)
      assert.equal(maximum[1].results.length, 250)
      await db
        .prepare(
          "UPDATE icono_sync_finalization_jobs SET next_attempt_at='2099-01-01' WHERE status IN ('queued','retrying')",
        )
        .run()
      const future = await measure()
      assert.equal(future[1].results.length, 0)
      assert.equal(future[2].results[0].has_runnable, 0)
      assert.equal(future[2].results[0].next_attempt_at, "2099-01-01")
      t.diagnostic(
        JSON.stringify({
          migration: actual,
          migration_bound: prepared.bound,
          before: before.map((r) => r.meta.rows_read),
          after: after.map((r) => r.meta.rows_read),
          maximum: maximum.map((r) => r.meta.rows_read),
          future: future.map((r) => r.meta.rows_read),
        }),
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
