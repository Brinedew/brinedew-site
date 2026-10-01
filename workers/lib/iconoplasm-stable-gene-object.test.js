import assert from "node:assert/strict"
import test from "node:test"

import { composeStableGeneObject } from "./iconoplasm-stable-gene-object.js"

// B-898 deletion stage, step A: the one stable object per gene is composed by
// a plain function, not inside the publication coordinator. Failure modes
// written before the code:
// 1. the object is the projected record plus the complete candidate pool,
//    its count, stable_object_version 3 and a published_at stamp;
// 2. the selected winner is marked is_current in the pool; nothing else is;
// 3. a projected record without a pool still composes (empty pool, count 0);
// 4. the published_at stamp comes from the injected clock, so tests and
//    rematerializations are deterministic.
const projected = {
  symbol: "TP53",
  full_name: "tumor protein p53",
  portrait: { status: "published", asset_sha256: "a".repeat(64) },
  portrait_candidates: [
    { asset_sha256: "a".repeat(64), is_current: false, image_score: 4 },
    { asset_sha256: "b".repeat(64), is_current: true, image_score: 1 },
  ],
}

test("the stable object is the projected record with its pool inline (B-898)", () => {
  const object = composeStableGeneObject(projected, {
    selectedAssetSha256: "a".repeat(64),
    now: () => "2026-10-01T16:00:00.000Z",
  })
  assert.equal(object.symbol, "TP53")
  assert.equal(object.stable_object_version, 3)
  assert.equal(object.published_at, "2026-10-01T16:00:00.000Z")
  assert.equal(object.candidate_count, 2)
  assert.deepEqual(
    object.portrait_candidates.map((c) => [c.asset_sha256.slice(0, 1), c.is_current]),
    [
      ["a", true],
      ["b", false],
    ],
    "the selected winner is the only current candidate",
  )
  assert.equal(object.portrait.asset_sha256, "a".repeat(64))
})

test("a record without a pool composes with an empty pool (B-898)", () => {
  const object = composeStableGeneObject(
    { symbol: "ZZZ3", full_name: "zinc finger ZZ-type containing 3", portrait: null },
    { selectedAssetSha256: null, now: () => "2026-10-01T16:00:00.000Z" },
  )
  assert.deepEqual(object.portrait_candidates, [])
  assert.equal(object.candidate_count, 0)
  assert.equal(object.portrait, null)
  assert.equal(object.stable_object_version, 3)
})

test("without a selection the pool's own is_current flags are kept (B-898)", () => {
  const object = composeStableGeneObject(projected, { now: () => "x" })
  assert.deepEqual(
    object.portrait_candidates.map((c) => c.is_current),
    [false, true],
  )
})
