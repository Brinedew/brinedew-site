import assert from "node:assert/strict"
import test from "node:test"

import { exportIconoplasmVoteCoordinatorToD1 } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// B-898 Stage 2, step 1: the sweep copies one coordinator into D1 by its
// Durable Object id. Failure modes written before the code:
// 1. the coordinator is addressed by idFromString, never idFromName (no new
//    coordinator is created by the sweep);
// 2. an unbootstrapped or legacy coordinator writes nothing;
// 3. a v2 coordinator's votes are upserted and D1 votes it no longer holds are
//    deleted, and its summaries replace D1's for that gene;
// 4. a malformed id is refused before any Durable Object call.
const sha = (c) => c.repeat(64)
const ID = "f".repeat(64)

function harness(exported) {
  const calls = { idFrom: [], fetch: [], sql: [] }
  const env = {
    ICONOPLASM_VOTE_COORDINATORS: {
      idFromString: (id) => {
        calls.idFrom.push(["string", id])
        return { id }
      },
      idFromName: (name) => {
        calls.idFrom.push(["name", name])
        return { name }
      },
      get: () => ({
        async fetch(request) {
          calls.fetch.push(new URL(request.url).pathname)
          return Response.json(exported)
        },
      }),
    },
    ICONOPLASM_DB: {
      prepare(sql) {
        return {
          bind: (...bindings) => ({ sql, bindings }),
          sql,
          bindings: [],
        }
      },
      async batch(statements) {
        for (const statement of statements)
          calls.sql.push(statement.sql.replace(/\s+/g, " ").trim())
        return statements.map(() => ({ meta: { changes: 1 } }))
      },
    },
  }
  return { env, calls }
}

test("a malformed id is refused before any Durable Object call", async () => {
  const h = harness({})
  await assert.rejects(exportIconoplasmVoteCoordinatorToD1(h.env, "not-an-id"), /64-hex/)
  assert.deepEqual(h.calls.fetch, [])
})

test("an unbootstrapped coordinator is read by id and writes nothing", async () => {
  const h = harness({ ok: true, bootstrapped: false, symbol: "", authority_epoch: "", votes: [] })
  const result = await exportIconoplasmVoteCoordinatorToD1(h.env, ID.toUpperCase())
  assert.deepEqual(h.calls.idFrom, [["string", ID]])
  assert.deepEqual(h.calls.fetch, ["/vote/export"])
  assert.equal(result.exported, false)
  assert.equal(result.reason, "not_bootstrapped")
  assert.deepEqual(h.calls.sql, [])
})

test("a legacy-epoch coordinator writes nothing", async () => {
  const h = harness({
    ok: true,
    bootstrapped: true,
    symbol: "TP53",
    authority_epoch: "legacy",
    votes: [{}],
  })
  const result = await exportIconoplasmVoteCoordinatorToD1(h.env, ID)
  assert.equal(result.exported, false)
  assert.equal(result.reason, "legacy_epoch")
  assert.deepEqual(h.calls.sql, [])
})

test("a v2 coordinator's votes and summaries are written to D1 for its gene", async () => {
  const h = harness({
    ok: true,
    bootstrapped: true,
    symbol: "tp53",
    authority_epoch: "v2",
    published_asset_sha256: sha("a"),
    votes: [
      {
        user_id: "reader-1",
        asset_sha256: sha("a"),
        vision_id: "anima-v1-9",
        candidate_image_id: 42,
        vote_value: 1,
        created_at: "2026-09-20 10:00:00",
        updated_at: "2026-09-20 10:00:00",
      },
      { user_id: "reader-2", asset_sha256: "not a sha", vote_value: 1 },
    ],
    asset_summaries: [
      {
        asset_sha256: sha("a"),
        vision_id: "anima-v1-9",
        upvotes: 1,
        downvotes: 0,
        score: 1,
        vote_count: 1,
      },
    ],
  })
  const result = await exportIconoplasmVoteCoordinatorToD1(h.env, ID)
  assert.equal(result.exported, true)
  assert.equal(result.symbol, "TP53")
  assert.equal(result.votes_in_coordinator, 2)
  assert.equal(result.votes_written, 1, "the malformed row is dropped")
  assert.equal(result.published_asset_sha256, sha("a"))
  assert.match(h.calls.sql[0], /^DELETE FROM icono_image_votes WHERE gene_symbol = \?/)
  assert.match(h.calls.sql[1], /^INSERT INTO icono_image_votes/)
  assert.match(h.calls.sql[1], /ON CONFLICT\(gene_symbol, asset_sha256, user_id\) DO UPDATE/)
  assert.match(h.calls.sql[2], /^DELETE FROM icono_vote_asset_summary WHERE gene_symbol = \?/)
  assert.match(h.calls.sql[3], /^INSERT INTO icono_vote_asset_summary/)
})
