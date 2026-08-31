import { sha256Hex } from "./iconoplasm-manifestation-body-crypto.js"
import {
  BUNNY_READ_AFTER_WRITE_DELAYS_MS,
  putBunnyObjectUntilVerified,
} from "./bunny-storage-consistency.js"

const MAX_CIPHERTEXT_BYTES = 64 * 1024
const RETRY_DELAYS_MS = Object.freeze([0, 125, 375, 1000])

function storageSetting(env, authoringName, fallback = "") {
  return String(env?.[authoringName] || fallback).trim()
}

function privateStorageConfig(env) {
  const host = storageSetting(env, "ICONOPLASM_AUTHORING_STORAGE_HOST", "storage.bunnycdn.com")
  const zone = storageSetting(env, "ICONOPLASM_AUTHORING_STORAGE_ZONE")
  const password = storageSetting(env, "ICONOPLASM_AUTHORING_STORAGE_PASSWORD")
  if (!host || !zone || !password) {
    throw new Error("Private manifestation body storage is not configured")
  }
  return { host, zone, password }
}

function normalizeObjectKey(raw) {
  const key = String(raw || "").trim()
  if (!/^private\/manifestations\/v1\/[a-f0-9]{2}\/[A-Za-z0-9_-]{8,128}\.bin$/.test(key)) {
    throw new TypeError("Manifestation body object key is invalid")
  }
  return key
}

export async function createManifestationBodyObjectKey({ locatorId } = {}) {
  // Revision IDs cross the browser and replica boundaries, so deriving an
  // object path from a revision ID would make the encrypted object address
  // public too. The locator is independent random authority-only metadata.
  const generated = `mbody_${crypto.randomUUID().replaceAll("-", "").toLowerCase()}`
  const id = String(locatorId || generated).trim()
  if (!/^mbody_[a-f0-9]{32}$/.test(id)) {
    throw new TypeError("Manifestation body storage locator is invalid")
  }
  const prefix = (await sha256Hex(id)).slice(0, 2)
  return `private/manifestations/v1/${prefix}/${id}.bin`
}

function storageUrl(env, objectKey) {
  const { host, zone } = privateStorageConfig(env)
  return `https://${host.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/${encodeURIComponent(zone)}/${normalizeObjectKey(objectKey)}`
}

function requestTimeoutMs(env) {
  const parsed = Number(env?.ICONOPLASM_AUTHORING_STORAGE_TIMEOUT_MS)
  return Number.isFinite(parsed) ? Math.max(500, Math.min(30_000, parsed)) : 8000
}

function retryable(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500
}

async function storageFetch(env, objectKey, init, { maxAttempts = 4 } = {}) {
  const config = privateStorageConfig(env)
  const url = storageUrl(env, objectKey)
  let lastError = null
  for (let attempt = 0; attempt < Math.max(1, Math.min(4, maxAttempts)); attempt += 1) {
    if (RETRY_DELAYS_MS[attempt] > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs(env))
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...(init?.headers || {}), AccessKey: config.password },
        signal: controller.signal,
      })
      if (response.ok || response.status === 404 || !retryable(response.status)) return response
      await response.body?.cancel().catch(() => null)
      lastError = new Error(`Private manifestation storage request failed (${response.status})`)
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError || new Error("Private manifestation storage request failed")
}

export async function readEncryptedManifestationBody(env, objectKey) {
  const response = await storageFetch(
    env,
    objectKey,
    { method: "GET", headers: { Accept: "application/octet-stream" } },
    { maxAttempts: 4 },
  )
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`Private manifestation storage GET failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength < 17 || bytes.byteLength > MAX_CIPHERTEXT_BYTES) {
    throw new Error("Encrypted manifestation body has an invalid byte length")
  }
  return { bytes, etag: String(response.headers.get("etag") || "").replace(/^W\//, "") }
}

export async function putEncryptedManifestationBody(
  env,
  objectKey,
  ciphertext,
  { expectedSha256, verifyPlaintext } = {},
) {
  const bytes = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext)
  if (bytes.byteLength < 17 || bytes.byteLength > MAX_CIPHERTEXT_BYTES) {
    throw new TypeError("Encrypted manifestation body has an invalid byte length")
  }
  const expectedHash = String(expectedSha256 || (await sha256Hex(bytes))).toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new TypeError("Ciphertext SHA-256 is invalid")

  let lastError = null
  const putOnce = async () => {
    const response = await storageFetch(
      env,
      objectKey,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Cache-Control": "private, no-store",
        },
        body: bytes,
      },
      { maxAttempts: 2 },
    )
    if (!response.ok) {
      lastError = new Error(`Private manifestation storage PUT failed (${response.status})`)
      throw lastError
    }
  }
  const verifyAfterPut = async () => {
    for (const delayMs of BUNNY_READ_AFTER_WRITE_DELAYS_MS) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      try {
        const stored = await readEncryptedManifestationBody(env, objectKey)
        if (!stored || stored.bytes.byteLength !== bytes.byteLength) continue
        if ((await sha256Hex(stored.bytes)) !== expectedHash) continue
        if (verifyPlaintext) await verifyPlaintext(stored.bytes)
        return { ok: true, etag: stored.etag, ciphertext_sha256: expectedHash }
      } catch (error) {
        lastError = error
      }
    }
    return null
  }
  const verified = await putBunnyObjectUntilVerified({ put: putOnce, verify: verifyAfterPut })
  if (verified) return verified
  throw lastError || new Error("Encrypted manifestation body could not be verified after PUT")
}

export async function deleteEncryptedManifestationBody(env, objectKey) {
  let initiallyMissing = false
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const response = await storageFetch(env, objectKey, { method: "DELETE" }, { maxAttempts: 4 })
    if (!response.ok && response.status !== 404) {
      throw new Error(`Private manifestation storage DELETE failed (${response.status})`)
    }
    if (attempt === 0) initiallyMissing = response.status === 404
    for (const delayMs of BUNNY_READ_AFTER_WRITE_DELAYS_MS) {
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      const remaining = await readEncryptedManifestationBody(env, objectKey)
      if (!remaining) return { ok: true, already_missing: initiallyMissing }
    }
  }
  throw new Error("Private manifestation object remained readable after idempotent DELETE retries")
}

// ARCHITECTURE FENCE [IPD-012]
