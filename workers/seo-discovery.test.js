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
import {
  iconoplasmGeneBlotFingerprint,
  iconoplasmGeneBlotObjectKey,
} from "./iconoplasm-gene-card-materialization-runtime-inside-the-only-allowed-internal-stateful-worker-do-not-duplicate.js"

const originalFetch = globalThis.fetch
const originalCaches = globalThis.caches
const rootRobotsSource = new URL("../content/robots.txt", import.meta.url)
const appsIndexSource = new URL("../content/apps/index.md", import.meta.url)
const geneguessrStaticAppSource = new URL("../quartz/static/geneguessr/app.js", import.meta.url)
const iconoplasmStaticAppSource = new URL("../quartz/static/iconoplasm/app.js", import.meta.url)
const iconoplasmStaticStylesSource = new URL(
  "../quartz/static/iconoplasm/styles.css",
  import.meta.url,
)
const headComponentSource = new URL("../quartz/components/Head.tsx", import.meta.url)
const deployWorkflowSource = new URL("../.github/workflows/deploy-quartz.yml", import.meta.url)
const publicWorkerWranglerSource = new URL("../wrangler.toml", import.meta.url)

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalCaches === undefined) delete globalThis.caches
  else globalThis.caches = originalCaches
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

function buildGenePageD1(genes) {
  const bySymbol = new Map(genes.map((gene) => [gene.s, gene]))
  return {
    prepare(sql) {
      const text = String(sql || "")
      const statement = {
        args: [],
        bind(...args) {
          this.args = args
          return this
        },
        async first() {
          const symbol = String(this.args[0] || "")
            .trim()
            .toUpperCase()
          const gene = bySymbol.get(symbol)
          if (text.includes("FROM icono_published_gene_routes")) {
            return gene ? { gene_symbol: symbol, full_name: gene.n } : null
          }
          if (text.includes("FROM icono_gene_catalog")) {
            return gene
              ? {
                  gene_symbol: symbol,
                  full_name: gene.n,
                  uniprot: null,
                  color_hex: "#667788",
                  tmh: 0,
                  aliases_json: "[]",
                }
              : null
          }
          if (text.includes("FROM icono_publish_state ps")) {
            return gene?.p?.asset_sha256
              ? {
                  asset_sha256: gene.p.asset_sha256,
                  width: 384,
                  height: 512,
                  candidate_image_id: 1,
                }
              : null
          }
          if (text.includes("FROM icono_gene_essence")) {
            return gene ? { full_name: gene.n, sex: "Female" } : null
          }
          if (text.includes("FROM icono_gene_blot_materializations")) return null
          throw new Error(`Unexpected gene-page D1 first query: ${text}`)
        },
        async all() {
          if (text.includes("FROM icono_gene_blot_materializations")) {
            return { results: [] }
          }
          if (text.includes("FROM icono_portrait_assets pa")) return { results: [] }
          throw new Error(`Unexpected gene-page D1 all query: ${text}`)
        },
      }
      return statement
    },
  }
}

async function buildPublishedCatalogEnv(
  genes,
  {
    cardPortraitShaBySymbol = {},
    cardPortraitStatusBySymbol = {},
    cardBlotSemanticUrlBySymbol = {},
    omitCardSymbols = [],
    omitBlotSymbols = [],
    materializedBlotRowsBySymbol = {},
    withGenePageD1 = false,
  } = {},
) {
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
  const omittedCards = new Set(omitCardSymbols)
  const omittedBlots = new Set(omitBlotSymbols)
  const cards = genes
    .filter((gene) => !omittedCards.has(gene.s))
    .map((gene) => {
      const cardPortraitSha = cardPortraitShaBySymbol[gene.s] || gene.p?.asset_sha256
      const cardPortraitStatus =
        cardPortraitStatusBySymbol[gene.s] || (cardPortraitSha ? "published" : "missing")
      const portrait = cardPortraitSha
        ? { status: cardPortraitStatus, asset_sha256: cardPortraitSha }
        : { status: "missing", asset_sha256: null }
      const blotFingerprint = "b".repeat(32)
      const blot =
        omittedBlots.has(gene.s) || cardPortraitStatus !== "published" || !cardPortraitSha
          ? null
          : {
              status: "ready",
              blot_fingerprint: blotFingerprint,
              portrait_asset_sha256: cardPortraitSha,
              asset_sha256: "c".repeat(64),
              object_key: `blots/v1/${gene.s[0]}/${gene.s}/${blotFingerprint}/${gene.s}-iconoplasm-gene-blot.webp`,
              image_url: `https://iconoplasmportraits.b-cdn.net/blots/v1/${gene.s[0]}/${gene.s}/${blotFingerprint}/${gene.s}-iconoplasm-gene-blot.webp`,
              canonical_url: `https://iconoplasm.brinedew.bio/blots/v1/${gene.s[0]}/${gene.s}/${blotFingerprint}/${gene.s}-iconoplasm-gene-blot.webp`,
              semantic_url:
                cardBlotSemanticUrlBySymbol[gene.s] ||
                `https://iconoplasm.brinedew.bio/blot/${gene.s}.webp`,
              width: 768,
              height: 1024,
            }
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
          ...(blot ? { blot } : {}),
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
    [
      "iconoplasm:gallery-version",
      JSON.stringify({ current: cardVersion, published_at: "2026-08-23T00:00:00.000Z" }),
    ],
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
    ICONOPLASM_DB: withGenePageD1
      ? buildGenePageD1(genes)
      : {
          prepare(sql) {
            const text = String(sql || "")
            if (text.includes("FROM icono_gene_catalog")) {
              return {
                bind() {
                  return this
                },
                async first() {
                  return null
                },
              }
            }
            if (!text.includes("FROM icono_gene_blot_materializations")) {
              throw new Error(`Discovery documents may query only exact blot rows: ${sql}`)
            }
            return {
              args: [],
              bind(...args) {
                this.args = args
                return this
              },
              async all() {
                return {
                  results: this.args.flatMap((symbol) => {
                    const row = materializedBlotRowsBySymbol[String(symbol || "").toUpperCase()]
                    return row ? [{ gene_symbol: symbol, ...row }] : []
                  }),
                }
              },
            }
          },
        },
    DB: null,
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

  const pagesSitemap = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/sitemaps/pages.xml"),
    env,
    {},
  )
  const pagesSitemapText = await pagesSitemap.text()
  assert.equal(pagesSitemap.status, 200)
  assert.match(pagesSitemapText, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/license<\/loc>/)

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
  assert.match(range.headers.get("etag") || "", /card-seofixture/)
  assert.match(range.headers.get("x-iconoplasm-card-version") || "", /^card-seofixture/)
  assert.equal(range.headers.get("x-iconoplasm-portrait-discovery-version"), "2026-08-24-v4")
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
  assert.equal(shard.headers.get("x-iconoplasm-portrait-discovery-version"), "2026-08-24-v4")
  assert.match(shard.headers.get("etag") || "", /2026-08-24-v4/)
  assert.match(shard.headers.get("etag") || "", /TO-TR\.xml/)
  assert.match(shardText, /\/gene\/TP53/)
  assert.match(shardText, /\/blot\/TP53\.webp/)
  assert.doesNotMatch(shardText, /TRIM1/)
  assert.doesNotMatch(shardText, /<image:(?:title|caption)>/)

  const llms = await worker.fetch(new Request("https://iconoplasm.brinedew.bio/llms.txt"), env, {})
  const llmsText = await llms.text()

  assert.equal(llms.status, 200)
  assert.match(llms.headers.get("content-type") || "", /text\/plain/)
  assert.match(llmsText, /^# Iconoplasm/m)
  assert.match(llmsText, /https:\/\/iconoplasm\.brinedew\.bio\/privacy/)
  assert.match(llmsText, /https:\/\/iconoplasm\.brinedew\.bio\/license/)
  assert.match(llmsText, /CC0 1\.0/)
  assert.match(llmsText, /\/gene\/\{HGNC_SYMBOL\}/)
  assert.match(llmsText, /PFAM clan → character fashion aesthetic/)
})

test("gene archive stays text-only while sitemap uses the exact card blot when portrait metadata drifts", async () => {
  const env = await buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")], {
    cardPortraitShaBySymbol: { TP53: "b".repeat(64) },
  })

  const [range, sitemap] = await Promise.all([
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/genes/TO-TR"), env, {}),
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/sitemaps/genes/TO-TR.xml"), env, {}),
  ])
  const [rangeHtml, sitemapXml] = await Promise.all([range.text(), sitemap.text()])
  assert.equal(range.status, 200)
  assert.equal(sitemap.status, 200)
  assert.match(rangeHtml, /href="\/gene\/TP53"/)
  assert.doesNotMatch(rangeHtml, /<img\b/)
  assert.doesNotMatch(rangeHtml, /\/blots\/v1\//)
  assert.match(
    sitemapXml,
    /<image:loc>https:\/\/iconoplasm\.brinedew\.bio\/blot\/TP53\.webp<\/image:loc>/,
  )
  assert.doesNotMatch(rangeHtml, new RegExp(`/portraits/v1/aa/${"a".repeat(64)}/`))
  assert.doesNotMatch(sitemapXml, new RegExp(`/portraits/v1/aa/${"a".repeat(64)}/`))
})

test("published genes remain discoverable when their exact card has no ready blot", async () => {
  const env = await buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")], {
    cardPortraitShaBySymbol: { TP53: "b".repeat(64) },
    omitBlotSymbols: ["TP53"],
  })
  const [range, sitemap] = await Promise.all([
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/genes/TO-TR"), env, {}),
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/sitemaps/genes/TO-TR.xml"), env, {}),
  ])
  const [rangeHtml, sitemapXml] = await Promise.all([range.text(), sitemap.text()])

  assert.equal(range.status, 200)
  assert.equal(sitemap.status, 200)
  assert.match(rangeHtml, /\/gene\/TP53/)
  assert.match(sitemapXml, /\/gene\/TP53/)
  assert.doesNotMatch(rangeHtml, /<img class="gene-card-thumb"/)
  assert.doesNotMatch(sitemapXml, /<image:image>/)
  assert.doesNotMatch(sitemapXml, /\/portraits\/v1\/bb\//)
})

test("zero-KV exact blot rows enter the gene sitemap without republishing card shards", async () => {
  const portraitSha = "b".repeat(64)
  const cardPayload = {
    symbol: "TP53",
    full_name: "tumor protein p53",
    portrait: { status: "published", asset_sha256: portraitSha },
  }
  const blotFingerprint = iconoplasmGeneBlotFingerprint(cardPayload)
  const objectKey = iconoplasmGeneBlotObjectKey("TP53", blotFingerprint)
  const env = await buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")], {
    cardPortraitShaBySymbol: { TP53: portraitSha },
    omitBlotSymbols: ["TP53"],
    materializedBlotRowsBySymbol: {
      TP53: {
        gene_blot_fingerprint: blotFingerprint,
        gene_blot_portrait_asset_sha256: portraitSha,
        gene_blot_asset_sha256: "c".repeat(64),
        gene_blot_object_key: objectKey,
        gene_blot_width: 768,
        gene_blot_height: 1024,
      },
    },
  })

  const sitemap = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/sitemaps/genes/TO-TR.xml"),
    env,
    {},
  )
  const sitemapXml = await sitemap.text()

  assert.equal(sitemap.status, 200)
  assert.match(
    sitemapXml,
    /<image:loc>https:\/\/iconoplasm\.brinedew\.bio\/blot\/TP53\.webp<\/image:loc>/,
  )
})

test("a stale zero-KV blot row cannot enter the gene sitemap", async () => {
  const portraitSha = "b".repeat(64)
  const env = await buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")], {
    cardPortraitShaBySymbol: { TP53: portraitSha },
    omitBlotSymbols: ["TP53"],
    materializedBlotRowsBySymbol: {
      TP53: {
        gene_blot_fingerprint: "0".repeat(32),
        gene_blot_portrait_asset_sha256: portraitSha,
        gene_blot_asset_sha256: "c".repeat(64),
        gene_blot_object_key: iconoplasmGeneBlotObjectKey("TP53", "0".repeat(32)),
        gene_blot_width: 768,
        gene_blot_height: 1024,
      },
    },
  })

  const sitemap = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/sitemaps/genes/TO-TR.xml"),
    env,
    {},
  )
  const sitemapXml = await sitemap.text()

  assert.equal(sitemap.status, 200)
  assert.doesNotMatch(sitemapXml, /<image:image>/)
})

test("a missing requested card fails the whole range and sitemap shard closed", async () => {
  const env = await buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")], {
    omitCardSymbols: ["TP53"],
  })
  const [range, sitemap] = await Promise.all([
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/genes/TO-TR"), env, {}),
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/sitemaps/genes/TO-TR.xml"), env, {}),
  ])

  assert.equal(range.status, 503)
  assert.equal(range.headers.get("cache-control"), "no-store")
  assert.equal(sitemap.status, 503)
  assert.equal(sitemap.headers.get("cache-control"), "no-store")
})

test("a malformed published-card portrait fails discovery documents closed", async () => {
  const env = await buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")], {
    cardPortraitShaBySymbol: { TP53: "not-a-sha-256" },
  })
  const [range, sitemap] = await Promise.all([
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/genes/TO-TR"), env, {}),
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/sitemaps/genes/TO-TR.xml"), env, {}),
  ])

  assert.equal(range.status, 503)
  assert.equal(range.headers.get("cache-control"), "no-store")
  assert.equal(sitemap.status, 503)
  assert.equal(sitemap.headers.get("cache-control"), "no-store")
})

test("sitemap roots fail closed when the selected card manifest is unavailable", async () => {
  const env = await buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")])
  const readKv = env.KV.get.bind(env.KV)
  env.KV.get = async (key) =>
    String(key).startsWith("iconoplasm:card-catalog:") ? null : readKv(key)

  const [index, pages] = await Promise.all([
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/sitemap.xml"), env, {}),
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/sitemaps/pages.xml"), env, {}),
  ])

  assert.equal(index.status, 503)
  assert.equal(index.headers.get("cache-control"), "no-store")
  assert.equal(pages.status, 503)
  assert.equal(pages.headers.get("cache-control"), "no-store")
})

test("gene document GET and HEAD use the same exact card blot as the sitemap", async () => {
  const staleD1PortraitSha = "a".repeat(64)
  const publishedCardPortraitSha = "b".repeat(64)
  const env = await buildPublishedCatalogEnv([publishedGene("TP53", "tumor protein p53")], {
    cardPortraitShaBySymbol: { TP53: publishedCardPortraitSha },
    cardBlotSemanticUrlBySymbol: {
      TP53: "https://iconoplasm.brinedew.bio/blots/TP53.webp",
    },
    withGenePageD1: true,
  })
  globalThis.fetch = async (url) => {
    const requestUrl = new URL(String(url))
    assert.equal(requestUrl.pathname, "/apps/iconoplasm/index")
    return htmlResponse(`<!doctype html>
<html><head><title>Iconoplasm</title><meta name="description" content="Iconoplasm"><meta name="robots" content="index,follow"></head><body><div id="iconoplasm-root"></div></body></html>`)
  }

  const [page, head, sitemap] = await Promise.all([
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/gene/TP53"), env, {
      waitUntil() {},
    }),
    worker.fetch(
      new Request("https://iconoplasm.brinedew.bio/gene/TP53", { method: "HEAD" }),
      env,
      {
        waitUntil() {},
      },
    ),
    worker.fetch(new Request("https://iconoplasm.brinedew.bio/sitemaps/genes/TO-TR.xml"), env, {
      waitUntil() {},
    }),
  ])
  const [pageHtml, headBody, sitemapXml] = await Promise.all([
    page.text(),
    head.text(),
    sitemap.text(),
  ])
  const blotUrl = "https://iconoplasm.brinedew.bio/blot/TP53.webp"

  assert.equal(page.status, 200)
  assert.equal(head.status, 200)
  assert.equal(headBody, "")
  assert.equal(sitemap.status, 200)
  assert.equal(page.headers.get("x-robots-tag"), null)
  assert.equal(head.headers.get("x-robots-tag"), null)
  assert.match(pageHtml, new RegExp(`property="og:image" content="${blotUrl}"`))
  assert.match(pageHtml, new RegExp(`name="twitter:image" content="${blotUrl}"`))
  assert.match(pageHtml, /class="icono-canonical-gene-blot-image"/)
  assert.match(pageHtml, /data-iconoplasm-role="canonical-blot" data-gene-symbol="TP53"/)
  assert.match(pageHtml, /data-iconoplasm-role="source-portrait" data-gene-symbol="TP53"/)
  assert.match(pageHtml, /data-icono-canonical-gene-blot hidden/)
  assert.match(pageHtml, /loading="lazy" decoding="async" fetchpriority="low"/)
  assert.doesNotMatch(pageHtml, /<figcaption>/)
  assert.match(
    pageHtml,
    /class="icono-canonical-gene-blot-image" src="https:\/\/iconoplasm\.brinedew\.bio\/blot\/TP53\.webp"/,
  )
  assert.doesNotMatch(
    pageHtml,
    /class="icono-canonical-gene-blot-image" src="https:\/\/iconoplasmportraits\.b-cdn\.net\//,
  )
  assert.match(pageHtml, /alt="TP53 Iconoplasm gene blot — tumor protein p53"/)
  assert.match(pageHtml, new RegExp(`"contentUrl":"${blotUrl}"`))
  assert.match(pageHtml, /"license":"https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/"/)
  assert.match(pageHtml, /"usageInfo":"https:\/\/iconoplasm\.brinedew\.bio\/license"/)
  assert.doesNotMatch(pageHtml, /class="icono-image-license"/)
  assert.match(
    pageHtml,
    /images under <a rel="license" href="https:\/\/creativecommons\.org\/publicdomain\/zero\/1\.0\/">CC0 1\.0 license<\/a>/,
  )
  assert.match(pageHtml, /reuse permitted without attribution/)
  assert.match(pageHtml, /rel="license"/)
  assert.match(sitemapXml, new RegExp(`<image:loc>${blotUrl}</image:loc>`))
  assert.doesNotMatch(pageHtml, new RegExp(`/portraits/v1/aa/${staleD1PortraitSha}/`))
  assert.doesNotMatch(sitemapXml, new RegExp(`/portraits/v1/aa/${staleD1PortraitSha}/`))

  const bootstrapMatch = pageHtml.match(
    /<script type="application\/json" id="iconoplasm-card-bootstrap">([^<]+)<\/script>/,
  )
  assert.ok(bootstrapMatch)
  const bootstrap = JSON.parse(bootstrapMatch[1])
  assert.equal(bootstrap.source, "site_gene_detail")
  assert.match(bootstrap.payload.card_snapshot_version, /^card-seofixture/)
  assert.equal(bootstrap.payload.portrait.asset_sha256, publishedCardPortraitSha)
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
  const aliasHead = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/p53", { method: "HEAD" }),
    env,
    { waitUntil() {} },
  )
  assert.equal(alias.status, 301)
  assert.equal(alias.headers.get("location"), "https://iconoplasm.brinedew.bio/gene/TP53")
  assert.equal(aliasHead.status, 301)
  assert.equal(aliasHead.headers.get("location"), "https://iconoplasm.brinedew.bio/gene/TP53")

  const unknown = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/THISISNOTAGENE"),
    env,
    { waitUntil() {} },
  )
  const unknownHead = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/THISISNOTAGENE", { method: "HEAD" }),
    env,
    { waitUntil() {} },
  )
  assert.equal(unknown.status, 404)
  assert.equal(unknown.headers.get("x-robots-tag"), "noindex, follow, noarchive")
  assert.equal(unknownHead.status, 404)
  assert.equal(await unknownHead.text(), "")

  const missingRenderedProfile = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/TP53"),
    env,
    { waitUntil() {} },
  )
  const missingRenderedProfileHead = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/TP53", { method: "HEAD" }),
    env,
    { waitUntil() {} },
  )
  assert.equal(missingRenderedProfile.status, 503)
  assert.equal(missingRenderedProfile.headers.get("x-robots-tag"), "noindex, follow, noarchive")
  assert.equal(missingRenderedProfileHead.status, 503)
  assert.equal(await missingRenderedProfileHead.text(), "")
  assert.equal(missingRenderedProfileHead.headers.get("x-robots-tag"), "noindex, follow, noarchive")
})

test("known incomplete gene shells remain noindex", async () => {
  const env = await buildPublishedCatalogEnv(
    [publishedGene("TRIM1", "tripartite motif containing 1", { published: false })],
    { withGenePageD1: true },
  )

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
  const head = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/TRIM1", { method: "HEAD" }),
    env,
    { waitUntil() {} },
  )
  const responseHtml = await response.text()

  assert.equal(response.status, 200)
  assert.equal(head.status, 200)
  assert.equal(await head.text(), "")
  assert.equal(response.headers.get("x-robots-tag"), "noindex, follow, noarchive")
  assert.equal(head.headers.get("x-robots-tag"), "noindex, follow, noarchive")
  assert.match(responseHtml, /<meta name="robots" content="noindex,follow,noarchive">/)
})

test("warm gene HTML cache preserves the card-aware noindex decision", async () => {
  const env = await buildPublishedCatalogEnv(
    [publishedGene("TRIM1", "tripartite motif containing 1", { published: false })],
    { withGenePageD1: true },
  )
  const storedResponses = new Map()
  globalThis.caches = {
    default: {
      async match(request) {
        return storedResponses.get(request.url)?.clone()
      },
      async put(request, response) {
        storedResponses.set(request.url, response.clone())
      },
    },
  }
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

  const pending = []
  const ctx = {
    waitUntil(promise) {
      pending.push(Promise.resolve(promise))
    },
  }
  const first = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/gene/TRIM1"),
    env,
    ctx,
  )
  assert.equal(first.status, 200)
  assert.equal(first.headers.get("x-robots-tag"), "noindex, follow, noarchive")
  await first.text()
  await Promise.all(pending)

  const warm = await worker.fetch(new Request("https://iconoplasm.brinedew.bio/gene/TRIM1"), env, {
    waitUntil() {},
  })
  const warmHtml = await warm.text()

  assert.equal(warm.status, 200)
  assert.equal(warm.headers.get("x-iconoplasm-html-shell-cache"), "HIT-GENE")
  assert.equal(warm.headers.get("x-robots-tag"), "noindex, follow, noarchive")
  assert.match(warmHtml, /<meta name="robots" content="noindex,follow,noarchive">/)
})

// ARCHITECTURE FENCE [IPD-003]
test("homepage discovery links the raw archive without adding immersive navigation chrome", async () => {
  globalThis.fetch = async () =>
    htmlResponse(
      `<!doctype html><html><head><title>Iconoplasm</title></head><body><nav class="icono-page-switcher" data-icono-page-switcher="true"><a href="/">Archive</a><a href="/clans">Clans</a><a href="/studio">Studio</a></nav><div id="iconoplasm-root"></div></body></html>`,
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
  const directBlotIndex = contentSource.indexOf(
    "https://iconoplasm.brinedew.bio/blot/{HGNC_SYMBOL}.webp",
  )
  const resolverIndex = contentSource.indexOf("The public image resolver is the advanced interface")
  assert.notEqual(directBlotIndex, -1)
  assert.ok(
    resolverIndex > directBlotIndex,
    "homepage must teach the direct blot URL before the resolver",
  )
})

test("gene hydration preserves and refreshes the canonical profile title", async () => {
  const source = await readFile(iconoplasmStaticAppSource, "utf8")

  assert.doesNotMatch(source, /route\.symbol \+ " - Iconoplasm"/)
  assert.match(source, /function geneProfileDocumentTitle\(gene, fallbackSymbol\)/)
  assert.match(source, /document\.title = geneProfileDocumentTitle\(g, symbol\)/)
  assert.match(source, /!document\.title\.endsWith\(" \| Iconoplasm character profile"\)/)
})

test("gene lead keeps the portrait subordinate and renders the canonical blot", async () => {
  const [source, styles] = await Promise.all([
    readFile(iconoplasmStaticAppSource, "utf8"),
    readFile(iconoplasmStaticStylesSource, "utf8"),
  ])

  assert.match(source, /function buildGeneLeadCardMarkup\(g\)/)
  assert.match(source, /var portraitUrl = publishedPortraitUrl\(g, "medium"\)/)
  assert.match(source, /character portrait used inside the Iconoplasm gene blot/)
  assert.match(source, /function canonicalGeneBlotMarkup\(genePayload\)/)
  assert.match(source, /var canonicalBlotUrl = String\(blot\.semantic_url \|\| ""\)\.trim\(\)/)
  assert.match(source, /class=\"icono-canonical-gene-blot-image\"/)
  assert.match(source, /data-iconoplasm-role=\"canonical-blot\" data-gene-symbol=\"/)
  assert.match(source, /data-iconoplasm-role=\"source-portrait\" data-gene-symbol=\"/)
  assert.match(source, /data-iconoplasm-role=\"candidate-blot\" data-gene-symbol=\"/)
  assert.match(source, /data-icono-canonical-gene-blot hidden/)
  assert.match(source, /function revealCanonicalGeneBlot\(trigger, symbol\)/)
  assert.match(source, /blot\.removeAttribute\("hidden"\)/)
  assert.doesNotMatch(source, /<figcaption>Canonical Iconoplasm gene blot/)
  assert.match(styles, /\.icono-canonical-gene-blot\[hidden\][\s\S]*display: none !important/)
  assert.match(source, /blotImage\.setAttribute\("src", canonicalBlotUrl\)/)
  assert.match(source, /portraitDelivery\.ensure\(canonicalBlotUrl\)/)
  assert.match(source, /portraitDelivery\.bind\(blotImage, canonicalBlotUrl\)/)
  assert.match(source, /Iconoplasm gene blot —/)
})
