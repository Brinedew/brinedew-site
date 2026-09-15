// Independent follow-up audit of ee4b3b57. No production traffic.
// Run alongside the unchanged eleven earlier regression checks.
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import { setImmediate as nextTurn } from "node:timers/promises"
import { IconoplasmCardPublicationCoordinator } from "../workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { createCardPublicationCoordinatorClass } from "../workers/lib/iconoplasm-card-publication-coordinator.js"

const root = new URL("../", import.meta.url)
const fixture = readFileSync(
  new URL("workers/iconoplasm.vote-authority-slice.test.js", root),
  "utf8",
)
const marker = 'test("a gene stays on the legacy epoch'
assert.ok(fixture.indexOf(marker) > 0, "Inspect the fixture after its boundary changes")
const fixtureSource =
  fixture
    .slice(0, fixture.indexOf(marker))
    .replace(
      '"./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"',
      JSON.stringify(
        new URL(
          "workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
          root,
        ).href,
      ),
    ) +
  "\nexport {newCoordinator, fakeCoordinatorState, seedAuthority, voteOptions, uploadedFor, sha};"
const { newCoordinator, fakeCoordinatorState, seedAuthority, voteOptions, uploadedFor, sha } =
  await import("data:text/javascript," + encodeURIComponent(fixtureSource))
const candidate = (asset, extra = {}) => ({
  asset_sha256: asset,
  status: "approved",
  autopick_eligible: 1,
  ...extra,
})
const post = (owner, path, body) =>
  owner.fetch(
    new Request("https://internal" + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "TP53", ...body }),
    }),
  )
const activation = (asset = sha("a")) => ({
  published_asset_sha256: asset,
  published: {
    content_sha256: sha("e"),
    object_key: `published-cards/v2/immutable/cards/${sha("e")}.json`,
  },
})
async function seeded(t) {
  const f = await newCoordinator(t)
  await seedAuthority(f.coordinator, {
    publishedAssetSha: sha("a"),
    winnerCandidateRows: [candidate(sha("a")), candidate(sha("b"))],
  })
  f.coordinator.ensureAssetSummaryRow(sha("a"), { visionId: "anima-v1-9" })
  f.coordinator.ensureAssetSummaryRow(sha("b"), { visionId: "anima-v1-8" })
  return f
}
async function dirty(t) {
  const f = await seeded(t)
  await f.coordinator.applyAuthoritativeVoteMutation(
    voteOptions(f.coordinator, sha("b"), { visionId: "anima-v1-8" }),
  )
  assert.equal(f.coordinator.publication.read().pending, true)
  return f
}
function deferred() {
  let resolve
  const promise = new Promise((r) => {
    resolve = r
  })
  return { promise, resolve }
}
function bindTo(owner) {
  return {
    idFromName: (name) => name,
    get: () => ({ fetch: (url, init) => owner.fetch(new Request(url, init)) }),
  }
}

// This test isolates the real coordinator's scheduling. The deliberately held
// materializer models an outstanding external request without timing a network.
test("ISOLATION: a held gene materialization must not queue another gene behind it", async (t) => {
  const f = fakeCoordinatorState()
  t.after(() => f.sql.db.close())
  const Publisher = createCardPublicationCoordinatorClass(() => ({}))
  const owner = new Publisher(f.state, {})
  await f.state.ready
  const entered = deferred(),
    release = deferred()
  let healthyStarted = false
  owner.publisher.materializeSymbol = async (symbol) => {
    if (symbol === "BROKEN") {
      entered.resolve()
      await release.promise
    } else healthyStarted = true
    return { symbol, withdrawn: false, receipts: {} }
  }
  const first = post(owner, "/materialize-symbol", {
    symbol: "BROKEN",
    portrait_asset_sha256: sha("a"),
  })
  await entered.promise
  const second = post(owner, "/materialize-symbol", {
    symbol: "TP53",
    portrait_asset_sha256: sha("b"),
  })
  await nextTurn()
  const independent = healthyStarted
  release.resolve()
  const responses = await Promise.all([first, second])
  t.diagnostic(
    JSON.stringify({
      case: "shared_publication_serialization",
      healthyStartedBeforeRelease: independent,
      statuses: responses.map((r) => r.status),
    }),
  )
  assert.equal(
    independent,
    true,
    "One outstanding gene operation held the shared publication queue",
  )
})

// Uses the actual sourceForEnv and default vote -> publisher adapter. There is
// no injected D1-free materializer. A throwing DB records any forbidden access.
test("ADMISSION: default publication must respect schema transition before consuming D1", async (t) => {
  const f = await dirty(t),
    p = fakeCoordinatorState()
  t.after(() => p.sql.db.close())
  let queries = 0
  const env = {
    ICONOPLASM_SCHEMA_TRANSITION: "1",
    ICONOPLASM_DB: {
      prepare() {
        queries++
        throw Error("Audit: D1 is unavailable during schema transition")
      },
    },
  }
  const publisher = new IconoplasmCardPublicationCoordinator(p.state, env)
  await p.state.ready
  f.coordinator.env = { ...env, ICONOPLASM_CARD_PUBLICATION: bindTo(publisher) }
  f.coordinator.setMeta("outbox_budget_retry_at", String(Date.now() + 86400000))
  f.setAlarm(null)
  const before = Date.now(),
    result = await f.coordinator.alarm(),
    state = f.coordinator.publication.read()
  t.diagnostic(
    JSON.stringify({
      case: "default_adapter_d1",
      queries,
      result,
      pending: state.pending,
      retryDelayMs: state.retryAt - before,
    }),
  )
  assert.equal(
    queries,
    0,
    "The real default publisher consumed D1 before transition/admission checks",
  )
})

test("ATOMICITY: rejected reactivation cannot change an active gene policy", async (t) => {
  const { coordinator } = await seeded(t)
  const before = {
    asset: coordinator.getMeta("published_asset_sha256"),
    override: coordinator.getMeta("admin_override"),
    publication: coordinator.publication.read(),
  }
  const response = await post(coordinator, "/authority/activate", {
    ...activation(sha("b")),
    admin_override: true,
  })
  const body = await response.json()
  const after = {
    asset: coordinator.getMeta("published_asset_sha256"),
    override: coordinator.getMeta("admin_override"),
    publication: coordinator.publication.read(),
  }
  t.diagnostic(
    JSON.stringify({ case: "rejected_reactivation", status: response.status, body, before, after }),
  )
  assert.ok(response.status >= 400, "Setup expects rejection of a conflicting seed")
  assert.deepEqual(
    after,
    before,
    "Rejected activation changed authority policy outside its transaction",
  )
})

test("MIGRATION: equal row counts with different accepted votes are not complete transfer", async (t) => {
  const { coordinator, sql } = await newCoordinator(t)
  coordinator.importGeneCandidateAuthority([candidate(sha("a"))])
  coordinator.ensureAssetSummaryRow(sha("a"), { visionId: "anima-v1-9" })
  sql.db
    .prepare(
      "INSERT INTO vote_by_user_asset (user_id,asset_sha256,vision_id,vote_value) VALUES (?,?,?,?)",
    )
    .run("wrong-local-reader", sha("a"), "anima-v1-9", 1)
  const legacy = new DatabaseSync(":memory:")
  t.after(() => legacy.close())
  legacy.exec(
    "CREATE TABLE icono_image_votes (gene_symbol TEXT,user_id TEXT,asset_sha256 TEXT,vote_value INTEGER)",
  )
  legacy
    .prepare("INSERT INTO icono_image_votes VALUES (?,?,?,?)")
    .run("TP53", "actual-accepted-reader", sha("a"), -1)
  const queries = []
  coordinator.env = {
    ICONOPLASM_DB: {
      prepare(query) {
        queries.push(query)
        return {
          bind(...args) {
            return {
              async first() {
                return legacy.prepare(query).get(...args)
              },
              async all() {
                return { results: legacy.prepare(query).all(...args) }
              },
            }
          },
        }
      },
    },
  }
  const response = await post(coordinator, "/authority/activate", activation())
  const body = await response.json()
  t.diagnostic(
    JSON.stringify({
      case: "same_count_different_votes",
      status: response.status,
      body,
      legacy: legacy.prepare("SELECT * FROM icono_image_votes").all(),
      local: sql.db.prepare("SELECT user_id,asset_sha256,vote_value FROM vote_by_user_asset").all(),
      queries,
    }),
  )
  assert.ok(
    response.status >= 400,
    "A different voter and opposite vote were certified by equal counts",
  )
  assert.notEqual(coordinator.getMeta("authority_epoch"), "v2")
})

test("MIGRATION: invalid candidate elements must reject before replacing accepted candidates", async (t) => {
  const { coordinator, sql } = await seeded(t)
  const before = sql.db
    .prepare("SELECT * FROM gene_candidate_authority ORDER BY asset_sha256")
    .all()
  const response = await post(coordinator, "/authority/candidates", {
    items: [{ asset_sha256: "invalid-sha", status: "approved", autopick_eligible: 1 }],
  })
  const body = await response.json(),
    after = sql.db.prepare("SELECT * FROM gene_candidate_authority ORDER BY asset_sha256").all()
  t.diagnostic(
    JSON.stringify({
      case: "invalid_candidate_members",
      status: response.status,
      body,
      beforeCount: before.length,
      afterCount: after.length,
      publication: coordinator.publication.read(),
    }),
  )
  assert.ok(
    response.status >= 400,
    "Malformed members were silently discarded before destructive replace",
  )
  assert.deepEqual(after, before)
})

// The caller updates the real caretaker ledger, then fails at the subsequent
// publication commit, exactly at the boundary that must be atomic or replayable.
test("ATOMICITY: caretaker assignment and publication intent survive the same failure boundary", async (t) => {
  const { coordinator } = await seeded(t)
  const before = coordinator.caretakerSupervotes.readAssignment()
  coordinator.publication.commitSelection = async () => {
    throw Error("Audit: publication commit unavailable")
  }
  const event = {
    event_id: "assignment-test-1",
    event_sequence: 100,
    gene: { gene_id: "gene-TP53", canonical_symbol: "TP53" },
    assignment: {
      caretaker_assignment_id: "assignment-1",
      account_id: "reader-1",
      status: "active",
      assignment_version: 1,
    },
  }
  await assert.rejects(
    post(coordinator, "/caretaker-assignment/project", { event }),
    /publication commit unavailable/,
  )
  const after = coordinator.caretakerSupervotes.readAssignment(),
    publication = coordinator.publication.read()
  t.diagnostic(
    JSON.stringify({
      case: "caretaker_commit_gap",
      before,
      after,
      publication,
      caretakerOutbox: coordinator.caretakerSupervotes.pendingOutboxRows(10).length,
    }),
  )
  assert.deepEqual(after, before, "Caretaker authority committed before publication intent failed")
})

test("BINDING: a materialization receipt for another gene cannot clear current pending work", async (t) => {
  const { coordinator } = await dirty(t)
  const requests = []
  coordinator.env = {
    ICONOPLASM_CARD_PUBLICATION: {
      idFromName: (name) => name,
      get: () => ({
        async fetch(url, init) {
          requests.push(JSON.parse(init.body))
          return Response.json({
            ok: true,
            symbol: "BRCA1",
            withdrawn: false,
            receipts: {
              card: { hash: sha("f"), key: `published-cards/v2/immutable/cards/${sha("f")}.json` },
            },
          })
        },
      }),
    },
  }
  const result = await coordinator.drainGenePublication(),
    state = coordinator.publication.read()
  t.diagnostic(JSON.stringify({ case: "wrong_gene_receipt", requests, result, state }))
  assert.equal(
    state.pending,
    true,
    "A correctly shaped but unrelated receipt cleared TP53 publication",
  )
})
