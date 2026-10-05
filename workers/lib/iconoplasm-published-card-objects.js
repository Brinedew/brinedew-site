import {
  externalPortraitStoragePassword,
  externalPortraitStorageUrl,
  fetchPortraitStorage,
} from "./iconoplasm-portrait-storage.js"

// THE ONLY writer and first-party reader of the published objects on Bunny
// Storage: one stable object per gene (genes/v3/<SYMBOL>.json), the catalog
// object (catalog/v3/index.json), GeneGuessr's "Top Streaks" board
// (leaderboard/v1/top.json, B-965), and the style picker's first page
// (picker/v1/styles.json, B-896). Readers outside the Worker fetch them from
// the CDN. ARCHITECTURE FENCE [IPD-011].
// A deployment without object storage cannot hold any published object.
// Distinguish that definitive absence from a transient read failure so
// readers can report an unknown identity instead of a retryable outage.
export const PUBLISHED_OBJECT_STORAGE_UNAVAILABLE = "PUBLISHED_OBJECT_STORAGE_UNAVAILABLE"
// A stable-object PUT always carries the complete object and is verified by
// read-back, so a transient Bunny Storage timeout (the request aborts at
// portraitStorageRequestTimeout) or a retryable 408/425/429/5xx is safe to
// retry inside the fetch. Linear B-753.
export const PUBLISHED_CARD_STORAGE_MAX_ATTEMPTS = 3
// B-898 (Stage 1): ONE stable, mutable object per gene. Readers fetch this
// single URL instead of walking head -> manifest -> indexes -> gene -> delta.
// It is rewritten in place whenever the gene changes and carries the complete
// candidate pool inline, so there is nothing else to resolve.
export const STABLE_GENE_OBJECT_PREFIX = "genes/v3"
export const STABLE_GENE_OBJECT_LIMIT = 1024 * 1024
export const STABLE_GENE_OBJECT_CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400"
// The pull zone ignores this header and applies its own expiration. What bounds
// staleness after a rewrite is the zone's edge rule for genes/v3, catalog/v3,
// leaderboard/v1 and picker/v1 (bunny/the-only-iconoplasm-pull-zone-policy.json): a 60 s edge
// and browser cache time, so a rewrite shows within replication lag plus 60 s.
// No rewrite purges: a purge re-pulls a replica that may not have the new bytes
// yet, and Bunny's API answers 429 once a bulk republish sends a purge per gene
// (2026-10-03, 19 of the first 80 genes).
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/

export function stableGeneObjectKey(symbol) {
  const clean = String(symbol || "")
    .trim()
    .toUpperCase()
  if (!SYMBOL.test(clean)) throw new Error("Invalid stable gene object symbol")
  return `${STABLE_GENE_OBJECT_PREFIX}/${clean}.json`
}

// B-898: the one stable catalog object (home, gallery, search). Built by
// scripts/publish-iconoplasm-catalog.mjs in GitHub Actions and uploaded
// through the Worker's admin route; readers fetch it from the CDN.
export const STABLE_CATALOG_OBJECT_KEY = "catalog/v3/index.json"
export const STABLE_CATALOG_OBJECT_LIMIT = 16 * 1024 * 1024

// B-965: the GeneGuessr leaderboard, five entries with their avatars embedded as data: URIs
// (workers/lib/leaderboard-publication.js builds it; 5 x 8 KiB of avatar at most).
export const LEADERBOARD_OBJECT_KEY = "leaderboard/v1/top.json"
export const LEADERBOARD_OBJECT_LIMIT = 128 * 1024

// B-896: the Free queue picker's first page, the 120 strongest styles with five
// previews each (about 90 KB). The same for every player, so it is read from the
// CDN instead of 120 D1 rows per open; a background job rebuilds it.
export const REQUEST_PICKER_OBJECT_KEY = "picker/v1/styles.json"
export const REQUEST_PICKER_OBJECT_LIMIT = 512 * 1024

function stableGeneObjectIdentity(key) {
  if (key === STABLE_CATALOG_OBJECT_KEY) return { symbol: "", limit: STABLE_CATALOG_OBJECT_LIMIT }
  if (key === REQUEST_PICKER_OBJECT_KEY) return { symbol: "", limit: REQUEST_PICKER_OBJECT_LIMIT }
  if (key === LEADERBOARD_OBJECT_KEY) return { symbol: "", limit: LEADERBOARD_OBJECT_LIMIT }
  const prefix = `${STABLE_GENE_OBJECT_PREFIX}/`
  if (typeof key !== "string" || !key.startsWith(prefix) || !key.endsWith(".json"))
    throw new Error("Invalid stable gene object key")
  const symbol = key.slice(prefix.length, -".json".length)
  if (!SYMBOL.test(symbol)) throw new Error("Invalid stable gene object key")
  return { symbol, limit: STABLE_GENE_OBJECT_LIMIT }
}
const encoder = new TextEncoder()

export function canonicalPublishedJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalPublishedJson).join(",")}]`
  if (!value || typeof value !== "object") return JSON.stringify(value === undefined ? null : value)
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalPublishedJson(value[key])}`)
    .join(",")}}`
}

export async function publishedObjectHash(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")
}

async function boundedBytes(response, limit, timeoutMs) {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel()
    throw new Error("Published object exceeds its byte limit")
  }
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Published object has no response body")
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    void reader.cancel().catch(() => {})
  }, timeoutMs)
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (timedOut) throw new Error("Published object body timed out")
      if (done) break
      length += value.byteLength
      if (length > limit) throw new Error("Published object exceeds its byte limit")
      chunks.push(value)
    }
  } finally {
    clearTimeout(timer)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export function createPublishedCardObjectStore(env, { request, bodyTimeoutMs = 8000 } = {}) {
  const send =
    request ||
    ((url, init, key) =>
      fetchPortraitStorage(env, url, init, {
        operation: init.method,
        key,
        maxAttempts: PUBLISHED_CARD_STORAGE_MAX_ATTEMPTS,
      }))

  // Stable (mutable, fixed-URL) gene object. PUT, then verify: the bytes are
  // read back through authenticated Storage and hash-compared before this
  // returns, so a caller that sees success knows the exact bytes are on the
  // origin.
  async function writeStable(key, value) {
    const identity = stableGeneObjectIdentity(key)
    const bytes = encoder.encode(canonicalPublishedJson(value))
    if (bytes.byteLength > identity.limit) {
      const error = new Error(
        `Stable gene object exceeds its byte limit: key=${key}, bytes=${bytes.byteLength}, limit=${identity.limit}`,
      )
      error.code = "PUBLISHED_OBJECT_OVERSIZED"
      error.permanent = true
      error.details = { object_kind: "stable_gene", bytes: bytes.byteLength, limit: identity.limit }
      throw error
    }
    const hash = await publishedObjectHash(bytes)
    const url = externalPortraitStorageUrl(env, key)
    const password = externalPortraitStoragePassword(env)
    if (!url || !password) throw new Error("Bunny published-object writes are not configured")
    const response = await send(
      url,
      {
        method: "PUT",
        headers: {
          AccessKey: password,
          "Content-Type": "application/json",
          "Cache-Control": STABLE_GENE_OBJECT_CACHE_CONTROL,
        },
        body: bytes,
      },
      key,
    )
    await response.body?.cancel().catch(() => {})
    if (!response.ok) throw new Error(`Stable gene object PUT failed (${response.status})`)
    const check = await send(
      url,
      { method: "GET", headers: { AccessKey: password, Accept: "application/json" } },
      key,
    )
    if (!check.ok) {
      await check.body?.cancel().catch(() => {})
      throw new Error("Stable gene object PUT is not yet readable")
    }
    const readBack = await boundedBytes(check, identity.limit, bodyTimeoutMs)
    if ((await publishedObjectHash(readBack)) !== hash)
      throw new Error("Stable gene object read-back hash mismatch")
    return { key, hash, size: bytes.byteLength, symbol: identity.symbol }
  }

  // First-party read of a stable gene object for the canonical-origin fallback
  // route. Authenticated Storage only: the CDN is what the reader tried first.
  async function readStable(key) {
    const identity = stableGeneObjectIdentity(key)
    const url = externalPortraitStorageUrl(env, key)
    const password = externalPortraitStoragePassword(env)
    if (!url || !password) {
      const error = new Error("Bunny published-object storage is not configured")
      error.code = PUBLISHED_OBJECT_STORAGE_UNAVAILABLE
      throw error
    }
    const response = await send(
      url,
      { method: "GET", headers: { AccessKey: password, Accept: "application/json" } },
      key,
    )
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      if (response.status === 404) return null
      throw new Error(`Stable gene object GET failed (${response.status})`)
    }
    const bytes = await boundedBytes(response, identity.limit, bodyTimeoutMs)
    return { key, bytes, symbol: identity.symbol }
  }

  return { writeStable, readStable }
}
