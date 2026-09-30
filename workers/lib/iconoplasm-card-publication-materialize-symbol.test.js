import assert from "node:assert/strict"
import test from "node:test"

import { createCardPublication } from "./iconoplasm-card-publication.js"

// B-762 per-gene publication: materialize exactly one gene for the coordinator's
// explicit winner and return verified immutable receipts without touching the
// global publication head, job or watermark.
function fakeRepository() {
  return {
    get: () => null,
    put() {},
    remove() {},
    reserveWrites() {},
    prepared: () => [],
    clearPrepared() {},
    transaction(callback) {
      return callback()
    },
  }
}

function fakeObjects({ failStable = false } = {}) {
  const written = []
  const stable = []
  const hashByKind = { cards: "a", genes: "b", portraits: "c", galleries: "f" }
  return {
    written,
    stable,
    async writeStable(key, value, options) {
      if (failStable) throw new Error("injected stable object failure")
      stable.push({ key, value, purge: options?.purge })
      return { key, hash: "e".repeat(64), size: 1 }
    },
    async write(kind, value) {
      const hash = hashByKind[kind].repeat(64)
      written.push({ kind, value })
      return { key: `published-cards/v2/immutable/${kind}/${hash}.json`, hash, size: 1 }
    },
  }
}

function fakeSource({ complete = true, materialize } = {}) {
  return {
    materialize:
      materialize ||
      (async (symbols, { portraitOverrides } = {}) =>
        symbols.map((symbol) => ({
          symbol,
          __complete: true,
          overrides: portraitOverrides,
        }))),
    complete: () => complete,
    stable: (card) => card,
    project: (payload) => payload,
    locator: (card) => card,
  }
}

function publisherFor(source, objects) {
  return createCardPublication({
    repository: fakeRepository(),
    objects,
    source,
    now: () => "2026-09-14T00:00:00Z",
  })
}

test("materializeSymbol writes and returns the verified card receipt for one gene", async () => {
  const objects = fakeObjects()
  const publisher = publisherFor(fakeSource(), objects)
  const result = await publisher.materializeSymbol("tp53", {
    portraitAssetSha256: "d".repeat(64),
  })
  assert.equal(result.symbol, "TP53")
  assert.equal(result.withdrawn, false)
  assert.deepEqual(
    objects.written.map((entry) => entry.kind),
    ["cards", "genes", "portraits"],
  )
  assert.equal(result.receipts.card.hash, "a".repeat(64))
  assert.equal(
    result.receipts.card.key,
    `published-cards/v2/immutable/cards/${"a".repeat(64)}.json`,
  )
  assert.deepEqual(objects.written[0].value.overrides, { TP53: "d".repeat(64) })
})

test("materializeSymbol withdrawal publishes the portrait-less tombstone version", async () => {
  const objects = fakeObjects()
  const publisher = publisherFor(fakeSource(), objects)
  const result = await publisher.materializeSymbol("TP53", { withdraw: true })
  assert.equal(result.withdrawn, false)
  assert.deepEqual(objects.written[0].value.overrides, { TP53: "none" })
  assert.equal(result.receipts.card.hash, "a".repeat(64))
})

test("materializeSymbol fails closed without writing when the card is invalid", async () => {
  const objects = fakeObjects()
  const publisher = publisherFor(fakeSource({ complete: false }), objects)
  await assert.rejects(
    publisher.materializeSymbol("TP53", { portraitAssetSha256: "d".repeat(64) }),
    /Invalid canonical card/,
  )
  assert.equal(objects.written.length, 0)
})

test("materializeSymbol reports a withdrawn gene with no card instead of inventing one", async () => {
  const objects = fakeObjects()
  const publisher = publisherFor(fakeSource({ materialize: async () => [] }), objects)
  const result = await publisher.materializeSymbol("TP53", { withdraw: true })
  assert.equal(result.withdrawn, true)
  assert.equal(result.receipts, null)
  assert.equal(objects.written.length, 0)
})

// B-898 Stage 1 failure modes, written before the code:
// 1. the per-gene path writes exactly one stable object at a fixed key;
// 2. it carries the complete candidate pool inline and the count;
// 3. the key does not depend on content, so a second publication overwrites it;
// 4. a failed stable write fails the materialization (no partial receipts).
test("materializeSymbol writes the one stable gene object with its pool inline (B-898)", async () => {
  const objects = fakeObjects()
  const pool = [
    { asset_sha256: "1".repeat(64), image_score: 3 },
    { asset_sha256: "2".repeat(64), image_score: 1 },
  ]
  const source = fakeSource({
    materialize: async (symbols, { portraitOverrides } = {}) =>
      symbols.map((symbol) => ({
        symbol,
        __complete: true,
        payload: { symbol, portrait_candidates: pool, overrides: portraitOverrides },
      })),
  })
  source.project = (payload) => payload
  const publisher = publisherFor(source, objects)
  await publisher.materializeSymbol("tp53", { portraitAssetSha256: "d".repeat(64) })
  assert.equal(objects.stable.length, 1)
  assert.equal(objects.stable[0].key, "genes/v3/TP53.json")
  assert.equal(objects.stable[0].purge, true, "a per-gene rewrite purges its CDN URL")
  assert.deepEqual(objects.stable[0].value.portrait_candidates, pool)
  assert.equal(objects.stable[0].value.candidate_count, 2)
  assert.equal(objects.stable[0].value.stable_object_version, 3)
  assert.equal(objects.stable[0].value.published_at, "2026-09-14T00:00:00Z")
  assert.deepEqual(objects.stable[0].value.overrides, { TP53: "d".repeat(64) })

  await publisher.materializeSymbol("tp53", { portraitAssetSha256: "1".repeat(64) })
  assert.equal(objects.stable[1].key, objects.stable[0].key, "fixed URL, rewritten in place")
})

test("a failed stable gene object write fails the per-gene materialization (B-898)", async () => {
  const objects = fakeObjects({ failStable: true })
  const publisher = publisherFor(fakeSource(), objects)
  await assert.rejects(
    publisher.materializeSymbol("tp53", { portraitAssetSha256: "d".repeat(64) }),
    /injected stable object failure/,
  )
})
