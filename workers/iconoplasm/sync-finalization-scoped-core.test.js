import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { drainCompletedFinalization } from "./sync-finalization-publication.js"

function fixture(t, rows = [["TP53", "completed_pending_finalize"]]) {
  const sqlite = new DatabaseSync(":memory:")
  t.after(() => sqlite.close())
  for (const name of [
    "0028_add_finalization_jobs.sql",
    "0094_finalization_summary.sql",
    "0099_finalization_queue_indexes.sql",
    "0100_finalization_job_version.sql",
    "0101_finalization_publication_barrier.sql",
  ]) {
    sqlite.exec(readFileSync(new URL(`../../migrations-iconoplasm/${name}`, import.meta.url), "utf8"))
  }
  const insert = sqlite.prepare(
    "INSERT INTO icono_sync_finalization_jobs(gene_symbol,status,phase) VALUES(?,'queued',?)",
  )
  for (const row of rows) insert.run(...row)
  const queries = []
  const db = {
    prepare(sql) {
      queries.push(sql)
      let values = []
      return {
        bind(...args) {
          values = args
          return this
        },
        async all() {
          return { results: sqlite.prepare(sql).all(...values) }
        },
        async first() {
          return sqlite.prepare(sql).get(...values) || null
        },
      }
    },
  }
  const row = () =>
    sqlite.prepare("SELECT * FROM icono_sync_finalization_jobs WHERE gene_symbol='TP53'").get()
  const run = (notifyPublisher, symbols = ["TP53"]) =>
    drainCompletedFinalization(db, {
      symbols,
      notifyPublisher,
      now: "2026-09-17T12:00:00.000Z",
    })
  return { sqlite, queries, row, run }
}

test("scoped finalization rejects empty membership before database or publication work", async () => {
  await assert.rejects(
    drainCompletedFinalization(
      { prepare: () => assert.fail("empty scope reached the database") },
      { symbols: [], notifyPublisher: () => assert.fail("empty scope reached publication") },
    ),
    /explicit non-empty finalization scope/i,
  )
})

test("V2 acceptance precedes completion while an unrelated job stays unfinished", async (t) => {
  const { run, row, sqlite, queries } = fixture(t, [
    ["TP53", "completed_pending_finalize"],
    ["BRCA1", "reconcile"],
  ])
  let notifications = 0
  const result = await run(async ({ symbols, jobs }) => {
    notifications += 1
    assert.deepEqual(symbols, ["TP53"])
    assert.deepEqual(jobs, [{ gene_symbol: "TP53", job_version: 1 }])
    assert.equal(row().status, "queued")
    return { accepted: true }
  })
  assert.equal(notifications, 1)
  assert.equal(result.finalized, 1)
  assert.equal(result.remaining, 0)
  assert.equal(result.broaden_next_drain, false)
  assert.equal(
    sqlite.prepare("SELECT status FROM icono_sync_finalization_jobs WHERE gene_symbol='BRCA1'").get().status,
    "queued",
  )
  assert.ok(queries.every((sql) => !sql.includes("FROM icono_sync_finalization_summary")))
})

test("a deferred handoff retains its exact job version and retry time", async (t) => {
  const { run, row } = fixture(t)
  const retryAt = "2026-09-17T12:05:00.000Z"
  const result = await run(async () => ({ accepted: false, nextAttemptAt: retryAt }))
  assert.equal(result.finalized, 0)
  assert.equal(result.publication_pending, true)
  assert.equal(result.publication_next_attempt_at, retryAt)
  assert.equal(row().status, "queued")
  assert.equal(row().job_version, 1)
})

test("publication failure preserves the pending obligation", async (t) => {
  const { run, row } = fixture(t)
  await assert.rejects(
    run(async () => {
      throw new Error("transport failed")
    }),
    /transport failed/,
  )
  assert.equal(row().status, "queued")
  assert.equal(row().job_version, 1)
})

test("a same-phase superseding version remains pending in the returned receipt", async (t) => {
  const { run, row, sqlite } = fixture(t)
  const result = await run(async () => {
    sqlite.exec(
      "UPDATE icono_sync_finalization_jobs SET job_version=job_version+1 WHERE gene_symbol='TP53'",
    )
    return { accepted: true }
  })
  assert.equal(result.finalized, 0)
  assert.equal(result.remaining, 1)
  assert.equal(result.ready_remaining, 1)
  assert.equal(result.publication_pending, true)
  assert.equal(row().job_version, 2)
})

test("a superseding earlier phase cannot be acknowledged by an older handoff", async (t) => {
  const { run, row, sqlite } = fixture(t)
  const result = await run(async () => {
    sqlite.exec(
      "UPDATE icono_sync_finalization_jobs SET job_version=job_version+1,phase='reconcile' WHERE gene_symbol='TP53'",
    )
    return { accepted: true }
  })
  assert.equal(result.finalized, 0)
  assert.equal(result.remaining, 1)
  assert.equal(row().phase, "reconcile")
  assert.equal(row().job_version, 2)
})

test("unfinished phases within the requested scope are not reported complete", async (t) => {
  const { run } = fixture(t, [["TP53", "reconcile"]])
  const result = await run(() => assert.fail("unfinished phase reached publication"))
  assert.equal(result.finalized, 0)
  assert.equal(result.remaining, 1)
  assert.equal(result.ready_remaining, 0)
  assert.equal(result.broaden_next_drain, false)
})

test("an accepted scoped handoff is a write-free and publication-free replay", async (t) => {
  const { run, row, queries } = fixture(t)
  const first = await run(async () => ({ accepted: true }))
  assert.equal(first.finalized, 1)
  const version = row().job_version
  queries.length = 0
  const repeat = await run(() => assert.fail("completed operation was published again"))
  assert.equal(repeat.finalized, 0)
  assert.equal(repeat.remaining, 0)
  assert.equal(row().job_version, version)
  assert.ok(queries.every((sql) => !/\bUPDATE\b/.test(sql)))
})
