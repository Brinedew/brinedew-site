import assert from "node:assert/strict"
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
  assert.match(sitemap, /<loc>https:\/\/iconoplasm\.brinedew\.bio\/genes\/A1-AG<\/loc>/)
  assert.match(llms, /# Iconoplasm/)
  assert.match(redirects, /\/blot\/\* \/static\/iconoplasm\/blot-placeholder\.svg 200/)
  assert.match(redirects, /\/portraits\/\* \/static\/iconoplasm\/blot-placeholder\.svg 200/)
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

async function immutableFixture({ fullName = "tumor protein p53" } = {}) {
  const object = immutableFixtureObject
  const gene = {
    symbol: "TP53",
    full_name: fullName,
    color: "#223344",
    essence: { summary: "Guardian of the genome" },
    portrait: { status: "published", asset_sha256: "a".repeat(64) },
    portrait_candidates: [],
  }
  const geneObject = await object("genes", gene)
  const portraitObject = await object("portraits", {
    symbol: "TP53",
    portrait: gene.portrait,
  })
  const cardObject = await object("cards", { symbol: "TP53", payload: gene })
  const indexObject = await object("indexes", {
    schema_version: 2,
    entries: [["TP53", cardObject.hash, geneObject.hash, portraitObject.hash]],
  })
  const catalogObject = await object("catalogs", {
    schema_version: 1,
    entries: [
      {
        symbol: "TP53",
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
    pages: [{ first_symbol: "TP53", last_symbol: "TP53", key: catalogObject.path.slice(1) }],
    search_entries: [["TP53", fullName, 0, 0]],
    gallery_entries: [["TP53", 0, 0, 100, 5]],
  })
  const manifestObject = await object("manifests", {
    storage: "bunny_card_catalog_v2",
    card_count: 1,
    shards: [
      {
        first_symbol: "TP53",
        last_symbol: "TP53",
        delivery_indexes: [
          { first_symbol: "TP53", last_symbol: "TP53", key: indexObject.path.slice(1) },
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
  return { gene, head, objects, geneObject, manifestObject }
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

test("blot bytes use immutable CDN identity or a static placeholder, never the semantic Worker route", () => {
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
