import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import {
  SCOPED_READY_FINALIZATION_SQL,
  COMPLETE_READY_FINALIZATION_SQL,
  drainCompletedFinalization,
} from "./sync-finalization-publication.js"
import { writeSyncFinalizationJobState } from "../iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

const source = (name) =>
  readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8")
const now = "2026-09-09T03:00:00.000Z"

function installFinalizationSchema(sqlite) {
  for (const file of [
    "0028_add_finalization_jobs.sql",
    "0094_finalization_summary.sql",
    "0099_finalization_queue_indexes.sql",
    "0100_finalization_job_version.sql",
    "0103_finalization_running_index.sql",
  ])
    sqlite.exec(source(file))
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
    assert.equal(result.handoff_accepted, false)
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
    const db = sqliteD1(sqlite)
    const savedRows = (await db.prepare(SCOPED_READY_FINALIZATION_SQL).bind('["TP53"]').all())
      .results
    const result = await drainCompletedFinalization(db, {
      symbols: ["TP53"],
      rows: savedRows,
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
    assert.equal(result.handoff_accepted, true)
    assert.equal(result.terminal_noop, true)
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
