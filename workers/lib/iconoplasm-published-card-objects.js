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
export const PUBLISHED_CARD_OBJECT_LIMITS = Object.freeze({
  cards: 65536,
  genes: 65536,
  portraits: 8192,
  indexes: 65536,
  manifests: 65536,
  shards: 4 * 1024 * 1024,
})
const HASH = /^[a-f0-9]{64}$/
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

export function publishedCardObjectKey(kind, hash) {
  if (!Object.hasOwn(PUBLISHED_CARD_OBJECT_LIMITS, kind) || !HASH.test(hash)) {
    throw new Error("Invalid published card object identity")
  }
  return `${PUBLISHED_CARD_OBJECT_PREFIX}/${kind}/${hash}.json`
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
      fetchPortraitStorage(env, url, init, { operation: init.method, key, maxAttempts: 1 }))

  async function read(key, { verifyStorageOnly = false } = {}) {
    const identity = objectIdentity(key)
    let candidates = externalPortraitReadCandidates(env, key, { accept: "application/json" })
    if (verifyStorageOnly)
      candidates = candidates.filter((c) => c.source === "authenticated_storage")
    if (!candidates.length) throw new Error("Bunny published-object storage is not configured")
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

  return {
    read,
    async write(kind, value) {
      if (!Object.hasOwn(PUBLISHED_CARD_OBJECT_LIMITS, kind))
        throw new Error("Unknown published object kind")
      const bytes = encoder.encode(canonicalPublishedJson(value))
      if (bytes.byteLength > PUBLISHED_CARD_OBJECT_LIMITS[kind])
        throw new Error("Published object exceeds its byte limit")
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
