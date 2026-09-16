import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { IconoplasmVoteCoordinator } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// B-762 per-gene vote authority: the coordinator owns its own gene's selection
// intent and publication wake. These tests exercise the integrated storage
// transaction, the shared alarm and the publication fencing; the immutable
// Bunny adapter is injected (no network) so the real adapter can land without
// rewriting these invariants.

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

function fakeCoordinatorState() {
  const sql = new DurableObjectSqlForTest()
  let alarm = null
  let alarmWrites = 0
  let failAlarm = false
  let transactionTail = Promise.resolve()
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
    transaction(fn) {
      const run = transactionTail.then(async () => {
        const before = alarm
        sql.db.exec("BEGIN IMMEDIATE")
        try {
          const result = await fn(storage)
          sql.db.exec("COMMIT")
          return result
        } catch (error) {
          sql.db.exec("ROLLBACK")
          alarm = before
          throw error
        }
      })
      transactionTail = run.catch(() => {})
      return run
    },
    async getAlarm() {
      return alarm
    },
    async setAlarm(value) {
      if (failAlarm) throw new Error("alarm storage unavailable")
      alarm = value
      alarmWrites += 1
    },
  }
  const state = {
    storage,
    blockConcurrencyWhile(callback) {
      this.ready = Promise.resolve().then(callback)
      return this.ready
    },
  }
  return {
    state,
    sql,
    storage,
    alarm: () => alarm,
    setAlarm: (value) => {
      alarm = value
    },
    alarmWrites: () => alarmWrites,
    failAlarm: (value) => {
      failAlarm = value
    },
  }
}

const SYMBOL = "TP53"
const sha = (char) => char.repeat(64)
const uploadedFor = (ticket) => ({
  selectionKey: ticket.selectionKey,
  contentSha256: sha("f"),
  objectKey: `published-cards/v2/immutable/cards/${sha("f")}.json`,
})

async function newCoordinator(t) {
  const fixture = fakeCoordinatorState()
  const coordinator = new IconoplasmVoteCoordinator(fixture.state, {})
  await fixture.state.ready
  t.after(() => fixture.sql.db.close())
  coordinator.setMeta("symbol", SYMBOL)
  coordinator.setMeta("bootstrapped", "1")
  return { coordinator, ...fixture }
}

function importCandidates(coordinator, rows) {
  return coordinator.importGeneCandidateAuthority(rows)
}

async function seedAuthority(
  coordinator,
  { publishedAssetSha, winnerCandidateRows, adminOverride = false },
) {
  importCandidates(coordinator, winnerCandidateRows)
  coordinator.setMeta("published_asset_sha256", publishedAssetSha)
  coordinator.setMeta("admin_override", adminOverride ? "1" : "0")
  await coordinator.publication.seedPublished(coordinator.authoritativeSelectionIdentity(), {
    contentSha256: sha("e"),
    objectKey: `published-cards/v2/immutable/cards/${sha("e")}.json`,
  })
  coordinator.setMeta("authority_epoch", "v2")
}

function voteOptions(coordinator, assetSha, { userId = "user-1", value = 1, visionId = "" } = {}) {
  return {
    assetSha256: assetSha,
    userId,
    requestedVoteValue: value,
    ensuredAsset: coordinator.ensureAssetSummaryRow(assetSha, { visionId }),
  }
}

test("a legacy gene's first canonical command demand-drives its handover without a legacy outbox write", async (t) => {
  const { coordinator } = await newCoordinator(t)
  const outcome = await coordinator.applyAuthoritativeVoteMutation(
    voteOptions(coordinator, sha("a"), { visionId: "anima-v1-9" }),
  )
  assert.equal(outcome.authority, "v2")
  assert.equal(outcome.publication.state.pending, true)
  assert.equal(coordinator.getMeta("authority_epoch"), "v2")
  assert.equal(coordinator.pendingOutboxRows(1).length, 0)
})

test("authority transfer refuses while the legacy outbox is unsettled", async (t) => {
  const { coordinator, sql } = await newCoordinator(t)
  importCandidates(coordinator, [
    { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
  ])
  sql.db
    .prepare(
      `INSERT INTO vote_outbox (mutation_id, asset_sha256, user_id, vote_value, reason)
       VALUES (?, ?, ?, 1, ?)`,
    )
    .run("retained:1", sha("a"), "user-1", "accepted legacy vote awaiting delivery")
  const activationPayload = {
    symbol: SYMBOL,
    published_asset_sha256: sha("a"),
    published: {
      content_sha256: sha("e"),
      object_key: `published-cards/v2/immutable/cards/${sha("e")}.json`,
    },
  }
  const blocked = await coordinator.fetch(
    new Request("https://internal/authority/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activationPayload),
    }),
  )
  assert.equal(blocked.status, 409)
  assert.equal((await blocked.json()).code, "OUTBOX_NOT_SETTLED")
  assert.equal(coordinator.getMeta("authority_epoch"), "")

  sql.db.exec(`UPDATE vote_outbox SET delivered_at = CURRENT_TIMESTAMP WHERE delivered_at IS NULL`)
  const activated = await coordinator.fetch(
    new Request("https://internal/authority/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(activationPayload),
    }),
  )
  assert.equal(activated.status, 200)
  assert.equal((await activated.json()).authority_epoch, "v2")
  assert.equal(coordinator.getMeta("authority_epoch"), "v2")
  assert.equal(coordinator.publication.read().pending, false)
})

test("v2 commits vote, selection intent and wake atomically; duplicates stay free", async (t) => {
  const { coordinator } = await newCoordinator(t)
  await seedAuthority(coordinator, {
    publishedAssetSha: sha("a"),
    winnerCandidateRows: [{ asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 }],
  })
  coordinator.ensureAssetSummaryRow(sha("a"), { visionId: "anima-v1-9" })
  coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" })

  const unchanged = await coordinator.applyAuthoritativeVoteMutation(
    voteOptions(coordinator, sha("a"), { visionId: "anima-v1-9" }),
  )
  assert.equal(unchanged.authority, "v2")
  assert.equal(unchanged.vote.changed, true)
  assert.equal(unchanged.publication.changed, false)
  assert.equal(coordinator.publication.read().pending, false)

  importCandidates(coordinator, [
    { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
    { asset_sha256: sha("b"), status: "approved", autopick_eligible: 1 },
  ])
  // A score tie keeps the currently published asset, so the first B vote is
  // content-neutral for publication.
  const tied = await coordinator.applyAuthoritativeVoteMutation(
    voteOptions(coordinator, sha("b"), { userId: "user-2", visionId: "anima-v1-8" }),
  )
  assert.equal(tied.publication.changed, false)
  const flip = await coordinator.applyAuthoritativeVoteMutation(
    voteOptions(coordinator, sha("b"), { userId: "user-3", visionId: "anima-v1-8" }),
  )
  assert.equal(flip.publication.changed, true)
  const pending = coordinator.publication.read()
  assert.equal(pending.pending, true)
  assert.equal(pending.desiredVersion, 2)

  const duplicate = await coordinator.applyAuthoritativeVoteMutation(
    voteOptions(coordinator, sha("b"), { userId: "user-3", visionId: "anima-v1-8" }),
  )
  assert.equal(duplicate.publication.changed, false)
  assert.equal(coordinator.publication.read().desiredVersion, 2)
})

test("an alarm failure rolls back the v2 vote and its selection intent", async (t) => {
  const { coordinator, sql, failAlarm } = await newCoordinator(t)
  await seedAuthority(coordinator, {
    publishedAssetSha: sha("a"),
    winnerCandidateRows: [
      { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
      { asset_sha256: sha("b"), status: "approved", autopick_eligible: 1 },
    ],
  })
  coordinator.ensureAssetSummaryRow(sha("a"), { visionId: "anima-v1-9" })
  coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" })
  failAlarm(true)
  await assert.rejects(
    coordinator.applyAuthoritativeVoteMutation(
      voteOptions(coordinator, sha("b"), { userId: "user-2", visionId: "anima-v1-8" }),
    ),
    /alarm storage unavailable/,
  )
  assert.equal(
    sql.db
      .prepare(`SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE asset_sha256 = ?`)
      .get(sha("b")).n,
    0,
  )
  assert.equal(coordinator.publication.read().desiredVersion, 1)
  assert.equal(coordinator.publication.read().pending, false)
})

test("a healthy gene publishes through its adapter while a sick gene stays dirty", async (t) => {
  const healthy = await newCoordinator(t)
  await seedAuthority(healthy.coordinator, {
    publishedAssetSha: sha("a"),
    winnerCandidateRows: [
      { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
      { asset_sha256: sha("b"), status: "approved", autopick_eligible: 1 },
    ],
  })
  healthy.coordinator.ensureAssetSummaryRow(sha("a"), { visionId: "anima-v1-9" })
  healthy.coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" })
  await healthy.coordinator.applyAuthoritativeVoteMutation(
    voteOptions(healthy.coordinator, sha("b"), { userId: "user-2", visionId: "anima-v1-8" }),
  )

  const unwired = await healthy.coordinator.drainGenePublication({})
  assert.equal(unwired.reason, "publication_adapter_pending")
  assert.equal(healthy.coordinator.publication.read().attemptId, 0)

  healthy.coordinator.genePublicationAdapter = () => async (ticket) => uploadedFor(ticket)
  const completed = await healthy.coordinator.drainGenePublication({})
  assert.equal(completed.ok, true)
  assert.equal(completed.applied, true)
  assert.equal(healthy.coordinator.publication.read().pending, false)
  assert.equal(healthy.coordinator.getMeta("published_asset_sha256"), sha("b"))

  const sick = await newCoordinator(t)
  await seedAuthority(sick.coordinator, {
    publishedAssetSha: sha("a"),
    winnerCandidateRows: [
      { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
      { asset_sha256: sha("b"), status: "approved", autopick_eligible: 1 },
    ],
  })
  sick.coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" })
  await sick.coordinator.applyAuthoritativeVoteMutation(
    voteOptions(sick.coordinator, sha("b"), { userId: "user-3", visionId: "anima-v1-8" }),
  )
  sick.coordinator.genePublicationAdapter = () => async () => {
    throw new Error("immutable storage unavailable")
  }
  const failed = await sick.coordinator.drainGenePublication({})
  assert.equal(failed.ok, false)
  assert.equal(sick.coordinator.publication.read().pending, true)
  assert.ok(failed.retry_at > Date.now())
  assert.equal(healthy.coordinator.publication.read().pending, false)
})

test("an administrator override pins the published asset instead of the vote leader", async (t) => {
  const { coordinator } = await newCoordinator(t)
  await seedAuthority(coordinator, {
    publishedAssetSha: sha("a"),
    winnerCandidateRows: [
      { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
      { asset_sha256: sha("b"), status: "approved", autopick_eligible: 1 },
    ],
    adminOverride: true,
  })
  coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" })
  const outcome = await coordinator.applyAuthoritativeVoteMutation(
    voteOptions(coordinator, sha("b"), { userId: "user-4", visionId: "anima-v1-8" }),
  )
  assert.equal(outcome.publication.changed, false)
  const status = await coordinator.fetch(
    new Request("https://internal/publication/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: SYMBOL }),
    }),
  )
  const state = await status.json()
  assert.equal(state.winner_asset_sha256, sha("a"))
  assert.equal(state.publication.pending, false)
})
