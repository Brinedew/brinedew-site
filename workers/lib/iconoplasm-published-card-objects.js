import {
  externalPortraitReadCandidates,
  externalPortraitStoragePassword,
  externalPortraitStorageUrl,
  fetchPortraitStorage,
} from "./iconoplasm-portrait-storage.js"

// ARCHITECTURE FENCE [IPD-011]: this is immutable storage, not canon selection.
// The publisher commits its head only after all referenced bytes are verified.
// Never overwrite a stable URL with different bytes or repair a miss from D1.
// Healthy CDN misses end at paid Bunny Storage, not a per-reader Worker build.
export const PUBLISHED_CARD_OBJECT_PREFIX = "published-cards/v2/immutable"
// A deployment without immutable object storage cannot hold any published
// object. Distinguish that definitive absence from a transient read failure so
// readers can report an unknown identity instead of a retryable outage.
export const PUBLISHED_OBJECT_STORAGE_UNAVAILABLE = "PUBLISHED_OBJECT_STORAGE_UNAVAILABLE"
// Publication objects are content-addressed and immutable, so a transient Bunny
// Storage timeout (the request aborts at portraitStorageRequestTimeout) or a
// retryable 408/425/429/5xx is safe to retry inside the fetch. The card
// publication coordinator's own bounded backoff remains the outer retry bound.
// Linear B-753.
export const PUBLISHED_CARD_STORAGE_MAX_ATTEMPTS = 3
// B-792: cards and genes carry the complete published candidate pool, so
// their bound is sized for the largest supported pool rather than the
// pre-candidate record. 256 KiB is a proposed application setting with
// headroom, not a provider requirement; unrelated kinds keep their bound.
export const PUBLISHED_CARD_OBJECT_LIMITS = Object.freeze({
  cards: 256 * 1024,
  genes: 256 * 1024,
  // B-793: immutable candidate gallery pages. A page is capped at 128
  // candidates or this bound, whichever is reached first; a single candidate
  // that cannot fit a page is a permanent validation error, never a truncation.
  galleries: 256 * 1024,
  portraits: 8192,
  indexes: 65536,
  catalogindexes: 128 * 1024,
  catalogs: 512 * 1024,
  manifests: 65536,
  shards: 4 * 1024 * 1024,
})
const HASH = /^[a-f0-9]{64}$/
const SYMBOL = /^[A-Z0-9][A-Z0-9._-]{0,31}$/
const BLOT_FINGERPRINT = /^[a-f0-9]{32,64}$/
const encoder = new TextEncoder()
const BLOT_PLACEHOLDER_BYTES = encoder.encode(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 3 4"><rect width="3" height="4" fill="#171714"/><path d="M.5 2h2" stroke="#d8d0bd" stroke-width=".08" opacity=".55"/></svg>',
)
const BLOT_BYTE_LIMIT = 5 * 1024 * 1024

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

export function publishedCardObjectKey(kind, hash) {
  if (!Object.hasOwn(PUBLISHED_CARD_OBJECT_LIMITS, kind) || !HASH.test(hash)) {
    throw new Error("Invalid published card object identity")
  }
  return `${PUBLISHED_CARD_OBJECT_PREFIX}/${kind}/${hash}.json`
}

export function publishedGeneBlotAliasKey(symbol) {
  const normalized = String(symbol || "")
    .trim()
    .toUpperCase()
  if (!SYMBOL.test(normalized)) throw new Error("Invalid published blot alias symbol")
  return `blot/${normalized}.webp`
}

function immutableBlotIdentity(symbol, blot) {
  if (!blot || blot.status !== "ready") return null
  const fingerprint = String(blot.blot_fingerprint || "").toLowerCase()
  const hash = String(blot.asset_sha256 || blot.blot_asset_sha256 || "").toLowerCase()
  if (!BLOT_FINGERPRINT.test(fingerprint) || !HASH.test(hash)) {
    throw new Error("Invalid published blot identity")
  }
  const key = `blots/v1/${symbol.slice(0, 1)}/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`
  if (blot.object_key !== key) throw new Error("Invalid published blot object key")
  return { key, hash }
}

function objectIdentity(key) {
  const prefix = `${PUBLISHED_CARD_OBJECT_PREFIX}/`
  if (typeof key !== "string" || !key.startsWith(prefix))
    throw new Error("Invalid published object namespace")
  const match = key.slice(prefix.length).match(/^([a-z]+)\/([a-f0-9]{64})\.json$/)
  if (!match || !Object.hasOwn(PUBLISHED_CARD_OBJECT_LIMITS, match[1])) {
    throw new Error("Invalid published object key")
  }
  return { kind: match[1], hash: match[2], limit: PUBLISHED_CARD_OBJECT_LIMITS[match[1]] }
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

  async function read(key, { verifyStorageOnly = false } = {}) {
    const identity = objectIdentity(key)
    let candidates = externalPortraitReadCandidates(env, key, { accept: "application/json" })
    if (verifyStorageOnly)
      candidates = candidates.filter((c) => c.source === "authenticated_storage")
    if (!candidates.length) {
      const error = new Error("Bunny published-object storage is not configured")
      error.code = PUBLISHED_OBJECT_STORAGE_UNAVAILABLE
      throw error
    }
    let failure
    let allMissing = true
    for (const candidate of candidates) {
      try {
        const response = await send(
          candidate.url,
          { method: "GET", headers: candidate.headers },
          key,
        )
        if (!response.ok) {
          await response.body?.cancel().catch(() => {})
          if (response.status === 404) continue
          throw new Error(`Published object GET failed (${response.status})`)
        }
        allMissing = false
        const bytes = await boundedBytes(response, identity.limit, bodyTimeoutMs)
        if ((await publishedObjectHash(bytes)) !== identity.hash)
          throw new Error("Published object hash mismatch")
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
        return { key, hash: identity.hash, value, bytes, source: candidate.source }
      } catch (error) {
        allMissing = false
        failure = error
      }
    }
    if (allMissing) return null
    throw failure || new Error("Published object unavailable")
  }

  /**
   * B-762 reader-readiness probe: an object is only reader-resolvable when
   * every configured read source (authenticated Storage and the public CDN)
   * returns bytes matching the exact content hash. A single authenticated
   * Storage success is not sufficient evidence for advertising a view.
   */
  async function verifyReaderResolvable(key) {
    const identity = objectIdentity(key)
    const candidates = externalPortraitReadCandidates(env, key, { accept: "application/json" })
    const sources = {}
    for (const candidate of candidates) {
      if (Object.hasOwn(sources, candidate.source)) continue
      let ok = false
      try {
        const response = await send(
          candidate.url,
          { method: "GET", headers: candidate.headers },
          key,
        )
        if (response.ok) {
          const bytes = await boundedBytes(response, identity.limit, bodyTimeoutMs)
          ok = (await publishedObjectHash(bytes)) === identity.hash
        } else {
          await response.body?.cancel().catch(() => {})
        }
      } catch {
        ok = false
      }
      sources[candidate.source] = ok
    }
    return {
      ready: Object.keys(sources).length > 0 && Object.values(sources).every(Boolean),
      sources,
    }
  }

  async function readImageBytes(
    key,
    expectedHash,
    { storageOnly = false, repairStorageFromCdn = false } = {},
  ) {
    let candidates = externalPortraitReadCandidates(env, key, { accept: "image/*" })
    if (storageOnly)
      candidates = candidates.filter((candidate) => candidate.source === "authenticated_storage")
    if (!candidates.length) throw new Error("Bunny blot storage is not configured")
    const verifiedSources = {}
    let bytes = null
    let storageFailure = null
    for (const candidate of candidates) {
      try {
        const response = await send(
          candidate.url,
          { method: "GET", headers: candidate.headers },
          key,
        )
        if (!response.ok) {
          await response.body?.cancel().catch(() => {})
          const error = new Error(`Published blot GET failed (${response.status}) for ${key}`)
          error.code =
            response.status === 404 ? "PUBLISHED_BLOT_NOT_FOUND" : "PUBLISHED_BLOT_READ_FAILED"
          error.status = response.status
          throw error
        }
        const candidateBytes = await boundedBytes(response, BLOT_BYTE_LIMIT, bodyTimeoutMs)
        if ((await publishedObjectHash(candidateBytes)) !== expectedHash) {
          throw new Error(`Published blot hash mismatch for ${key} from ${candidate.source}`)
        }
        if (repairStorageFromCdn && storageFailure && candidate.source === "public_cdn") {
          const storageUrl = externalPortraitStorageUrl(env, key)
          const password = externalPortraitStoragePassword(env)
          if (!storageUrl || !password) throw storageFailure
          const repaired = await send(
            storageUrl,
            {
              method: "PUT",
              headers: { AccessKey: password, "Content-Type": "image/webp" },
              body: candidateBytes,
            },
            key,
          )
          if (!repaired.ok) {
            await repaired.body?.cancel().catch(() => {})
            throw new Error(`Published blot origin repair failed (${repaired.status}) for ${key}`)
          }
          await repaired.body?.cancel().catch(() => {})
          const verified = await send(
            storageUrl,
            { method: "GET", headers: { AccessKey: password, Accept: "image/*" } },
            key,
          )
          if (!verified.ok) {
            await verified.body?.cancel().catch(() => {})
            throw new Error(
              `Published blot origin repair verification failed (${verified.status}) for ${key}`,
            )
          }
          const verifiedBytes = await boundedBytes(verified, BLOT_BYTE_LIMIT, bodyTimeoutMs)
          if ((await publishedObjectHash(verifiedBytes)) !== expectedHash) {
            throw new Error(`Published blot origin repair hash mismatch for ${key}`)
          }
          verifiedSources.authenticated_storage = true
        }
        bytes ||= candidateBytes
        verifiedSources[candidate.source] = true
        if (repairStorageFromCdn && candidate.source === "authenticated_storage") {
          return { bytes, verifiedSources }
        }
      } catch (error) {
        if (repairStorageFromCdn && candidate.source === "authenticated_storage") {
          storageFailure = error
          continue
        }
        throw error
      }
    }
    if (!bytes && storageFailure) throw storageFailure
    return { bytes, verifiedSources }
  }

  /**
   * The exact bytes are verified through any configured read source. Bunny
   * Storage reads and the public pull zone can each lag the other after a
   * write (both directions observed live), so requiring one named source
   * couples a catalog-wide pass to whichever cache happens to be behind.
   */
  async function firstMatchingCandidate(key, expectedHash) {
    const candidates = externalPortraitReadCandidates(env, key, { accept: "image/*" })
    for (const candidate of candidates) {
      try {
        const response = await send(
          candidate.url,
          { method: "GET", headers: candidate.headers },
          key,
        )
        if (!response.ok) {
          await response.body?.cancel().catch(() => {})
          continue
        }
        const bytes = await boundedBytes(response, BLOT_BYTE_LIMIT, bodyTimeoutMs)
        if ((await publishedObjectHash(bytes)) === expectedHash) {
          return { bytes, source: candidate.source }
        }
      } catch {
        // Try the next configured source.
      }
    }
    return null
  }

  async function publishBlotAlias(symbol, blot, { allowMissingImmutablePlaceholder = false } = {}) {
    const normalized = String(symbol || "")
      .trim()
      .toUpperCase()
    const key = publishedGeneBlotAliasKey(normalized)
    const immutable = immutableBlotIdentity(normalized, blot)
    let bytes = BLOT_PLACEHOLDER_BYTES
    let contentType = "image/svg+xml"
    if (immutable) {
      // A catalog-wide rematerialization republishes the alias for every
      // published card. When any configured source already serves the exact
      // immutable bytes under the alias key, that read IS the verification;
      // skipping the idempotent PUT cuts a full pass from three round trips
      // per card to one. Missing, mismatched or unreadable bytes fall through
      // to the authoritative publish path below.
      const existing = await firstMatchingCandidate(key, immutable.hash)
      if (existing?.bytes) {
        return {
          key,
          hash: immutable.hash,
          size: existing.bytes.byteLength,
          contentType: "image/webp",
          sources: { [existing.source]: true },
          skipped: true,
        }
      }
      try {
        bytes = (
          await readImageBytes(immutable.key, immutable.hash, { repairStorageFromCdn: true })
        ).bytes
        contentType = "image/webp"
      } catch (error) {
        if (!(allowMissingImmutablePlaceholder && error?.code === "PUBLISHED_BLOT_NOT_FOUND"))
          throw error
      }
    }
    const hash = await publishedObjectHash(bytes)
    const url = externalPortraitStorageUrl(env, key)
    const password = externalPortraitStoragePassword(env)
    if (!url || !password) throw new Error("Bunny published blot writes are not configured")
    // The stable /blot/{symbol}.webp object is a compatibility projection, not
    // publication authority, and each read source can lag a write
    // independently: requiring one named source once stalled a catalog-wide
    // pass for tens of minutes on a key whose public bytes were already
    // correct (CLNK, 2026-09-21). Repeat the identical PUT a bounded number of
    // times and accept the first source that serves the exact expected bytes;
    // an unverifiable alias still fails closed.
    let verified = null
    for (let attempt = 1; attempt <= 3 && !verified; attempt += 1) {
      const response = await send(
        url,
        {
          method: "PUT",
          headers: {
            AccessKey: password,
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=30, must-revalidate",
          },
          body: bytes,
        },
        key,
      )
      await response.body?.cancel().catch(() => {})
      if (!response.ok) throw new Error(`Published blot alias PUT failed (${response.status})`)
      verified = await firstMatchingCandidate(key, hash)
      if (!verified && attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }
    if (!verified)
      throw new Error(`Published blot alias PUT is not readable as ${hash.slice(0, 12)}`)
    return { key, hash, size: bytes.byteLength, contentType, sources: { [verified.source]: true } }
  }

  return {
    read,
    verifyReaderResolvable,
    publishBlotAlias,
    async write(kind, value) {
      if (!Object.hasOwn(PUBLISHED_CARD_OBJECT_LIMITS, kind))
        throw new Error("Unknown published object kind")
      const bytes = encoder.encode(canonicalPublishedJson(value))
      if (bytes.byteLength > PUBLISHED_CARD_OBJECT_LIMITS[kind]) {
        // B-792: an oversized serialized document is not a transient failure.
        // The exact input cannot succeed on a later attempt, so the coordinator
        // records it durably as permanent instead of re-uploading and retrying
        // the same bytes. The caller attaches the gene and run identity.
        const error = new Error(
          `Published object exceeds its byte limit: kind=${kind}, bytes=${bytes.byteLength}, limit=${PUBLISHED_CARD_OBJECT_LIMITS[kind]}`,
        )
        error.code = "PUBLISHED_OBJECT_OVERSIZED"
        error.permanent = true
        error.details = {
          object_kind: kind,
          bytes: bytes.byteLength,
          limit: PUBLISHED_CARD_OBJECT_LIMITS[kind],
        }
        throw error
      }
      const hash = await publishedObjectHash(bytes)
      const key = publishedCardObjectKey(kind, hash)
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
            "Cache-Control": "public, max-age=31536000, immutable",
          },
          body: bytes,
        },
        key,
      )
      await response.body?.cancel().catch(() => {})
      if (!response.ok) throw new Error(`Published object PUT failed (${response.status})`)
      // A successful PUT or HEAD is insufficient: Bunny has acknowledged bytes
      // before they were readable. Verify the hash through authenticated Storage.
      // Failure leaves durable publisher work pending; it never advances canon.
      const verified = await read(key, { verifyStorageOnly: true })
      if (!verified) throw new Error("Published object PUT is not yet readable")
      return { key, hash, size: bytes.byteLength }
    },
  }
}
