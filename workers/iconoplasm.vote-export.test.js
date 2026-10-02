import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { IconoplasmVoteCoordinator } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// B-898 Stage 2, step 1: export every vote a gene's coordinator holds, so D1
// becomes the one copy before the coordinator is deleted. Failure modes
// written before the code:
// 1. a coordinator that was never bootstrapped answers {bootstrapped: false}
//    and reads nothing from D1 (the export must never trigger a bootstrap);
// 2. a bootstrapped v2 gene answers its meta, every per-user vote row and
//    every asset summary, exactly as stored;
// 3. the route is GET only.
class DurableObjectSqlForTest {
  constructor() {
    this.db = new DatabaseSync(":memory:")
  }
  exec(sql, ...bindings) {
    const source = String(sql || "")
    let rows = []
    if (bindings.length) rows = this.db.prepare(source).all(...bindings)
    else if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(source) && !source.trim().includes(";"))
      rows = this.db.prepare(source).all()
    else this.db.exec(source)
    return { toArray: () => rows }
  }
}

function fakeState() {
  const sql = new DurableObjectSqlForTest()
  let alarm = null
  const storage = {
    sql,
    transactionSync(callback) {
      sql.db.exec("BEGIN IMMEDIATE")
      try {
        const result = callback()
        sql.db.exec("COMMIT")
        return result
      } catch (error) {
        sql.db.exec("ROLLBACK")
        throw error
      }
    },
    async transaction(fn) {
      sql.db.exec("BEGIN IMMEDIATE")
      try {
        const result = await fn(storage)
        sql.db.exec("COMMIT")
        return result
      } catch (error) {
        sql.db.exec("ROLLBACK")
        throw error
      }
    },
    async getAlarm() {
      return alarm
    },
    async setAlarm(value) {
      alarm = value
    },
  }
  const state = {
    storage,
    blockConcurrencyWhile(callback) {
      this.ready = Promise.resolve().then(callback)
      return this.ready
    },
  }
  return { state, sql }
}

const sha = (char) => char.repeat(64)

function throwingDb() {
  return {
    prepare() {
      throw new Error("the export must not read D1")
    },
  }
}

async function coordinatorFor(t, { bootstrapped }) {
  const { state, sql } = fakeState()
  t.after(() => sql.db.close())
  const coordinator = new IconoplasmVoteCoordinator(state, { ICONOPLASM_DB: throwingDb() })
  await state.ready
  if (bootstrapped) {
    coordinator.setMeta("symbol", "TP53")
    coordinator.setMeta("bootstrapped", "1")
    coordinator.setMeta("authority_epoch", "v2")
    coordinator.setMeta("published_asset_sha256", sha("a"))
    coordinator.setMeta("admin_override", "0")
    sql.db
      .prepare(
        `INSERT INTO vote_by_user_asset (user_id, asset_sha256, vision_id, candidate_image_id, vote_value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("reader-1", sha("a"), "anima-v1-9", 42, 1, "2026-09-20 10:00:00", "2026-09-20 10:00:00")
    sql.db
      .prepare(
        `INSERT INTO vote_by_user_asset (user_id, asset_sha256, vision_id, candidate_image_id, vote_value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        "reader-2",
        sha("b"),
        "anima-v1-8",
        null,
        -1,
        "2026-09-21 10:00:00",
        "2026-09-21 11:00:00",
      )
    coordinator.ensureAssetSummaryRow(sha("a"), { visionId: "anima-v1-9" })
    sql.db
      .prepare(
        `UPDATE asset_summary SET upvotes = 1, score = 1, vote_count = 1 WHERE asset_sha256 = ?`,
      )
      .run(sha("a"))
  }
  return coordinator
}

async function exportFrom(coordinator, method = "GET") {
  const response = await coordinator.fetch(
    new Request("https://coordinator/vote/export", { method }),
  )
  return { status: response.status, body: await response.json().catch(() => null) }
}

test("an unbootstrapped coordinator reports so and reads nothing", async (t) => {
  const coordinator = await coordinatorFor(t, { bootstrapped: false })
  const { status, body } = await exportFrom(coordinator)
  assert.equal(status, 200)
  assert.equal(body.bootstrapped, false)
  assert.deepEqual(body.votes, [])
})

test("a v2 gene exports its meta, every vote row and every summary", async (t) => {
  const coordinator = await coordinatorFor(t, { bootstrapped: true })
  const { status, body } = await exportFrom(coordinator)
  assert.equal(status, 200)
  assert.equal(body.bootstrapped, true)
  assert.equal(body.symbol, "TP53")
  assert.equal(body.authority_epoch, "v2")
  assert.equal(body.published_asset_sha256, sha("a"))
  assert.equal(body.admin_override, false)
  assert.deepEqual(
    body.votes.map((v) => [
      v.user_id,
      v.asset_sha256.slice(0, 1),
      v.vote_value,
      v.vision_id,
      v.candidate_image_id,
      v.updated_at,
    ]),
    [
      ["reader-1", "a", 1, "anima-v1-9", 42, "2026-09-20 10:00:00"],
      ["reader-2", "b", -1, "anima-v1-8", null, "2026-09-21 11:00:00"],
    ],
  )
  assert.equal(body.asset_summaries.length, 1)
  assert.equal(body.asset_summaries[0].upvotes, 1)
  assert.equal(body.asset_summaries[0].asset_sha256, sha("a"))
})

test("the export is GET only", async (t) => {
  const coordinator = await coordinatorFor(t, { bootstrapped: true })
  assert.equal((await exportFrom(coordinator, "POST")).status, 404)
})
