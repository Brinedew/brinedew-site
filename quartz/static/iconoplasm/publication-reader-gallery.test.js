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

function fixture({ candidates = [], embedded = false, staleOverlay = false } = {}) {
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
    if (staleOverlay) {
      const olderCandidates = candidates.slice(0, -1)
      const olderGallery = await writeCandidateGallery(SYMBOL, olderCandidates, writePage)
      const overlayGene = store("genes", {
        symbol: SYMBOL,
        full_name: "tumor protein p53",
        portrait: { status: "published", asset_sha256: olderCandidates[0].asset_sha256 },
        candidate_count: olderGallery.candidate_count,
        candidate_gallery: olderGallery.candidate_gallery,
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
