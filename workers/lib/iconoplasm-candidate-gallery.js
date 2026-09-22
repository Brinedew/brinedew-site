import {
  canonicalPublishedJson,
  PUBLISHED_CARD_OBJECT_LIMITS,
} from "./iconoplasm-published-card-objects.js"

// B-793: the published gene record stays small. Its complete candidate pool
// moves into immutable gallery pages, one consistent paginated format from the
// start: at most 128 candidates and at most one object bound of serialized
// UTF-8 JSON per page, whichever is reached first. Every page names its
// immutable next page, or ends the chain explicitly. The split is computed from
// actual serialized bytes, so nothing is silently truncated: an individually
// oversized candidate is a permanent validation error, not an empty page.
export const CANDIDATE_GALLERY_SCHEMA_VERSION = 1
export const CANDIDATE_GALLERY_PAGE_CANDIDATE_LIMIT = 128
export const CANDIDATE_GALLERY_PAGE_BYTE_LIMIT = PUBLISHED_CARD_OBJECT_LIMITS.galleries
// Headroom reserved inside each page for the immutable reference to its next
// page (a 64-hex object key plus its small wrapper). The reference is only
// known after the next page is written, so the split reserves its bound.
export const CANDIDATE_GALLERY_NEXT_REFERENCE_RESERVE = 256

const UTF8 = new TextEncoder()

function utf8Bytes(value) {
  return UTF8.encode(value).byteLength
}

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
}

function emptyPageBytes(symbol, page) {
  return utf8Bytes(
    canonicalPublishedJson({
      schema_version: CANDIDATE_GALLERY_SCHEMA_VERSION,
      symbol,
      page,
      count: 0,
      candidates: [],
      next: null,
    }),
  )
}

function oversizedCandidateError(symbol, index, bytes, limit) {
  const error = new Error(
    `Candidate gallery candidate exceeds its page byte limit: symbol=${symbol}, index=${index}, bytes=${bytes}, limit=${limit}`,
  )
  error.code = "CANDIDATE_GALLERY_CANDIDATE_OVERSIZED"
  error.permanent = true
  error.gene = symbol
  error.details = { object_kind: "galleries", index, bytes, limit }
  return error
}

/**
 * Byte-accurate page plan. Preserves the given candidate order exactly (the
 * source's ordering, including its stable tie-breaker) and never truncates.
 * An empty pool plans zero pages; the gene record then carries a count of zero
 * and a null reference instead of an empty page object.
 */
export function planCandidateGalleryPages(symbol, candidates) {
  const cleanSymbol = normalizeSymbol(symbol)
  const list = Array.isArray(candidates) ? candidates : []
  const budget = CANDIDATE_GALLERY_PAGE_BYTE_LIMIT - CANDIDATE_GALLERY_NEXT_REFERENCE_RESERVE
  const planned = []
  let current = []
  let currentBytes = 0
  for (let index = 0; index < list.length; index += 1) {
    const candidate = list[index]
    const candidateBytes = utf8Bytes(canonicalPublishedJson(candidate))
    const separator = current.length ? 1 : 0
    if (
      current.length &&
      (current.length >= CANDIDATE_GALLERY_PAGE_CANDIDATE_LIMIT ||
        currentBytes + separator + candidateBytes > budget)
    ) {
      planned.push(current)
      current = []
      currentBytes = 0
    }
    if (!current.length) {
      currentBytes = emptyPageBytes(cleanSymbol, planned.length)
      if (currentBytes + candidateBytes > budget) {
        throw oversizedCandidateError(cleanSymbol, index, candidateBytes, budget)
      }
    }
    current.push(candidate)
    currentBytes += (current.length > 1 ? 1 : 0) + candidateBytes
  }
  if (current.length) planned.push(current)
  return planned
}

/**
 * Builds and writes the immutable page chain from the last page backwards, so
 * every page can name the exact immutable identity of its next page. `write`
 * is the shared published-object writer; it verifies each object's bytes are
 * readable before returning, so a written chain is a validated chain.
 */
export async function writeCandidateGallery(symbol, candidates, write) {
  const cleanSymbol = normalizeSymbol(symbol)
  const planned = planCandidateGalleryPages(cleanSymbol, candidates)
  let next = null
  const pages = []
  for (let page = planned.length - 1; page >= 0; page -= 1) {
    const body = {
      schema_version: CANDIDATE_GALLERY_SCHEMA_VERSION,
      symbol: cleanSymbol,
      page,
      count: planned[page].length,
      candidates: planned[page],
      next,
    }
    const bytes = utf8Bytes(canonicalPublishedJson(body))
    if (bytes > CANDIDATE_GALLERY_PAGE_BYTE_LIMIT) {
      const error = new Error(
        `Candidate gallery page exceeds its byte limit: symbol=${cleanSymbol}, page=${page}, bytes=${bytes}, limit=${CANDIDATE_GALLERY_PAGE_BYTE_LIMIT}`,
      )
      error.code = "PUBLISHED_OBJECT_OVERSIZED"
      error.permanent = true
      error.gene = cleanSymbol
      error.details = {
        object_kind: "galleries",
        page,
        bytes,
        limit: CANDIDATE_GALLERY_PAGE_BYTE_LIMIT,
      }
      throw error
    }
    const written = await write("galleries", body)
    pages.push({ page, key: written.key, hash: written.hash, count: body.count })
    next = { key: written.key, hash: written.hash }
  }
  pages.reverse()
  return {
    candidate_count: Array.isArray(candidates) ? candidates.length : 0,
    candidate_gallery: pages.length
      ? { key: pages[0].key, hash: pages[0].hash, page_count: pages.length }
      : null,
    pages,
  }
}
