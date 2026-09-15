import assert from "node:assert/strict"
import test from "node:test"
import {
  compactShelfRowsFromChronology,
  compactSharedRowsFromSummaries,
  isoFromEpochSeconds,
  sortCompactShelfRows,
} from "./discovery-compact-read.js"

function event(symbol, at, overrides = {}) {
  return {
    seq: at,
    ordinal: 0,
    symbol,
    at,
    source: "extension_hover",
    trigger: "hover_dwell",
    dwell_ms: 900,
    ...overrides,
  }
}

test("shelf aggregation preserves first/last, repeat counts and provenance", () => {
  const rows = compactShelfRowsFromChronology({
    chunks: [
      {
        chunk_seq: 1,
        events: [event("TP53", 100), event("BRCA1", 110), event("TP53", 120)],
      },
    ],
    active_events: [
      event("TP53", 90, { source: "gene_page_visit", trigger: "gene_page_visit", dwell_ms: null }),
      event("EGFR", 130),
    ],
  })
  const tp53 = rows.find((row) => row.gene_symbol === "TP53")
  assert.equal(tp53.encounter_count, 3)
  assert.equal(tp53.first_discovered_at, isoFromEpochSeconds(90))
  assert.equal(tp53.last_encountered_at, isoFromEpochSeconds(120))
  assert.equal(tp53.first_source, "gene_page_visit")
  assert.equal(tp53.first_dwell_ms, null)
  assert.equal(tp53.last_source, "extension_hover")
  assert.deepEqual(
    rows.map((row) => row.gene_symbol),
    ["TP53", "BRCA1", "EGFR"],
  )
  assert.equal(rows[1].encounter_count, 1)
})

test("chunks are applied in chunk order regardless of read order", () => {
  const rows = compactShelfRowsFromChronology({
    chunks: [
      { chunk_seq: 2, events: [event("TP53", 300)] },
      { chunk_seq: 1, events: [event("TP53", 200)] },
    ],
    active_events: [],
  })
  assert.equal(rows[0].first_discovered_at, isoFromEpochSeconds(200))
  assert.equal(rows[0].last_encountered_at, isoFromEpochSeconds(300))
})

test("shared rows project discoverer counts through the ordinal dictionary", () => {
  const summaries = [
    { ordinal: 0, discoverer_count: 3, encounter_count: 5, first_at: 100, latest_at: 900 },
    { ordinal: 7, discoverer_count: 1, encounter_count: 1, first_at: 50, latest_at: 50 },
  ]
  const rows = compactSharedRowsFromSummaries(
    summaries,
    new Map([
      [0, "TP53"],
      [7, "BRCA1"],
    ]),
  )
  assert.deepEqual(
    rows.map((row) => [row.gene_symbol, row.encounter_count, row.first_discovered_at]),
    [
      ["BRCA1", 1, isoFromEpochSeconds(50)],
      ["TP53", 5, isoFromEpochSeconds(100)],
    ],
  )
  const missing = compactSharedRowsFromSummaries(
    [{ ordinal: 3, discoverer_count: 1, encounter_count: 1, first_at: 1, latest_at: 1 }],
    new Map(),
  )
  assert.deepEqual(missing, [])
})

test("newest order is timestamp-descending with a stable symbol tiebreak", () => {
  const rows = [
    { gene_symbol: "TP53", first_discovered_at: "2026-01-01T00:00:00.000Z" },
    { gene_symbol: "BRCA1", first_discovered_at: "2026-02-01T00:00:00.000Z" },
    { gene_symbol: "EGFR", first_discovered_at: "2026-02-01T00:00:00.000Z" },
  ]
  assert.deepEqual(
    sortCompactShelfRows(rows, "newest", null).map((row) => row.gene_symbol),
    ["BRCA1", "EGFR", "TP53"],
  )
  assert.deepEqual(
    sortCompactShelfRows(rows, "symbol", null).map((row) => row.gene_symbol),
    ["BRCA1", "EGFR", "TP53"],
  )
})
