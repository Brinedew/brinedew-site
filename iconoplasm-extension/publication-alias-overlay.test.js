import assert from "node:assert/strict"
import test from "node:test"

import { iconoplasmPublicationAliasManifest } from "../workers/iconoplasm-publication-aliases.js"

await import("./publication-alias-overlay.js")
await import("./content-matcher.js")

const overlayApi = globalThis.IconoplasmPublicationAliasOverlay
const matcherApi = globalThis.IconoplasmContentMatcher

const requestedOverlay = {
  schema_version: 1,
  version: "v1-test",
  alias_count: 8,
  by_symbol: {
    CEBPB: ["C/EBPβ"],
    CGAS: ["cGAS"],
    IL1A: ["IL-1", "IL-1α"],
    IL1B: ["IL-1β"],
    NOTCH1: ["N1ICD"],
    RELA: ["p65"],
    TGFB1: ["TGF-β"],
  },
}

function baseGeneMap() {
  return Object.fromEntries(
    Object.keys(requestedOverlay.by_symbol).map((symbol) => [symbol, { n: symbol }]),
  )
}

test("every tracked publication alias is recognized by the real extension matcher", async () => {
  const manifest = await iconoplasmPublicationAliasManifest()
  const overlay = overlayApi.normalizePublishedAliasOverlay(manifest)
  const policySymbols = new Set([
    ...Object.keys(manifest.by_symbol),
    ...Object.keys(manifest.remove_by_symbol),
  ])
  const genes = Object.fromEntries(
    Array.from(policySymbols, (symbol) => [
      symbol,
      symbol === "CDH17" ? { n: symbol, a: ["HPT-1", "cadherin"] } : { n: symbol },
    ]),
  )
  const result = overlayApi.applyPublishedAliasOverlay(genes, overlay)

  assert.deepEqual(result.errors, [])
  const matcher = matcherApi.createGeneMatcher(result.genes)
  for (const [symbol, aliases] of Object.entries(manifest.by_symbol)) {
    for (const alias of aliases) {
      const matches = matcher.findMatches(`before ${alias} after`)
      assert.ok(
        matches.some((match) => match.symbol === symbol && match.text === alias),
        `${alias} should match ${symbol}`,
      )
    }
  }
  assert.deepEqual(result.genes.CDH17.a, ["HPT-1"])
  assert.deepEqual(matcher.findMatches("a generic cadherin family protein"), [])
})

test("manifest alias overlay makes every reported label match its canonical gene", () => {
  const overlay = overlayApi.normalizePublishedAliasOverlay(requestedOverlay)
  const result = overlayApi.applyPublishedAliasOverlay(baseGeneMap(), overlay)

  assert.deepEqual(result.errors, [])
  const matcher = matcherApi.createGeneMatcher(result.genes)
  const matches = matcher
    .findMatches("C/EBPβ IL-1 p65 TGF-β N1ICD IL-1α IL-1β cGAS")
    .map(({ symbol, text }) => `${text}:${symbol}`)

  assert.deepEqual(matches, [
    "C/EBPβ:CEBPB",
    "IL-1:IL1A",
    "p65:RELA",
    "TGF-β:TGFB1",
    "N1ICD:NOTCH1",
    "IL-1α:IL1A",
    "IL-1β:IL1B",
    "cGAS:CGAS",
  ])
})

test("an alias-only refresh removes the previous overlay without refetching the base catalog", () => {
  const genes = { RELA: { a: ["NFKB3"] }, NOTCH1: {} }
  const firstOverlay = overlayApi.normalizePublishedAliasOverlay({
    schema_version: 1,
    version: "v1-first",
    alias_count: 2,
    by_symbol: { NOTCH1: ["N1ICD"], RELA: ["p65"] },
  })
  const first = overlayApi.applyPublishedAliasOverlay(genes, firstOverlay)
  const secondOverlay = overlayApi.normalizePublishedAliasOverlay({
    schema_version: 1,
    version: "v1-second",
    alias_count: 1,
    by_symbol: { RELA: ["p65"] },
  })
  const second = overlayApi.applyPublishedAliasOverlay(first.genes, secondOverlay, first.applied)

  assert.deepEqual(second.errors, [])
  assert.deepEqual(second.genes.RELA.a, ["NFKB3", "p65"])
  assert.equal(second.genes.NOTCH1.a, undefined)
})

test("overlay bookkeeping never removes an alias that already belongs to the base artifact", () => {
  const overlay = overlayApi.normalizePublishedAliasOverlay({
    schema_version: 1,
    version: "v1-existing",
    alias_count: 1,
    by_symbol: { RELA: ["p65"] },
  })
  const first = overlayApi.applyPublishedAliasOverlay({ RELA: { a: ["p65"] } }, overlay)
  const second = overlayApi.applyPublishedAliasOverlay(first.genes, null, first.applied)

  assert.deepEqual(first.applied, { added_by_symbol: {}, removed_by_symbol: {} })
  assert.deepEqual(second.genes.RELA.a, ["p65"])
})

test("cadherin policy preserves specific labels and reverses without an artifact refetch", async () => {
  const manifest = await iconoplasmPublicationAliasManifest()
  const overlay = overlayApi.normalizePublishedAliasOverlay({
    schema_version: manifest.schema_version,
    version: manifest.version,
    alias_count: manifest.by_symbol.CDH1.length + manifest.by_symbol.CDH2.length,
    removal_count: manifest.removal_count,
    by_symbol: { CDH1: manifest.by_symbol.CDH1, CDH2: manifest.by_symbol.CDH2 },
    remove_by_symbol: manifest.remove_by_symbol,
  })
  const baseGenes = {
    CDH1: { a: ["CD324"] },
    CDH2: { a: ["NCAD"] },
    CDH17: { a: ["HPT-1", "cadherin"] },
  }
  const applied = overlayApi.applyPublishedAliasOverlay(baseGenes, overlay)

  assert.deepEqual(applied.errors, [])
  assert.deepEqual(applied.genes.CDH17.a, ["HPT-1"])
  const matcher = matcherApi.createGeneMatcher(applied.genes)
  assert.deepEqual(
    matcher
      .findMatches(
        "cadherin Cadherin cadherins Cadherins E-cadherin E-Cadherin E‑cadherin E–Cadherin E cadherins E Cadherins N-cadherin N-Cadherin N‑cadherins N–Cadherins N cadherins N Cadherins",
      )
      .map(({ text, symbol }) => `${text}:${symbol}`),
    [
      "E-cadherin:CDH1",
      "E-Cadherin:CDH1",
      "E‑cadherin:CDH1",
      "E–Cadherin:CDH1",
      "E cadherins:CDH1",
      "E Cadherins:CDH1",
      "N-cadherin:CDH2",
      "N-Cadherin:CDH2",
      "N‑cadherins:CDH2",
      "N–Cadherins:CDH2",
      "N cadherins:CDH2",
      "N Cadherins:CDH2",
    ],
  )

  const reverted = overlayApi.applyPublishedAliasOverlay(applied.genes, null, applied.applied)
  assert.deepEqual(reverted.genes.CDH1.a, ["CD324"])
  assert.deepEqual(reverted.genes.CDH2.a, ["NCAD"])
  assert.deepEqual(reverted.genes.CDH17.a, ["HPT-1", "cadherin"])
})

test("malformed or ambiguous manifest overlays fail validation", () => {
  assert.equal(
    overlayApi.normalizePublishedAliasOverlay({
      schema_version: 1,
      version: "v1-bad-count",
      alias_count: 2,
      by_symbol: { RELA: ["p65"] },
    }),
    null,
  )
  assert.equal(
    overlayApi.normalizePublishedAliasOverlay({
      schema_version: 1,
      version: "v1-ambiguous",
      alias_count: 2,
      by_symbol: { RELA: ["p65"], RPRM: ["P65"] },
    }),
    null,
  )
  assert.equal(
    overlayApi.normalizePublishedAliasOverlay({
      schema_version: 1,
      version: "v1-bad-removal-count",
      alias_count: 0,
      removal_count: 2,
      by_symbol: {},
      remove_by_symbol: { CDH17: ["cadherin"] },
    }),
    null,
  )
  assert.equal(
    overlayApi.normalizePublishedAliasOverlay({
      schema_version: 1,
      version: "v1-conflicting-operation",
      alias_count: 1,
      removal_count: 1,
      by_symbol: { CDH17: ["cadherin"] },
      remove_by_symbol: { CDH17: ["Cadherin"] },
    }),
    null,
  )
})
