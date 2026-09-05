import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { readSyncFinalizationSummary } from "./sync-finalization-summary.js"

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
    raw.exec(
      `UPDATE icono_sync_finalization_jobs SET status='completed',completed_at='2026-09-05' WHERE gene_symbol='TEST'`,
    )
    summary = await readSyncFinalizationSummary(db)
    assert.equal(summary.completed_count, 20001)
    assert.equal(summary.pending_finalize_count, 0)
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
