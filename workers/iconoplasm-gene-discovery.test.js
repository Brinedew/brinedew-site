import assert from "node:assert/strict"
import test from "node:test"

import {
  ICONOPLASM_GENE_RANGE_CONTRACT_VERSION,
  ICONOPLASM_GENE_RANGES,
  ICONOPLASM_PORTRAIT_DISCOVERY_CONTRACT_VERSION,
  buildIconoplasmGeneDiscoverySnapshot,
  buildIconoplasmGeneRangeSitemapXml,
  buildIconoplasmLlmsTxt,
  buildIconoplasmSitemapIndexXml,
  buildIconoplasmStaticPagesSitemapXml,
  iconoplasmPublishedPortraitUrl,
  iconoplasmGeneRangeBySlug,
  iconoplasmGeneRangeForSymbol,
  iconoplasmPublishedGeneRecordIsDiscoveryCandidate,
  renderIconoplasmGeneIndexHtml,
  renderIconoplasmGeneRangeHtml,
} from "./iconoplasm-gene-discovery.js"

const PORTRAIT_SHA = "a".repeat(64)

function publishedGene(symbol, name = `full name for ${symbol}`) {
  return {
    s: symbol,
    n: name,
    p: { asset_sha256: PORTRAIT_SHA },
  }
}

function completeRangeFixture() {
  let serial = 0
  const genes = []
  for (const range of ICONOPLASM_GENE_RANGES) {
    for (const prefix of range.prefixes) {
      serial += 1
      genes.push(publishedGene(`${prefix}X${serial}`))
    }
  }
  return genes
}

function publishedCardProjection(genes, { missingBlotSymbols = [] } = {}) {
  const bySymbol = new Map()
  const missing = new Set(missingBlotSymbols)
  for (const gene of genes) {
    bySymbol.set(gene.s, {
      blot: missing.has(gene.s)
        ? null
        : {
            status: "ready",
            blot_fingerprint: "b".repeat(32),
            image_url: `https://iconoplasmportraits.b-cdn.net/blots/v1/${gene.s[0]}/${gene.s}/${"b".repeat(32)}/${gene.s}-iconoplasm-gene-blot.webp`,
            canonical_url: `https://iconoplasm.brinedew.bio/blots/v1/${gene.s[0]}/${gene.s}/${"b".repeat(32)}/${gene.s}-iconoplasm-gene-blot.webp`,
            semantic_url: `https://iconoplasm.brinedew.bio/blot/${gene.s}.webp`,
            width: 768,
            height: 1024,
          },
    })
  }
  return { version: "card-fixture-v1", bySymbol }
}

// ARCHITECTURE FENCE [IPD-003]
test("frozen ranges assign every eligible symbol exactly once", () => {
  const genes = completeRangeFixture()
  const snapshot = buildIconoplasmGeneDiscoverySnapshot({
    version: "fixture-v1",
    catalogHash: "fixturehash",
    generatedAt: "2026-07-22T00:00:00.000Z",
    genes,
  })
  const flattened = Array.from(snapshot.ranges.values()).flat()

  assert.equal(ICONOPLASM_GENE_RANGE_CONTRACT_VERSION, "2026-07-22-19023-v1")
  assert.equal(ICONOPLASM_PORTRAIT_DISCOVERY_CONTRACT_VERSION, "2026-08-24-v4")
  assert.equal(ICONOPLASM_GENE_RANGES.length, 58)
  assert.equal(snapshot.candidateCount, genes.length)
  assert.equal(flattened.length, genes.length)
  assert.equal(new Set(flattened.map((gene) => gene.symbol)).size, genes.length)
  assert.deepEqual(flattened.map((gene) => gene.symbol).sort(), genes.map((gene) => gene.s).sort())
  assert.equal(Array.from(snapshot.ranges.values()).filter((range) => range.length === 0).length, 0)
})

test("TP53 is self-locating in the frozen TO–TR range", () => {
  const range = iconoplasmGeneRangeForSymbol("TP53")

  assert.equal(range?.slug, "TO-TR")
  assert.equal(range?.label, "TO–TR")
  assert.equal(iconoplasmGeneRangeBySlug("to-tr"), range)
  assert.deepEqual(range?.prefixes, ["TO", "TP", "TR"])
})

test("unmapped or duplicate catalog symbols fail loudly instead of rebalancing", () => {
  assert.throws(
    () =>
      buildIconoplasmGeneDiscoverySnapshot({
        genes: [publishedGene("ZQNOTFROZEN")],
      }),
    /outside frozen range contract/,
  )
  assert.throws(
    () =>
      buildIconoplasmGeneDiscoverySnapshot({
        genes: [publishedGene("TP53"), publishedGene("TP53")],
      }),
    /duplicate symbol TP53/,
  )
})

test("catalog discovery candidacy ignores non-authoritative portrait metadata", () => {
  const complete = publishedGene("TP53", "tumor protein p53")
  const missingName = { ...complete, n: "" }
  const missingPortrait = { ...complete, p: null }
  const snapshot = buildIconoplasmGeneDiscoverySnapshot({
    genes: [complete, { s: "TRIM1", n: "tripartite motif containing 1" }],
  })

  assert.equal(iconoplasmPublishedGeneRecordIsDiscoveryCandidate(complete), true)
  assert.equal(iconoplasmPublishedGeneRecordIsDiscoveryCandidate(missingName), false)
  assert.equal(iconoplasmPublishedGeneRecordIsDiscoveryCandidate(missingPortrait), true)
  assert.equal(snapshot.knownBySymbol.size, 2)
  assert.deepEqual(Array.from(snapshot.candidateBySymbol.keys()), ["TP53", "TRIM1"])
  assert.equal(
    iconoplasmPublishedPortraitUrl(complete),
    `https://iconoplasm.brinedew.bio/portraits/v1/aa/${PORTRAIT_SHA}/medium.webp`,
  )
  assert.equal(iconoplasmPublishedPortraitUrl(complete, "unsupported"), "")
})

test("raw archive HTML links every range and puts TP53 on TO–TR", () => {
  const snapshot = buildIconoplasmGeneDiscoverySnapshot({
    version: "fixture-v2",
    catalogHash: "fixturehash",
    generatedAt: "2026-07-22T00:00:00.000Z",
    genes: [publishedGene("TP53", "tumor protein p53")],
  })
  const rootHtml = renderIconoplasmGeneIndexHtml(snapshot)
  const range = iconoplasmGeneRangeBySlug("TO-TR")
  const rangeHtml = renderIconoplasmGeneRangeHtml(
    snapshot,
    range,
    publishedCardProjection([publishedGene("TP53", "tumor protein p53")]),
  )

  for (const frozenRange of ICONOPLASM_GENE_RANGES) {
    assert.match(rootHtml, new RegExp(`href="/genes/${frozenRange.slug}"`))
  }
  assert.match(rangeHtml, /href="\/gene\/TP53"/)
  assert.match(rangeHtml, /TP53/)
  assert.match(rangeHtml, /tumor protein p53/)
  assert.doesNotMatch(rootHtml, /<script\b/i)
  assert.doesNotMatch(rangeHtml, /gene-card-thumb-delivery\.js/)
})

test("sitemap index and shards use the same eligible range membership", () => {
  const snapshot = buildIconoplasmGeneDiscoverySnapshot({
    version: "fixture-v3",
    catalogHash: "fixturehash",
    generatedAt: "2026-07-22T00:00:00.000Z",
    genes: [
      publishedGene("TP53", "tumor protein p53"),
      { s: "TRIM1", n: "tripartite motif containing 1" },
    ],
  })
  const indexXml = buildIconoplasmSitemapIndexXml(snapshot)
  const pagesXml = buildIconoplasmStaticPagesSitemapXml(snapshot)
  const geneXml = buildIconoplasmGeneRangeSitemapXml(
    snapshot,
    iconoplasmGeneRangeBySlug("TO-TR"),
    publishedCardProjection([publishedGene("TP53", "tumor protein p53")]),
  )

  assert.match(indexXml, /<sitemapindex/)
  assert.match(indexXml, /<lastmod>2026-08-24<\/lastmod>/)
  assert.match(indexXml, /\/sitemaps\/pages\.xml/)
  assert.match(indexXml, /\/sitemaps\/genes\/TO-TR\.xml/)
  assert.match(pagesXml, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/genes<\/loc>/)
  assert.match(pagesXml, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/genes\/TO-TR<\/loc>/)
  assert.match(geneXml, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/gene\/TP53<\/loc>/)
  assert.match(
    geneXml,
    /<image:loc>https:\/\/iconoplasm\.brinedew\.bio\/blot\/TP53\.webp<\/image:loc>/,
  )
  assert.doesNotMatch(geneXml, /TRIM1/)
})

test("ready canonical blots stay out of range HTML and remain in the matching image sitemap", () => {
  const snapshot = buildIconoplasmGeneDiscoverySnapshot({
    version: "fixture-images-v1",
    catalogHash: "fixturehash",
    generatedAt: "2026-08-03T00:00:00.000Z",
    genes: [publishedGene("TP53", "tumor protein p53")],
  })
  const range = iconoplasmGeneRangeForSymbol("TP53")
  const readyProjection = publishedCardProjection([publishedGene("TP53", "tumor protein p53")])
  const html = renderIconoplasmGeneRangeHtml(snapshot, range, readyProjection)
  const sitemap = buildIconoplasmGeneRangeSitemapXml(snapshot, range, readyProjection)

  assert.doesNotMatch(html, /<img\b/i)
  assert.doesNotMatch(html, /gene-card-thumb-delivery\.js/)
  assert.match(html, /href="\/gene\/TP53"/)
  assert.match(sitemap, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/)
  assert.match(
    sitemap,
    /<image:loc>https:\/\/iconoplasm\.brinedew\.bio\/blot\/TP53\.webp<\/image:loc>/,
  )
  assert.equal((sitemap.match(/<image:image>/g) || []).length, 1)
  assert.doesNotMatch(sitemap, /<image:(?:title|caption)>/)

  const textOnlyProjection = publishedCardProjection([publishedGene("TP53", "tumor protein p53")], {
    missingBlotSymbols: ["TP53"],
  })
  const textOnlyHtml = renderIconoplasmGeneRangeHtml(snapshot, range, textOnlyProjection)
  const textOnlySitemap = buildIconoplasmGeneRangeSitemapXml(snapshot, range, textOnlyProjection)
  assert.doesNotMatch(textOnlyHtml, /<img class="gene-card-thumb"/)
  assert.match(textOnlyHtml, /href="\/gene\/TP53"/)
  assert.match(textOnlyHtml, /1 published genes/)
  assert.equal((textOnlySitemap.match(/<image:image>/g) || []).length, 0)
  assert.match(textOnlySitemap, /\/gene\/TP53/)
})

test("llms.txt documents discovery and every card mapping", () => {
  const text = buildIconoplasmLlmsTxt({ catalogHash: "fixturehash" })

  assert.match(text, /\/gene\/\{HGNC_SYMBOL\}/)
  assert.match(text, /Every complete gene stays in the archive and gene sitemap/)
  assert.match(text, /Gene\/ImageObject\/WebPage structured data/)
  assert.match(text, /\/genes/)
  assert.match(text, /First gene-symbol letter → color hue/)
  assert.match(text, /HPA tissue-specificity tau → character color vibrance/)
  assert.match(text, /gnomAD LOEUF constraint → character color shade/)
  assert.match(text, /Gene-family grouping → character family and family trait/)
  assert.match(text, /Soluble or transmembrane molecular category → character sex/)
  assert.match(text, /First-publication year → character age/)
  assert.match(text, /Molecular mass in kDa → character mass in kg/)
  assert.match(text, /PFAM clan → character aesthetic/)
  assert.match(text, /Oncogene or tumor-suppressor molecular alignment → character alignment/)
  assert.match(text, /catalog\.fixturehash\.jsonl/)
})
