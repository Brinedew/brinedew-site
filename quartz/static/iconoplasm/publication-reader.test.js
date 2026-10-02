import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { parse as parseToml } from "toml"
import { prepareIconoplasmEdgeAssets } from "../../../scripts/prepare-iconoplasm-edge-assets.mjs"
import { createIconoplasmPublicationReader } from "./publication-reader.js"
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
  assert.equal(config.assets.run_worker_first.includes("/portraits/*"), true)
  // B-807, IPD-001: healthy readers take publication objects from Bunny. The
  // exact immutable prefix reaches the Worker only as the origin fallback, for
  // the extension and for a website reader whose Bunny request failed.
  assert.deepEqual(
    config.assets.run_worker_first.filter((pattern) => pattern.startsWith("/published-cards")),
    [],
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
    writeFile(path.join(sourceRoot, "apps", "iconoplasm", "developers.html"), "developers"),
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
  assert.doesNotMatch(redirects, /^\/portraits\//m)
  assert.match(redirects, /\/genes \/ 301/)
  assert.match(redirects, /\/genes\/\* \/ 301/)
  assert.doesNotMatch(sitemap, /<main>Iconoplasm<\/main>/)
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

// The page reads the one stable object per gene and the one stable catalog
// object. Failure modes written before the code:
// 1. stable object present on Bunny -> exactly one CDN fetch, revalidated
//    (cache: "no-cache"), portrait media rewritten to the CDN, pool inline;
// 2. CDN 404 -> null ("no card for this gene"), and no origin request;
// 3. a malformed stable object -> a reader error, never older state, and no
//    origin request;
// 4. CDN unreachable -> the canonical origin's copy of the same object;
// 5. both unreachable -> a reader error;
// 6. the catalog object answers home, gallery, search, metrics and metadata
//    from one CDN fetch;
// 7. a catalog 404 or malformed catalog is a reader error, with no origin
//    request for the 404;
// 8. a brick batch is answered from the catalog rows; unknown symbols are
//    simply absent.
const CANONICAL = "https://iconoplasm.brinedew.bio"
const BUNNY = "https://iconoplasmportraits.b-cdn.net"

function stableGeneFixture() {
  return {
    symbol: "TP53",
    full_name: "tumor protein p53",
    color: "#223344",
    essence: { summary: "Guardian of the genome" },
    portrait: { status: "published", asset_sha256: "a".repeat(64) },
    portrait_candidates: [
      { asset_sha256: "a".repeat(64), is_current: true, image_score: 4 },
      { asset_sha256: "b".repeat(64), is_current: false, image_score: 1 },
    ],
    candidate_count: 2,
    stable_object_version: 3,
    published_at: "2026-09-30T22:52:55.283Z",
  }
}

function stableCatalogFixture() {
  return JSON.stringify({
    schema: 3,
    generated_at: "2026-10-01T15:00:00.000Z",
    watermark_event_id: 320152,
    genes: [
      [
        "A1BG",
        "Alpha-1B-glycoprotein",
        "b".repeat(64),
        "#dd8c9d",
        1,
        14.6,
        54.3,
        34,
        1986,
        "2026-08-04 04:37:23",
      ],
      [
        "TP53",
        "tumor protein p53",
        "a".repeat(64),
        "#223344",
        9,
        2.1,
        43.6,
        48,
        1979,
        "2026-09-30 22:52:55",
      ],
      ["ZZZ3", "zinc finger ZZ-type containing 3", "", "", 0, null, 12.0, 7, 2001, ""],
    ],
  })
}

function recordingReader(answer) {
  const requests = []
  const cacheModes = []
  const reader = createIconoplasmPublicationReader({
    fetchImpl: async (url, init) => {
      const parsed = new URL(url)
      requests.push(parsed.origin + parsed.pathname)
      cacheModes.push(init?.cache)
      return answer(parsed)
    },
  })
  return { reader, requests, cacheModes }
}

test("a gene with a stable object is one revalidated CDN fetch with its pool inline (B-898)", async () => {
  const { reader, requests, cacheModes } = recordingReader((parsed) =>
    parsed.pathname === "/genes/v3/TP53.json"
      ? new Response(JSON.stringify(stableGeneFixture()), { status: 200 })
      : new Response(null, { status: 404 }),
  )
  const gene = await reader.gene("tp53")
  assert.equal(gene.symbol, "TP53")
  assert.equal(gene.stable_object_version, 3)
  assert.deepEqual(requests, [`${BUNNY}/genes/v3/TP53.json`])
  assert.deepEqual(cacheModes, ["no-cache"])
  assert.equal(gene.portrait.medium_url, `${BUNNY}/portraits/v1/aa/${"a".repeat(64)}/medium.webp`)
  const pool = await reader.candidateGallery(gene)
  assert.equal(pool.count, 2)
  assert.equal(pool.candidates[0].is_current, true)
  assert.equal(requests.length, 1, "the inline pool needs no further fetch")
})

test("a CDN 404 means no card for the gene and never becomes a Worker request (B-898)", async () => {
  const { reader, requests } = recordingReader(() => new Response(null, { status: 404 }))
  assert.equal(await reader.gene("TP53"), null)
  assert.deepEqual(requests, [`${BUNNY}/genes/v3/TP53.json`])
})

test("a malformed stable object is a reader error, not older state (B-898)", async () => {
  const { reader, requests } = recordingReader(
    () =>
      new Response(JSON.stringify({ ...stableGeneFixture(), symbol: "BRCA1" }), { status: 200 }),
  )
  await assert.rejects(reader.gene("TP53"), /Invalid published gene object: TP53/)
  assert.deepEqual(requests, [`${BUNNY}/genes/v3/TP53.json`])
})

test("an unreachable CDN hedges the stable object to the canonical origin (B-898)", async () => {
  const { reader, requests } = recordingReader((parsed) => {
    if (parsed.origin === BUNNY) throw new TypeError("Failed to fetch")
    return parsed.pathname === "/api/public/v1/stable-genes/TP53.json"
      ? new Response(JSON.stringify(stableGeneFixture()), { status: 200 })
      : new Response(null, { status: 404 })
  })
  const gene = await reader.gene("TP53")
  assert.equal(gene.stable_object_version, 3)
  assert.deepEqual(requests, [
    `${BUNNY}/genes/v3/TP53.json`,
    `${CANONICAL}/api/public/v1/stable-genes/TP53.json`,
  ])
  // After one network failure the rest of the page skips Bunny.
  await reader.gene("RB1")
  assert.equal(requests.at(-1), `${CANONICAL}/api/public/v1/stable-genes/RB1.json`)
})

test("a reader that reaches neither source gets an error, never a fabricated gene (B-898)", async () => {
  const { reader } = recordingReader(() => {
    throw new TypeError("Failed to fetch")
  })
  await assert.rejects(reader.gene("TP53"), /published gene object is unavailable/)
})

test("home, gallery and search read the one stable catalog object (B-898)", async () => {
  const { reader, requests } = recordingReader((parsed) =>
    parsed.pathname === "/catalog/v3/index.json"
      ? new Response(stableCatalogFixture(), { status: 200 })
      : new Response(null, { status: 404 }),
  )
  const gallery = await reader.gallery({ order: "votes", offset: 0, limit: 24 })
  assert.deepEqual(
    gallery.items.map((item) => item.symbol),
    ["TP53", "A1BG", "ZZZ3"],
  )
  assert.equal(gallery.total, 3)
  assert.equal(gallery.published_total, 2)
  assert.equal(gallery.items[0].full_name, "tumor protein p53")
  assert.equal(gallery.items[0].image_score, 9)
  assert.equal(gallery.items[0].color, "#223344")
  assert.equal(
    gallery.items[0].portrait.medium_url,
    `${BUNNY}/portraits/v1/aa/${"a".repeat(64)}/medium.webp`,
  )
  assert.equal(gallery.items[0].portrait.status, "published")
  assert.equal(gallery.items[2].portrait, null)
  assert.equal(gallery.snapshot_version, "catalog-v3:320152")
  const heaviest = await reader.gallery({ order: "heaviest", offset: 0, limit: 2 })
  assert.deepEqual(
    heaviest.items.map((item) => item.symbol),
    ["A1BG", "TP53"],
  )
  assert.equal(heaviest.has_more, true)
  const search = await reader.search("tumor", { limit: 12 })
  assert.deepEqual(
    search.genes.map((gene) => gene.symbol),
    ["TP53"],
  )
  const metrics = await reader.geneMetrics()
  assert.equal(metrics.get("A1BG").weight_kg, 54.3)
  assert.equal(metrics.get("A1BG").image_score, 1)
  assert.equal((await reader.metadata()).card_snapshot_version, "catalog-v3:320152")
  assert.deepEqual(requests, [`${BUNNY}/catalog/v3/index.json`])
})

test("a missing or malformed stable catalog is a reader error and the next call retries (B-898)", async () => {
  let status = 404
  let body = null
  const { reader, requests } = recordingReader((parsed) =>
    parsed.pathname === "/catalog/v3/index.json"
      ? new Response(body, { status })
      : new Response(null, { status: 404 }),
  )
  await assert.rejects(reader.gallery({ order: "votes" }), /No published Iconoplasm catalog/)
  assert.deepEqual(requests, [`${BUNNY}/catalog/v3/index.json`], "a 404 never hits the origin")
  status = 200
  body = JSON.stringify({ schema: 2 })
  await assert.rejects(reader.search("tumor"), /Invalid published Iconoplasm catalog/)
  body = stableCatalogFixture()
  assert.equal((await reader.search("tumor")).genes[0].symbol, "TP53")
  assert.equal(requests.length, 3, "a failed read is not remembered; the next call retries")
})

test("a brick batch is answered from the stable catalog rows (B-898)", async () => {
  const { reader, requests } = recordingReader((parsed) =>
    parsed.pathname === "/catalog/v3/index.json"
      ? new Response(stableCatalogFixture(), { status: 200 })
      : new Response(null, { status: 404 }),
  )
  const records = await reader.genes(["tp53", "A1BG", "NOPE", "TP53"])
  assert.deepEqual(
    records.map((r) => r.symbol),
    ["TP53", "A1BG"],
  )
  assert.equal(records[0].full_name, "tumor protein p53")
  assert.equal(
    records[0].portrait.medium_url,
    `${BUNNY}/portraits/v1/aa/${"a".repeat(64)}/medium.webp`,
  )
  assert.deepEqual(requests, [`${BUNNY}/catalog/v3/index.json`])
})
