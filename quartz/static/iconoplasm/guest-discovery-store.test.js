import assert from "node:assert/strict"
import test from "node:test"

import {
  createWebsiteGuestDiscoveryStore,
  normalizeWebsiteGuestDiscoveries,
  WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES,
  WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE,
} from "./guest-discovery-store.js"

function memoryStorage(initialValue) {
  const values = new Map()
  if (initialValue !== undefined) {
    values.set("iconoplasm.website-guest-discoveries.v1", initialValue)
  }
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null
    },
    setItem(key, value) {
      values.set(key, value)
    },
    read(key = "iconoplasm.website-guest-discoveries.v1") {
      return values.get(key)
    },
  }
}

test("website guest discovery storage normalizes, de-duplicates, and rejects invalid symbols", () => {
  const entries = normalizeWebsiteGuestDiscoveries(
    [
      {
        gene_symbol: "tp53",
        first_discovered_at: "2026-07-20T10:00:00.000Z",
        last_encountered_at: "2026-07-20T10:00:00.000Z",
      },
      {
        symbol: "TP53",
        first_discovered_at: "2026-07-19T10:00:00.000Z",
        last_encountered_at: "2026-07-21T10:00:00.000Z",
        encounter_count: 2,
      },
      { symbol: "../not-a-gene" },
    ],
    200,
  )

  assert.deepEqual(entries, [
    {
      gene_symbol: "TP53",
      first_discovered_at: "2026-07-19T10:00:00.000Z",
      last_encountered_at: "2026-07-21T10:00:00.000Z",
      encounter_count: 3,
    },
  ])
})

test("website guest discovery store persists dossier visits and clears only merged symbols", () => {
  const storage = memoryStorage()
  const times = [
    new Date("2026-07-24T10:00:00.000Z"),
    new Date("2026-07-24T11:00:00.000Z"),
    new Date("2026-07-24T12:00:00.000Z"),
  ]
  const store = createWebsiteGuestDiscoveryStore({
    storage,
    now: () => times.shift(),
  })

  store.remember("tp53")
  store.remember("brca1")
  store.remember("TP53")

  assert.deepEqual(store.pendingSymbols(), ["TP53", "BRCA1"])
  assert.deepEqual(store.pendingSymbols(1), ["TP53"])
  assert.equal(store.listEntries()[0].encounter_count, 2)
  store.remove(["TP53"])
  assert.deepEqual(store.pendingSymbols(), ["BRCA1"])

  const persisted = JSON.parse(storage.read())
  assert.equal(persisted.version, 2)
  assert.deepEqual(
    persisted.discoveries.map((entry) => entry[0]),
    ["BRCA1"],
  )
})

test("website guest discovery store keeps only the newest bounded entries", () => {
  const storage = memoryStorage()
  let tick = 0
  const store = createWebsiteGuestDiscoveryStore({
    storage,
    maxEntries: 3,
    now: () => new Date(Date.UTC(2026, 6, 24, 10, tick++)),
  })

  for (const symbol of ["A1BG", "INS", "RHO", "PRL"]) store.remember(symbol)

  assert.deepEqual(store.pendingSymbols(), ["INS", "RHO", "PRL"])
  assert.equal(WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES, 19_023)
  assert.equal(WEBSITE_GUEST_DISCOVERY_MERGE_BATCH_SIZE, 200)
})

test("website guest discovery store reads the compact full-catalog format", () => {
  const storage = memoryStorage(
    JSON.stringify({
      version: 2,
      discoveries: [
        ["TP53", Date.parse("2026-07-24T10:00:00.000Z"), Date.parse("2026-07-24T11:00:00.000Z"), 2],
      ],
    }),
  )
  const store = createWebsiteGuestDiscoveryStore({ storage })

  assert.deepEqual(store.listEntries(), [
    {
      gene_symbol: "TP53",
      first_discovered_at: "2026-07-24T10:00:00.000Z",
      last_encountered_at: "2026-07-24T11:00:00.000Z",
      encounter_count: 2,
    },
  ])
})

test("the complete 19,023-gene shelf stays compact enough for ordinary localStorage quotas", () => {
  const discoveries = Array.from(
    { length: WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES },
    (_value, index) => [
      `GENE${index}`,
      Date.parse("2026-07-24T10:00:00.000Z"),
      Date.parse("2026-07-24T10:00:00.000Z"),
      1,
    ],
  )
  const storage = memoryStorage(JSON.stringify({ version: 2, discoveries }))
  const store = createWebsiteGuestDiscoveryStore({
    storage,
    now: () => new Date("2026-07-24T11:00:00.000Z"),
  })

  assert.equal(store.listEntries().length, WEBSITE_GUEST_DISCOVERY_MAX_ENTRIES)
  store.remember("GENE0")
  assert.ok(
    storage.read().length < 1_250_000,
    `full compact shelf unexpectedly grew to ${storage.read().length.toLocaleString()} characters`,
  )
})

test("website guest discovery store stays usable when localStorage is unavailable", () => {
  const storage = {
    getItem() {
      throw new Error("blocked")
    },
    setItem() {
      throw new Error("blocked")
    },
  }
  const store = createWebsiteGuestDiscoveryStore({
    storage,
    now: () => new Date("2026-07-24T10:00:00.000Z"),
  })

  assert.doesNotThrow(() => store.remember("INS"))
  assert.deepEqual(store.pendingSymbols(), ["INS"])
})
