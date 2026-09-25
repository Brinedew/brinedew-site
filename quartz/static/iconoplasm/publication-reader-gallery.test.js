import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { createIconoplasmPublicationReader } from "./publication-reader.js"
import { writeCandidateGallery } from "../../../workers/lib/iconoplasm-candidate-gallery.js"

const SYMBOL = "TP53"

function sha256(text) {
  return createHash("sha256").update(text).digest("hex")
}

function candidate(id, filler = "") {
  return {
    candidate_image_id: id,
    asset_sha256: String(id).padStart(64, "0"),
    image_upvotes: id % 5,
    is_current: id === 1,
    ...(filler ? { filler } : {}),
  }
}

function fixture({
  candidates = [],
  embedded = false,
  staleOverlay = false,
  overlayCandidates = null,
} = {}) {
  const objects = new Map()
  const requests = []
  const store = (kind, value) => {
    const text = JSON.stringify(value)
    const hash = sha256(text)
    const key = `published-cards/v2/immutable/${kind}/${hash}.json`
    objects.set(key, text)
    return { key, hash }
  }

  const manifestRef = store("manifests", {
    storage: "bunny_card_catalog_v2",
    card_count: 1,
    shards: [],
  })
  // Written below with the real page chain, then referenced by the index.
  const writePage = async (kind, body) => store(kind, body)

  return (async () => {
    const gallery = await writeCandidateGallery(SYMBOL, candidates, writePage)
    const geneBody = {
      symbol: SYMBOL,
      full_name: "tumor protein p53",
      candidate_count: gallery.candidate_count,
      candidate_gallery: gallery.candidate_gallery,
      ...(embedded ? { portrait_candidates: candidates } : {}),
    }
    if (embedded) delete geneBody.candidate_gallery
    const geneRef = store("genes", geneBody)
    const indexRef = store("indexes", {
      schema_version: 2,
      entries: [[SYMBOL, sha256("cards"), geneRef.hash, sha256("portraits")]],
    })
    const manifest = store("manifests", {
      storage: "bunny_card_catalog_v2",
      card_count: 1,
      shards: [
        {
          first_symbol: SYMBOL,
          last_symbol: SYMBOL,
          card_count: 1,
          delivery_indexes: [
            {
              first_symbol: SYMBOL,
              last_symbol: SYMBOL,
              key: indexRef.key,
            },
          ],
        },
      ],
    })
    const head = { schema_version: 2, current: `ccv2-${manifest.hash}` }
    if (staleOverlay || overlayCandidates) {
      const overlayPool = overlayCandidates || candidates.slice(0, -1)
      const overlayGallery = await writeCandidateGallery(SYMBOL, overlayPool, writePage)
      const overlayGene = store("genes", {
        symbol: SYMBOL,
        full_name: "tumor protein p53",
        portrait: { status: "published", asset_sha256: overlayPool[0].asset_sha256 },
        candidate_count: overlayGallery.candidate_count,
        candidate_gallery: overlayGallery.candidate_gallery,
      })
      const segment = store("indexes", {
        schema_version: 1,
        seq: 1,
        entries: {
          [SYMBOL]: {
            symbol: SYMBOL,
            version: 3,
            selection_key: "a".repeat(64),
            seq: 1,
            status: "committed",
            gene: overlayGene,
          },
        },
      })
      const chain = store("indexes", {
        schema_version: 1,
        kind: "gene_delta_chain",
        base: head.current,
        segments: [{ seq: 1, ...segment, count: 1 }],
      })
      head.reader_view = `${head.current}.c${chain.hash}`
    }

    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname
      requests.push(pathname)
      if (pathname === "/api/public/v1/card-current") {
        return new Response(JSON.stringify(head), { status: 200 })
      }
      const key = pathname.replace(/^\//, "")
      const text = objects.get(key)
      return text ? new Response(text, { status: 200 }) : new Response(null, { status: 404 })
    }
    const reader = createIconoplasmPublicationReader({ fetchImpl })
    return { reader, requests, objects, manifestRef }
  })()
}

test("a core gene render fetches no gallery page; the gallery resolves on demand", async () => {
  const pool = Array.from({ length: 200 }, (_, index) => candidate(index + 1))
  const { reader, requests } = await fixture({ candidates: pool })
  const record = await reader.gene(SYMBOL)
  assert.equal(record.candidate_count, 200)
  assert.equal(record.portrait_candidates, undefined)
  assert.equal(
    requests.filter((path) => path.includes("/galleries/")).length,
    0,
    "a core gene render must not fetch candidate pages",
  )

  const gallery = await reader.candidateGallery(record)
  assert.equal(gallery.count, 200)
  assert.deepEqual(
    gallery.candidates.map((item) => item.candidate_image_id),
    pool.map((item) => item.candidate_image_id),
  )
  assert.ok(requests.some((path) => path.includes("/galleries/")))
})

test("a missing gallery page fails loudly instead of reporting an empty pool", async () => {
  const pool = Array.from({ length: 200 }, (_, index) => candidate(index + 1))
  const { reader, objects } = await fixture({ candidates: pool })
  const record = await reader.gene(SYMBOL)
  const pageKey = record.candidate_gallery.key
  objects.delete(pageKey)
  await assert.rejects(reader.candidateGallery(record), /Publication HTTP 404/)
})

test("a count mismatch or wrong symbol in the chain is rejected", async () => {
  const pool = Array.from({ length: 3 }, (_, index) => candidate(index + 1))
  const { reader } = await fixture({ candidates: pool })
  const record = await reader.gene(SYMBOL)

  const short = { ...record, candidate_count: 99 }
  await assert.rejects(reader.candidateGallery(short), /count mismatch/)

  const other = { ...record, symbol: "BRCA1" }
  await assert.rejects(reader.candidateGallery(other), /Invalid candidate gallery page/)
})

test("a record with no gallery and no pool is a legitimate empty pool", async () => {
  const { reader } = await fixture({ candidates: [] })
  const record = await reader.gene(SYMBOL)
  assert.equal(record.candidate_count, 0)
  assert.equal(record.candidate_gallery, null)
  const gallery = await reader.candidateGallery(record)
  assert.deepEqual(gallery, { candidates: [], count: 0 })
})

test("records published before the split still resolve their embedded pool", async () => {
  const pool = Array.from({ length: 5 }, (_, index) => candidate(index + 1))
  const { reader, requests } = await fixture({ candidates: pool, embedded: true })
  const record = await reader.gene(SYMBOL)
  assert.equal(record.portrait_candidates.length, 5)
  const gallery = await reader.candidateGallery(record)
  assert.equal(gallery.count, 5)
  assert.equal(
    requests.filter((path) => path.includes("/galleries/")).length,
    0,
    "the embedded pool never touches gallery objects",
  )
})

test("a newer base gallery supplies newly generated candidates while the vote overlay keeps its canonical portrait", async () => {
  const pool = [candidate(1), candidate(2), candidate(3)]
  const { reader } = await fixture({ candidates: pool, staleOverlay: true })
  const record = await reader.gene(SYMBOL)
  assert.equal(record.portrait.asset_sha256, pool[0].asset_sha256)
  assert.equal(record.candidate_count, 3)
  const gallery = await reader.candidateGallery(record)
  assert.deepEqual(
    gallery.candidates.map((item) => item.candidate_image_id),
    [1, 2, 3],
  )
  assert.deepEqual(
    gallery.candidates.map((item) => item.is_current),
    [true, false, false],
  )
})

// B-865: delta segments are carried across catalog rebuilds, so a delta can be
// older than the catalog (the case above, #257) or newer (ARCN1, 2026-09-25:
// six uploads sat in the delta's gallery for over an hour while the page showed
// the catalog's older pool). Ways the reader can get this wrong:
// 1. a newer delta pool is hidden behind the catalog's older one;
// 2. same, when the catalog record is pre-split and embeds its pool inline
//    (ARCN1's exact shape), so no gallery reference exists on the merged record;
// 3. an older delta pool hides the catalog's newer generation (#257);
// 4. equal newest candidates pick the delta (a tie is no evidence it is newer);
// 5. the shown count disagrees with the pool actually shown;
// 6. the delta's selected portrait stops being marked current.
test("a delta holding the newest upload shows its pool over an older catalog gallery", async () => {
  const pool = [candidate(1), candidate(2)]
  const newer = [candidate(1), candidate(2), candidate(63140), candidate(63145)]
  const { reader } = await fixture({ candidates: pool, overlayCandidates: newer })
  const record = await reader.gene(SYMBOL)
  const gallery = await reader.candidateGallery(record)
  assert.deepEqual(
    gallery.candidates.map((item) => item.candidate_image_id),
    [1, 2, 63140, 63145],
  )
  assert.equal(gallery.count, 4)
  assert.deepEqual(
    gallery.candidates.map((item) => item.is_current),
    [true, false, false, false],
  )
})

test("a delta holding the newest upload wins over a pre-split catalog that embeds its pool", async () => {
  const pool = [candidate(8185), candidate(35127)]
  const newer = [candidate(8185), candidate(35127), candidate(63140), candidate(63145)]
  const { reader } = await fixture({ candidates: pool, embedded: true, overlayCandidates: newer })
  const record = await reader.gene(SYMBOL)
  const gallery = await reader.candidateGallery(record)
  assert.equal(gallery.count, 4)
  assert.deepEqual(
    gallery.candidates.map((item) => item.candidate_image_id),
    [8185, 35127, 63140, 63145],
  )
})

test("an equally new delta pool leaves the catalog pool in charge", async () => {
  const pool = [candidate(1), candidate(2), candidate(3)]
  const same = [candidate(1), candidate(3)]
  const { reader } = await fixture({ candidates: pool, overlayCandidates: same })
  const record = await reader.gene(SYMBOL)
  const gallery = await reader.candidateGallery(record)
  assert.deepEqual(
    gallery.candidates.map((item) => item.candidate_image_id),
    [1, 2, 3],
  )
})
