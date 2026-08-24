import assert from "node:assert/strict"
import test from "node:test"

import { pagePublishedCardCatalogArtifact } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

class FakeKv {
  constructor(entries) {
    this.entries = new Map(entries)
    this.reads = []
  }

  async get(key) {
    this.reads.push(key)
    return this.entries.get(key) ?? null
  }
}

function card(symbol) {
  return {
    symbol,
    payload: { symbol, canonical_symbol: symbol, full_name: `${symbol} full name` },
  }
}

test("published blot pagination walks the immutable published shards, not D1 catalog rows", async () => {
  const version = "ccv1-blot-pagination"
  const firstKey = "iconoplasm:card-catalog-shard:first"
  const secondKey = "iconoplasm:card-catalog-shard:second"
  const kv = new FakeKv([
    [
      `iconoplasm:card-catalog:${version}`,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        artifact_version: version,
        storage: "kv_card_catalog_content_addressed_shards",
        shards: [
          {
            key: firstKey,
            index: 0,
            card_count: 3,
            content_hash: "first",
            first_symbol: "A1BG",
            last_symbol: "A2M",
          },
          {
            key: secondKey,
            index: 1,
            card_count: 3,
            content_hash: "second",
            first_symbol: "A2ML1",
            last_symbol: "ABAT",
          },
        ],
      }),
    ],
    [
      firstKey,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        storage: "kv_card_catalog_content_addressed_shards",
        content_hash: "first",
        cards: [card("A1BG"), card("A1CF"), card("A2M")],
      }),
    ],
    [
      secondKey,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        storage: "kv_card_catalog_content_addressed_shards",
        content_hash: "second",
        cards: [card("A2ML1"), card("A4GALT"), card("ABAT")],
      }),
    ],
  ])

  const first = await pagePublishedCardCatalogArtifact({ KV: kv }, version, { after: "", limit: 4 })
  assert.deepEqual(
    first.records.map((item) => item.symbol),
    ["A1BG", "A1CF", "A2M", "A2ML1"],
  )
  assert.equal(first.records[0].full_name, "A1BG full name")
  assert.equal(first.total_count, 6)
  assert.equal(first.done, false)
  assert.equal(first.next_after, "A2ML1")

  const second = await pagePublishedCardCatalogArtifact({ KV: kv }, version, {
    after: first.next_after,
    limit: 4,
  })
  assert.deepEqual(
    second.records.map((item) => item.symbol),
    ["A4GALT", "ABAT"],
  )
  assert.equal(second.done, true)
  assert.equal(second.total_count, 6)
  assert.equal(second.next_after, "ABAT")
})

test("published blot pagination skips shards wholly before the resume cursor", async () => {
  const version = "ccv1-blot-resume"
  const oldKey = "iconoplasm:card-catalog-shard:old"
  const currentKey = "iconoplasm:card-catalog-shard:current"
  const kv = new FakeKv([
    [
      `iconoplasm:card-catalog:${version}`,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        artifact_version: version,
        storage: "kv_card_catalog_content_addressed_shards",
        shards: [
          {
            key: oldKey,
            index: 0,
            card_count: 1,
            content_hash: "old",
            first_symbol: "A1BG",
            last_symbol: "A1BG",
          },
          {
            key: currentKey,
            index: 1,
            card_count: 1,
            content_hash: "current",
            first_symbol: "TP53",
            last_symbol: "TP53",
          },
        ],
      }),
    ],
    [
      oldKey,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        storage: "kv_card_catalog_content_addressed_shards",
        content_hash: "old",
        cards: [card("A1BG")],
      }),
    ],
    [
      currentKey,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        storage: "kv_card_catalog_content_addressed_shards",
        content_hash: "current",
        cards: [card("TP53")],
      }),
    ],
  ])

  const page = await pagePublishedCardCatalogArtifact({ KV: kv }, version, {
    after: "A1BG",
    limit: 100,
  })
  assert.deepEqual(
    page.records.map((item) => item.symbol),
    ["TP53"],
  )
  assert.equal(page.total_count, 2)
  assert.equal(kv.reads.includes(oldKey), false)
})

test("published blot pagination safely amortizes a 250-gene workstation slice", async () => {
  const version = "ccv1-blot-250"
  const shardKey = "iconoplasm:card-catalog-shard:large"
  const cards = Array.from({ length: 300 }, (_value, index) =>
    card(`GENE${String(index).padStart(3, "0")}`),
  )
  const kv = new FakeKv([
    [
      `iconoplasm:card-catalog:${version}`,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        artifact_version: version,
        storage: "kv_card_catalog_content_addressed_shards",
        shards: [
          {
            key: shardKey,
            index: 0,
            card_count: cards.length,
            content_hash: "large",
            first_symbol: cards[0].symbol,
            last_symbol: cards.at(-1).symbol,
          },
        ],
      }),
    ],
    [
      shardKey,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        storage: "kv_card_catalog_content_addressed_shards",
        content_hash: "large",
        cards,
      }),
    ],
  ])

  const page = await pagePublishedCardCatalogArtifact({ KV: kv }, version, {
    after: "",
    limit: 1_000,
  })

  assert.equal(page.records.length, 250)
  assert.equal(page.next_after, "GENE249")
  assert.equal(page.done, false)
  assert.equal(page.total_count, 300)
})
