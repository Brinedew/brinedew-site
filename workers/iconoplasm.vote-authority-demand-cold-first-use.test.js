import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { IconoplasmVoteCoordinator } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

class SqlForTest {
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

function stateFixture() {
  const sql = new SqlForTest()
  let alarm = null
  let tail = Promise.resolve()
  const storage = {
    sql,
    transactionSync(fn) {
      sql.db.exec("BEGIN IMMEDIATE")
      try {
        const value = fn()
        sql.db.exec("COMMIT")
        return value
      } catch (error) {
        sql.db.exec("ROLLBACK")
        throw error
      }
    },
    transaction(fn) {
      const run = tail.then(async () => {
        const before = alarm
        sql.db.exec("BEGIN IMMEDIATE")
        try {
          const value = await fn(storage)
          sql.db.exec("COMMIT")
          return value
        } catch (error) {
          sql.db.exec("ROLLBACK")
          alarm = before
          throw error
        }
      })
      tail = run.catch(() => {})
      return run
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
    blockConcurrencyWhile(fn) {
      this.ready = Promise.resolve().then(fn)
      return this.ready
    },
  }
  return { state, sql }
}

const sha = (char) => char.repeat(64)

function retainedLegacyD1(symbol) {
  const asset = {
    asset_sha256: sha("a"),
    vision_id: "anima-v1-9",
    candidate_image_id: 7,
    status: "approved",
    autopick_eligible: 1,
    is_stale: 0,
    is_legacy: 0,
    created_at: "2026-09-01T00:00:00Z",
  }
  const vote = {
    user_id: "legacy-user",
    asset_sha256: sha("a"),
    vision_id: "anima-v1-9",
    candidate_image_id: 7,
    vote_value: 1,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  }
  return {
    prepare(sql) {
      const source = String(sql || "")
      return {
        bind(...bindings) {
          return {
            async all() {
              if (String(bindings[0] || "") !== symbol) return { results: [] }
              if (source.includes("FROM icono_portrait_assets")) return { results: [asset] }
              if (source.includes("FROM icono_image_votes"))
                return { results: bindings.length > 2 ? [] : [vote] }
              return { results: [] }
            },
            async first() {
              if (String(bindings[0] || "") !== symbol) return null
              if (source.includes("FROM icono_portrait_assets")) return asset
              return null
            },
            async run() {
              return { success: true }
            },
          }
        },
      }
    },
  }
}

function post(coordinator, path, body) {
  return coordinator.fetch(
    new Request(`https://internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

test("cold ordinary first mutation reconstructs retained candidate authority without test-side seeding", async (t) => {
  const symbol = "TP53"
  const { state, sql } = stateFixture()
  t.after(() => sql.db.close())
  const coordinator = new IconoplasmVoteCoordinator(state, {
    ICONOPLASM_DB: retainedLegacyD1(symbol),
  })
  await state.ready
  coordinator.setMeta("symbol", symbol)
  // This is retained legacy policy, not v2 candidate preparation. Production
  // first use must reconcile the bounded candidate authority itself.
  coordinator.setMeta("published_asset_sha256", sha("a"))

  assert.equal(
    coordinator.sqlFirst("SELECT COUNT(*) AS n FROM gene_candidate_authority").n,
    0,
    "setup must not pre-seed v2 candidate authority",
  )

  const response = await post(coordinator, "/vote/set", {
    symbol,
    asset_sha256: sha("a"),
    user_id: "new-user",
    vote_value: 1,
    vision_id: "anima-v1-9",
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.authority, "v2")

  const statusResponse = await post(coordinator, "/publication/state", { symbol })
  assert.equal(statusResponse.status, 200)
  const status = await statusResponse.json()
  assert.equal(status.authority_epoch, "v2")
  assert.equal(status.winner_asset_sha256, sha("a"), "retained published authority was lost")
  assert.equal(
    status.candidate_count,
    1,
    "cold handover did not reconstruct retained candidate authority",
  )
  assert.equal(
    coordinator.sqlFirst(
      "SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE user_id = ? AND asset_sha256 = ?",
      "legacy-user",
      sha("a"),
    ).n,
    1,
    "accepted retained vote did not survive handover",
  )
  assert.equal(
    coordinator.sqlFirst(
      "SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE user_id = ? AND asset_sha256 = ?",
      "new-user",
      sha("a"),
    ).n,
    1,
    "original first command did not execute after handover",
  )
})

function countingLegacyD1(symbol) {
  const inner = retainedLegacyD1(symbol)
  const counters = { envelopeReads: 0 }
  return {
    counters,
    prepare(sql) {
      const source = String(sql || "")
      // The envelope read is the only retained-source query with a LIMIT; the
      // cold bootstrap asset query does not bound its rows.
      const envelope = /FROM icono_portrait_assets[\s\S]*LIMIT/.test(source)
      const prepared = inner.prepare(sql)
      return {
        bind(...bindings) {
          const bound = prepared.bind(...bindings)
          return {
            async all() {
              if (envelope) counters.envelopeReads += 1
              return bound.all()
            },
            async first() {
              return bound.first()
            },
            async run() {
              return bound.run()
            },
          }
        },
      }
    },
  }
}

test("a warm-but-empty coordinator reconstructs candidate authority on the first canonical command", async (t) => {
  const symbol = "TP53"
  const { state, sql } = stateFixture()
  t.after(() => sql.db.close())
  const d1 = countingLegacyD1(symbol)
  const coordinator = new IconoplasmVoteCoordinator(state, { ICONOPLASM_DB: d1 })
  await state.ready
  coordinator.setMeta("symbol", symbol)

  // The ordinary gene page renders vote boxes with this batched snapshot read.
  // It marks the coordinator bootstrapped without creating candidate authority,
  // which is exactly the warm first-use state the demand handover must handle.
  const snapshots = await post(coordinator, "/vote/snapshots", {
    items: [{ symbol, asset_sha256: sha("a"), vision_id: "anima-v1-9" }],
  })
  assert.equal(snapshots.status, 200)
  assert.equal(coordinator.getMeta("bootstrapped"), "1")
  assert.equal(
    coordinator.sqlFirst("SELECT COUNT(*) AS n FROM gene_candidate_authority").n,
    0,
    "the snapshot read must not fabricate candidate authority",
  )

  const response = await post(coordinator, "/vote/set", {
    symbol,
    asset_sha256: sha("a"),
    user_id: "new-user",
    vote_value: 1,
    vision_id: "anima-v1-9",
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).authority, "v2")
  const status = await (await post(coordinator, "/publication/state", { symbol })).json()
  assert.equal(status.authority_epoch, "v2")
  assert.equal(status.winner_asset_sha256, sha("a"), "retained published authority was lost")
  assert.equal(
    status.candidate_count,
    1,
    "warm first use skipped retained candidate reconstruction",
  )
  assert.equal(d1.counters.envelopeReads, 1)

  const repeat = await post(coordinator, "/vote/set", {
    symbol,
    asset_sha256: sha("a"),
    user_id: "new-user",
    vote_value: 1,
    vision_id: "anima-v1-9",
  })
  assert.equal(repeat.status, 200)
  assert.equal(d1.counters.envelopeReads, 1, "the warm path must stay D1-free after reconstruction")
})

test("an activated v2 gene with empty candidate authority repairs once and advances the selection", async (t) => {
  const symbol = "TP53"
  const { state, sql } = stateFixture()
  t.after(() => sql.db.close())
  const d1 = countingLegacyD1(symbol)
  const coordinator = new IconoplasmVoteCoordinator(state, { ICONOPLASM_DB: d1 })
  await state.ready
  coordinator.setMeta("symbol", symbol)
  coordinator.setMeta("bootstrapped", "1")
  coordinator.setMeta("authority_epoch", "v2")
  assert.equal(coordinator.sqlFirst("SELECT COUNT(*) AS n FROM gene_candidate_authority").n, 0)

  const response = await post(coordinator, "/vote/set", {
    symbol,
    asset_sha256: sha("a"),
    user_id: "new-user",
    vote_value: 1,
    vision_id: "anima-v1-9",
  })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).authority, "v2")
  const status = await (await post(coordinator, "/publication/state", { symbol })).json()
  assert.equal(status.authority_epoch, "v2")
  assert.equal(status.candidate_count, 1, "activated v2 gene stayed permanently candidate-less")
  assert.equal(status.winner_asset_sha256, sha("a"))
  assert.equal(d1.counters.envelopeReads, 1)

  const repeat = await post(coordinator, "/vote/set", {
    symbol,
    asset_sha256: sha("a"),
    user_id: "new-user",
    vote_value: 1,
    vision_id: "anima-v1-9",
  })
  assert.equal(repeat.status, 200)
  assert.equal(d1.counters.envelopeReads, 1, "the warm path must stay D1-free after reconstruction")
})
