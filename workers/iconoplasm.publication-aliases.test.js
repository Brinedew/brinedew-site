import assert from "node:assert/strict"
import test from "node:test"

import {
  applyIconoplasmPublicationAliasPolicyToGene,
  expandIconoplasmPublicationAliasForms,
  ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
  iconoplasmPublicationAliasManifest,
  validateIconoplasmPublicationAliases,
} from "./iconoplasm-publication-aliases.js"

test("spelling families expand into an inspectable concrete dictionary", () => {
  assert.deepEqual(
    expandIconoplasmPublicationAliasForms({
      parts: [["A"], ["kinase", "Kinase"]],
      separators: ["-", " "],
      suffixes: ["", "s"],
    }),
    [
      "A-kinase",
      "A-Kinase",
      "A kinase",
      "A Kinase",
      "A-kinases",
      "A-Kinases",
      "A kinases",
      "A Kinases",
    ],
  )
})

test("tracked publication aliases cover the curated labels that failed on real pages", () => {
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol.CEBPB, ["C/EBPβ"])
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol.CGAS, ["cGAS"])
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol.IL1A, ["IL-1", "IL-1α"])
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol.IL1B, ["IL-1β"])
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol.NOTCH1, ["N1ICD"])
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol.RELA, ["p65"])
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol.TGFB1, ["TGF-β"])
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol.CDH1, [
    "E-cadherin",
    "E-Cadherin",
    "E cadherin",
    "E Cadherin",
    "E-cadherins",
    "E-Cadherins",
    "E cadherins",
    "E Cadherins",
  ])
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol.CDH2, [
    "N-cadherin",
    "N-Cadherin",
    "N cadherin",
    "N Cadherin",
    "N-cadherins",
    "N-Cadherins",
    "N cadherins",
    "N Cadherins",
  ])
  assert.deepEqual(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.remove_by_symbol.CDH17, ["cadherin"])
})

test("publication alias manifest is deterministic and small enough to inline", async () => {
  const first = await iconoplasmPublicationAliasManifest()
  const second = await iconoplasmPublicationAliasManifest()

  assert.equal(first, second)
  assert.match(first.version, /^v1-[a-f0-9]{16}$/)
  assert.equal(first.alias_count, 45)
  assert.equal(first.removal_count, 1)
  assert.ok(
    Buffer.byteLength(JSON.stringify(first), "utf8") < 4096,
    "the alias overlay should stay cheaper than a second request or catalog refetch",
  )
})

test("publication aliases reject ambiguous and unknown canonical mappings", () => {
  assert.throws(
    () =>
      validateIconoplasmPublicationAliases(
        { RELA: ["p65"], RPRM: ["P65"] },
        { canonicalSymbols: ["RELA", "RPRM"] },
      ),
    /Ambiguous publication alias/,
  )
  assert.throws(
    () =>
      validateIconoplasmPublicationAliases(
        { NOT_A_GENE: ["Alias"] },
        { canonicalSymbols: ["RELA"] },
      ),
    /Unknown canonical publication-alias symbol/,
  )
  assert.throws(
    () =>
      validateIconoplasmPublicationAliases(
        { CDH17: ["cadherin"] },
        { canonicalSymbols: ["CDH17"], rawRemovals: { CDH17: ["cadherin"] } },
      ),
    /cannot be added and removed/,
  )
})

test("server-side gene views apply additions and ownership-scoped removals immutably", () => {
  const baseGene = Object.freeze({ s: "RELA", n: "RELA proto-oncogene", a: ["NFKB3"] })
  const merged = applyIconoplasmPublicationAliasPolicyToGene(
    baseGene,
    "RELA",
    ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
  )
  const baseCadherin = Object.freeze({ s: "CDH17", a: Object.freeze(["HPT-1", "cadherin"]) })
  const correctedCadherin = applyIconoplasmPublicationAliasPolicyToGene(
    baseCadherin,
    "CDH17",
    ICONOPLASM_DEFAULT_PUBLICATION_ALIASES,
  )

  assert.deepEqual(baseGene.a, ["NFKB3"])
  assert.deepEqual(merged.a, ["NFKB3", "p65"])
  assert.deepEqual(baseCadherin.a, ["HPT-1", "cadherin"])
  assert.deepEqual(correctedCadherin.a, ["HPT-1"])
})
