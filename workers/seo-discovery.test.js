import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test, { afterEach } from "node:test"

import worker, {
  rewriteIconoplasmGeneDiscoveryMetadata,
} from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { resolvePostAuthAppUrl } from "./auth.js"
import {
  buildPortraitAwareManifestHash,
  resetIconoplasmRuntimeCachesForTest,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

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

function buildPublishedCatalogEnv(genes) {
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
  ])
  const env = {
    KV: {
      async get(key) {
        return store.get(key) || null
      },
      async put(key, value) {
        store.set(key, String(value))
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

test("GeneGuessr canonical subdomain owns public app URLs", async () => {
  const [appsIndex, geneguessrStaticApp, headComponent] = await Promise.all([
    readFile(appsIndexSource, "utf8"),
    readFile(geneguessrStaticAppSource, "utf8"),
    readFile(headComponentSource, "utf8"),
  ])

  assert.match(appsIndex, /\]\(https:\/\/geneguessr\.brinedew\.bio\/\)/)
  assert.doesNotMatch(appsIndex, /\]\(\/apps\/geneguessr\/?\)/)
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

test("Iconoplasm exposes the crawlable range archive, sitemap index, and agent contract", async () => {
  const env = buildPublishedCatalogEnv([
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
  assert.match(rangeHtml, /href="\/gene\/TP53"/)
  assert.doesNotMatch(rangeHtml, /TRIM1/)

  const shard = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/sitemaps/genes/TO-TR.xml"),
    env,
    {},
  )
  const shardText = await shard.text()
  assert.match(shardText, /\/gene\/TP53/)
  assert.doesNotMatch(shardText, /TRIM1/)

  const llms = await worker.fetch(new Request("https://iconoplasm.brinedew.bio/llms.txt"), env, {})
  const llmsText = await llms.text()

  assert.equal(llms.status, 200)
  assert.match(llms.headers.get("content-type") || "", /text\/plain/)
  assert.match(llmsText, /^# Iconoplasm/m)
  assert.match(llmsText, /https:\/\/iconoplasm\.brinedew\.bio\/privacy/)
  assert.match(llmsText, /\/gene\/\{HGNC_SYMBOL\}/)
  assert.match(llmsText, /PFAM clan → character aesthetic/)
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
  assert.doesNotMatch(completeHtml, /SoftwareApplication/)

  const incompleteHtml = rewriteIconoplasmGeneDiscoveryMetadata(completeHtml, "/gene/TP53", {
    record: publishedGene("TP53", "tumor protein p53", { published: false }),
    indexable: false,
  })
  assert.match(incompleteHtml, /<meta name="robots" content="noindex,follow,noarchive">/)
})

test("gene discovery redirects aliases, rejects junk URLs, and fail-closes missing profiles", async () => {
  const env = buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")])

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
  const env = buildPublishedCatalogEnv([
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
