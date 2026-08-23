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
  iconoplasmCanonicalPortraitUrl,
  iconoplasmGeneRangeBySlug,
  iconoplasmGeneRangeForSymbol,
  iconoplasmPublishedGeneRecordIsIndexable,
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
  assert.equal(ICONOPLASM_PORTRAIT_DISCOVERY_CONTRACT_VERSION, "2026-08-23-v1")
  assert.equal(ICONOPLASM_GENE_RANGES.length, 58)
  assert.equal(snapshot.eligibleCount, genes.length)
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

test("one shared eligibility predicate excludes incomplete catalog records", () => {
  const complete = publishedGene("TP53", "tumor protein p53")
  const missingName = { ...complete, n: "" }
  const missingPortrait = { ...complete, p: null }
  const snapshot = buildIconoplasmGeneDiscoverySnapshot({
    genes: [complete, { s: "TRIM1", n: "tripartite motif containing 1" }],
  })

  assert.equal(iconoplasmPublishedGeneRecordIsIndexable(complete), true)
  assert.equal(iconoplasmPublishedGeneRecordIsIndexable(missingName), false)
  assert.equal(iconoplasmPublishedGeneRecordIsIndexable(missingPortrait), false)
  assert.equal(snapshot.knownBySymbol.size, 2)
  assert.deepEqual(Array.from(snapshot.eligibleBySymbol.keys()), ["TP53"])
  assert.equal(
    iconoplasmCanonicalPortraitUrl(complete),
    `https://iconoplasm.brinedew.bio/portraits/v1/aa/${PORTRAIT_SHA}/medium.webp`,
  )
  assert.equal(iconoplasmCanonicalPortraitUrl(complete, "unsupported"), "")
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
  const rangeHtml = renderIconoplasmGeneRangeHtml(snapshot, range)

  for (const frozenRange of ICONOPLASM_GENE_RANGES) {
    assert.match(rootHtml, new RegExp(`href="/genes/${frozenRange.slug}"`))
  }
  assert.match(rangeHtml, /href="\/gene\/TP53"/)
  assert.match(rangeHtml, /TP53/)
  assert.match(rangeHtml, /tumor protein p53/)
  assert.doesNotMatch(rootHtml, /<script\b/i)
  assert.doesNotMatch(rangeHtml, /<script\b/i)
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
  const geneXml = buildIconoplasmGeneRangeSitemapXml(snapshot, iconoplasmGeneRangeBySlug("TO-TR"))

  assert.match(indexXml, /<sitemapindex/)
  assert.match(indexXml, /<lastmod>2026-08-23<\/lastmod>/)
  assert.match(indexXml, /\/sitemaps\/pages\.xml/)
  assert.match(indexXml, /\/sitemaps\/genes\/TO-TR\.xml/)
  assert.match(pagesXml, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/genes<\/loc>/)
  assert.match(pagesXml, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/genes\/TO-TR<\/loc>/)
  assert.match(geneXml, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/gene\/TP53<\/loc>/)
  assert.match(
    geneXml,
    new RegExp(
      `<image:loc>https://iconoplasm\\.brinedew\\.bio/portraits/v1/aa/${PORTRAIT_SHA}/medium\\.webp</image:loc>`,
    ),
  )
  assert.doesNotMatch(geneXml, /TRIM1/)
})

test("ready requested cards appear in raw range HTML and the matching image sitemap only", () => {
  const snapshot = buildIconoplasmGeneDiscoverySnapshot({
    version: "fixture-images-v1",
    catalogHash: "fixturehash",
    generatedAt: "2026-08-03T00:00:00.000Z",
    genes: [publishedGene("TP53", "tumor protein p53")],
  })
  const range = iconoplasmGeneRangeForSymbol("TP53")
  const ready = new Map([
    [
      "TP53",
      {
        image_url:
          "https://iconoplasmportraits.b-cdn.net/gene-cards/v1/T/TP53/fingerprint/TP53-iconoplasm-gene-card.png",
        width: 1536,
        height: 2048,
      },
    ],
  ])
  const html = renderIconoplasmGeneRangeHtml(snapshot, range, ready)
  const sitemap = buildIconoplasmGeneRangeSitemapXml(snapshot, range, ready)

  assert.match(html, /class="gene-card-thumb"/)
  assert.match(html, /TP53 Iconoplasm labelled gene card/)
  assert.match(
    html,
    /data-iconoplasm-canonical-image-src="https:\/\/iconoplasm\.brinedew\.bio\/gene-cards\/v1\/T\/TP53/,
  )
  assert.match(html, /gene-card-thumb-delivery\.js\?v=20260803-gene-card-fallback/)
  assert.match(sitemap, /xmlns:image="http:\/\/www\.google\.com\/schemas\/sitemap-image\/1\.1"/)
  assert.match(
    sitemap,
    new RegExp(
      `<image:loc>https://iconoplasm\\.brinedew\\.bio/portraits/v1/aa/${PORTRAIT_SHA}/medium\\.webp</image:loc>`,
    ),
  )
  assert.match(sitemap, /<image:loc>https:\/\/iconoplasm\.brinedew\.bio\/gene-cards\/v1\/T\/TP53/)
  assert.equal((sitemap.match(/<image:image>/g) || []).length, 2)
  assert.doesNotMatch(sitemap, /<image:(?:title|caption)>/)

  const textOnlyHtml = renderIconoplasmGeneRangeHtml(snapshot, range, new Map())
  const textOnlySitemap = buildIconoplasmGeneRangeSitemapXml(snapshot, range, new Map())
  assert.doesNotMatch(textOnlyHtml, /<img class="gene-card-thumb"/)
  assert.equal((textOnlySitemap.match(/<image:image>/g) || []).length, 1)
  assert.match(textOnlySitemap, /\/portraits\/v1\/aa\/[a-f0-9]{64}\/medium\.webp/)
})

test("llms.txt documents discovery and every card mapping", () => {
  const text = buildIconoplasmLlmsTxt({ catalogHash: "fixturehash" })

  assert.match(text, /\/gene\/\{HGNC_SYMBOL\}/)
  assert.match(text, /Every complete gene page exposes one published, content-addressed/)
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
