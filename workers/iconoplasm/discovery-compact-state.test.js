import assert from "node:assert/strict"
import test from "node:test"
import {
  DISCOVERY_CHUNK_EVENTS,
  applyDiscoveryBatch,
  applySharedDiscoveryDeltas,
  createDiscoveryOrdinalDictionary,
  discoveryMembershipByteLength,
  hasDiscoveryOrdinal,
  readSharedDiscoveryOrdinal,
} from "./discovery-compact-state.js"

const dictionary = createDiscoveryOrdinalDictionary([
  { symbol: "TP53", ordinal: 0 },
  { symbol: "BRCA1", ordinal: 7 },
  { symbol: "EGFR", ordinal: 19022 },
])

test("19023 stable ordinals occupy exactly 2378 membership bytes", () => {
  assert.equal(discoveryMembershipByteLength(19022), 2378)
})

test("batch merges membership, preserves repeat chronology and is idempotent by batch id", () => {
  const first = applyDiscoveryBatch(null, {
    batchId: "device-a:1",
    dictionary,
    encounters: [
      { symbol: "TP53", at: 100, source: "extension", trigger: "hover", dwell_ms: 900 },
      { symbol: "TP53", at: 110, source: "extension", trigger: "hover", dwell_ms: 1200 },
      { symbol: "BRCA1", at: 120, source: "extension", trigger: "hover", dwell_ms: 1000 },
    ],
  })
  assert.equal(first.state.member_count, 2)
  assert.equal(first.state.active_events.length, 3)
  assert.equal(first.shared_deltas.find((delta) => delta.ordinal === 0).encounters, 2)
  assert.equal(first.shared_deltas.find((delta) => delta.ordinal === 0).new_member, true)
  assert.equal(hasDiscoveryOrdinal(first.state.membership_b64, 0), true)
  assert.equal(hasDiscoveryOrdinal(first.state.membership_b64, 7), true)
  assert.equal(hasDiscoveryOrdinal(first.state.membership_b64, 19022), false)

  const replay = applyDiscoveryBatch(first.state, {
    batchId: "device-a:1",
    dictionary,
    encounters: [{ symbol: "EGFR", at: 130 }],
  })
  assert.equal(replay.replay, true)
  assert.deepEqual(replay.state, first.state)
  assert.equal(replay.shared_deltas.length, 0)
})

test("later batches set new bits without moving earlier ordinals", () => {
  const first = applyDiscoveryBatch(null, {
    batchId: "a",
    dictionary,
    encounters: [{ symbol: "TP53", at: 1 }],
  })
  const later = applyDiscoveryBatch(first.state, {
    batchId: "b",
    dictionary,
    encounters: [{ symbol: "EGFR", at: 2 }],
  })
  assert.equal(later.state.member_count, 2)
  assert.equal(hasDiscoveryOrdinal(later.state.membership_b64, 0), true)
  assert.equal(hasDiscoveryOrdinal(later.state.membership_b64, 19022), true)
})

test("chronology seals fixed bounded chunks without acknowledging away events", () => {
  const encounters = Array.from({ length: DISCOVERY_CHUNK_EVENTS + 3 }, (_, i) => ({
    symbol: i % 2 ? "TP53" : "BRCA1",
    at: 1000 + i,
    source: "test",
    trigger: "hover",
  }))
  const result = applyDiscoveryBatch(null, { batchId: "chunk", dictionary, encounters })
  assert.equal(result.sealed_chunks.length, 1)
  assert.equal(result.sealed_chunks[0].events.length, DISCOVERY_CHUNK_EVENTS)
  assert.equal(result.state.active_events.length, 3)
  assert.equal(result.sealed_chunks[0].first_event_seq, 1)
  assert.equal(result.sealed_chunks[0].last_event_seq, DISCOVERY_CHUNK_EVENTS)
})

test("shared compact arrays preserve exact discoverer, encounter and time summaries", () => {
  const first = applyDiscoveryBatch(null, {
    batchId: "one",
    dictionary,
    encounters: [
      { symbol: "TP53", at: 100 },
      { symbol: "TP53", at: 105 },
      { symbol: "BRCA1", at: 110 },
    ],
  })
  let shared = applySharedDiscoveryDeltas(null, {
    dictionaryVersion: dictionary.version,
    deltas: first.shared_deltas,
  })
  assert.deepEqual(readSharedDiscoveryOrdinal(shared, 0), {
    discoverer_count: 1,
    encounter_count: 2,
    first_at: 100,
    latest_at: 105,
  })
  const repeat = applyDiscoveryBatch(first.state, {
    batchId: "two",
    dictionary,
    encounters: [{ symbol: "TP53", at: 200 }],
  })
  assert.equal(repeat.shared_deltas[0].new_member, false)
  shared = applySharedDiscoveryDeltas(shared, {
    dictionaryVersion: dictionary.version,
    deltas: repeat.shared_deltas,
  })
  assert.deepEqual(readSharedDiscoveryOrdinal(shared, 0), {
    discoverer_count: 1,
    encounter_count: 3,
    first_at: 100,
    latest_at: 200,
  })
})

test("dictionary rejects ordinal reuse and later dictionary versions preserve prior positions", () => {
  assert.throws(
    () =>
      createDiscoveryOrdinalDictionary([
        { symbol: "TP53", ordinal: 1 },
        { symbol: "BRCA1", ordinal: 1 },
      ]),
    /Duplicate/,
  )
  const v2 = createDiscoveryOrdinalDictionary(
    [
      { symbol: "TP53", ordinal: 0 },
      { symbol: "BRCA1", ordinal: 7 },
      { symbol: "EGFR", ordinal: 19022 },
      { symbol: "NEW1", ordinal: 19023 },
    ],
    { version: 2 },
  )
  const prior = applyDiscoveryBatch(null, {
    batchId: "prior",
    dictionary,
    encounters: [{ symbol: "TP53", at: 1 }],
  })
  const next = applyDiscoveryBatch(prior.state, {
    batchId: "next",
    dictionary: v2,
    encounters: [{ symbol: "NEW1", at: 2 }],
  })
  assert.equal(hasDiscoveryOrdinal(next.state.membership_b64, 0), true)
  assert.equal(hasDiscoveryOrdinal(next.state.membership_b64, 19023), true)
})
