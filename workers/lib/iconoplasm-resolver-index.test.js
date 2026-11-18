import assert from "node:assert/strict"
import test from "node:test"

import {
  buildCompactResolverIndex,
  buildCompactResolverOverlay,
  isValidCompactResolverIndex,
  resolveIdentifierFromCompactIndex,
} from "./iconoplasm-resolver-index.js"

test("compact resolver index preserves symbol, uniprot, case-sensitive alias, and overlay rules", () => {
  const index = buildCompactResolverIndex(
    [
      { s: "A1BG", u: "P04217", a: [] },
      { s: "CCNH", u: "P51946", a: [] },
      { s: "CDH1", u: "P12830", a: ["CD324"] },
      { s: "CDH17", u: "Q12864", a: ["HPT-1", "cadherin"] },
      { s: "HBA1", u: "P69905", a: ["AMBIG"] },
      { s: "HBA2", u: "P69905", a: ["AMBIG", "pipe|alias^2%"] },
      { s: "NOLC1", u: "Q14978", a: ["P130"] },
      { s: "RBL2", u: "Q08999", a: ["p130"] },
      { s: "SOSTDC1", u: "Q6X4U4", a: ["USAG1"] },
    ],
    { generatedAt: "2026-11-18T00:00:00.000Z" },
  )

  assert.equal(isValidCompactResolverIndex(index), true)
  assert.equal(index.gene_count, 9)
  assert.equal(index.entries.includes("\\"), false, "no JSON string backslashes")

  const overlay = buildCompactResolverOverlay(index, {
    by_symbol: {
      CCNH: ["Cyclin H"],
      CDH1: ["E-cadherin", "E cadherins"],
      ABSENT1: ["ghostAlias"],
    },
    remove_by_symbol: {
      CDH17: ["cadherin"],
    },
  })

  const resolve = (value) => resolveIdentifierFromCompactIndex(index, value, overlay)

  assert.deepEqual(resolve("a1bg"), {
    requested: "a1bg",
    found: true,
    canonical_symbol: "A1BG",
    matched_by: "symbol",
  })
  assert.deepEqual(resolve("p04217"), {
    requested: "p04217",
    found: true,
    canonical_symbol: "A1BG",
    matched_by: "uniprot",
  })
  // Duplicated UniProt accession resolves alphabetically first (HBA1 before HBA2).
  assert.equal(resolve("P69905").canonical_symbol, "HBA1")
  assert.equal(resolve("USAG1").canonical_symbol, "SOSTDC1")
  assert.equal(resolve("usag1").found, false)
  // Case sensitivity preserved on exact aliases.
  assert.equal(resolve("P130").canonical_symbol, "NOLC1")
  assert.equal(resolve("p130").canonical_symbol, "RBL2")
  // Ambiguous base alias stays unresolved.
  assert.equal(resolve("AMBIG").found, false)
  // Delimiter-bearing alias round-trips without corrupting records.
  assert.equal(resolve("pipe|alias^2%").canonical_symbol, "HBA2")
  // Curated overlay additions & retractions.
  assert.equal(resolve("Cyclin H").canonical_symbol, "CCNH")
  assert.equal(resolve("E\u2014cadherin").canonical_symbol, "CDH1")
  assert.equal(resolve("E cadherins").canonical_symbol, "CDH1")
  assert.equal(resolve("cadherin").found, false)
  // Curated additions for absent genes never invent catalog entries.
  assert.equal(resolve("ghostAlias").found, false)
})

test("compact resolver handles curated collision against an active base owner", () => {
  const index = buildCompactResolverIndex([
    { s: "CXCL8", u: "", a: [] },
    { s: "OTHER", u: "", a: ["IL8"] },
  ])
  const overlay = buildCompactResolverOverlay(index, {
    by_symbol: { CXCL8: ["IL8"] },
    remove_by_symbol: {},
  })
  assert.equal(resolveIdentifierFromCompactIndex(index, "IL8", overlay).found, false)
})
