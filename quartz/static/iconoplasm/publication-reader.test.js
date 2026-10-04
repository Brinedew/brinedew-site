import assert from "node:assert/strict"

import test from "node:test"

import { createIconoplasmPublicationReader } from "./publication-reader.js"

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
  assert.equal(gene.portrait_candidates.length, 2)
  assert.equal(gene.portrait_candidates[0].is_current, true)
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

// Real catalog rows (2026-10-04): "insulin" is INS's exact full name, and twelve other genes'
// names start with it. Ranked as a mere prefix, INS sorted after IDE and every IGF gene and fell
// off the 12-row dropdown, so a search for "insulin" did not show insulin.
test("an exact full name ranks first, like an exact symbol", async () => {
  const row = (symbol, name) => [symbol, name, "", "#888888", 0, null, 10, 1, 1990, ""]
  const { reader } = recordingReader((parsed) =>
    parsed.pathname === "/catalog/v3/index.json"
      ? new Response(
          JSON.stringify({
            schema: 3,
            generated_at: "2026-10-04T00:00:00.000Z",
            watermark_event_id: 1,
            genes: [
              row("IDE", "insulin degrading enzyme"),
              row("IGF1", "insulin like growth factor 1"),
              row("IGF1R", "insulin like growth factor 1 receptor"),
              row("INS", "insulin"),
              row("INSR", "insulin receptor"),
            ],
          }),
          { status: 200 },
        )
      : new Response(null, { status: 404 }),
  )
  const found = await reader.search("insulin", { limit: 12 })
  assert.equal(found.genes[0].symbol, "INS")
  assert.equal((await reader.search("INS", { limit: 12 })).genes[0].symbol, "INS")
})
