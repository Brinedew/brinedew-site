import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { parse as parseToml } from "toml"
import { prepareIconoplasmEdgeAssets } from "../../../scripts/prepare-iconoplasm-edge-assets.mjs"
import {
  createIconoplasmPublicationReader,
  immutableBlotByteUrl,
  PUBLIC_READ_REQUEST_BOUNDS,
} from "./publication-reader.js"
import {
  createThrowingStateBindings,
  serveStaticFirstRequest,
} from "../../../workers/test-helpers/throwing-state-bindings.js"

const appPath = new URL("./app.js", import.meta.url)
const diagramStudioPath = new URL("./diagram-studio.js", import.meta.url)
const headPath = new URL("../../components/Head.tsx", import.meta.url)
const wranglerPath = new URL(
  "../../../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  import.meta.url,
)

test("anonymous gene detail asks the immutable publication reader instead of a stateful API", async () => {
  const source = await readFile(appPath, "utf8")
  const start = source.indexOf("function fetchCompleteGeneDetailFromEndpoint(key, options)")
  const end = source.indexOf("function fetchGeneDetail(symbol, options)", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const readerCalls = []
  const load = new Function(
    "reader",
    `
      var calls = [];
      var window = { IconoplasmPublicationReader: reader };
      function fetchJSON(path, init) {
        calls.push({ type: "stateful", path, init });
        return Promise.resolve({ symbol: "TP53", essence: {}, portrait_candidates: [] });
      }
      function isCompleteGeneDetailPayload(payload, symbol) {
        return payload && payload.symbol === symbol && payload.essence && Array.isArray(payload.portrait_candidates);
      }
      function hydratePublishedCandidateGallery(payload) { return Promise.resolve(payload) }
      ${source.slice(start, end)}
      return { fetchCompleteGeneDetailFromEndpoint, calls };
    `,
  )({
    gene(symbol, options) {
      readerCalls.push({ symbol, options })
      return Promise.resolve({ symbol, essence: {}, portrait_candidates: [] })
    },
  })

  const payload = await load.fetchCompleteGeneDetailFromEndpoint("TP53", {})
  assert.equal(payload.symbol, "TP53")
  assert.equal(readerCalls.length, 1)
  assert.deepEqual(load.calls, [])
})

test("publication reader imports carry its current content hash", async () => {
  const source = await readFile(new URL("./publication-reader.js", import.meta.url), "utf8")
  const version = createHash("sha256").update(source).digest("hex").slice(0, 16)
  for (const consumerPath of [appPath, diagramStudioPath]) {
    const consumer = await readFile(consumerPath, "utf8")
    assert.match(consumer, new RegExp(`publication-reader\\.js\\?v=${version}`))
  }
})

test("gene document head-start never calls the stateful card or detail APIs", async () => {
  const source = await readFile(headPath, "utf8")
  const startupStart = source.indexOf("var bootstrap = {")
  const startupEnd = source.indexOf(
    'if ((iconoplasmStartupPath === "/" || iconoplasmStartupPath === "")',
    startupStart,
  )
  assert.notEqual(startupStart, -1, "missing Iconoplasm bootstrap")
  assert.notEqual(startupEnd, -1, "missing Iconoplasm bootstrap boundary")
  const geneStartup = source.slice(startupStart, startupEnd)
  assert.doesNotMatch(geneStartup, /\/api\/iconoplasm\/cards/)
  assert.doesNotMatch(geneStartup, /\/api\/iconoplasm\/site\/genes/)
  assert.doesNotMatch(geneStartup, /startGeneDetailFetch/)
})

test("passive gene hydration never polls print-copy state", async () => {
  const source = await readFile(appPath, "utf8")
  const start = source.indexOf("function wirePrintCopyRequests")
  const end = source.indexOf("function openPrintCopyImage", start)
  assert.notEqual(start, -1, "missing print-copy wiring")
  assert.notEqual(end, -1, "missing print-copy wiring boundary")
  const block = source.slice(start, end)
  assert.doesNotMatch(block, /fetchPrintCopyStatus/)
  assert.doesNotMatch(block, /fetchJSON|fetch\(/)
})

test("anonymous catalog search, gallery, and freshness stay in the publication reader", async () => {
  const source = await readFile(appPath, "utf8")
  const start = source.indexOf("function fetchJSON(path, init)")
  const end = source.indexOf("function fetchAuthedJSON(path, init)", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)
  const network = []
  const readerCalls = []
  const load = new Function(
    "reader",
    `
      var API = "https://iconoplasm.brinedew.bio";
      var window = { IconoplasmPublicationReader: reader };
      function apiErrorMessage() { return "error"; }
      function fetch(url) { network.push(url); return Promise.reject(new Error("network")); }
      var network = [];
      ${source.slice(start, end)}
      return { fetchJSON, network };
    `,
  )({
    search(query, options) {
      readerCalls.push(["search", query, options])
      return Promise.resolve({ genes: [] })
    },
    gallery(options) {
      readerCalls.push(["gallery", options])
      return Promise.resolve({ items: [] })
    },
    metadata() {
      readerCalls.push(["metadata"])
      return Promise.resolve({ card_snapshot_version: "ccv2-head" })
    },
  })

  await load.fetchJSON("/api/public/v1/genes/search?q=TP53&limit=12&scope=catalog")
  await load.fetchJSON("/api/public/v1/gallery?order=votes&limit=24&offset=0")
  await load.fetchJSON("/api/public/v1/metadata?gallery-freshness=ignored")
  assert.deepEqual(
    readerCalls.map((entry) => entry[0]),
    ["search", "gallery", "metadata"],
  )
  assert.deepEqual(load.network, [])

  await assert.rejects(
    load.fetchJSON("/api/public/v1/genes/search?q=TP53&limit=12&scope=discoveries"),
    /network/,
  )
  assert.deepEqual(load.network, [
    "https://iconoplasm.brinedew.bio/api/public/v1/genes/search?q=TP53&limit=12&scope=discoveries",
  ])
})

test("gene documents are one static SPA shell and never enter Worker execution", async () => {
  const config = parseToml(await readFile(wranglerPath, "utf8"))
  assert.equal(config.assets.not_found_handling, "single-page-application")
  assert.equal(
    config.assets.run_worker_first.some((pattern) => pattern.startsWith("/gene")),
    false,
  )
  assert.equal(
    config.assets.run_worker_first.some((pattern) => pattern.startsWith("/sitemap")),
    false,
  )
  assert.equal(config.assets.run_worker_first.includes("/robots.txt"), false)
  assert.equal(
    config.assets.run_worker_first.some((pattern) => pattern.startsWith("/portraits")),
    false,
  )
  assert.equal(
    config.assets.run_worker_first.some((pattern) =>
      pattern.startsWith("/published-cards/v2/immutable"),
    ),
    false,
  )
  assert.equal(config.assets.run_worker_first.includes("/api/*"), true)
  assert.equal(
    config.assets.run_worker_first.some((pattern) => pattern.startsWith("/admin")),
    true,
  )
})

test("the emitted static asset policy permits immutable Bunny JSON reads", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "iconoplasm-public-plane-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const sourceRoot = path.join(root, "public")
  const outputRoot = path.join(root, "public-iconoplasm-edge")
  await mkdir(path.join(sourceRoot, "apps", "iconoplasm"), { recursive: true })
  await mkdir(path.join(sourceRoot, "static"), { recursive: true })
  await Promise.all([
    writeFile(path.join(sourceRoot, "apps", "iconoplasm", "index.html"), "<main>Iconoplasm</main>"),
    writeFile(path.join(sourceRoot, "apps", "iconoplasm", "privacy.html"), "privacy"),
    writeFile(path.join(sourceRoot, "apps", "iconoplasm", "license.html"), "license"),
    writeFile(path.join(sourceRoot, "apps", "iconoplasm", "caretaker-terms.html"), "terms"),
    writeFile(path.join(sourceRoot, "favicon.ico"), "icon"),
  ])

  await prepareIconoplasmEdgeAssets({ sourceRoot, outputRoot })
  const headers = await readFile(path.join(outputRoot, "_headers"), "utf8")
  assert.match(headers, /connect-src[^\n]*https:\/\/iconoplasmportraits\.b-cdn\.net/)
  const robots = await readFile(path.join(outputRoot, "robots.txt"), "utf8")
  const sitemap = await readFile(path.join(outputRoot, "sitemap.xml"), "utf8")
  const llms = await readFile(path.join(outputRoot, "llms.txt"), "utf8")
  const redirects = await readFile(path.join(outputRoot, "_redirects"), "utf8")
  assert.match(robots, /Sitemap: https:\/\/iconoplasm\.brinedew\.bio\/sitemap\.xml/)
  assert.doesNotMatch(sitemap, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/genes/)
  assert.match(llms, /# Iconoplasm/)
  assert.doesNotMatch(redirects, /^\/blot\//m)
  assert.match(redirects, /\/portraits\/\* \/static\/iconoplasm\/blot-placeholder\.svg 200/)
  assert.match(redirects, /\/genes \/ 301/)
  assert.match(redirects, /\/genes\/\* \/ 301/)
  assert.doesNotMatch(sitemap, /<main>Iconoplasm<\/main>/)
})

async function immutableFixtureObject(kind, value) {
  const body = JSON.stringify(value)
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))
  const hash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  return {
    hash,
    path: `/published-cards/v2/immutable/${kind}/${hash}.json`,
    body,
  }
}

async function immutableFixture({ symbol = "TP53", fullName = "tumor protein p53" } = {}) {
  const object = immutableFixtureObject
  const gene = {
    symbol,
    full_name: fullName,
    color: "#223344",
    essence: { summary: "Guardian of the genome" },
    portrait: { status: "published", asset_sha256: "a".repeat(64) },
    portrait_candidates: [],
  }
  const geneObject = await object("genes", gene)
  const portraitObject = await object("portraits", {
    symbol,
    portrait: gene.portrait,
  })
  const cardObject = await object("cards", { symbol, payload: gene })
  const indexObject = await object("indexes", {
    schema_version: 2,
    entries: [[symbol, cardObject.hash, geneObject.hash, portraitObject.hash]],
  })
  const catalogObject = await object("catalogs", {
    schema_version: 1,
    entries: [
      {
        symbol,
        full_name: fullName,
        color: "#223344",
        popularity_score: 100,
        image_upvotes: 7,
        image_downvotes: 2,
        image_score: 5,
        portrait: gene.portrait,
        candidate_summaries: [],
      },
    ],
  })
  const catalogIndexObject = await object("catalogindexes", {
    schema_version: 2,
    pages: [{ first_symbol: symbol, last_symbol: symbol, key: catalogObject.path.slice(1) }],
    search_entries: [[symbol, fullName, 0, 0]],
    gallery_entries: [[symbol, 0, 0, 100, 5]],
  })
  const manifestObject = await object("manifests", {
    storage: "bunny_card_catalog_v2",
    card_count: 1,
    shards: [
      {
        first_symbol: symbol,
        last_symbol: symbol,
        delivery_indexes: [
          { first_symbol: symbol, last_symbol: symbol, key: indexObject.path.slice(1) },
        ],
        catalog_index: { key: catalogIndexObject.path.slice(1), page_count: 1 },
      },
    ],
  })
  const head = JSON.stringify({ schema_version: 2, current: `ccv2-${manifestObject.hash}` })
  const objects = new Map(
    [
      geneObject,
      portraitObject,
      cardObject,
      indexObject,
      catalogObject,
      catalogIndexObject,
      manifestObject,
    ].map((entry) => [entry.path, entry.body]),
  )
  return { gene, head, objects, geneObject, catalogObject, manifestObject }
}

test("the browser resolves gene, search, and gallery from one immutable publication", async () => {
  const fixture = await immutableFixture()
  const requests = []
  const throwingBindings = createThrowingStateBindings()
  const reader = createIconoplasmPublicationReader({
    hedgeMs: 50,
    fetchImpl: async (url) => {
      const parsed = new URL(url)
      requests.push(parsed)
      if (parsed.origin !== "https://iconoplasmportraits.b-cdn.net") {
        throwingBindings.ICONOPLASM_DB.prepare("anonymous immutable read entered state")
      }
      if (parsed.pathname === "/api/public/v1/card-current") {
        return new Response(fixture.head, { status: 200 })
      }
      const body = fixture.objects.get(parsed.pathname)
      return body ? new Response(body, { status: 200 }) : new Response(null, { status: 404 })
    },
  })

  const gene = await reader.gene("TP53")
  assert.equal(gene.symbol, fixture.gene.symbol)
  assert.deepEqual(
    (await reader.genes(["TP53", "TP53", "not valid!"])).map((record) => record.symbol),
    ["TP53"],
  )
  assert.equal(
    gene.portrait.medium_url,
    `https://iconoplasmportraits.b-cdn.net/portraits/v1/aa/${"a".repeat(64)}/medium.webp`,
  )
  assert.deepEqual(
    (await reader.search("tumor", { limit: 12 })).genes.map((gene) => gene.symbol),
    ["TP53"],
  )
  const gallery = await reader.gallery({ order: "votes", offset: 0, limit: 24 })
  assert.deepEqual(
    gallery.items.map((gene) => gene.symbol),
    ["TP53"],
  )
  assert.equal(gallery.items[0].image_score, 5, "passive vote display comes from the artifact")
  assert.deepEqual(gallery.items[0].candidate_summaries, [])
  assert.equal(
    requests.every((request) => request.origin === "https://iconoplasmportraits.b-cdn.net"),
    true,
    "healthy immutable reads must never enter the throwing stateful origin",
  )
  assert.equal(
    requests.some(
      (request) =>
        request.pathname.startsWith("/api/iconoplasm/") ||
        request.pathname === "/api/public/v1/gallery" ||
        request.pathname === "/api/public/v1/genes/search",
    ),
    false,
  )
})

test("a legacy immutable gene without candidates remains a complete static dossier", async () => {
  const fixture = await immutableFixture()
  const legacyGene = { ...fixture.gene }
  delete legacyGene.portrait_candidates
  const geneObject = await immutableFixtureObject("genes", legacyGene)
  const oldEntry = JSON.parse(
    fixture.objects.get([...fixture.objects.keys()].find((key) => key.includes("/indexes/"))),
  )
  oldEntry.entries[0][2] = geneObject.hash
  const indexObject = await immutableFixtureObject("indexes", oldEntry)
  const manifest = JSON.parse(fixture.manifestObject.body)
  manifest.shards[0].delivery_indexes[0].key = indexObject.path.slice(1)
  const manifestObject = await immutableFixtureObject("manifests", manifest)
  const objects = new Map(fixture.objects)
  objects.set(geneObject.path, geneObject.body)
  objects.set(indexObject.path, indexObject.body)
  objects.set(manifestObject.path, manifestObject.body)
  const reader = createIconoplasmPublicationReader({
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname
      if (pathname === "/api/public/v1/card-current") {
        return new Response(
          JSON.stringify({ schema_version: 2, current: `ccv2-${manifestObject.hash}` }),
        )
      }
      const body = objects.get(pathname)
      return body ? new Response(body) : new Response(null, { status: 404 })
    },
  })

  const gene = await reader.gene("TP53")
  assert.deepEqual(gene.portrait_candidates, [])
})

test("a healthy Bunny response never starts a browser-side canonical-origin hedge", async () => {
  const fixture = await immutableFixture()
  let originRequests = 0
  const reader = createIconoplasmPublicationReader({
    fetchImpl: async (url) => {
      const parsed = new URL(url)
      if (parsed.origin === "https://iconoplasm.brinedew.bio") originRequests += 1
      if (parsed.pathname === "/api/public/v1/card-current") {
        return new Response(fixture.head, { status: 200 })
      }
      const body = fixture.objects.get(parsed.pathname)
      return body ? new Response(body, { status: 200 }) : new Response(null, { status: 404 })
    },
  })

  assert.equal((await reader.gene("TP53")).symbol, "TP53")
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.equal(originRequests, 0)
})

test("a failed Bunny head keeps the coherent prior publication without stateful reconstruction", async () => {
  const fixture = await immutableFixture()
  const storage = new Map([["iconoplasm.publication-head.v1", fixture.head]])
  const requested = []
  const reader = createIconoplasmPublicationReader({
    storage: {
      getItem(key) {
        return storage.get(key) || null
      },
      setItem(key, value) {
        storage.set(key, value)
      },
    },
    fetchImpl: async (url) => {
      const parsed = new URL(url)
      requested.push(parsed)
      if (parsed.pathname === "/api/public/v1/card-current") {
        return new Response(null, { status: 503 })
      }
      const body = fixture.objects.get(parsed.pathname)
      return body ? new Response(body, { status: 200 }) : new Response(null, { status: 404 })
    },
  })

  assert.equal((await reader.gene("TP53")).symbol, "TP53")
  assert.equal(
    requested.some((request) => request.pathname.startsWith("/api/iconoplasm/")),
    false,
  )
  assert.equal(
    requested.every((request) => request.origin === "https://iconoplasmportraits.b-cdn.net"),
    true,
    "a Bunny failure must not fan readers into the Worker/KV origin",
  )
})

test("a valid new head with a missing child retains the last fully coherent publication", async () => {
  const prior = await immutableFixture()
  const brokenManifest = await immutableFixtureObject("manifests", {
    storage: "bunny_card_catalog_v2",
    card_count: 1,
    shards: [
      {
        first_symbol: "TP53",
        last_symbol: "TP53",
        delivery_indexes: [
          {
            first_symbol: "TP53",
            last_symbol: "TP53",
            key: `published-cards/v2/immutable/indexes/${"f".repeat(64)}.json`,
          },
        ],
      },
    ],
  })
  const nextHead = JSON.stringify({ schema_version: 2, current: `ccv2-${brokenManifest.hash}` })
  const stored = new Map([["iconoplasm.publication-head.v1", prior.head]])
  const reader = createIconoplasmPublicationReader({
    storage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname
      if (pathname === "/api/public/v1/card-current") return new Response(nextHead)
      if (pathname === brokenManifest.path) return new Response(brokenManifest.body)
      const body = prior.objects.get(pathname)
      return body ? new Response(body) : new Response(null, { status: 404 })
    },
  })

  assert.equal((await reader.gene("TP53")).symbol, "TP53")
  assert.equal(stored.get("iconoplasm.publication-head.v1"), prior.head)
})

test("a search on a partially propagated head cannot erase the prior coherent gene fallback", async () => {
  const prior = await immutableFixture({ fullName: "prior tumor protein p53" })
  const next = await immutableFixture({ fullName: "next tumor protein p53" })
  const stored = new Map([["iconoplasm.publication-head.v1", prior.head]])
  const reader = createIconoplasmPublicationReader({
    storage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname
      if (pathname === "/api/public/v1/card-current") return new Response(next.head)
      if (pathname === next.geneObject.path) return new Response(null, { status: 404 })
      const body = next.objects.get(pathname) || prior.objects.get(pathname)
      return body ? new Response(body) : new Response(null, { status: 404 })
    },
  })

  assert.deepEqual(
    (await reader.search("next", { limit: 12 })).genes.map((gene) => gene.full_name),
    ["next tumor protein p53"],
  )
  assert.equal((await reader.gene("TP53")).full_name, "prior tumor protein p53")
})

test("a successful gene cannot evict another symbol's coherent fallback", async () => {
  const priorTp53 = await immutableFixture({ symbol: "TP53", fullName: "prior TP53" })
  const priorRb1 = await immutableFixture({ symbol: "RB1", fullName: "prior RB1" })
  const brokenTp53 = await immutableFixture({ symbol: "TP53", fullName: "broken TP53" })
  let head = priorTp53.head
  const stored = new Map()
  const fixtures = [priorTp53, priorRb1, brokenTp53]
  const reader = createIconoplasmPublicationReader({
    storage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname
      if (pathname === "/api/public/v1/card-current") return new Response(head)
      if (pathname === brokenTp53.geneObject.path) return new Response(null, { status: 404 })
      for (const fixture of fixtures) {
        const body = fixture.objects.get(pathname)
        if (body) return new Response(body)
      }
      return new Response(null, { status: 404 })
    },
  })

  assert.equal((await reader.gene("TP53")).full_name, "prior TP53")
  head = priorRb1.head
  assert.equal((await reader.gene("RB1")).full_name, "prior RB1")
  head = brokenTp53.head
  assert.equal((await reader.gene("TP53")).full_name, "prior TP53")
})

test("a successful search query cannot evict another query's coherent fallback", async () => {
  const priorBeta = await immutableFixture({ fullName: "prior beta protein" })
  const nextAlpha = await immutableFixture({ fullName: "next alpha protein" })
  const brokenBeta = await immutableFixture({ fullName: "next beta protein" })
  let head = priorBeta.head
  const stored = new Map()
  const reader = createIconoplasmPublicationReader({
    storage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname
      if (pathname === "/api/public/v1/card-current") return new Response(head)
      if (head === brokenBeta.head && pathname === brokenBeta.catalogObject.path)
        return new Response(null, { status: 404 })
      for (const fixture of [brokenBeta, nextAlpha, priorBeta]) {
        const body = fixture.objects.get(pathname)
        if (body) return new Response(body)
      }
      return new Response(null, { status: 404 })
    },
  })

  assert.equal((await reader.search("beta")).genes[0].full_name, "prior beta protein")
  head = nextAlpha.head
  assert.equal((await reader.search("alpha")).genes[0].full_name, "next alpha protein")
  head = brokenBeta.head
  assert.equal((await reader.search("beta")).genes[0].full_name, "prior beta protein")
})

test("a successful gallery page cannot evict another page's coherent fallback", async () => {
  const prior = await immutableFixture({ fullName: "prior gallery item" })
  const next = await immutableFixture({ fullName: "next gallery item" })
  let head = prior.head
  const stored = new Map()
  const reader = createIconoplasmPublicationReader({
    storage: {
      getItem: (key) => stored.get(key) || null,
      setItem: (key, value) => stored.set(key, value),
    },
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname
      if (pathname === "/api/public/v1/card-current") return new Response(head)
      if (head === next.head && pathname === next.catalogObject.path)
        return new Response(null, { status: 404 })
      for (const fixture of [next, prior]) {
        const body = fixture.objects.get(pathname)
        if (body) return new Response(body)
      }
      return new Response(null, { status: 404 })
    },
  })

  assert.equal(
    (await reader.gallery({ offset: 0, limit: 1 })).items[0].full_name,
    "prior gallery item",
  )
  head = next.head
  await reader.gallery({ offset: 1, limit: 1 })
  assert.equal(
    (await reader.gallery({ offset: 0, limit: 1 })).items[0].full_name,
    "prior gallery item",
  )
})

test("search and gallery fetch compact indexes plus only result pages", async () => {
  const fixture = await immutableFixture()
  const requested = []
  const reader = createIconoplasmPublicationReader({
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname
      requested.push(pathname)
      if (pathname === "/api/public/v1/card-current") return new Response(fixture.head)
      const body = fixture.objects.get(pathname)
      return body ? new Response(body) : new Response(null, { status: 404 })
    },
  })

  await reader.search("tumor", { limit: 12 })
  await reader.gallery({ order: "votes", offset: 0, limit: 24 })
  const catalogReads = requested.filter((pathname) => pathname.includes("/catalog"))
  assert.equal(catalogReads.length, 2, "one compact index plus one selected rich page")
  assert.deepEqual(PUBLIC_READ_REQUEST_BOUNDS, {
    catalogIndexes: 32,
    compactIndexBytes: 131072,
    resultPageBytes: 524288,
    searchRequests: 46,
    searchBytes: 10_553_344,
    galleryRequests: 58,
    galleryBytes: 16_844_800,
  })
})

test("the browser uses an exact immutable blot object or a placeholder, never the mutable alias", () => {
  const fingerprint = "1".repeat(32)
  const objectKey = `blots/v1/T/TP53/${fingerprint}/TP53-iconoplasm-gene-blot.webp`
  assert.equal(
    immutableBlotByteUrl({
      blot_fingerprint: fingerprint,
      object_key: objectKey,
      semantic_url: "https://iconoplasm.brinedew.bio/blot/TP53.webp",
      image_url: `https://iconoplasmportraits.b-cdn.net/${objectKey}`,
    }),
    `https://iconoplasmportraits.b-cdn.net/${objectKey}`,
  )
  assert.equal(
    immutableBlotByteUrl({
      blot_fingerprint: fingerprint,
      object_key: objectKey,
      image_url: "https://iconoplasmportraits.b-cdn.net/not-the-published-object.webp",
    }),
    "/static/iconoplasm/blot-placeholder.svg",
  )
  assert.equal(
    immutableBlotByteUrl({ semantic_url: "/blot/TP53.webp" }),
    "/static/iconoplasm/blot-placeholder.svg",
  )
})

test("homepage and crawler-facing reads short-circuit before every throwing state binding", async () => {
  const bindings = createThrowingStateBindings()
  const shell = new Response("<main>Iconoplasm static shell</main>", {
    headers: { "Content-Type": "text/html" },
  })
  const assets = new Map([
    ["/", shell],
    ["/index.html", shell],
    ["/robots.txt", new Response("User-agent: *\nAllow: /")],
    ["/sitemap.xml", new Response("<urlset></urlset>")],
    ["/llms.txt", new Response("# Iconoplasm")],
    ["/static/iconoplasm/blot-placeholder.svg", new Response("<svg></svg>")],
  ])
  const worker = async (_request, env) => {
    env.ICONOPLASM_DB.prepare("SELECT 1")
    return new Response("state was reached", { status: 500 })
  }
  const cases = [
    ["homepage", "/", 200, "Iconoplasm static shell"],
    ["gene dossier shell", "/gene/TP53", 200, "Iconoplasm static shell"],
    ["gene archive shell", "/genes/A1-AG", 200, "Iconoplasm static shell"],
    ["crawler policy", "/robots.txt", 200, "User-agent"],
    ["sitemap", "/sitemap.xml", 200, "urlset"],
    ["llms", "/llms.txt", 200, "Iconoplasm"],
    ["failed blot placeholder", "/blot/TP53.webp", 200, "svg"],
    ["failed portrait placeholder", "/portraits/v1/aa/missing.webp", 200, "svg"],
  ]
  for (const [label, pathname, status, body] of cases) {
    const response = await serveStaticFirstRequest(
      new Request(`https://iconoplasm.brinedew.bio${pathname}`),
      {
        assets,
        shell,
        placeholder: assets.get("/static/iconoplasm/blot-placeholder.svg"),
        bindings,
        worker,
      },
    )
    assert.equal(response.status, status, label)
    assert.match(await response.text(), new RegExp(body), label)
  }
})

// B-793: the published gene record keeps its complete candidate pool in
// immutable gallery pages. The dossier hydrates it at the one funnel every
// load passes through, so no synchronous consumer changes shape.
function loadDossierFunnel(reader) {
  return readFile(appPath, "utf8").then((source) => {
    const start = source.indexOf("function isCompleteGeneDetailPayload")
    const end = source.indexOf("function fetchGeneDetail", start)
    assert.notEqual(start, -1, "missing gene detail payload guard")
    assert.notEqual(end, -1, "missing gene detail funnel boundary")
    return new Function(
      "reader",
      `
        var window = { IconoplasmPublicationReader: reader };
        function normalizedSymbol(value) { return String(value || "").trim().toUpperCase() }
        ${source.slice(start, end)}
        return { fetchCompleteGeneDetailFromEndpoint };
      `,
    )(reader)
  })
}

function pagedRecord(symbol) {
  return {
    symbol,
    essence: { summary: "p53" },
    candidate_count: 72,
    candidate_gallery: {
      key: `published-cards/v2/immutable/galleries/${"a".repeat(64)}.json`,
      hash: "a".repeat(64),
      page_count: 1,
    },
  }
}

test("a paged gene record hydrates its gallery at the dossier funnel", async () => {
  const calls = []
  const load = await loadDossierFunnel({
    gene(symbol) {
      calls.push(["gene", symbol])
      return Promise.resolve(pagedRecord(symbol))
    },
    candidateGallery(record) {
      calls.push(["candidateGallery", record.symbol])
      return Promise.resolve({ candidates: [{ candidate_image_id: 7 }], count: 1 })
    },
  })
  const data = await load.fetchCompleteGeneDetailFromEndpoint("TP53")
  assert.equal(data.portrait_candidates.length, 1)
  assert.equal(data.candidate_count, 1)
  assert.equal(data.essence.summary, "p53")
  assert.deepEqual(calls, [
    ["gene", "TP53"],
    ["candidateGallery", "TP53"],
  ])
})

test("an embedded or older record passes the funnel without a gallery fetch", async () => {
  let galleryCalls = 0
  const load = await loadDossierFunnel({
    gene(symbol) {
      return Promise.resolve({
        symbol,
        essence: {},
        portrait_candidates: [{ candidate_image_id: 1 }],
      })
    },
    candidateGallery() {
      galleryCalls += 1
      return Promise.resolve({ candidates: [], count: 0 })
    },
  })
  const data = await load.fetchCompleteGeneDetailFromEndpoint("TP53")
  assert.equal(data.portrait_candidates.length, 1)
  assert.equal(galleryCalls, 0)
})

test("a failed gallery page rejects the dossier load instead of rendering an empty gallery", async () => {
  const load = await loadDossierFunnel({
    gene(symbol) {
      return Promise.resolve(pagedRecord(symbol))
    },
    candidateGallery() {
      return Promise.reject(new Error("Publication HTTP 404"))
    },
  })
  await assert.rejects(load.fetchCompleteGeneDetailFromEndpoint("TP53"), /HTTP 404/)
})
