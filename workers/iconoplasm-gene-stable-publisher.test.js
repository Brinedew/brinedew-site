import assert from "node:assert/strict"
import test from "node:test"

import { publishIconoplasmGeneStableObject } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// ARCHITECTURE FENCE [IPD-010]: routine publication is per gene and bounded.
// B-898: the per-gene publisher. Failure modes written after a live republish
// of ADO on 2026-10-01 17:37Z published a portrait-less object and nulled its
// D1 winner, because "no selection given" was treated as "withdraw":
// 1. no selection (the republish route) -> materialize from D1 as it stands,
//    no portrait override, no D1 projection;
// 2. an explicit winner (the vote authority) -> that override, projected;
// 3. withdraw -> the "none" override, a null projection;
// 4. a gene with no card -> reported withdrawn, nothing written or projected.
function harness({ cards = null } = {}) {
  const calls = { materialize: [], projected: [], written: [] }
  const source = {
    async materialize(symbols, { portraitOverrides } = {}) {
      calls.materialize.push(portraitOverrides)
      return cards === null
        ? symbols.map((symbol) => ({ symbol, payload: { symbol, portrait_candidates: [] } }))
        : cards
    },
    complete: () => true,
    stable: (card) => card,
    project: (payload) => payload,
    async publishSelection(symbol, asset) {
      calls.projected.push([symbol, asset])
    },
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

test("no selection: publish from D1 as it stands, no override, no projection", async () => {
  const h = harness()
  const result = await h.run({})
  assert.deepEqual(h.calls.materialize, [null])
  assert.deepEqual(h.calls.projected, [])
  assert.equal(h.calls.written[0].key, "genes/v3/TP53.json")
  assert.equal(result.selected_asset_sha256, null)
})

test("an explicit winner is the override and is projected into D1", async () => {
  const h = harness()
  await h.run({ portraitAssetSha256: "A".repeat(64) })
  assert.deepEqual(h.calls.materialize, [{ TP53: "a".repeat(64) }])
  assert.deepEqual(h.calls.projected, [["TP53", "a".repeat(64)]])
})

test("withdraw publishes the portrait-less version and projects null", async () => {
  const h = harness()
  await h.run({ withdraw: true })
  assert.deepEqual(h.calls.materialize, [{ TP53: "none" }])
  assert.deepEqual(h.calls.projected, [["TP53", null]])
})

test("a gene with no card is reported withdrawn and nothing is written", async () => {
  const h = harness({ cards: [] })
  const result = await h.run({})
  assert.equal(result.withdrawn, true)
  assert.deepEqual(h.calls.written, [])
  assert.deepEqual(h.calls.projected, [])
})
