import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  GLOBAL_FINALIZATION_SUMMARY_SQL,
  readSyncFinalizationSummary,
  readSyncFinalizationDrainCounts,
} from "./sync-finalization-summary.js"

test("global completion time has constant D1 reads even when all historical timestamps are blank", async () => {
  const require = createRequire(import.meta.url)
  const { Miniflare, convertV4MiniflareOptions } = createRequire(
    require.resolve("wrangler/package.json"),
  )("miniflare")
  const mf = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: "export default {fetch(){return new Response('test')}}",
      compatibilityDate: "2026-08-01",
      d1Databases: ["DB"],
    }),
  )
  const schema = new DatabaseSync(":memory:")
  try {
    for (const name of ["0028_add_finalization_jobs.sql", "0094_finalization_summary.sql"])
      schema.exec(
        readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8"),
      )
    const db = await mf.getD1Database("DB")
    for (const { sql } of schema
      .prepare(
        "SELECT sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, rowid",
      )
      .all())
      await db.prepare(sql).run()
    await db.prepare("INSERT INTO icono_sync_finalization_summary VALUES(1,0,0,0,0,0,0)").run()
    for (const count of [0, 20000, 60000]) {
      if (count)
        await db
          .prepare(
            `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<?)
        INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,completed_at)
        SELECT ?||n, 'completed', '' FROM ids`,
          )
          .bind(count, `B${count}-`)
          .run()
      const result = await db.prepare(GLOBAL_FINALIZATION_SUMMARY_SQL).first()
      assert.equal(result.completed_at, null)
      const receipt = await db.prepare(GLOBAL_FINALIZATION_SUMMARY_SQL).all()
      assert.ok(receipt.meta.rows_read <= 2, JSON.stringify(receipt.meta))
    }
    await db
      .prepare(
        "INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,completed_at) VALUES('OLD','completed','2026-09-01'),('NEW','completed','2026-09-09'),('RUNNING','running','2099-01-01')",
      )
      .run()
    const dated = await db.prepare(GLOBAL_FINALIZATION_SUMMARY_SQL).all()
    assert.equal(dated.results[0].completed_at, "2026-09-09")
    assert.ok(dated.meta.rows_read <= 2, JSON.stringify(dated.meta))
    await db.prepare("DELETE FROM icono_sync_finalization_jobs WHERE gene_symbol='NEW'").run()
    assert.equal(
      (await db.prepare(GLOBAL_FINALIZATION_SUMMARY_SQL).first()).completed_at,
      "2026-09-01",
    )
  } finally {
    schema.close()
    await mf.dispose()
  }
})

test("finalization counts stay exact through writes without scanning completed history", async () => {
  const raw = new DatabaseSync(":memory:")
  const plans = []
  const db = {
    prepare(sql) {
      let parameters = []
      return {
        bind(...values) {
          parameters = values
          return this
        },
        async first() {
          plans.push(...raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...parameters))
          return raw.prepare(sql).get(...parameters)
        },
      }
    },
  }
  try {
    raw.exec(
      readFileSync(
        new URL("../../migrations-iconoplasm/0028_add_finalization_jobs.sql", import.meta.url),
        "utf8",
      ),
    )
    raw.exec(`WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<20000)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,completed_at)
      SELECT 'GENE'||n, 'completed', '2026-09-01' FROM ids`)
    raw.exec(
      readFileSync(
        new URL("../../migrations-iconoplasm/0094_finalization_summary.sql", import.meta.url),
        "utf8",
      ),
    )
    assert.equal((await readSyncFinalizationSummary(db)).completed_count, 20000)
    raw.exec(
      readFileSync(
        new URL(
          "../../migrations-iconoplasm/0101_finalization_publication_barrier.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    )
    assert.deepEqual(
      { ...(await readSyncFinalizationDrainCounts(db)) },
      { remaining_count: 0, pending_finalize_count: 0 },
    )
    const pendingPlan = raw
      .prepare(
        `EXPLAIN QUERY PLAN SELECT * FROM icono_sync_finalization_jobs
      WHERE status <> ? ORDER BY CASE WHEN phase = ? THEN 0 ELSE 1 END,
      next_attempt_at, requested_at, gene_symbol LIMIT ?`,
      )
      .all("completed", "completed_pending_finalize", 200)
    assert.ok(
      pendingPlan.some(({ detail }) => detail.includes("idx_icono_finalization_unfinished")),
    )
    raw.exec(`INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase)
      VALUES('TEST','queued','completed_pending_finalize')`)
    let summary = await readSyncFinalizationSummary(db)
    assert.equal(summary.queued_count, 1)
    assert.equal(summary.pending_finalize_count, 1)
    raw.exec(`INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase)
      VALUES('ACTIVE','retrying','reconcile'),('PHASE_DONE','queued','completed')`)
    assert.deepEqual(
      { ...(await readSyncFinalizationDrainCounts(db)) },
      { remaining_count: 1, pending_finalize_count: 1 },
    )
    assert.deepEqual(
      { ...(await readSyncFinalizationDrainCounts(db, ["TEST", "PHASE_DONE", "MISSING"])) },
      { remaining_count: 0, pending_finalize_count: 1 },
    )
    assert.deepEqual(
      { ...(await readSyncFinalizationDrainCounts(db, ["ACTIVE"])) },
      { remaining_count: 1, pending_finalize_count: 0 },
    )
    raw.exec(
      `UPDATE icono_sync_finalization_jobs SET status='completed',completed_at='2026-09-05' WHERE gene_symbol='TEST'`,
    )
    summary = await readSyncFinalizationSummary(db)
    assert.equal(summary.completed_count, 20001)
    assert.equal(summary.pending_finalize_count, 0)
    assert.deepEqual(
      { ...(await readSyncFinalizationDrainCounts(db)) },
      { remaining_count: 1, pending_finalize_count: 0 },
    )
    assert.equal(summary.completed_at, "2026-09-05")
    assert.equal((await readSyncFinalizationSummary(db, ["TEST", "MISSING"])).completed_count, 1)
    raw.exec(`BEGIN; DELETE FROM icono_sync_finalization_jobs WHERE gene_symbol='TEST'; ROLLBACK;`)
    assert.equal((await readSyncFinalizationSummary(db)).completed_count, 20001)
    raw.exec(`DELETE FROM icono_sync_finalization_jobs WHERE gene_symbol='TEST'`)
    assert.equal((await readSyncFinalizationSummary(db)).completed_at, "2026-09-01")
    for (const { detail } of plans) assert.doesNotMatch(detail, /SCAN icono_sync_finalization_jobs/)
    assert.ok(plans.some(({ detail }) => detail.includes("idx_icono_finalization_completed_at")))
    raw.exec("DROP INDEX idx_icono_finalization_completed_at")
    await assert.rejects(readSyncFinalizationSummary(db), /no such index/)
  } finally {
    raw.close()
  }
})
