import assert from "node:assert/strict"
import test from "node:test"
import { createIconoplasmPublicationReader } from "./publication-reader.js"

// The stable gene object carries its complete candidate pool inline. Failure
// modes written before the code:
// 1. the pool is the record's own array, with no fetch at all;
// 2. is_current follows the record's selected portrait, not the stale flags
//    the pool was published with;
// 3. a record without a pool array is a broken publication and fails loudly,
//    never "no candidates";
// 4. a record with an empty pool is a legitimate empty gallery;
// 5. an invalid symbol is rejected.
const SYMBOL = "TP53"

function candidate(id, filler = "") {
  return {
    candidate_image_id: id,
    asset_sha256: String(id).padStart(64, "0"),
    is_current: id === 1,
    image_score: id,
    filler,
  }
}

function reader() {
  return createIconoplasmPublicationReader({
    fetchImpl: async () => {
      throw new Error("the candidate gallery must never fetch")
    },
  })
}

test("the stable object's inline pool is the candidate gallery, with no fetch", async () => {
  const pool = await reader().candidateGallery({
    symbol: SYMBOL,
    portrait: { status: "published", asset_sha256: candidate(2).asset_sha256 },
    portrait_candidates: [candidate(1), candidate(2), candidate(3)],
  })
  assert.equal(pool.count, 3)
  assert.deepEqual(
    pool.candidates.map((item) => [item.candidate_image_id, item.is_current]),
    [
      [1, false],
      [2, true],
      [3, false],
    ],
  )
})

test("without a selected portrait the pool keeps its published is_current flags", async () => {
  const pool = await reader().candidateGallery({
    symbol: SYMBOL,
    portrait: null,
    portrait_candidates: [candidate(1), candidate(2)],
  })
  assert.deepEqual(
    pool.candidates.map((item) => item.is_current),
    [true, false],
  )
})

test("a record without a pool array fails loudly instead of reporting an empty pool", async () => {
  await assert.rejects(
    reader().candidateGallery({ symbol: SYMBOL, portrait: null, candidate_count: 72 }),
    /has no candidate pool: TP53/,
  )
})

test("an empty pool is a legitimate empty gallery", async () => {
  const pool = await reader().candidateGallery({
    symbol: SYMBOL,
    portrait: null,
    portrait_candidates: [],
  })
  assert.deepEqual(pool, { candidates: [], count: 0 })
})

test("an invalid symbol is rejected", async () => {
  await assert.rejects(
    reader().candidateGallery({ symbol: "bad<", portrait_candidates: [] }),
    /Invalid/,
  )
})
