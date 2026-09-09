import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  GLOBAL_READY_FINALIZATION_SQL,
  SCOPED_READY_FINALIZATION_SQL,
  COMPLETE_READY_FINALIZATION_SQL,
  readFinalizationPublicationBarrier,
  drainCompletedFinalization,
  claimFinalizationPublication,
  acknowledgeFinalizationPublication,
} from "./sync-finalization-publication.js"
import { createFinalizationPublicationMigrationCostAdapter } from "./operation-cost-finalization-publication-migration-adapter.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const source = (name) =>
  readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8")
const now = "2026-09-09T03:00:00.000Z"

test("missing handoff counters refuse before completing any saved jobs", async () => {
  await assert.rejects(
    drainCompletedFinalization(
      {
        prepare() {
          return {
            async first() {
              return null
            },
            async all() {
              assert.fail("must not mutate without handoff state")
            },
          }
        },
      },
      { now, notifyPublisher: async () => assert.fail("must not publish without handoff state") },
    ),
    /migration 0101/,
  )
})

test(
  "bounded completion preserves exact versions and one durable publisher handoff beside large history",
  { timeout: 120000 },
  async (t) => {
    const runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: "export default {fetch(){return new Response('handoff')}}",
        compatibilityDate: "2026-08-01",
        d1Databases: ["jobs"],
      }),
    )
    const schema = new DatabaseSync(":memory:")
    try {
      for (const file of [
        "0028_add_finalization_jobs.sql",
        "0094_finalization_summary.sql",
        "0099_finalization_queue_indexes.sql",
        "0100_finalization_job_version.sql",
        "0103_finalization_running_index.sql",
      ])
        schema.exec(source(file))
      const db = await runtime.getD1Database("jobs")
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
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<60000)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase) SELECT 'H'||n,'completed','completed' FROM ids`,
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<5000)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase) SELECT 'T'||n,'queued','completed' FROM ids`,
        )
        .run()
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<201)
      INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase,vision_ids_json) SELECT 'R'||n,'queued','completed_pending_finalize','["already-rebuilt"]' FROM ids`,
        )
        .run()
      const adapter = createFinalizationPublicationMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      await assert.rejects(
        adapter.dispatch(await adapter.prepare({ max_terminal: 4999, max_schema_rows: 512 })),
      )
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM sqlite_schema WHERE name='icono_sync_finalization_publication'",
            )
            .first()
        ).n,
        0,
      )
      const prepared = await adapter.prepare({ max_terminal: 5000, max_schema_rows: 512 })
      const migration = await adapter.dispatch(prepared)
      assert.ok(migration.actual.rows_read <= prepared.bound.rows_read, JSON.stringify(migration))
      assert.ok(
        migration.actual.rows_written <= prepared.bound.rows_written,
        JSON.stringify(migration),
      )
      const receipts = []
      const metered = {
        prepare(sql) {
          let args = []
          return {
            bind(...values) {
              args = values
              return this
            },
            async all() {
              const result = await db
                .prepare(sql)
                .bind(...args)
                .all()
              receipts.push({ sql, ...result.meta })
              return result
            },
            async first() {
              const result = await this.all()
              return result.results[0] || null
            },
            async run() {
              return this.all()
            },
          }
        },
      }
      const scoped = await db
        .prepare(SCOPED_READY_FINALIZATION_SQL)
        .bind(
          JSON.stringify([
            ...Array.from({ length: 201 }, (_, i) => `R${i + 1}`),
            ...Array.from({ length: 4799 }, (_, i) => `H${i + 1}`),
          ]),
        )
        .all()
      assert.equal(scoped.results.length, 100)
      assert.ok(scoped.meta.rows_read <= 20000, JSON.stringify(scoped.meta))
      const scopedMaximum = await db
        .prepare(SCOPED_READY_FINALIZATION_SQL)
        .bind(JSON.stringify(Array.from({ length: 5000 }, (_, i) => `T${i + 1}`)))
        .all()
      assert.equal(scopedMaximum.results.length, 100)
      assert.ok(scopedMaximum.meta.rows_read <= 20000, JSON.stringify(scopedMaximum.meta))
      let notifications = 0,
        completed = 0,
        maxPageRead = 0,
        maxPageWrite = 0
      for (let page = 0; page < 53; page++) {
        const receiptStart = receipts.length
        const result = await drainCompletedFinalization(metered, {
          now,
          notifyPublisher: async () => {
            notifications++
            return { accepted: true }
          },
        })
        assert.ok(result.finalized <= 100)
        completed += result.finalized
        maxPageRead = Math.max(
          maxPageRead,
          receipts.slice(receiptStart).reduce((sum, receipt) => sum + receipt.rows_read, 0),
        )
        maxPageWrite = Math.max(
          maxPageWrite,
          receipts.slice(receiptStart).reduce((sum, receipt) => sum + receipt.rows_written, 0),
        )
        if (result.remaining) assert.equal(notifications, 0)
      }
      assert.equal(completed, 5201)
      assert.equal(notifications, 1)
      assert.ok(maxPageRead <= 1500, JSON.stringify({ maxPageRead }))
      assert.ok(maxPageWrite <= 1100, JSON.stringify({ maxPageWrite }))
      let barrier = await readFinalizationPublicationBarrier(db)
      assert.equal(barrier.remaining_count, 0)
      assert.equal(barrier.terminal_phase_count, 0)
      assert.equal(barrier.enqueued_version, barrier.notified_version)
      const maxRead = Math.max(...receipts.map((r) => r.rows_read))
      const maxWrite = Math.max(...receipts.map((r) => r.rows_written))
      assert.ok(maxRead <= 1500, JSON.stringify({ maxRead }))
      assert.ok(maxWrite <= 1100, JSON.stringify({ maxWrite }))
      assert.equal(
        receipts.some((r) => /SELECT vision_ids_json/.test(r.sql)),
        false,
      )

      await db
        .prepare(
          "INSERT INTO icono_sync_finalization_jobs(gene_symbol,phase) VALUES('TP53','completed_pending_finalize')",
        )
        .run()
      const selected = await db.prepare(GLOBAL_READY_FINALIZATION_SQL).all()
      await db
        .prepare(
          "UPDATE icono_sync_finalization_jobs SET job_version=job_version+1,requested_at='newer',phase='reconcile' WHERE gene_symbol='TP53'",
        )
        .run()
      const stale = await db
        .prepare(COMPLETE_READY_FINALIZATION_SQL)
        .bind(JSON.stringify(selected.results.map((r) => [r.gene_symbol, r.job_version])), now)
        .all()
      assert.equal(stale.results.length, 0, "old completion page cannot clear a newer enqueue")
      await db
        .prepare(
          "UPDATE icono_sync_finalization_jobs SET phase='completed_pending_finalize',job_version=job_version+1 WHERE gene_symbol='TP53'",
        )
        .run()
      let enter, release
      const entered = new Promise((resolve) => {
        enter = resolve
      })
      const gate = new Promise((resolve) => {
        release = resolve
      })
      const first = drainCompletedFinalization(db, {
        now,
        notifyPublisher: async () => {
          enter()
          await gate
          return { accepted: true }
        },
      })
      await entered
      const duplicate = await drainCompletedFinalization(db, {
        now,
        notifyPublisher: async () => assert.fail("unexpired handoff already claimed"),
      })
      assert.equal(duplicate.publication_pending, true)
      assert.equal(duplicate.publication_next_attempt_at, "2026-09-09T03:02:00.000Z")
      await db
        .prepare(
          "INSERT INTO icono_sync_finalization_jobs(gene_symbol,phase) VALUES('BRCA1','completed_pending_finalize')",
        )
        .run()
      release()
      const firstResult = await first
      assert.equal(
        firstResult.publication_pending,
        true,
        "new enqueue survives the older handoff acknowledgement",
      )
      const second = await drainCompletedFinalization(db, {
        now,
        notifyPublisher: async () => ({ accepted: true }),
      })
      assert.equal(second.publication_pending, false)

      await db
        .prepare(
          "INSERT INTO icono_sync_finalization_jobs(gene_symbol,phase) VALUES('RETRY','completed_pending_finalize')",
        )
        .run()
      const deferred = await drainCompletedFinalization(db, {
        now,
        notifyPublisher: async () => ({
          accepted: false,
          nextAttemptAt: "2026-09-10T00:00:00.000Z",
        }),
      })
      assert.equal(deferred.remaining, 0)
      assert.equal(deferred.publication_pending, true)
      await drainCompletedFinalization(db, {
        now,
        notifyPublisher: async () =>
          assert.fail("durable retry deadline must survive another delivery"),
      })
      barrier = await readFinalizationPublicationBarrier(db)
      const version = barrier.enqueued_version
      assert.ok(
        await claimFinalizationPublication(db, version, "2026-09-10T00:00:00.000Z", "old-lease"),
      )
      assert.ok(
        await claimFinalizationPublication(db, version, "2026-09-10T00:03:00.000Z", "new-lease"),
      )
      assert.equal(await acknowledgeFinalizationPublication(db, "old-lease", version), null)
      assert.ok(await acknowledgeFinalizationPublication(db, "new-lease", version))
      t.diagnostic(
        JSON.stringify({
          migration: migration.actual,
          migration_bound: prepared.bound,
          completed,
          notifications,
          maxRead,
          maxWrite,
          maxPageRead,
          maxPageWrite,
          scopedRead: scoped.meta.rows_read,
          scopedMaximumRead: scopedMaximum.meta.rows_read,
        }),
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)
