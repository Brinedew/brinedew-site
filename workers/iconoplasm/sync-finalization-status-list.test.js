import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  GLOBAL_FINALIZATION_STATUS_LIST_SQL,
  SCOPED_FINALIZATION_STATUS_LIST_SQL,
} from "./sync-finalization-status-list.js"
const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const source = (name) =>
  readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8")
const reference = `SELECT * FROM icono_sync_finalization_jobs WHERE status <> 'completed'
  ORDER BY CASE WHEN phase = 'completed_pending_finalize' THEN 0 ELSE 1 END,
  next_attempt_at, requested_at, gene_symbol LIMIT ?`
const fixture = `INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase,next_attempt_at,requested_at) VALUES
 ('V','queued','vision_rollups','2026-09-06','2026-09-01'),
 ('R','running','reconcile','2026-09-05','2026-09-01'),
 ('F','retrying','gene_rollups','2099-09-01','2026-09-01'),
 ('P','queued','completed_pending_finalize','2099-09-01','2026-09-01'),
 ('T','queued','completed','2026-09-04','2026-09-01'),
 ('X','retrying','unknown','2026-09-03','2026-09-01'),
 ('DONE','completed','completed','2026-09-01','2026-09-01')`

test("status list preserves ready-first order, future retries and unexpected stored phases", () => {
  const db = new DatabaseSync(":memory:")
  try {
    for (const name of [
      "0028_add_finalization_jobs.sql",
      "0094_finalization_summary.sql",
      "0102_finalization_status_index.sql",
    ])
      db.exec(source(name))
    db.exec(fixture)
    assert.deepEqual(
      db.prepare(GLOBAL_FINALIZATION_STATUS_LIST_SQL).all(100),
      db.prepare(reference).all(100),
    )
    assert.deepEqual(
      db
        .prepare(SCOPED_FINALIZATION_STATUS_LIST_SQL)
        .all(JSON.stringify(["V", "P", "DONE", "MISSING", "V"]), 100)
        .map((row) => row.gene_symbol),
      ["P", "V"],
    )
    const plan = db.prepare(`EXPLAIN QUERY PLAN ${GLOBAL_FINALIZATION_STATUS_LIST_SQL}`).all(100)
    assert.ok(
      plan.some((row) => row.detail.includes("idx_icono_finalization_status_list")),
      JSON.stringify(plan),
    )
    assert.ok(
      plan.every((row) => !row.detail.includes("TEMP B-TREE")),
      JSON.stringify(plan),
    )
  } finally {
    db.close()
  }
})

test(
  "workerd list cost stays bounded as history and backlog grow",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('status')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["DB"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      for (const name of [
        "0028_add_finalization_jobs.sql",
        "0094_finalization_summary.sql",
        "0099_finalization_queue_indexes.sql",
        "0100_finalization_job_version.sql",
        "0102_finalization_status_index.sql",
        "0103_finalization_running_index.sql",
      ])
        schema.exec(source(name))
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
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<25000)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase,next_attempt_at,requested_at)
      SELECT printf('JOB%05d',n), CASE WHEN n<=5000 THEN 'queued' ELSE 'completed' END,
      CASE WHEN n%2=0 THEN 'completed_pending_finalize' ELSE 'reconcile' END,'2026-09-09','2026-09-01' FROM ids`,
        )
        .run()
      // The summary counters are maintained by the 0094 triggers, so they
      // confirm that the history and the unfinished backlog really grew.
      const counters = async () => {
        const jobs = await db
          .prepare("SELECT COUNT(*) AS n FROM icono_sync_finalization_jobs")
          .first()
        const summary = await db
          .prepare("SELECT unfinished_count FROM icono_sync_finalization_summary WHERE singleton=1")
          .first()
        return [jobs.n, summary.unfinished_count]
      }
      assert.deepEqual(await counters(), [25000, 5000])
      const measure = async () => {
        const costs = []
        for (const limit of [1, 200, 1000]) {
          const result = await db.prepare(GLOBAL_FINALIZATION_STATUS_LIST_SQL).bind(limit).all()
          assert.equal(result.results.length, limit)
          assert.ok(result.meta.rows_read <= 2 * limit + 2, JSON.stringify(result.meta))
          assert.equal(result.meta.rows_written, 0)
          costs.push(result.meta.rows_read)
        }
        const symbols = Array.from(
          { length: 5000 },
          (_, i) => `JOB${String(i + 1).padStart(5, "0")}`,
        )
        const scoped = await db
          .prepare(SCOPED_FINALIZATION_STATUS_LIST_SQL)
          .bind(JSON.stringify(symbols), 1000)
          .all()
        assert.equal(scoped.results.length, 1000)
        assert.ok(scoped.meta.rows_read <= 20002, JSON.stringify(scoped.meta))
        costs.push(scoped.meta.rows_read)
        return costs
      }
      const before = await measure()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<80000)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase,next_attempt_at,requested_at)
      SELECT 'GROWTH'||n,CASE WHEN n<=60000 THEN 'retrying' ELSE 'completed' END,
      'reconcile','2099-09-01','2026-09-01' FROM ids`,
        )
        .run()
      const after = await measure()
      assert.deepEqual(await counters(), [105000, 65000])
      assert.deepEqual(after, before)
      t.diagnostic(JSON.stringify({ before, after }))
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
