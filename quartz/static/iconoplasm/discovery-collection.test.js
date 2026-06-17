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
  assert.deepEqual(
    HOME_COLLECTION_ORDERS.find((option) => option.value === "newest"),
    { value: "newest", label: "Recently discovered" },
  )
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

test("newest sorting is the user's discovery log, not gene age or portrait freshness", () => {
  const sorted = sortDiscoveryEntries(
    normalizeDiscoveryEntries([
      {
        gene_symbol: "OLDGENE",
        full_name: "Old organismal gene",
        age_years: 900,
        first_discovered_at: "2026-04-29T12:00:00.000Z",
        last_encountered_at: "2026-04-29T12:00:00.000Z",
        published_at: "2026-04-29T12:00:00.000Z",
      },
      {
        gene_symbol: "NEW101",
        full_name: "The one hundred and first discovery",
        age_years: 1,
        first_discovered_at: "2026-04-30T12:00:00.000Z",
        last_encountered_at: "2026-04-30T12:00:00.000Z",
        published_at: "2020-01-01T00:00:00.000Z",
      },
      {
        gene_symbol: "YOUNG",
        full_name: "Young gene characteristic",
        age_years: 1,
        first_discovered_at: "2026-04-28T12:00:00.000Z",
        last_encountered_at: "2026-04-28T12:00:00.000Z",
        published_at: "2026-04-30T12:00:00.000Z",
      },
    ]),
    "newest",
  )

  assert.deepEqual(
    sorted.map((entry) => entry.gene_symbol),
    ["NEW101", "OLDGENE", "YOUNG"],
  )
})

test("newest sorting does not move an older discovery after it is encountered again", () => {
  const sorted = sortDiscoveryEntries(
    normalizeDiscoveryEntries([
      {
        gene_symbol: "OLDHOVER",
        first_discovered_at: "2026-01-01T00:00:00.000Z",
        last_encountered_at: "2026-05-02T00:00:00.000Z",
      },
      {
        gene_symbol: "NEWDISC",
        first_discovered_at: "2026-05-01T00:00:00.000Z",
        last_encountered_at: "2026-05-01T00:00:00.000Z",
      },
      {
        gene_symbol: "MIDDISC",
        first_discovered_at: "2026-04-15T00:00:00.000Z",
        last_encountered_at: "2026-04-15T00:00:00.000Z",
      },
    ]),
    "newest",
  )

  assert.deepEqual(
    sorted.map((entry) => entry.gene_symbol),
    ["NEWDISC", "MIDDISC", "OLDHOVER"],
  )
})
