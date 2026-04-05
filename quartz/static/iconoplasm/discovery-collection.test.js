import assert from "node:assert/strict"
import test from "node:test"

import {
  HOME_COLLECTION_ORDERS,
  normalizeDiscoveryEntries,
  normalizeHomeCollectionOrder,
  sortDiscoveryEntries,
} from "./discovery-collection.js"

test("home collection orders include shortest-name sorting", () => {
  assert.ok(HOME_COLLECTION_ORDERS.some((option) => option.value === "shortest"))
  assert.ok(HOME_COLLECTION_ORDERS.some((option) => option.value === "votes"))
  assert.equal(normalizeHomeCollectionOrder("shortest"), "shortest")
  assert.equal(normalizeHomeCollectionOrder("recent"), "newest")
})

test("normalize discovery entries keeps full names and de-duplicates by symbol", () => {
  const entries = normalizeDiscoveryEntries([
    { gene_symbol: "furin", full_name: "Furin", encounter_count: 1 },
    { gene_symbol: "FURIN", full_name: "ignored duplicate", encounter_count: 99 },
  ])

  assert.equal(entries.length, 1)
  assert.equal(entries[0]?.gene_symbol, "FURIN")
  assert.equal(entries[0]?.full_name, "Furin")
  assert.equal(entries[0]?.encounter_count, 1)
  assert.equal(entries[0]?.weight_kg, null)
  assert.equal(entries[0]?.image_score, 0)
})

test("shortest-name sorting uses full-name length then stable tie-breaks", () => {
  const sorted = sortDiscoveryEntries(
    normalizeDiscoveryEntries([
      { gene_symbol: "PLXNB3", full_name: "Plexin-B3" },
      { gene_symbol: "NRM", full_name: "Nurim" },
      { gene_symbol: "OCA2", full_name: "P protein" },
      { gene_symbol: "FURIN", full_name: "Furin" },
      { gene_symbol: "ABCD", full_name: "Furin" },
    ]),
    "shortest",
  )

  assert.deepEqual(
    sorted.map((entry) => entry.gene_symbol),
    ["ABCD", "FURIN", "NRM", "OCA2", "PLXNB3"],
  )
})