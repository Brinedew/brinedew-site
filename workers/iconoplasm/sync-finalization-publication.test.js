import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  FINALIZATION_COMPLETION_PAGE_SIZE,
  SCOPED_READY_FINALIZATION_SQL,
  COMPLETE_READY_FINALIZATION_SQL,
  readFinalizationPublicationBarrier,
  drainCompletedFinalization,
  claimFinalizationPublication,
  acknowledgeFinalizationPublication,
} from "./sync-finalization-publication.js"
import { createFinalizationPublicationMigrationCostAdapter } from "./operation-cost-finalization-publication-migration-adapter.js"
import { writeSyncFinalizationJobState } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const require = createRequire(import.meta.url)
const { Miniflare, convertV4MiniflareOptions } = createRequire(
  require.resolve("wrangler/package.json"),
)("miniflare")
const source = (name) =>
  readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8")
const now = "2026-09-09T03:00:00.000Z"

function installFinalizationSchema(sqlite, { handoff = true } = {}) {
  for (const file of [
    "0028_add_finalization_jobs.sql",
    "0094_finalization_summary.sql",
    "0099_finalization_queue_indexes.sql",
    "0100_finalization_job_version.sql",
    "0103_finalization_running_index.sql",
  ])
    sqlite.exec(source(file))
  if (handoff) sqlite.exec(source("0101_finalization_publication_barrier.sql"))
}

function sqliteD1(db) {
  return {
    prepare(sql) {
      let args = []
      return {
        sql,
        bind(...values) {
          args = values
          return this
        },
        async all() {
          const statement = db.prepare(sql)
          return { results: statement.all(...args) }
        },
        async first() {
          const statement = db.prepare(sql)
          return statement.get(...args) || null
        },
        async run() {
          const statement = db.prepare(sql)
          const result = statement.run(...args)
          return { results: [], meta: { changes: Number(result.changes || 0) } }
        },
      }
    },
  }
}

test("ordinary finalization refuses an empty scope before any database read", async () => {
  await assert.rejects(
    drainCompletedFinalization(
      { prepare: () => assert.fail("empty scope must refuse before any database read") },
      { symbols: [], now, notifyPublisher: async () => assert.fail("must not publish") },
    ),
    /explicit non-empty finalization scope/i,
  )
})

test("scoped finalization requires durable per-gene acceptance before acknowledgement", async () => {
  const sqlite = new DatabaseSync(":memory:")
  try {
    installFinalizationSchema(sqlite)
    sqlite
      .prepare(
        "INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase) VALUES('TP53','queued','completed_pending_finalize')",
      )
      .run()
    sqlite
      .prepare(
        "INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase) VALUES('BRCA1','queued','reconcile')",
      )
      .run()
    const db = sqliteD1(sqlite)
    const accepted = []
    const result = await drainCompletedFinalization(db, {
      symbols: ["TP53"],
      now,
      notifyPublisher: async ({ symbols, jobs }) => {
        assert.deepEqual(symbols, ["TP53"])
        assert.deepEqual(jobs, [{ gene_symbol: "TP53", job_version: 1 }])
        assert.equal(
          sqlite
            .prepare("SELECT status FROM icono_sync_finalization_jobs WHERE gene_symbol='TP53'")
            .get().status,
          "queued",
          "V2 acceptance must happen before the D1 completion acknowledgement",
        )
        accepted.push(...symbols)
        return { accepted: true }
      },
    })
    assert.deepEqual(accepted, ["TP53"])
    assert.equal(result.finalized, 1)
    assert.equal(result.broaden_next_drain, false)
    assert.equal(result.global_finalize_deferred, false)
    assert.equal(
      sqlite
        .prepare("SELECT status FROM icono_sync_finalization_jobs WHERE gene_symbol='TP53'")
        .get().status,
      "completed",
    )
    assert.equal(
      sqlite
        .prepare("SELECT status FROM icono_sync_finalization_jobs WHERE gene_symbol='BRCA1'")
        .get().status,
      "queued",
      "unrelated finalization must neither block nor join the scoped handoff",
    )
  } finally {
    sqlite.close()
  }
})

test("a deferred V2 handoff leaves the finalization row pending with its retry deadline", async () => {
  const sqlite = new DatabaseSync(":memory:")
  try {
    installFinalizationSchema(sqlite)
    sqlite
      .prepare(
        "INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase) VALUES('TP53','queued','completed_pending_finalize')",
      )
      .run()
    const retryAt = "2026-09-09T03:05:00.000Z"
    const result = await drainCompletedFinalization(sqliteD1(sqlite), {
      symbols: ["TP53"],
      now,
      notifyPublisher: async () => ({ accepted: false, nextAttemptAt: retryAt }),
    })
    assert.equal(result.finalized, 0)
    assert.equal(result.publication_pending, true)
    assert.equal(result.publication_next_attempt_at, retryAt)
    const row = sqlite
      .prepare(
        "SELECT status,phase,job_version FROM icono_sync_finalization_jobs WHERE gene_symbol='TP53'",
      )
      .get()
    assert.deepEqual(
      { ...row },
      { status: "queued", phase: "completed_pending_finalize", job_version: 1 },
    )
  } finally {
    sqlite.close()
  }
})

test("a superseding enqueue cannot be cleared by an older accepted handoff", async () => {
  const sqlite = new DatabaseSync(":memory:")
  try {
    installFinalizationSchema(sqlite)
    sqlite
      .prepare(
        "INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase) VALUES('TP53','queued','completed_pending_finalize')",
      )
      .run()
    const result = await drainCompletedFinalization(sqliteD1(sqlite), {
      symbols: ["TP53"],
      now,
      notifyPublisher: async () => {
        sqlite
          .prepare(
            "UPDATE icono_sync_finalization_jobs SET job_version=job_version+1,phase='reconcile',requested_at='newer' WHERE gene_symbol='TP53'",
          )
          .run()
        return { accepted: true }
      },
    })
    assert.equal(result.finalized, 0)
    const row = sqlite
      .prepare(
        "SELECT status,phase,job_version FROM icono_sync_finalization_jobs WHERE gene_symbol='TP53'",
      )
      .get()
    assert.deepEqual({ ...row }, { status: "queued", phase: "reconcile", job_version: 2 })
  } finally {
    sqlite.close()
  }
})

test(
  "scoped completion remains bounded beside large unrelated history",
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
      installFinalizationSchema(schema, { handoff: false })
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
       INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase)
       SELECT 'H'||n,'completed','completed' FROM ids`,
        )
        .run()
      const scope = Array.from({ length: 5000 }, (_, index) => `T${index + 1}`)
      await db
        .prepare(
          `WITH RECURSIVE ids(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM ids WHERE n<5000)
       INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase)
       SELECT 'T'||n,'queued','completed_pending_finalize' FROM ids`,
        )
        .run()

      const adapter = createFinalizationPublicationMigrationCostAdapter({
        db,
        executable_sha256: "a".repeat(64),
        schema_sha256: "b".repeat(64),
      })
      const prepared = await adapter.prepare({ max_terminal: 5000, max_schema_rows: 512 })
      const migration = await adapter.dispatch(prepared)
      assert.ok(migration.actual.rows_read <= prepared.bound.rows_read, JSON.stringify(migration))
      assert.ok(
        migration.actual.rows_written <= prepared.bound.rows_written,
        JSON.stringify(migration),
      )

      const selected = await db
        .prepare(SCOPED_READY_FINALIZATION_SQL)
        .bind(JSON.stringify(scope))
        .all()
      assert.equal(selected.results.length, FINALIZATION_COMPLETION_PAGE_SIZE)
      assert.ok(selected.meta.rows_read <= 20000, JSON.stringify(selected.meta))

      let total = 0
      let handoffs = 0
      for (
        let page = 0;
        page < Math.ceil(scope.length / FINALIZATION_COMPLETION_PAGE_SIZE);
        page++
      ) {
        const result = await drainCompletedFinalization(db, {
          symbols: scope,
          now,
          notifyPublisher: async ({ symbols }) => {
            handoffs += 1
            assert.ok(symbols.length <= FINALIZATION_COMPLETION_PAGE_SIZE)
            return { accepted: true }
          },
        })
        total += result.finalized
      }
      assert.equal(total, 5000)
      assert.equal(handoffs, Math.ceil(5000 / FINALIZATION_COMPLETION_PAGE_SIZE))
      assert.equal(
        (
          await db
            .prepare(
              "SELECT COUNT(*) AS n FROM icono_sync_finalization_jobs WHERE gene_symbol LIKE 'H%' AND status='completed'",
            )
            .first()
        ).n,
        60000,
        "unrelated history remains untouched",
      )
      t.diagnostic(
        JSON.stringify({
          migration: migration.actual,
          selected_rows_read: selected.meta.rows_read,
        }),
      )
    } finally {
      schema.close()
      await runtime.dispose()
    }
  },
)

test("completion uses the exact saved job version", async () => {
  const sqlite = new DatabaseSync(":memory:")
  try {
    installFinalizationSchema(sqlite)
    sqlite
      .prepare(
        "INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase) VALUES('TP53','queued','completed_pending_finalize')",
      )
      .run()
    const selected = sqlite.prepare(SCOPED_READY_FINALIZATION_SQL).all(JSON.stringify(["TP53"]))
    sqlite
      .prepare(
        "UPDATE icono_sync_finalization_jobs SET job_version=job_version+1,phase='reconcile' WHERE gene_symbol='TP53'",
      )
      .run()
    const completed = sqlite
      .prepare(COMPLETE_READY_FINALIZATION_SQL)
      .all(JSON.stringify(selected.map((row) => [row.gene_symbol, row.job_version])), now)
    assert.equal(completed.length, 0)
  } finally {
    sqlite.close()
  }
})

test("vision cursor transitions retain their exact version fence", async () => {
  const sqlite = new DatabaseSync(":memory:")
  try {
    installFinalizationSchema(sqlite)
    sqlite
      .prepare(
        "INSERT INTO icono_sync_finalization_jobs(gene_symbol,phase,vision_ids_json) VALUES('CURSOR','vision_rollups','[\"anima-v1-1\",\"anima-v1-2\"]')",
      )
      .run()
    const env = { ICONOPLASM_DB: sqliteD1(sqlite) }
    assert.equal(
      await writeSyncFinalizationJobState(env, {
        symbol: "CURSOR",
        expectedVersion: 1,
        status: "queued",
        phase: "vision_rollups",
        remainingVisionIds: ["anima-v1-2"],
      }),
      true,
    )
    assert.equal(
      await writeSyncFinalizationJobState(env, {
        symbol: "CURSOR",
        expectedVersion: 1,
        status: "queued",
        phase: "vision_rollups",
        remainingVisionIds: [],
      }),
      false,
    )
    assert.deepEqual(
      {
        ...sqlite
          .prepare(
            "SELECT job_version,vision_ids_json FROM icono_sync_finalization_jobs WHERE gene_symbol='CURSOR'",
          )
          .get(),
      },
      { job_version: 2, vision_ids_json: '["anima-v1-2"]' },
    )
  } finally {
    sqlite.close()
  }
})

test("historical singleton handoff lease remains version fenced until deletion migration", async () => {
  const sqlite = new DatabaseSync(":memory:")
  try {
    installFinalizationSchema(sqlite)
    const db = sqliteD1(sqlite)
    sqlite
      .prepare(
        "UPDATE icono_sync_finalization_publication SET enqueued_version=2,notified_version=1,next_attempt_at='' WHERE singleton=1",
      )
      .run()
    let barrier = await readFinalizationPublicationBarrier(db)
    assert.equal(barrier.enqueued_version, 2)
    assert.equal(barrier.notified_version, 1)
    assert.ok(await claimFinalizationPublication(db, 2, now, "old-lease"))
    assert.equal(await acknowledgeFinalizationPublication(db, "other-lease", 2), null)
    assert.ok(await acknowledgeFinalizationPublication(db, "old-lease", 2))
    barrier = await readFinalizationPublicationBarrier(db)
    assert.equal(barrier.enqueued_version, barrier.notified_version)
  } finally {
    sqlite.close()
  }
})
