import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import test, { afterEach } from "node:test"

import worker, {
  iconoplasmGeneDocumentProjectionIsIndexable,
  rewriteIconoplasmGeneDiscoveryMetadata,
} from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { resolvePostAuthAppUrl } from "./auth.js"
import {
  buildPortraitAwareManifestHash,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { iconoplasmPublicationAliasManifest } from "./iconoplasm-publication-aliases.js"
import { iconoplasmRecognitionPairKvKey } from "./iconoplasm-recognition-policy-reconciliation.js"

const originalFetch = globalThis.fetch
const rootRobotsSource = new URL("../content/robots.txt", import.meta.url)
const appsIndexSource = new URL("../content/apps/index.md", import.meta.url)
const geneguessrStaticAppSource = new URL("../quartz/static/geneguessr/app.js", import.meta.url)
const iconoplasmStaticAppSource = new URL("../quartz/static/iconoplasm/app.js", import.meta.url)
const headComponentSource = new URL("../quartz/components/Head.tsx", import.meta.url)
const deployWorkflowSource = new URL("../.github/workflows/deploy-quartz.yml", import.meta.url)
const publicWorkerWranglerSource = new URL("../wrangler.toml", import.meta.url)

afterEach(() => {
  globalThis.fetch = originalFetch
  resetIconoplasmRuntimeCachesForTest()
})

function htmlResponse(body) {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8",
    },
  })
}

let catalogFixtureSequence = 0

function publishedGene(symbol, name, { published = true } = {}) {
  return {
    s: symbol,
    n: name,
    ...(published ? { p: { asset_sha256: "a".repeat(64) } } : {}),
  }
}

async function buildPublishedCatalogEnv(genes, { cardPortraitShaBySymbol = {} } = {}) {
  catalogFixtureSequence += 1
  resetIconoplasmRuntimeCachesForTest()
  const hash = `seofixture${catalogFixtureSequence}`
  const fingerprint = { published_count: genes.length, latest: "a".repeat(64) }
  const buildHash = buildPortraitAwareManifestHash(hash, fingerprint)
  const artifact = {
    schema_version: 5,
    contract_revision: 1,
    generated_at: "2026-07-22T00:00:00.000Z",
    gene_count: genes.length,
    genes,
  }
  const cardVersion = `card-${hash}`
  const publicationAliases = await iconoplasmPublicationAliasManifest()
  const blocklistTerms = []
  const extensionBlocklist = {
    schema_version: 1,
    revision: 1,
    version: `ebl1-${createHash("sha256")
      .update(JSON.stringify(blocklistTerms))
      .digest("hex")
      .slice(0, 16)}`,
    term_count: blocklistTerms.length,
    terms: blocklistTerms,
  }
  const cards = genes.map((gene) => {
    const cardPortraitSha = cardPortraitShaBySymbol[gene.s] || gene.p?.asset_sha256
    const portrait = cardPortraitSha
      ? { status: "published", asset_sha256: cardPortraitSha }
      : { status: "missing", asset_sha256: null }
    return {
      __complete: true,
      schema_version: "iconoplasm.mobileCard.v1",
      snapshot_version: cardVersion,
      data_source: "published_card_catalog",
      symbol: gene.s,
      full_name: gene.n,
      portrait,
      field_status: {},
      payload: {
        symbol: gene.s,
        full_name: gene.n,
        portrait,
      },
    }
  })
  const store = new Map([
    [
      "iconoplasm:catalog-manifest",
      JSON.stringify({
        current_hash: hash,
        generated_at: artifact.generated_at,
        schema_version: 5,
        artifact_schema_version: 5,
        artifact_contract_revision: 1,
        gene_count: genes.length,
      }),
    ],
    [
      "iconoplasm:published-portrait-fingerprint:v3",
      JSON.stringify({ cached_at: Date.now(), fingerprint }),
    ],
    [`iconoplasm:hydrated-catalog-artifact:a5c1:${buildHash}`, JSON.stringify(artifact)],
    ["iconoplasm:gallery-version", JSON.stringify({ current: cardVersion })],
    [
      `iconoplasm:card-catalog:${cardVersion}`,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        artifact_version: cardVersion,
        storage: "kv_sharded",
        catalog_gene_count: cards.length,
        card_count: cards.length,
        shard_count: 1,
        shards: [
          {
            index: 0,
            key: `iconoplasm:card-catalog-shard:${cardVersion}:0`,
            artifact_version: cardVersion,
            shard_index: 0,
            first_symbol: cards[0]?.symbol || "",
            last_symbol: cards[cards.length - 1]?.symbol || "",
            card_count: cards.length,
          },
        ],
      }),
    ],
    [
      `iconoplasm:card-catalog-shard:${cardVersion}:0`,
      JSON.stringify({
        schema: "iconoplasm.cardCatalog.v1",
        artifact_version: cardVersion,
        shard_index: 0,
        cards,
      }),
    ],
    [
      iconoplasmRecognitionPairKvKey(1, 1),
      JSON.stringify({
        schema_version: 1,
        alias_revision: 1,
        blocklist_revision: 1,
        alias_depends_on_blocklist_revision: null,
        blocklist_depends_on_alias_revision: null,
        publication_aliases: publicationAliases,
        extension_blocklist: extensionBlocklist,
      }),
    ],
  ])
  const env = {
    KV: {
      async get(key) {
        return store.get(key) || null
      },
      async put(key, value) {
        store.set(key, String(value))
      },
      async list({ prefix = "", limit = 1_000 } = {}) {
        const matching = [...store.keys()].filter((key) => key.startsWith(prefix)).sort()
        return {
          keys: matching.slice(0, limit).map((name) => ({ name })),
          list_complete: matching.length <= limit,
        }
      },
    },
    ICONOPLASM_DB: {
      prepare(sql) {
        throw new Error(`Discovery documents must not query D1: ${sql}`)
      },
    },
  }
  return env
}

test("apex robots source stays standards-only", async () => {
  const text = await readFile(rootRobotsSource, "utf8")

  assert.match(text, /User-agent: \*/)
  assert.match(text, /Sitemap: https:\/\/brinedew\.bio\/sitemap\.xml/)
  assert.doesNotMatch(text, /\bsearch:\s*yes\b/)
  assert.doesNotMatch(text, /\bai-input:\s*yes\b/)
  assert.doesNotMatch(text, /\bai-train:\s*yes\b/)
  assert.doesNotMatch(text, /\bCrawl-delay\b/i)
})

test("www host is routed and permanently canonicalized to the apex host", async () => {
  const [workflow, wrangler] = await Promise.all([
    readFile(deployWorkflowSource, "utf8"),
    readFile(publicWorkerWranglerSource, "utf8"),
  ])

  assert.match(workflow, /"www\.brinedew\.bio\/\*"/)
  assert.match(wrangler, /pattern = "www\.brinedew\.bio\/\*"/)

  globalThis.fetch = async () => {
    throw new Error("www canonical redirect must not proxy duplicate static HTML")
  }

  const response = await worker.fetch(
    new Request("https://www.brinedew.bio/posts/example?utm_source=test"),
    {},
    {},
  )

  assert.equal(response.status, 301)
  assert.equal(
    response.headers.get("location"),
    "https://brinedew.bio/posts/example?utm_source=test",
  )
})

test("GeneGuessr canonical subdomain owns public app routes", async () => {
  const [geneguessrStaticApp, headComponent] = await Promise.all([
    readFile(geneguessrStaticAppSource, "utf8"),
    readFile(headComponentSource, "utf8"),
  ])

  assert.doesNotMatch(geneguessrStaticApp, /https:\/\/brinedew\.bio\/apps\/geneguessr\/(?!render)/)
  assert.match(headComponent, /host === "geneguessr\.brinedew\.bio" \? "\/privacy"/)
  assert.doesNotMatch(
    headComponent,
    /host === "geneguessr\.brinedew\.bio" \? "\/apps\/geneguessr\/privacy"/,
  )
  assert.equal(
    resolvePostAuthAppUrl(new URL("https://geneguessr.brinedew.bio/api/auth/callback"), ""),
    "https://geneguessr.brinedew.bio/",
  )
  // Apex auth stays on the apex blog site (not the older "redirect to geneguessr" default).
  // Each subdomain is its own app; users who log in from brinedew.bio land back on brinedew.bio.
  assert.equal(
    resolvePostAuthAppUrl(new URL("https://brinedew.bio/api/auth/callback"), ""),
    "https://brinedew.bio/",
  )

  globalThis.fetch = async () => {
    throw new Error("apex GeneGuessr app duplicates must redirect instead of proxying static HTML")
  }

  for (const [path, location] of [
    ["/apps/geneguessr", "https://geneguessr.brinedew.bio/?utm_source=chatgpt"],
    ["/apps/geneguessr/", "https://geneguessr.brinedew.bio/?utm_source=chatgpt"],
    ["/apps/geneguessr/index", "https://geneguessr.brinedew.bio/?utm_source=chatgpt"],
    ["/apps/geneguessr/index/", "https://geneguessr.brinedew.bio/?utm_source=chatgpt"],
    ["/apps/geneguessr/privacy", "https://geneguessr.brinedew.bio/privacy?utm_source=chatgpt"],
    ["/apps/geneguessr/privacy/", "https://geneguessr.brinedew.bio/privacy?utm_source=chatgpt"],
  ]) {
    const response = await worker.fetch(
      new Request(`https://brinedew.bio${path}?utm_source=chatgpt`),
      {},
      {},
    )

    assert.equal(response.status, 301, path)
    assert.equal(response.headers.get("location"), location, path)
  }
})

test("apps index delegates descriptions to the canonical folder listing", async () => {
  const appsIndex = await readFile(appsIndexSource, "utf8")
  const body = appsIndex.replace(/^---[\s\S]*?---\s*/, "").trim()

  assert.deepEqual(
    body.split(/\r?\n/).filter((line) => line.trim()),
    ["# Apps"],
  )
  assert.doesNotMatch(body, /\bData:|\bGameplay:|\bStatus:|6 guesses|Fully static/)
})

test("Iconoplasm exposes the crawlable range archive, sitemap index, and agent contract", async () => {
  const env = await buildPublishedCatalogEnv([
    publishedGene("TP53", "tumor protein p53"),
    publishedGene("TRIM1", "tripartite motif containing 1", { published: false }),
  ])
  const robots = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/robots.txt"),
    env,
    {},
  )
  const robotsText = await robots.text()

  assert.equal(robots.status, 200)
  assert.match(robots.headers.get("content-type") || "", /text\/plain/)
  assert.match(robotsText, /Sitemap: https:\/\/iconoplasm\.brinedew\.bio\/sitemap\.xml/)
  assert.match(robotsText, /User-agent: GPTBot\s+Disallow: \//)
  assert.match(robotsText, /User-agent: ClaudeBot\s+Disallow: \//)
  for (const searchAgent of [
    "OAI-SearchBot",
    "ChatGPT-User",
    "Claude-SearchBot",
    "Claude-User",
    "PerplexityBot",
    "Perplexity-User",
  ]) {
    assert.match(
      robotsText,
      new RegExp(`User-agent: ${searchAgent}\\s+Allow: /\\s+Disallow: /api/`),
      searchAgent,
    )
  }
  assert.doesNotMatch(robotsText, /\bsearch:\s*yes\b/)
  assert.doesNotMatch(robotsText, /\bCrawl-delay\b/i)

  const sitemap = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/sitemap.xml"),
    env,
    {},
  )
  const sitemapText = await sitemap.text()

  assert.equal(sitemap.status, 200)
  assert.match(sitemap.headers.get("content-type") || "", /application\/xml/)
  assert.match(sitemapText, /<sitemapindex/)
  assert.match(sitemapText, /\/sitemaps\/pages\.xml/)
  assert.match(sitemapText, /\/sitemaps\/genes\/TO-TR\.xml/)

  const archive = await worker.fetch(new Request("https://iconoplasm.brinedew.bio/genes"), env, {})
  const archiveHtml = await archive.text()
  assert.equal(archive.status, 200)
  assert.match(archiveHtml, /href="\/genes\/TO-TR"/)

  const range = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/genes/TO-TR"),
    env,
    {},
  )
  const rangeHtml = await range.text()
  assert.equal(range.status, 200)
  assert.equal(range.headers.get("etag"), null)
  assert.equal(range.headers.get("x-iconoplasm-portrait-discovery-version"), "2026-08-23-v1")
  assert.match(rangeHtml, /href="\/gene\/TP53"/)
  assert.doesNotMatch(rangeHtml, /TRIM1/)

  const shard = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/sitemaps/genes/TO-TR.xml"),
    env,
    {},
  )
  const shardText = await shard.text()
  assert.equal(shard.status, 200)
  assert.match(shard.headers.get("x-iconoplasm-card-version") || "", /^card-seofixture/)
  assert.equal(shard.headers.get("x-iconoplasm-portrait-discovery-version"), "2026-08-23-v1")
  assert.match(shard.headers.get("etag") || "", /2026-08-23-v1/)
  assert.match(shard.headers.get("etag") || "", /TO-TR\.xml/)
  assert.match(shardText, /\/gene\/TP53/)
  assert.match(shardText, /\/portraits\/v1\/aa\/[a-f0-9]{64}\/medium\.webp/)
  assert.doesNotMatch(shardText, /TRIM1/)
  assert.doesNotMatch(shardText, /<image:(?:title|caption)>/)

  const llms = await worker.fetch(new Request("https://iconoplasm.brinedew.bio/llms.txt"), env, {})
  const llmsText = await llms.text()

  assert.equal(llms.status, 200)
  assert.match(llms.headers.get("content-type") || "", /text\/plain/)
  assert.match(llmsText, /^# Iconoplasm/m)
  assert.match(llmsText, /https:\/\/iconoplasm\.brinedew\.bio\/privacy/)
  assert.match(llmsText, /\/gene\/\{HGNC_SYMBOL\}/)
  assert.match(llmsText, /PFAM clan → character aesthetic/)
})

test("gene sitemap fails closed when the card artifact and discovery portrait diverge", async () => {
  const env = await buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")], {
    cardPortraitShaBySymbol: { TP53: "b".repeat(64) },
  })

  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/sitemaps/genes/TO-TR.xml"),
    env,
    {},
  )
  const body = await response.text()

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("cache-control"), "no-store")
  assert.equal(response.headers.get("retry-after"), "60")
  assert.match(response.headers.get("content-type") || "", /application\/xml/)
  assert.match(body, /Sitemap publication snapshot temporarily unavailable/)
  assert.doesNotMatch(body, /\/portraits\/v1\//)
})

test("subdomain privacy pages use the short canonical privacy URL", async () => {
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url))
    assert.equal(requestUrl.pathname, "/apps/iconoplasm/privacy")
    return htmlResponse(`<!doctype html>
<html>
  <head>
    <title>Privacy Policy - Iconoplasm</title>
    <link rel="canonical" href="https://iconoplasm.brinedew.bio/privacy">
    <meta property="og:url" content="https://iconoplasm.brinedew.bio/privacy">
    <meta name="twitter:url" content="https://iconoplasm.brinedew.bio/privacy">
  </head>
  <body>privacy</body>
</html>`)
  }

  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/privacy"),
    {},
    {},
  )
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /https:\/\/iconoplasm\.brinedew\.bio\/privacy/)

  const legacy = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/apps/iconoplasm/privacy"),
    {},
    {},
  )
  assert.equal(legacy.status, 301)
  assert.equal(legacy.headers.get("location"), "https://iconoplasm.brinedew.bio/privacy")
})

test("GeneGuessr exposes short privacy canonical and host sitemap", async () => {
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url))
    assert.equal(requestUrl.pathname, "/apps/geneguessr/privacy")
    return htmlResponse(`<!doctype html>
<html>
  <head>
    <title>Privacy Policy - GeneGuessr</title>
    <link rel="canonical" href="https://geneguessr.brinedew.bio/privacy">
    <meta property="og:url" content="https://geneguessr.brinedew.bio/privacy">
    <meta name="twitter:url" content="https://geneguessr.brinedew.bio/privacy">
  </head>
  <body>privacy</body>
</html>`)
  }

  const sitemap = await worker.fetch(
    new Request("https://geneguessr.brinedew.bio/sitemap.xml"),
    {},
    {},
  )
  const sitemapText = await sitemap.text()

  assert.match(sitemapText, /<loc>https:\/\/geneguessr\.brinedew\.bio\/privacy<\/loc>/)
  assert.doesNotMatch(sitemapText, /\/apps\/geneguessr\/privacy/)

  const response = await worker.fetch(
    new Request("https://geneguessr.brinedew.bio/privacy"),
    {},
    {},
  )
  const html = await response.text()

  assert.equal(response.status, 200)
  assert.match(html, /https:\/\/geneguessr\.brinedew\.bio\/privacy/)

  const legacy = await worker.fetch(
    new Request("https://geneguessr.brinedew.bio/apps/geneguessr/privacy"),
    {},
    {},
  )
  assert.equal(legacy.status, 301)
  assert.equal(legacy.headers.get("location"), "https://geneguessr.brinedew.bio/privacy")
})

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

  assert.match(
    completeHtml,
    /<title>TP53 — tumor protein p53 \| Iconoplasm character profile<\/title>/,
  )
  assert.doesNotMatch(completeHtml, /name="robots"/)
  assert.match(completeHtml, /female, age 44, 44 kg, Kingcore aesthetic, pro-control alignment/)
  assert.match(
    completeHtml,
    /<link rel="canonical" href="https:\/\/iconoplasm\.brinedew\.bio\/gene\/TP53">/,
  )
  const portraitUrl = `https://iconoplasm.brinedew.bio/portraits/v1/aa/${"a".repeat(64)}/medium.webp`
  assert.match(completeHtml, new RegExp(`<meta property="og:image" content="${portraitUrl}">`))
  assert.match(completeHtml, /<meta property="og:image:type" content="image\/webp">/)
  assert.doesNotMatch(completeHtml, /og:image:(?:width|height)/)
  assert.match(
    completeHtml,
    /<meta property="og:image:alt" content="TP53 canonical gene character portrait by Iconoplasm">/,
  )
  assert.match(completeHtml, /<meta name="twitter:card" content="summary_large_image">/)
  assert.match(completeHtml, new RegExp(`<meta name="twitter:image" content="${portraitUrl}">`))
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
  const image = graphById.get("https://iconoplasm.brinedew.bio/gene/TP53#canonical-portrait")
  assert.equal(webpage.primaryImageOfPage["@id"], image["@id"])
  assert.equal(webpage.mainEntity["@id"], gene["@id"])
  assert.equal(gene.image["@id"], image["@id"])
  assert.equal(gene.identifier.propertyID, "HGNC approved symbol")
  assert.equal(gene.identifier.value, "TP53")
  assert.equal(image.contentUrl, portraitUrl)
  assert.equal(image.caption, "Canonical Iconoplasm portrait of human TP53 (tumor protein p53).")
  assert.equal(image.representativeOfPage, true)
  assert.equal("width" in image, false)
  assert.equal("height" in image, false)
  assert.doesNotMatch(completeHtml, /SoftwareApplication/)
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

  const mismatchedHtml = rewriteIconoplasmGeneDiscoveryMetadata(completeHtml, "/gene/TP53", {
    record: {
      ...publishedGene("TP53", "tumor protein p53"),
      p: { asset_sha256: "b".repeat(64) },
    },
    cardPayload: {
      symbol: "TP53",
      portrait: { status: "published", asset_sha256: "a".repeat(64) },
    },
    indexable: true,
  })
  assert.match(mismatchedHtml, /<meta name="robots" content="noindex,follow,noarchive">/)
  assert.equal(
    iconoplasmGeneDocumentProjectionIsIndexable({
      record: {
        ...publishedGene("TP53", "tumor protein p53"),
        p: { asset_sha256: "b".repeat(64) },
      },
      cardPayload: {
        symbol: "TP53",
        portrait: { status: "published", asset_sha256: "a".repeat(64) },
      },
      indexable: true,
      profileComplete: true,
    }),
    false,
  )
  assert.doesNotMatch(mismatchedHtml, /iconoplasm-gene-structured-data/)
  assert.doesNotMatch(mismatchedHtml, /(?:property|name)="(?:og:image|twitter:image)/)

  const incompleteHtml = rewriteIconoplasmGeneDiscoveryMetadata(completeHtml, "/gene/TP53", {
    record: publishedGene("TP53", "tumor protein p53", { published: false }),
    indexable: false,
  })
  assert.match(incompleteHtml, /<meta name="robots" content="noindex,follow,noarchive">/)
  assert.doesNotMatch(incompleteHtml, /iconoplasm-gene-structured-data/)
  assert.doesNotMatch(incompleteHtml, /(?:property|name)="(?:og:image|twitter:image)/)
})

test("gene discovery redirects aliases, rejects junk URLs, and fail-closes missing profiles", async () => {
  const env = await buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")])

  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url))
    assert.equal(requestUrl.pathname, "/apps/iconoplasm/index")
    return htmlResponse(`<!doctype html>
<html>
  <head>
    <title>Iconoplasm - Mnemonics for genes</title>
    <meta name="robots" content="index,follow">
  </head>
  <body><div id="iconoplasm-root"></div></body>
</html>`)
  }

  const alias = await worker.fetch(new Request("https://iconoplasm.brinedew.bio/gene/p53"), env, {
    waitUntil() {},
  })
  assert.equal(alias.status, 301)
  assert.equal(alias.headers.get("location"), "https://iconoplasm.brinedew.bio/gene/TP53")

  const unknown = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/THISISNOTAGENE"),
    env,
    { waitUntil() {} },
  )
  assert.equal(unknown.status, 404)
  assert.equal(unknown.headers.get("x-robots-tag"), "noindex, follow, noarchive")

  const missingRenderedProfile = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/TP53"),
    env,
    { waitUntil() {} },
  )
  assert.equal(missingRenderedProfile.status, 503)
  assert.equal(missingRenderedProfile.headers.get("x-robots-tag"), "noindex, follow, noarchive")
})

test("known incomplete gene shells remain noindex", async () => {
  const env = await buildPublishedCatalogEnv([
    publishedGene("TRIM1", "tripartite motif containing 1", { published: false }),
  ])

  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url))
    assert.equal(requestUrl.pathname, "/apps/iconoplasm/index")
    return htmlResponse(`<!doctype html>
<html>
  <head>
    <title>Iconoplasm - Mnemonics for genes</title>
    <meta name="robots" content="index,follow">
  </head>
  <body><div id="iconoplasm-root"></div></body>
</html>`)
  }

  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/TRIM1"),
    env,
    { waitUntil() {} },
  )
  const responseHtml = await response.text()

  assert.equal(response.headers.get("x-robots-tag"), "noindex, follow, noarchive")
  assert.match(responseHtml, /<meta name="robots" content="noindex,follow,noarchive">/)
})

// ARCHITECTURE FENCE [IPD-003]
test("homepage discovery links the raw archive without adding immersive navigation chrome", async () => {
  globalThis.fetch = async () =>
    htmlResponse(
      `<!doctype html><html><head><title>Iconoplasm</title></head><body><nav class="icono-page-switcher" data-icono-page-switcher="true"><a href="/">Archive</a><a href="/clans">Clans</a></nav><div id="iconoplasm-root"></div></body></html>`,
    )

  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/"),
    {},
    { waitUntil() {} },
  )
  const html = await response.text()
  const contentSource = await readFile(
    new URL("../content/apps/iconoplasm/index.md", import.meta.url),
    "utf8",
  )

  assert.doesNotMatch(html, />Gene index<\/a>/)
  assert.match(
    contentSource,
    /class="sr-only"[\s\S]*href="https:\/\/iconoplasm\.brinedew\.bio\/genes" tabindex="-1">published human gene cards<\/a>/,
  )
})

test("gene hydration preserves and refreshes the canonical profile title", async () => {
  const source = await readFile(iconoplasmStaticAppSource, "utf8")

  assert.doesNotMatch(source, /route\.symbol \+ " - Iconoplasm"/)
  assert.match(source, /function geneProfileDocumentTitle\(gene, fallbackSymbol\)/)
  assert.match(source, /document\.title = geneProfileDocumentTitle\(g, symbol\)/)
  assert.match(source, /!document\.title\.endsWith\(" \| Iconoplasm character profile"\)/)
})

test("gene lead rendering and hydration preserve canonical portrait alt text", async () => {
  const source = await readFile(iconoplasmStaticAppSource, "utf8")

  assert.match(source, /function buildGeneLeadCardMarkup\(g\)/)
  assert.match(source, /var portraitUrl = publishedPortraitUrl\(g, "medium"\)/)
  assert.match(source, /var portraitAlt = IconoCardShared\.canonicalGenePortraitAlt\(g\.symbol\)/)
  assert.match(source, /var portraitCaption = IconoCardShared\.canonicalGenePortraitCaption\(/)
  assert.match(
    source,
    /card\.classList\.contains\("icono-gene-lead-card"\)[\s\S]*IconoCardShared\.canonicalGenePortraitAlt\(genePayload\.symbol\)/,
  )
})
