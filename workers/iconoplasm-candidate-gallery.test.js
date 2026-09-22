import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import {
  CANDIDATE_GALLERY_PAGE_BYTE_LIMIT,
  CANDIDATE_GALLERY_PAGE_CANDIDATE_LIMIT,
  planCandidateGalleryPages,
  writeCandidateGallery,
} from "./lib/iconoplasm-candidate-gallery.js"
import { canonicalPublishedJson } from "./lib/iconoplasm-published-card-objects.js"

const UTF8 = new TextEncoder()

function candidate(id, filler = "") {
  return {
    candidate_image_id: id,
    asset_sha256: String(id).padStart(64, "0"),
    image_upvotes: id % 7,
    is_current: id === 1,
    ...(filler ? { filler } : {}),
  }
}

function fixture() {
  const bodies = new Map()
  const writes = []
  const write = async (kind, body) => {
    const text = canonicalPublishedJson(body)
    const hash = createHash("sha256").update(text).digest("hex")
    const key = `published-cards/v2/immutable/${kind}/${hash}.json`
    bodies.set(key, body)
    writes.push({ kind, key, hash, body })
    return { key, hash, size: UTF8.encode(text).byteLength }
  }
  return { write, writes, bodies }
}

function walkChain(start, bodies) {
  const chain = []
  let reference = start
  while (reference) {
    const body = bodies.get(reference.key)
    assert.ok(body, `page ${reference.key} must exist`)
    chain.push(body)
    reference = body.next
  }
  return chain
}

test("an empty pool plans zero pages and a null reference", async () => {
  assert.deepEqual(planCandidateGalleryPages("TP53", []), [])
  const { write, writes } = fixture()
  const gallery = await writeCandidateGallery("TP53", [], write)
  assert.equal(gallery.candidate_count, 0)
  assert.equal(gallery.candidate_gallery, null)
  assert.equal(writes.length, 0)
})

test("128 candidates fit one page; 129 split into two chained pages", async () => {
  const pool = Array.from({ length: 128 }, (_, index) => candidate(index + 1))
  assert.equal(planCandidateGalleryPages("TP53", pool).length, 1)
  assert.equal(planCandidateGalleryPages("TP53", [...pool, candidate(129)]).length, 2)

  const { write, writes, bodies } = fixture()
  const gallery = await writeCandidateGallery("TP53", [...pool, candidate(129)], write)
  assert.equal(gallery.candidate_count, 129)
  assert.equal(gallery.candidate_gallery.page_count, 2)
  // Pages are written from the last page backwards so every page can name its
  // exact immutable successor.
  assert.equal(writes.length, 2)
  assert.equal(writes[0].body.page, 1)
  assert.equal(writes[0].body.next, null)
  assert.equal(writes[1].body.page, 0)
  assert.deepEqual(writes[1].body.next, {
    key: writes[0].key,
    hash: writes[0].hash,
  })
  assert.equal(writes[0].body.count, 1)
  assert.equal(writes[1].body.count, CANDIDATE_GALLERY_PAGE_CANDIDATE_LIMIT)

  const chain = walkChain(gallery.candidate_gallery, bodies)
  assert.deepEqual(
    chain.flatMap((page) => page.candidates.map((item) => item.candidate_image_id)),
    pool.concat([candidate(129)]).map((item) => item.candidate_image_id),
  )
})

test("a large synthetic pool is fully reachable exactly once, in order", async () => {
  const pool = Array.from({ length: 1000 }, (_, index) =>
    candidate(index + 1, `filler-${index % 13}`),
  )
  const { write, bodies } = fixture()
  const gallery = await writeCandidateGallery("TP53", pool, write)
  const chain = walkChain(gallery.candidate_gallery, bodies)
  assert.ok(chain.length > 1, "a 1000-candidate pool spans multiple pages")
  const reached = chain.flatMap((page) => page.candidates.map((item) => item.candidate_image_id))
  assert.equal(reached.length, pool.length)
  assert.deepEqual(
    reached,
    pool.map((item) => item.candidate_image_id),
  )
  assert.equal(new Set(reached).size, pool.length)
  assert.equal(chain.at(-1).next, null)
  for (const page of chain) {
    assert.ok(page.candidates.length <= CANDIDATE_GALLERY_PAGE_CANDIDATE_LIMIT)
    assert.ok(
      UTF8.encode(canonicalPublishedJson(page)).byteLength <= CANDIDATE_GALLERY_PAGE_BYTE_LIMIT,
    )
  }
})

test("page boundaries use actual serialized bytes, including multibyte text", async () => {
  // Each candidate carries a long multibyte string, so byte size rather than
  // the 128-candidate count must drive the split.
  const filler = "遺伝子候補".repeat(4000)
  const pool = Array.from({ length: 9 }, (_, index) => candidate(index + 1, filler))
  const { write, bodies } = fixture()
  const gallery = await writeCandidateGallery("TP53", pool, write)
  const chain = walkChain(gallery.candidate_gallery, bodies)
  assert.ok(chain.length >= 2)
  assert.equal(
    chain.flatMap((page) => page.candidates).length,
    pool.length,
    "nothing is silently truncated",
  )
  for (const page of chain) {
    assert.ok(page.candidates.length < CANDIDATE_GALLERY_PAGE_CANDIDATE_LIMIT)
    const bytes = UTF8.encode(canonicalPublishedJson(page)).byteLength
    assert.ok(bytes <= CANDIDATE_GALLERY_PAGE_BYTE_LIMIT, `${bytes} must fit the page bound`)
  }
})

test("an individually oversized candidate is a permanent validation error", async () => {
  const pool = [candidate(1), candidate(2, "x".repeat(CANDIDATE_GALLERY_PAGE_BYTE_LIMIT))]
  const { write, writes } = fixture()
  await assert.rejects(writeCandidateGallery("TP53", pool, write), (error) => {
    assert.equal(error.code, "CANDIDATE_GALLERY_CANDIDATE_OVERSIZED")
    assert.equal(error.permanent, true)
    assert.equal(error.gene, "TP53")
    assert.equal(error.details.object_kind, "galleries")
    assert.equal(error.details.index, 1)
    assert.ok(error.details.bytes > error.details.limit)
    return true
  })
  assert.equal(writes.length, 0, "no page is written for an unsupported record")
})
