import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { IconoplasmVoteCoordinator } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// B-762 reader-view handoff: the vote authority persists the verified receipt
// before advertising it, retries on its own alarm, and recovers a crash
// between local publication and the shared projection.

class DurableObjectSqlForTest {
  constructor() {
    this.db = new DatabaseSync(":memory:")
  }

  exec(sql, ...bindings) {
    const source = String(sql || "")
    let rows = []
    if (bindings.length) {
      rows = this.db.prepare(source).all(...bindings)
    } else if (/^\s*(SELECT|PRAGMA|WITH)\b/i.test(source) && !source.trim().includes(";")) {
      rows = this.db.prepare(source).all()
    } else {
      this.db.exec(source)
    }
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

async function seeded(t) {
  const { state, sql } = fakeState()
  t.after(() => sql.db.close())
  const coordinator = new IconoplasmVoteCoordinator(state, {})
  await state.ready
  coordinator.setMeta("symbol", "TP53")
  coordinator.setMeta("bootstrapped", "1")
  coordinator.importGeneCandidateAuthority([
    { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
  ])
  coordinator.setMeta("published_asset_sha256", sha("a"))
  coordinator.ensureAssetSummaryRow(sha("a"), { visionId: "anima-v1-9" })
  await coordinator.publication.seedPublished(coordinator.authoritativeSelectionIdentity(), {
    contentSha256: sha("e"),
    objectKey: `published-cards/v2/immutable/cards/${sha("e")}.json`,
  })
  coordinator.setMeta("authority_epoch", "v2")
  coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" })
  coordinator.importGeneCandidateAuthority([
    { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
    { asset_sha256: sha("b"), status: "approved", autopick_eligible: 1 },
  ])
  return { coordinator, state, sql }
}

function verifiedPublication(ticket) {
  return {
    selectionKey: ticket.selectionKey,
    contentSha256: sha("f"),
    objectKey: `published-cards/v2/immutable/cards/${sha("f")}.json`,
    projections: {
      gene: { key: `published-cards/v2/immutable/genes/${sha("b")}.json`, hash: sha("b") },
      portrait: {
        key: `published-cards/v2/immutable/portraits/${sha("c")}.json`,
        hash: sha("c"),
      },
    },
  }
}

function fakeCoordinatorBinding(requests, { ok = true, status = 200 } = {}) {
  return {
    idFromName: (name) => name,
    get: () => ({
      async fetch(url, init) {
        requests.push({ path: new URL(url).pathname, body: JSON.parse(init.body) })
        if (!ok) return Response.json({ ok: false, error: "unavailable" }, { status })
        return Response.json({ ok: true, accepted: true, replayed: false, seq: 1 })
      },
    }),
  }
}

async function publishWinningVote(coordinator) {
  await coordinator.applyAuthoritativeVoteMutation({
    assetSha256: sha("b"),
    userId: "reader-1",
    requestedVoteValue: 1,
    ensuredAsset: coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" }),
  })
  coordinator.genePublicationAdapter = () => async (ticket) => verifiedPublication(ticket)
  const result = await coordinator.drainGenePublication({})
  assert.equal(result.applied, true)
}

test("verified receipts persist as a durable handoff and deliver to the view owner", async (t) => {
  const { coordinator, sql } = await seeded(t)
  await publishWinningVote(coordinator)
  const row = sql.db
    .prepare(`SELECT symbol, version, selection_key, delivered_at FROM publication_handoffs`)
    .get()
  assert.equal(row.symbol, "TP53")
  assert.equal(row.version, 2)
  assert.equal(row.delivered_at, null)

  const requests = []
  const drained = await coordinator.drainReaderHandoffs({
    ICONOPLASM_CARD_PUBLICATION: fakeCoordinatorBinding(requests),
  })
  assert.equal(drained.delivered, 1)
  assert.equal(drained.pending, 0)
  assert.equal(requests[0].path, "/commit-gene-version")
  assert.deepEqual(requests[0].body, {
    symbol: "TP53",
    version: 2,
    selection_key: row.selection_key,
    withdrawn: false,
    card: { key: `published-cards/v2/immutable/cards/${sha("f")}.json`, hash: sha("f") },
    gene: { key: `published-cards/v2/immutable/genes/${sha("b")}.json`, hash: sha("b") },
    portrait: {
      key: `published-cards/v2/immutable/portraits/${sha("c")}.json`,
      hash: sha("c"),
    },
  })
})

test("a failed handoff keeps the durable row and retries with backoff", async (t) => {
  const { coordinator, sql } = await seeded(t)
  await publishWinningVote(coordinator)
  const requests = []
  const failed = await coordinator.drainReaderHandoffs({
    ICONOPLASM_CARD_PUBLICATION: fakeCoordinatorBinding(requests, { ok: false, status: 503 }),
  })
  assert.equal(failed.delivered, 0)
  assert.equal(failed.pending, 1)
  const row = sql.db
    .prepare(`SELECT attempts, next_attempt_at, delivered_at FROM publication_handoffs`)
    .get()
  assert.equal(row.attempts, 1)
  assert.ok(row.next_attempt_at > Date.now())
  assert.equal(row.delivered_at, null)
})

test("a crash between publication and projection re-enqueues from the published artifact", async (t) => {
  const { coordinator, state, sql } = await seeded(t)
  await publishWinningVote(coordinator)
  sql.db.exec(`DELETE FROM publication_handoffs`)
  const restarted = new IconoplasmVoteCoordinator(state, {})
  await state.ready
  const recovered = sql.db.prepare(`SELECT version, delivered_at FROM publication_handoffs`).get()
  assert.equal(recovered.version, 2)
  assert.equal(recovered.delivered_at, null)
  const requests = []
  const drained = await restarted.drainReaderHandoffs({
    ICONOPLASM_CARD_PUBLICATION: fakeCoordinatorBinding(requests),
  })
  assert.equal(drained.delivered, 1)
  assert.equal(requests[0].body.version, 2)
})

test("one alarm publishes the winner and hands it to the reader view owner", async (t) => {
  const { coordinator } = await seeded(t)
  await coordinator.applyAuthoritativeVoteMutation({
    assetSha256: sha("b"),
    userId: "reader-2",
    requestedVoteValue: 1,
    ensuredAsset: coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" }),
  })
  coordinator.genePublicationAdapter = () => async (ticket) => verifiedPublication(ticket)
  const requests = []
  coordinator.env = { ICONOPLASM_CARD_PUBLICATION: fakeCoordinatorBinding(requests) }
  const result = await coordinator.alarm()
  assert.equal(result.publication.applied, true)
  assert.equal(result.handoff.delivered, 1)
  assert.equal(requests.length, 1)
})
