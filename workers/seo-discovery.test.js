import assert from "node:assert/strict"

import test from "node:test"

import {
  iconoplasmGeneDocumentProjectionIsIndexable,
  rewriteIconoplasmGeneDiscoveryMetadata,
} from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

test("gene metadata preserves opaque script and style bodies while replacing duplicate metadata", () => {
  const style = `<style>.sample::before { content: '<meta name="description" content="css">'; }${".x{color:red}".repeat(25000)}</style>`
  const script = `<script>const fixture = '<title>keep script</title></head><meta name="robots" content="script">';</script>`
  const source = `<html><head><title>old</title>${style}${script}<meta name="description" content="old"><meta name="description" content="duplicate"><script type="application/ld+json">{"old":true}</script></head><body>Profile</body></html>`
  const result = rewriteIconoplasmGeneDiscoveryMetadata(source, "/gene/TP53", {
    record: publishedGene("TP53", "tumor protein p53"),
    indexable: false,
  })
  assert.ok(result.includes(style))
  assert.ok(result.includes(script))
  assert.ok(result.endsWith("</head><body>Profile</body></html>"))
  const markup = result.replace(style, "").replace(script, "")
  assert.equal((markup.match(/name="description"/g) || []).length, 1)
  assert.equal((markup.match(/name="robots"/g) || []).length, 1)
  assert.match(markup, /<title>TP53/)
  assert.match(markup, /rel="canonical" href="https:\/\/iconoplasm.brinedew.bio\/gene\/TP53"/)
  assert.doesNotMatch(markup, /application\/ld\+json|content="duplicate"/)
})

function publishedGene(symbol, name, { published = true } = {}) {
  return {
    s: symbol,
    n: name,
    ...(published ? { p: { asset_sha256: "a".repeat(64) } } : {}),
  }
}

function readyBlot(symbol) {
  const fingerprint = "b".repeat(32)
  return {
    status: "ready",
    blot_fingerprint: fingerprint,
    portrait_asset_sha256: "a".repeat(64),
    asset_sha256: "c".repeat(64),
    object_key: `blots/v1/${symbol[0]}/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`,
    image_url: `https://iconoplasmportraits.b-cdn.net/blots/v1/${symbol[0]}/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`,
    canonical_url: `https://iconoplasm.brinedew.bio/blots/v1/${symbol[0]}/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`,
    semantic_url: `https://iconoplasm.brinedew.bio/blot/${symbol}.webp`,
    width: 768,
    height: 1024,
  }
}

test("complete gene metadata is indexable while incomplete records retain noindex", async () => {
  const completeHtml = rewriteIconoplasmGeneDiscoveryMetadata(
    `<!doctype html>
<html>
  <head>
    <title>Iconoplasm - Mnemonics for genes</title>
    <meta name="description" content="Browse gene personas">
    <meta name="robots" content="index,follow">
    <link rel="canonical" href="https://iconoplasm.brinedew.bio/">
    <meta property="og:url" content="https://iconoplasm.brinedew.bio/">
    <meta name="twitter:url" content="https://iconoplasm.brinedew.bio/">
    <script type="application/ld+json">{"@type":"SoftwareApplication"}</script>
  </head>
  <body></body>
    </html>`,
    "/gene/TP53",
    {
      record: publishedGene("TP53", "tumor protein p53"),
      cardPayload: {
        symbol: "TP53",
        full_name: "tumor protein p53",
        portrait: {
          status: "published",
          asset_sha256: "a".repeat(64),
          width: 768,
          height: 1024,
        },
        blot: readyBlot("TP53"),
        essence: {
          sex: "Female",
          age: "44",
          weight_kg: 43.7,
          aesthetics: ["Kingcore"],
          politics: "pro-control",
        },
      },
      indexable: true,
    },
  )

  assert.match(completeHtml, /<title>TP53 — tumor protein p53 \| Iconoplasm<\/title>/)
  assert.doesNotMatch(completeHtml, /name="robots"/)
  assert.match(completeHtml, /female, age 44, 44 kg, Kingcore aesthetic, pro-control alignment/)
  assert.match(
    completeHtml,
    /<link rel="canonical" href="https:\/\/iconoplasm\.brinedew\.bio\/gene\/TP53">/,
  )
  const blotUrl = "https://iconoplasm.brinedew.bio/blot/TP53.webp"
  assert.match(completeHtml, new RegExp(`<meta property="og:image" content="${blotUrl}">`))
  assert.match(completeHtml, /<meta property="og:image:type" content="image\/webp">/)
  assert.match(completeHtml, /<meta property="og:image:width" content="768">/)
  assert.match(completeHtml, /<meta property="og:image:height" content="1024">/)
  assert.match(
    completeHtml,
    /<meta property="og:image:alt" content="TP53 Iconoplasm gene blot — tumor protein p53">/,
  )
  assert.match(completeHtml, /<meta name="twitter:card" content="summary_large_image">/)
  assert.match(completeHtml, new RegExp(`<meta name="twitter:image" content="${blotUrl}">`))
  assert.match(completeHtml, /<meta name="twitter:title" content="TP53 — tumor protein p53/)
  assert.match(
    completeHtml,
    /<meta name="twitter:description" content="TP53 \(tumor protein p53\) Iconoplasm character profile/,
  )
  const structuredDataMatch = completeHtml.match(
    /<script type="application\/ld\+json" id="iconoplasm-gene-structured-data">([\s\S]*?)<\/script>/,
  )
  assert.ok(structuredDataMatch)
  const structuredData = JSON.parse(structuredDataMatch[1])
  const graphById = new Map(structuredData["@graph"].map((entry) => [entry["@id"], entry]))
  const webpage = graphById.get("https://iconoplasm.brinedew.bio/gene/TP53#webpage")
  const gene = graphById.get("https://iconoplasm.brinedew.bio/gene/TP53#gene")
  const image = graphById.get("https://iconoplasm.brinedew.bio/gene/TP53#canonical-blot")
  assert.equal(webpage.primaryImageOfPage["@id"], image["@id"])
  assert.equal(webpage.mainEntity["@id"], gene["@id"])
  assert.equal(gene.image["@id"], image["@id"])
  assert.equal(gene.identifier.propertyID, "HGNC approved symbol")
  assert.equal(gene.identifier.value, "TP53")
  assert.equal(gene.isPartOf["@id"], "https://iconoplasm.brinedew.bio/genes#dataset")
  assert.equal(image.contentUrl, blotUrl)
  assert.match(image.caption, /full gene name and symbol printed over the character portrait/)
  assert.equal(image.representativeOfPage, true)
  assert.equal(image.width, 768)
  assert.equal(image.height, 1024)
  assert.doesNotMatch(completeHtml, /SoftwareApplication/)
  assert.equal(
    iconoplasmGeneDocumentProjectionIsIndexable({
      record: publishedGene("TP53", "tumor protein p53"),
      cardPayload: {
        symbol: "TP53",
        portrait: { status: "published", asset_sha256: "a".repeat(64) },
        blot: readyBlot("TP53"),
      },
      indexable: true,
      profileComplete: true,
    }),
    true,
  )

  const staleCatalogPortraitHtml = rewriteIconoplasmGeneDiscoveryMetadata(
    completeHtml,
    "/gene/TP53",
    {
      record: {
        ...publishedGene("TP53", "tumor protein p53"),
        p: { asset_sha256: "b".repeat(64) },
      },
      cardPayload: {
        symbol: "TP53",
        portrait: { status: "published", asset_sha256: "a".repeat(64) },
        blot: readyBlot("TP53"),
      },
      indexable: true,
    },
  )
  assert.doesNotMatch(staleCatalogPortraitHtml, /name="robots"/)
  assert.equal(
    iconoplasmGeneDocumentProjectionIsIndexable({
      record: {
        ...publishedGene("TP53", "tumor protein p53"),
        p: { asset_sha256: "b".repeat(64) },
      },
      cardPayload: {
        symbol: "TP53",
        portrait: { status: "published", asset_sha256: "a".repeat(64) },
        blot: readyBlot("TP53"),
      },
      indexable: true,
      profileComplete: true,
    }),
    true,
  )
  assert.match(staleCatalogPortraitHtml, /iconoplasm-gene-structured-data/)
  assert.match(staleCatalogPortraitHtml, /\/blot\/TP53\.webp/)
  assert.doesNotMatch(staleCatalogPortraitHtml, /\/portraits\/v1\//)

  const pendingBlotHtml = rewriteIconoplasmGeneDiscoveryMetadata(completeHtml, "/gene/TP53", {
    record: publishedGene("TP53", "tumor protein p53"),
    cardPayload: {
      symbol: "TP53",
      full_name: "tumor protein p53",
      portrait: { status: "published", asset_sha256: "a".repeat(64) },
    },
    indexable: true,
  })
  assert.doesNotMatch(pendingBlotHtml, /name="robots"/)
  assert.doesNotMatch(pendingBlotHtml, /(?:property|name)="(?:og:image|twitter:image)/)
  assert.doesNotMatch(pendingBlotHtml, /canonical-blot/)
  const pendingStructuredDataMatch = pendingBlotHtml.match(
    /<script type="application\/ld\+json" id="iconoplasm-gene-structured-data">([\s\S]*?)<\/script>/,
  )
  assert.ok(pendingStructuredDataMatch)
  const pendingGraph = JSON.parse(pendingStructuredDataMatch[1])["@graph"]
  assert.deepEqual(
    pendingGraph.map((entry) => entry["@type"]),
    ["WebPage", "Gene"],
  )
  assert.equal(
    iconoplasmGeneDocumentProjectionIsIndexable({
      record: publishedGene("TP53", "tumor protein p53"),
      cardPayload: {
        symbol: "TP53",
        portrait: { status: "published", asset_sha256: "a".repeat(64) },
      },
      indexable: true,
      profileComplete: true,
    }),
    true,
  )

  const incompleteHtml = rewriteIconoplasmGeneDiscoveryMetadata(completeHtml, "/gene/TP53", {
    record: publishedGene("TP53", "tumor protein p53", { published: false }),
    indexable: false,
  })
  assert.match(incompleteHtml, /<meta name="robots" content="noindex,follow,noarchive">/)
  assert.doesNotMatch(incompleteHtml, /iconoplasm-gene-structured-data/)
  assert.doesNotMatch(incompleteHtml, /(?:property|name)="(?:og:image|twitter:image)/)
})
