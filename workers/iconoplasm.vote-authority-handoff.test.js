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

function finalizationSource(responses, queries) {
  let reads = 0
  return {
    prepare(query) {
      if (/FROM icono_sync_finalization_jobs/.test(query)) {
        return {
          bind(symbol, version) {
            assert.equal(symbol, "TP53")
            return {
              async first() {
                return version === 1
                  ? { job_version: 1, status: "queued", phase: "completed_pending_finalize" }
                  : null
              },
            }
          },
        }
      }
      assert.match(query, /FROM icono_portrait_assets/)
      assert.match(query, /WHERE gene_symbol = \?/)
      assert.match(query, /LIMIT \?/)
      return {
        bind(symbol, limit) {
          assert.equal(symbol, "TP53")
          assert.equal(limit, 65)
          return {
            async all() {
              queries.push({ symbol, limit })
              const value = responses[Math.min(reads, responses.length - 1)]
              reads += 1
              if (value instanceof Error) throw value
              return structuredClone(value)
            },
          }
        },
      }
    },
  }
}

const retainedCandidates = (letters = ["a", "b", "c"]) =>
  letters.map((letter) => ({
    asset_sha256: sha(letter),
    status: "approved",
    autopick_eligible: 1,
    is_stale: 0,
    is_legacy: 0,
    created_at: "",
  }))

async function requestFinalizationHandoff(coordinator) {
  const response = await coordinator.fetch(
    new Request("https://coordinator/publication/finalization-handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "TP53", job_version: 1 }),
    }),
  )
  assert.equal(response.status, 200)
  return response.json()
}

test("the real finalization handler persists one V2 intent and replays it after restart", async (t) => {
  const { coordinator, state, sql } = await seeded(t)
  // A retained vote for the newly generated candidate must become selectable
  // when finalization imports that candidate; no selection has been committed yet.
  coordinator.state.storage.transactionSync(() =>
    coordinator.applyVoteStateMutationCore({
      assetSha256: sha("c"),
      userId: "retained-reader",
      requestedVoteValue: 1,
      ensuredAsset: coordinator.ensureAssetSummaryRow(sha("c"), { visionId: "anima-v1-7" }),
    }),
  )
  assert.equal(coordinator.publication.read().pending, false)
  const queries = []
  coordinator.env = {
    ICONOPLASM_DB: finalizationSource([{ results: retainedCandidates() }], queries),
  }
  const first = await requestFinalizationHandoff(coordinator)
  assert.equal(first.ok, true)
  assert.equal(first.accepted, true)
  assert.equal(first.authority_epoch, "v2")
  assert.equal(first.symbol, "TP53")
  assert.equal(first.job_version, 1)
  assert.equal(first.candidate_count, 3)
  assert.equal(coordinator.publication.read().pending, true)
  assert.equal(queries.length, 2)
  assert.equal(sql.db.prepare("SELECT COUNT(*) AS count FROM vote_outbox").get().count, 0)
  const desired = coordinator.publication.read()
  const restarted = new IconoplasmVoteCoordinator(state, coordinator.env)
  await state.ready
  const repeat = await requestFinalizationHandoff(restarted)
  assert.deepEqual(repeat, first)
  assert.deepEqual(restarted.publication.read(), desired)
})

for (const [name, responses, expectedCode] of [
  [
    "changing candidate source",
    [{ results: retainedCandidates() }, { results: retainedCandidates(["a"]) }],
    "CANDIDATE_SOURCE_CHANGED",
  ],
  [
    "oversized candidate source",
    [{ results: Array.from({ length: 65 }, () => retainedCandidates()[0]) }],
    "CANDIDATE_SOURCE_EXCEEDS_ENVELOPE",
  ],
  ["failed candidate read", [new Error("storage unavailable")], "CANDIDATE_SOURCE_FAILED"],
  ["malformed candidate response", [{}], "CANDIDATE_SOURCE_FAILED"],
  [
    "explicitly failed candidate response",
    [{ success: false, results: [] }],
    "CANDIDATE_SOURCE_FAILED",
  ],
]) {
  test(`the real finalization handler preserves authority on ${name}`, async (t) => {
    const { coordinator, sql } = await seeded(t)
    const prior = sql.db
      .prepare("SELECT * FROM gene_candidate_authority ORDER BY asset_sha256")
      .all()
    const publication = coordinator.publication.read()
    coordinator.env = { ICONOPLASM_DB: finalizationSource(responses, []) }
    const result = await requestFinalizationHandoff(coordinator)
    assert.equal(result.accepted, false)
    assert.equal(result.code, expectedCode)
    assert.deepEqual(
      sql.db.prepare("SELECT * FROM gene_candidate_authority ORDER BY asset_sha256").all(),
      prior,
    )
    assert.deepEqual(coordinator.publication.read(), publication)
    assert.equal(coordinator.getMeta("authority_epoch"), "v2")
  })
}

// B-876 (gene HR, 26 Sep): new candidates arrived for a published v2 gene
// without changing its winner. The handoff imported them, but the selection
// identity ignored the candidate set, so nothing re-published and the gene
// page gallery stayed stale indefinitely.
function candidateOnlySource(jobVersion, candidates) {
  return {
    prepare(query) {
      if (/FROM icono_sync_finalization_jobs/.test(query)) {
        return {
          bind: (_symbol, version) => ({
            first: async () =>
              version === jobVersion
                ? { job_version: jobVersion, status: "queued", phase: "completed_pending_finalize" }
                : null,
          }),
        }
      }
      return { bind: () => ({ all: async () => ({ results: structuredClone(candidates) }) }) }
    },
  }
}

async function handoff(coordinator, jobVersion) {
  const response = await coordinator.fetch(
    new Request("https://coordinator/publication/finalization-handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "TP53", job_version: jobVersion }),
    }),
  )
  return response.json()
}

test("a finalization that only adds candidates republishes the gene card (B-876)", async (t) => {
  const { coordinator } = await seeded(t)
  await publishWinningVote(coordinator)
  const published = coordinator.publication.read()
  assert.equal(published.pending, false)

  coordinator.env = {
    ICONOPLASM_DB: candidateOnlySource(2, retainedCandidates(["a", "b", "c"])),
  }
  const receipt = await handoff(coordinator, 2)
  assert.equal(receipt.accepted, true)
  assert.equal(receipt.candidate_changed, true)
  const after = coordinator.publication.read()
  assert.equal(after.pending, true, "an added candidate must re-publish the gene card")
  assert.equal(after.desiredVersion, published.desiredVersion + 1)
  assert.equal(
    after.selectionRef.includes(`winner=${sha("b")}`),
    true,
    "the winner itself is unchanged",
  )
})

test("a finalization that changes no candidate spends no publication (B-876)", async (t) => {
  const { coordinator } = await seeded(t)
  await publishWinningVote(coordinator)
  coordinator.env = {
    ICONOPLASM_DB: candidateOnlySource(2, retainedCandidates(["a", "b"])),
  }
  const before = coordinator.publication.read()
  const receipt = await handoff(coordinator, 2)
  assert.equal(receipt.accepted, true)
  assert.equal(receipt.candidate_changed, false)
  assert.deepEqual(coordinator.publication.read(), before)
})
