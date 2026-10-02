import assert from "node:assert/strict"
import test from "node:test"

import { publishIconoplasmGeneStableObject } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// ARCHITECTURE FENCE [IPD-010]: routine publication is per gene and bounded.
// B-898: the per-gene publisher. Failure modes written after a live republish
// of ADO on 2026-10-01 17:37Z published a portrait-less object and nulled its
// D1 winner, because "no selection given" was treated as "withdraw":
// 1. no selection (votes, uploads, the republish route) -> materialize from D1
//    as it stands, with no portrait override;
// 2. an explicit winner (the administrator's /admin/publish pin, already in
//    D1) -> that override and the pool's current mark;
// 3. a gene with no card -> reported withdrawn, nothing written.
// The vote-version recheck after the write is proven against a real D1 schema
// in iconoplasm.d1-votes.test.js (failure mode 11).
function harness({ cards = null } = {}) {
  const calls = { materialize: [], written: [] }
  const source = {
    async materialize(symbols, { portraitOverrides } = {}) {
      calls.materialize.push(portraitOverrides)
      return cards === null
        ? symbols.map((symbol) => ({
            symbol,
            payload: {
              symbol,
              portrait_candidates: [
                { asset_sha256: "a".repeat(64) },
                { asset_sha256: "b".repeat(64) },
              ],
            },
          }))
        : cards
    },
    complete: () => true,
    stable: (card) => card,
    project: (payload) => payload,
  }
  const objects = {
    async writeStable(key, value) {
      calls.written.push({ key, value })
      return { key, hash: "e".repeat(64), size: 1, purged: true }
    },
  }
  return {
    calls,
    run: (opts) => publishIconoplasmGeneStableObject({}, "tp53", { ...opts, source, objects }),
  }
}

test("no selection: publish from D1 as it stands, with no override", async () => {
  const h = harness()
  const result = await h.run({})
  assert.deepEqual(h.calls.materialize, [null])
  assert.equal(h.calls.written[0].key, "genes/v3/TP53.json")
  assert.equal(result.selected_asset_sha256, null)
  assert.equal(result.vote_version, null, "a publisher without D1 stamps no vote version")
})

test("an explicit winner is the override and the pool's only current candidate", async () => {
  const h = harness()
  const result = await h.run({ portraitAssetSha256: "A".repeat(64) })
  assert.deepEqual(h.calls.materialize, [{ TP53: "a".repeat(64) }])
  assert.equal(result.selected_asset_sha256, "a".repeat(64))
  assert.deepEqual(
    h.calls.written[0].value.portrait_candidates.map((candidate) => candidate.is_current),
    [true, false],
  )
})

test("a gene with no card is reported withdrawn and nothing is written", async () => {
  const h = harness({ cards: [] })
  const result = await h.run({})
  assert.equal(result.withdrawn, true)
  assert.deepEqual(h.calls.written, [])
})
