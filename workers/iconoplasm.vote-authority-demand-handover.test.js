import assert from "node:assert/strict"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"

import { IconoplasmVoteCoordinator } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// B-762 connected demand-driven handover: one healthy gene completes its
// legacy->v2 handover inside the ordinary canonical-affecting command path
// while an unrelated gene stays unmigrated, with deferral/restart replay and
// explicit empty-state behavior. These tests exercise the real coordinator
// handler and its storage transaction; the immutable Bunny adapter is injected
// (no network).

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
    alarmWrites: () => alarmWrites,
    setAlarm: (value) => {
      alarm = value
    },
  }
}

/**
 * Minimal legacy D1 stand-in for the exact queries the coordinator issues:
 * icono_portrait_assets / icono_image_votes reads and the keyset-paginated
 * double-pass source verification.
 */
function fakeLegacyD1(genes) {
  return {
    prepare(sql) {
      const source = String(sql || "")
      return {
        bind(...bindings) {
          return {
            async all() {
              const symbol = String(bindings[0] || "")
              const state = genes.get(symbol) || { assets: [], votes: [] }
              if (source.includes("FROM icono_portrait_assets")) {
                return { results: state.assets }
              }
              if (source.includes("FROM icono_image_votes")) {
                // The cursor page (five bindings) is a continuation; these
                // fixtures fit in one page, so it is empty.
                if (bindings.length > 2) return { results: [] }
                return { results: state.votes }
              }
              return { results: [] }
            },
            first() {
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

const sha = (char) => char.repeat(64)
const uploadedFor = (ticket) => ({
  selectionKey: ticket.selectionKey,
  contentSha256: sha("e"),
  objectKey: `published-cards/v2/immutable/cards/${sha("e")}.json`,
})

async function newCoordinator(t, symbol, env = {}) {
  const fixture = fakeCoordinatorState()
  const coordinator = new IconoplasmVoteCoordinator(fixture.state, env)
  await fixture.state.ready
  t.after(() => fixture.sql.db.close())
  coordinator.setMeta("symbol", symbol)
  return { coordinator, ...fixture }
}

function retainedOutboxRow(assetSha, userId) {
  return [
    `legacy:${assetSha.slice(0, 8)}:${userId}`,
    assetSha,
    userId,
    "accepted legacy vote awaiting delivery",
  ]
}

function post(coordinator, path, payload) {
  return coordinator.fetch(
    new Request(`https://internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  )
}

test("a healthy gene completes demand-driven handover through its canonical command while an unrelated gene stays unmigrated", async (t) => {
  const geneA = "TP53"
  const geneB = "LMNA"
  const d1 = fakeLegacyD1(
    new Map([
      [
        geneA,
        {
          assets: [{ asset_sha256: sha("a"), vision_id: "anima-v1-9", candidate_image_id: 7 }],
          votes: [
            {
              user_id: "user-1",
              asset_sha256: sha("a"),
              vision_id: "anima-v1-9",
              candidate_image_id: 7,
              vote_value: 1,
              created_at: "2026-09-01T00:00:00Z",
              updated_at: "2026-09-01T00:00:00Z",
            },
          ],
        },
      ],
      [geneB, { assets: [], votes: [] }],
    ]),
  )
  const { coordinator } = await newCoordinator(t, geneA, { ICONOPLASM_DB: d1 })
  // Retained candidate authority for gene A; the legacy vote arrives through
  // the bounded bootstrap read, exactly like a cold production coordinator.
  coordinator.importGeneCandidateAuthority([
    { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
  ])

  const response = await post(coordinator, "/vote/set", {
    symbol: geneA,
    asset_sha256: sha("a"),
    user_id: "user-2",
    vote_value: 1,
    vision_id: "anima-v1-9",
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.authority, "v2")
  // The handover verified the retained accepted vote and completed before the
  // command mutated v2 state; the original command then applied under v2.
  assert.equal(coordinator.getMeta("authority_epoch"), "v2")
  assert.equal(coordinator.getMeta("bootstrapped"), "1")
  assert.equal(
    coordinator.sqlFirst(
      `SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE user_id = ? AND asset_sha256 = ?`,
      "user-2",
      sha("a"),
    ).n,
    1,
  )
  assert.equal(
    coordinator.sqlFirst(
      `SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE user_id = ? AND asset_sha256 = ?`,
      "user-1",
      sha("a"),
    ).n,
    1,
  )

  // The new immutable result resolves through the real delivery path.
  coordinator.genePublicationAdapter = () => async (ticket) => uploadedFor(ticket)
  const delivered = await coordinator.drainGenePublication({})
  assert.equal(delivered.ok, true)
  assert.equal(delivered.applied, true)
  const publication = coordinator.publication.read()
  assert.equal(publication.pending, false)
  assert.equal(coordinator.getMeta("published_asset_sha256"), sha("a"))

  // The unrelated gene was never consulted, never activated and never wrote a
  // legacy outbox row: it remains exactly where it was.
  const geneBState = await newCoordinator(t, geneB, { ICONOPLASM_DB: d1 })
  assert.equal(geneBState.coordinator.getMeta("authority_epoch"), "")
  assert.equal(geneBState.coordinator.publication.read(), null)
  assert.equal(geneBState.coordinator.pendingOutboxRows(1).length, 0)
})

test("a pending retained obligation defers the command, then a restart replays the same command exactly once", async (t) => {
  const geneA = "TP53"
  const d1 = fakeLegacyD1(
    new Map([
      [
        geneA,
        {
          assets: [{ asset_sha256: sha("a"), vision_id: "anima-v1-9", candidate_image_id: 7 }],
          votes: [
            {
              user_id: "user-1",
              asset_sha256: sha("a"),
              vision_id: "anima-v1-9",
              candidate_image_id: 7,
              vote_value: 1,
              created_at: "2026-09-01T00:00:00Z",
              updated_at: "2026-09-01T00:00:00Z",
            },
          ],
        },
      ],
    ]),
  )
  const first = await newCoordinator(t, geneA, { ICONOPLASM_DB: d1 })
  first.coordinator.importGeneCandidateAuthority([
    { asset_sha256: sha("a"), status: "approved", autopick_eligible: 1 },
  ])
  const [mutationId, assetSha, userId, reason] = retainedOutboxRow(sha("a"), "user-1")
  first.sql.db
    .prepare(
      `INSERT INTO vote_outbox (mutation_id, asset_sha256, user_id, vote_value, reason)
       VALUES (?, ?, ?, 1, ?)`,
    )
    .run(mutationId, assetSha, userId, reason)

  const command = {
    symbol: geneA,
    asset_sha256: sha("a"),
    user_id: "user-2",
    vote_value: 1,
    vision_id: "anima-v1-9",
  }
  const deferred = await post(first.coordinator, "/vote/set", command)
  assert.equal(deferred.status, 409)
  const deferredBody = await deferred.json()
  assert.equal(deferredBody.code, "OUTBOX_NOT_SETTLED")
  assert.equal(deferredBody.retryable, true)
  // Nothing was applied and no legacy fallback ran.
  assert.equal(first.coordinator.getMeta("authority_epoch"), "")
  assert.equal(
    first.coordinator.sqlFirst(
      `SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE user_id = ?`,
      "user-2",
    ).n,
    0,
  )

  // The retained obligation reaches its destination, then the coordinator
  // restarts over the same durable storage and the same command is replayed.
  first.sql.db.exec(
    `UPDATE vote_outbox SET delivered_at = CURRENT_TIMESTAMP WHERE delivered_at IS NULL`,
  )
  const restarted = new IconoplasmVoteCoordinator(first.state, { ICONOPLASM_DB: d1 })
  await first.state.ready
  const replayed = await post(restarted, "/vote/set", command)
  assert.equal(replayed.status, 200)
  assert.equal((await replayed.json()).authority, "v2")
  assert.equal(restarted.getMeta("authority_epoch"), "v2")
  assert.equal(
    first.coordinator.sqlFirst(
      `SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE user_id = ? AND asset_sha256 = ?`,
      "user-2",
      sha("a"),
    ).n,
    1,
  )
  // A second replay is content-neutral for publication and does not duplicate
  // accepted state.
  const secondReplay = await post(restarted, "/vote/set", command)
  assert.equal(secondReplay.status, 200)
  const secondBody = await secondReplay.json()
  assert.equal(secondBody.authority, "v2")
  assert.equal(
    first.coordinator.sqlFirst(
      `SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE user_id = ? AND asset_sha256 = ?`,
      "user-2",
      sha("a"),
    ).n,
    1,
  )
})

test("a gene with no eligible candidate handovers to an explicit empty state and accepts its first valid candidate later", async (t) => {
  const gene = "TP53"
  const d1 = fakeLegacyD1(new Map([[gene, { assets: [], votes: [] }]]))
  const { coordinator } = await newCoordinator(t, gene, { ICONOPLASM_DB: d1 })

  const response = await post(coordinator, "/vote/set", {
    symbol: gene,
    asset_sha256: sha("c"),
    user_id: "user-9",
    vote_value: 1,
    vision_id: "anima-v1-1",
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.authority, "v2")
  assert.equal(coordinator.getMeta("authority_epoch"), "v2")
  // The gene is explicitly covered with a pending empty/tombstone publication
  // identity, not silently excluded from v2.
  const emptyPublication = coordinator.publication.read()
  assert.ok(emptyPublication)
  assert.equal(emptyPublication.pending, true)
  assert.equal(emptyPublication.desiredVersion, 1)
  assert.equal(
    coordinator.sqlFirst(
      `SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE user_id = ? AND asset_sha256 = ?`,
      "user-9",
      sha("c"),
    ).n,
    1,
  )

  // The first valid candidate arrives after activation and elects normally.
  const candidates = await post(coordinator, "/authority/candidates", {
    symbol: gene,
    items: [{ asset_sha256: sha("c"), status: "approved", autopick_eligible: 1 }],
  })
  assert.equal(candidates.status, 200)
  const status = await post(coordinator, "/publication/state", { symbol: gene })
  assert.equal(status.status, 200)
  const state = await status.json()
  assert.equal(state.authority_epoch, "v2")
  assert.equal(state.winner_asset_sha256, sha("c"))
})

test("an oversized retained candidate source defers the handover instead of certifying a truncated snapshot", async (t) => {
  const gene = "TP53"
  const boundedVotes = [
    {
      user_id: "user-1",
      asset_sha256: sha("a"),
      vision_id: "anima-v1-9",
      candidate_image_id: 7,
      vote_value: 1,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
    {
      user_id: "user-2",
      asset_sha256: sha("a"),
      vision_id: "anima-v1-9",
      candidate_image_id: 7,
      vote_value: 1,
      created_at: "2026-09-01T00:00:00Z",
      updated_at: "2026-09-01T00:00:00Z",
    },
  ]
  // The bootstrap read is bounded, but the migration-only keyset source is
  // larger than the bounded envelope: every page is full, so the snapshot can
  // never certify completeness. The handover must refuse rather than truncate.
  let page = 0
  const d1 = {
    prepare(sql) {
      const source = String(sql || "")
      return {
        bind(...bindings) {
          return {
            async all() {
              if (source.includes("FROM icono_portrait_assets")) {
                return {
                  results: [
                    { asset_sha256: sha("a"), vision_id: "anima-v1-9", candidate_image_id: 7 },
                  ],
                }
              }
              if (source.includes("FROM icono_image_votes")) {
                if (bindings.length > 1) {
                  page += 1
                  return {
                    results: Array.from({ length: 500 }, (_, index) => ({
                      user_id: `u${page}x${index}`,
                      asset_sha256: sha("a"),
                      vote_value: 1,
                    })),
                  }
                }
                return { results: boundedVotes }
              }
              return { results: [] }
            },
            first() {
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
  const { coordinator } = await newCoordinator(t, gene, { ICONOPLASM_DB: d1 })

  const response = await post(coordinator, "/vote/set", {
    symbol: gene,
    asset_sha256: sha("a"),
    user_id: "new-user",
    vote_value: 1,
    vision_id: "anima-v1-9",
  })
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.code, "SOURCE_CHECK_FAILED")
  assert.equal(body.retryable, true)
  // Nothing was truncated, nothing was applied, and the gene was not activated
  // against a partial snapshot; the same command replays once the source fits.
  assert.equal(coordinator.getMeta("authority_epoch"), "")
  assert.equal(coordinator.publication.read(), null)
  assert.equal(coordinator.pendingOutboxRows(1).length, 0)
  assert.equal(
    coordinator.sqlFirst(
      `SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE user_id = ?`,
      "new-user",
    ).n,
    0,
  )
  assert.equal(
    coordinator.sqlFirst(`SELECT COUNT(*) AS n FROM vote_by_user_asset`).n,
    boundedVotes.length,
    "the retained local votes must stay exactly as imported",
  )
})

test("an oversized retained candidate source defers the handover instead of truncating the candidate set", async (t) => {
  const gene = "TP53"
  const oversizedAssets = Array.from({ length: 65 }, (_, index) => ({
    asset_sha256: (index + 1).toString(16).padStart(64, "0"),
    status: "approved",
    autopick_eligible: 1,
    is_stale: 0,
    is_legacy: 0,
    created_at: "2026-09-01T00:00:00Z",
  }))
  const retainedVote = {
    user_id: "user-1",
    asset_sha256: oversizedAssets[0].asset_sha256,
    vision_id: "anima-v1-9",
    candidate_image_id: 7,
    vote_value: 1,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  }
  const d1 = {
    prepare(sql) {
      const source = String(sql || "")
      return {
        bind(...bindings) {
          return {
            async all() {
              if (source.includes("FROM icono_portrait_assets")) {
                return { results: oversizedAssets }
              }
              if (source.includes("FROM icono_image_votes")) {
                if (bindings.length > 2) return { results: [] }
                return { results: [retainedVote] }
              }
              return { results: [] }
            },
            first() {
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
  const { coordinator } = await newCoordinator(t, gene, { ICONOPLASM_DB: d1 })

  const response = await post(coordinator, "/vote/set", {
    symbol: gene,
    asset_sha256: oversizedAssets[0].asset_sha256,
    user_id: "new-user",
    vote_value: 1,
    vision_id: "anima-v1-9",
  })
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.code, "CANDIDATE_SOURCE_EXCEEDS_ENVELOPE")
  assert.equal(body.retryable, true)
  // No truncated candidate set was imported, no epoch flipped and no command
  // state was applied; the same command replays once the source fits.
  assert.equal(coordinator.getMeta("authority_epoch"), "")
  assert.equal(coordinator.publication.read(), null)
  assert.equal(coordinator.pendingOutboxRows(1).length, 0)
  assert.equal(
    coordinator.sqlFirst(`SELECT COUNT(*) AS n FROM gene_candidate_authority`).n,
    0,
    "an oversized source must never be truncated into the v2 candidate set",
  )
  assert.equal(
    coordinator.sqlFirst(
      `SELECT COUNT(*) AS n FROM vote_by_user_asset WHERE user_id = ?`,
      "new-user",
    ).n,
    0,
  )
})

test("an ordinary command never restores the retired legacy write path", async (t) => {
  const gene = "TP53"
  const { coordinator } = await newCoordinator(t, gene, {})
  const outcome = await coordinator.applyAuthoritativeVoteMutation({
    assetSha256: sha("a"),
    userId: "user-1",
    requestedVoteValue: 1,
    ensuredAsset: coordinator.ensureAssetSummaryRow(sha("a"), { visionId: "anima-v1-9" }),
  })
  assert.equal(outcome.authority, "v2")
  // The retained identity is now a pending v2 publication; the adapter owns
  // materialization and no legacy outbox row was written.
  assert.equal(outcome.publication.state.pending, true)
  assert.equal(coordinator.getMeta("authority_epoch"), "v2")
  assert.equal(coordinator.pendingOutboxRows(1).length, 0)
})

async function finalizationFixture(t, { candidates, jobVersion = 1 } = {}) {
  const candidate = {
    asset_sha256: sha("a"),
    status: "approved",
    autopick_eligible: 1,
    is_stale: 0,
    is_legacy: 0,
    created_at: "",
  }
  let sourceReads = 0
  const fixture = await newCoordinator(t, "TP53", {
    ICONOPLASM_DB: {
      prepare(sql) {
        assert.ok(sql.includes("icono_sync_finalization_jobs"))
        return {
          bind(symbol, version) {
            return {
              async first() {
                sourceReads += 1
                assert.equal(symbol, "TP53")
                return version === jobVersion
                  ? {
                      job_version: jobVersion,
                      status: "queued",
                      phase: "completed_pending_finalize",
                    }
                  : null
              },
            }
          },
        }
      },
    },
  })
  fixture.coordinator.setMeta("authority_epoch", "v2")
  fixture.coordinator.importGeneCandidateAuthority([candidate])
  fixture.coordinator.readLegacyCandidateAuthorityEnvelope = async () => ({
    overflow: false,
    items: candidates || [candidate],
  })
  return {
    ...fixture,
    candidate,
    sourceReads: () => sourceReads,
    handoff: (version = 1) =>
      post(fixture.coordinator, "/publication/finalization-handoff", {
        symbol: "TP53",
        job_version: version,
      }).then((response) => response.json()),
  }
}

test("finalization owner requires a durable job version before reading the retained source", async (t) => {
  const { coordinator, sourceReads } = await finalizationFixture(t)
  const response = await post(coordinator, "/publication/finalization-handoff", { symbol: "TP53" })
  assert.equal((await response.json()).accepted, false)
  assert.equal(sourceReads(), 0)
})

test("finalization owner commits an exact receipt and replays it without legacy reads", async (t) => {
  const { coordinator, handoff } = await finalizationFixture(t)
  const first = await handoff()
  assert.equal(first.accepted, true)
  assert.equal(first.job_version, 1)
  assert.equal(first.symbol, "TP53")
  assert.equal(coordinator.publication.read().pending, true)
  coordinator.env.ICONOPLASM_DB = { prepare: () => assert.fail("replay reached legacy D1") }
  coordinator.readLegacyCandidateAuthorityEnvelope = () =>
    assert.fail("replay reimported candidates")
  assert.deepEqual(await handoff(), first)
})

test("finalization owner refuses a superseded job before candidate replacement", async (t) => {
  const { coordinator, handoff } = await finalizationFixture(t, { jobVersion: 2 })
  const before = coordinator.getMeta("candidate_authority_revision")
  assert.equal((await handoff(1)).accepted, false)
  assert.equal(coordinator.getMeta("candidate_authority_revision"), before)
})

test("finalization cannot erase V2 candidates omitted by the legacy source", async (t) => {
  const { coordinator, handoff } = await finalizationFixture(t, { candidates: [] })
  const result = await handoff()
  assert.equal(result.accepted, true)
  assert.equal(result.candidate_count, 1)
  assert.equal(coordinator.sqlFirst("SELECT COUNT(*) AS n FROM gene_candidate_authority").n, 1)
  assert.equal(coordinator.publication.read().pending, true)
})

test("finalization preserves newer V2 candidate edits while importing newly generated assets", async (t) => {
  const sourceExisting = {
    asset_sha256: sha("a"),
    status: "rejected",
    autopick_eligible: 0,
    is_stale: 1,
    is_legacy: 0,
    created_at: "2026-09-19T00:00:00Z",
  }
  const sourceNew = {
    ...sourceExisting,
    asset_sha256: sha("b"),
    status: "approved",
    autopick_eligible: 1,
    is_stale: 0,
  }
  const { coordinator, candidate, handoff } = await finalizationFixture(t, {
    candidates: [sourceExisting, sourceNew],
  })

  const result = await handoff()

  assert.equal(result.accepted, true)
  assert.equal(result.candidate_count, 2)
  assert.equal(result.candidate_imported_count, 1)
  assert.equal(result.candidate_conflict_count, 1)
  const existing = coordinator.sqlFirst(
    "SELECT status, autopick_eligible, is_stale, created_at FROM gene_candidate_authority WHERE asset_sha256 = ?",
    candidate.asset_sha256,
  )
  assert.deepEqual(
    { ...existing },
    {
      status: candidate.status,
      autopick_eligible: candidate.autopick_eligible,
      is_stale: candidate.is_stale,
      created_at: candidate.created_at,
    },
  )
  assert.equal(
    coordinator.sqlFirst(
      "SELECT COUNT(*) AS n FROM gene_candidate_authority WHERE asset_sha256 = ?",
      sourceNew.asset_sha256,
    ).n,
    1,
  )
})

test("finalization cannot overwrite a candidate mutation accepted during source reads", async (t) => {
  const { coordinator, candidate, handoff } = await finalizationFixture(t)
  let reads = 0
  coordinator.readLegacyCandidateAuthorityEnvelope = async () => {
    reads += 1
    if (reads === 2)
      coordinator.importGeneCandidateAuthority([
        candidate,
        { ...candidate, asset_sha256: sha("b") },
      ])
    return { overflow: false, items: [candidate] }
  }
  const result = await handoff()
  assert.equal(result.accepted, false)
  assert.equal(coordinator.sqlFirst("SELECT COUNT(*) AS n FROM gene_candidate_authority").n, 2)
  assert.equal(coordinator.publication.read(), null)
})
