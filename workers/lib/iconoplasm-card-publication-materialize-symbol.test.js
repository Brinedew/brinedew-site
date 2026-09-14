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

function fakeObjects() {
  const written = []
  const hashByKind = { cards: "a", genes: "b", portraits: "c" }
  return {
    written,
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
