import assert from "node:assert/strict"
import test from "node:test"
import {
  discoveryOrdinalLookup,
  evolveDiscoveryOrdinalDictionary,
} from "./discovery-ordinal-dictionary.js"

test("initial seed is deterministic but later genes append instead of renumbering", () => {
  const initial = evolveDiscoveryOrdinalDictionary({ symbols: ["TP53", "BRCA1", "EGFR"] })
  assert.deepEqual(
    initial.entries.map(({ ordinal, symbol }) => [ordinal, symbol]),
    [
      [0, "BRCA1"],
      [1, "EGFR"],
      [2, "TP53"],
    ],
  )
  assert.equal(initial.version, 1)

  const later = evolveDiscoveryOrdinalDictionary({
    previous: initial,
    symbols: ["A1BG", "TP53", "BRCA1", "EGFR"],
  })
  assert.deepEqual(
    later.entries.map(({ ordinal, symbol }) => [ordinal, symbol]),
    [
      [0, "BRCA1"],
      [1, "EGFR"],
      [2, "TP53"],
      [3, "A1BG"],
    ],
  )
  assert.equal(later.version, 2)
})

test("canonical rename preserves the ordinal and keeps the old symbol as an alias", () => {
  const initial = evolveDiscoveryOrdinalDictionary({ symbols: ["OLD1", "TP53"] })
  const ordinal = discoveryOrdinalLookup(initial).byName.get("OLD1")
  const renamed = evolveDiscoveryOrdinalDictionary({
    previous: initial,
    symbols: ["NEW1", "TP53"],
    aliases: { OLD1: "NEW1" },
  })
  const lookup = discoveryOrdinalLookup(renamed)
  assert.equal(lookup.byName.get("NEW1"), ordinal)
  assert.equal(lookup.byName.get("OLD1"), ordinal)
  assert.equal(lookup.byOrdinal.get(ordinal).symbol, "NEW1")
  assert.deepEqual(lookup.byOrdinal.get(ordinal).aliases, ["OLD1"])
  assert.equal(lookup.byOrdinal.get(ordinal).active, true)
})

test("retired ordinals remain reserved and are never recycled", () => {
  const initial = evolveDiscoveryOrdinalDictionary({ symbols: ["BRCA1", "TP53"] })
  const retiredOrdinal = discoveryOrdinalLookup(initial).byName.get("BRCA1")
  const retired = evolveDiscoveryOrdinalDictionary({ previous: initial, symbols: ["TP53"] })
  assert.equal(discoveryOrdinalLookup(retired).byOrdinal.get(retiredOrdinal).active, false)

  const appended = evolveDiscoveryOrdinalDictionary({
    previous: retired,
    symbols: ["TP53", "EGFR"],
  })
  const lookup = discoveryOrdinalLookup(appended)
  assert.equal(lookup.byName.get("BRCA1"), retiredOrdinal)
  assert.notEqual(lookup.byName.get("EGFR"), retiredOrdinal)
  assert.ok(lookup.byName.get("EGFR") > Math.max(...initial.entries.map((entry) => entry.ordinal)))
})

test("unchanged catalog keeps the dictionary version stable", () => {
  const initial = evolveDiscoveryOrdinalDictionary({ symbols: ["BRCA1", "TP53"] })
  const same = evolveDiscoveryOrdinalDictionary({
    previous: initial,
    symbols: ["TP53", "BRCA1"],
  })
  assert.equal(same.version, initial.version)
  assert.deepEqual(same.entries, initial.entries)
})

test("ambiguous aliases and duplicate historical ownership fail closed", () => {
  assert.throws(
    () =>
      discoveryOrdinalLookup({
        version: 1,
        entries: [
          { ordinal: 0, symbol: "TP53", aliases: ["OLD"] },
          { ordinal: 1, symbol: "BRCA1", aliases: ["OLD"] },
        ],
      }),
    /ambiguous/i,
  )
  assert.throws(
    () =>
      evolveDiscoveryOrdinalDictionary({
        previous: {
          version: 1,
          entries: [
            { ordinal: 0, symbol: "OLD1", aliases: [] },
            { ordinal: 1, symbol: "NEW1", aliases: [] },
          ],
        },
        symbols: ["NEW1"],
        aliases: { OLD1: "NEW1" },
      }),
    /Two discovery ordinals/i,
  )
})
