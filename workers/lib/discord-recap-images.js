import {
  BUNNY_READ_AFTER_WRITE_DELAYS_MS,
  putBunnyObjectUntilVerified,
} from "./bunny-storage-consistency.js"

const DISCORD_RECAP_IMAGE_PREFIX = "discord-recap-images/v2/"

// ARCHITECTURE FENCE [GG-002]: storage acknowledgement is not delivery proof.
// Keep the immutable identity, documented 201 status, and exact-byte read-back
// together so a rewritten 404 or delayed/misdirected write cannot become a
// false "uploaded" state in the admin UI.

// This is part of the stored-object identity. Bump it whenever the renderer,
// camera, colouring, or pixel-readiness contract changes. A bump deliberately
// makes every older image a cache miss instead of silently reusing stale ink.
export const DISCORD_RECAP_RENDER_CONTRACT = "molstar-recap-v2"

const BUNNY_UPLOAD_SUCCESS_STATUS = 201

export function isValidIsoDay(value) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

function normalizeUniprotId(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
  return /^[A-Z0-9]+(?:-[0-9]+)?$/.test(normalized) ? normalized : null
}

function normalizeImageIdentity(identity) {
  const day = String(identity?.day || "").trim()
  const uniprotId = normalizeUniprotId(identity?.uniprotId)
  if (!isValidIsoDay(day)) {
    throw new Error("Invalid recap image day")
  }
  if (!uniprotId) {
    throw new Error("Invalid recap image UniProt id")
  }
  return { day, uniprotId }
}

export function buildDiscordRecapImageKey(identity) {
  const { day, uniprotId } = normalizeImageIdentity(identity)
  return `${DISCORD_RECAP_IMAGE_PREFIX}${day}/${uniprotId}/${DISCORD_RECAP_RENDER_CONTRACT}.png`
}

// ---------------------------------------------------------------------------
// Storage backend resolution.
//
// The recap PNG used to live only in the R2 bucket `STRUCTURES_BUCKET`. R2 is
// currently disabled on the account (see wrangler config), so that path is
// dead. We reuse the already-live Bunny CDN object storage that the Iconoplasm
// portrait pipeline depends on. The same env vars drive both:
//
//   ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL   - credential-less fallback read base
//   ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST   - storage API host (write/head)
//   ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE   - storage zone name
//   ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD - storage AccessKey (secret)
//
// If R2 is ever rebound (STRUCTURES_BUCKET present), we prefer it automatically
// so this code keeps working without edits after an R2 restore.
// ---------------------------------------------------------------------------

function bunnyCdnBase(env) {
  const raw = String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL || "").trim()
  return raw ? raw.replace(/\/+$/, "") : ""
}

function bunnyStorageHost(env) {
  const raw = String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_HOST || "").trim()
  return raw || "storage.bunnycdn.com"
}

function bunnyStorageZone(env) {
  return String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE || "").trim()
}

function bunnyStoragePassword(env) {
  return String(env?.ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD || "").trim()
}

function bunnyReadUrl(env, key) {
  const base = bunnyCdnBase(env)
  return base ? `${base}/${key}` : null
}

function bunnyWriteUrl(env, key) {
  const host = bunnyStorageHost(env)
  const zone = bunnyStorageZone(env)
  if (!host || !zone) return null
  return `https://${host}/${zone}/${key}`
}

function asUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }
  throw new Error("Recap image bytes must be binary data")
}

function equalBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

async function boundedResponseText(response, maxLength = 400) {
  const body = await response.text().catch(() => "")
  return body.length > maxLength ? `${body.slice(0, maxLength)}...` : body
}

export function canWriteDiscordRecapImage(env) {
  if (env?.STRUCTURES_BUCKET) return true
  return Boolean(bunnyStorageZone(env) && bunnyStoragePassword(env))
}

export function canReadDiscordRecapImage(env) {
  if (env?.STRUCTURES_BUCKET) return true
  return Boolean((bunnyStorageZone(env) && bunnyStoragePassword(env)) || bunnyCdnBase(env))
}

/**
 * Store the recap PNG for a day. Returns { key }.
 */
export async function putDiscordRecapImage(
  env,
  identity,
  bytes,
  { contentType = "image/png" } = {},
) {
  const normalizedIdentity = normalizeImageIdentity(identity)
  const key = buildDiscordRecapImageKey(normalizedIdentity)
  const expectedBytes = asUint8Array(bytes)

  if (env?.STRUCTURES_BUCKET) {
    await env.STRUCTURES_BUCKET.put(key, expectedBytes, {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        day: normalizedIdentity.day,
        uniprotId: normalizedIdentity.uniprotId,
        renderContract: DISCORD_RECAP_RENDER_CONTRACT,
        uploadedBy: "admin",
        uploadedAt: new Date().toISOString(),
      },
    })
    const stored = await loadDiscordRecapImageBytes(env, normalizedIdentity)
    if (!stored || !equalBytes(stored, expectedBytes)) {
      throw new Error(`Recap image R2 read-back verification failed for ${key}`)
    }
    return { key, verifiedBytes: stored.byteLength }
  }

  const writeUrl = bunnyWriteUrl(env, key)
  const password = bunnyStoragePassword(env)
  if (!writeUrl || !password) {
    throw new Error(
      "Recap image storage is not configured for writes (Bunny zone/password missing)",
    )
  }
  const stored = await putBunnyObjectUntilVerified({
    put: async () => {
      const response = await fetch(writeUrl, {
        method: "PUT",
        headers: {
          AccessKey: password,
          "Content-Type": contentType,
        },
        body: expectedBytes,
      })
      if (response.status !== BUNNY_UPLOAD_SUCCESS_STATUS) {
        const responseText = await boundedResponseText(response)
        throw new Error(
          `Recap image PUT returned ${response.status}, expected ${BUNNY_UPLOAD_SUCCESS_STATUS}, for ${key}: ${responseText || "no body"}`,
        )
      }
      await response.body?.cancel().catch(() => null)
    },
    verify: async () => {
      for (const delayMs of BUNNY_READ_AFTER_WRITE_DELAYS_MS) {
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
        const readBack = await loadDiscordRecapImageBytes(env, normalizedIdentity)
        if (readBack && equalBytes(readBack, expectedBytes)) return readBack
      }
      return null
    },
  })
  if (stored) return { key, verifiedBytes: stored.byteLength }

  throw new Error(`Recap image PUT was acknowledged but exact-byte read-back failed for ${key}`)
}

/**
 * Return existence/metadata for a day's recap PNG, or null if missing.
 */
export async function headDiscordRecapImage(env, identity) {
  const key = buildDiscordRecapImageKey(identity)

  if (env?.STRUCTURES_BUCKET) {
    const head = await env.STRUCTURES_BUCKET.head(key)
    if (!head) return null
    return {
      key,
      size: head.size || null,
      uploadedAt: head.uploaded ? head.uploaded.toISOString() : null,
      metadata: head.customMetadata || {},
    }
  }

  // Prefer the authenticated storage HEAD; fall back to a public CDN HEAD.
  const writeUrl = bunnyWriteUrl(env, key)
  const password = bunnyStoragePassword(env)
  if (writeUrl && password) {
    const response = await fetch(writeUrl, { method: "HEAD", headers: { AccessKey: password } })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Recap image HEAD failed (${response.status}) for ${key}`)
    }
    const len = response.headers.get("content-length")
    return {
      key,
      size: len ? Number(len) : null,
      uploadedAt: response.headers.get("last-modified") || null,
      metadata: {},
    }
  }

  const readUrl = bunnyReadUrl(env, key)
  if (!readUrl) return null
  const response = await fetch(readUrl, { method: "HEAD" })
  if (response.status === 404 || !response.ok) return null
  const len = response.headers.get("content-length")
  return {
    key,
    size: len ? Number(len) : null,
    uploadedAt: response.headers.get("last-modified") || null,
    metadata: {},
  }
}

/**
 * Load a day's recap PNG bytes, or null if missing.
 */
export async function loadDiscordRecapImageBytes(env, identity) {
  const key = buildDiscordRecapImageKey(identity)

  if (env?.STRUCTURES_BUCKET) {
    const object = await env.STRUCTURES_BUCKET.get(key)
    if (!object) return null
    const imageData = await object.arrayBuffer()
    if (!imageData || imageData.byteLength <= 0) return null
    return new Uint8Array(imageData)
  }

  const storageUrl = bunnyWriteUrl(env, key)
  const password = bunnyStoragePassword(env)
  if (storageUrl && password) {
    const response = await fetch(storageUrl, { headers: { AccessKey: password } })
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Recap image fetch failed (${response.status}) for ${key}`)
    }
    const imageData = await response.arrayBuffer()
    if (!imageData || imageData.byteLength <= 0) return null
    return new Uint8Array(imageData)
  }

  const readUrl = bunnyReadUrl(env, key)
  if (!readUrl) return null
  const response = await fetch(readUrl)
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Recap image fetch failed (${response.status}) for ${key}`)
  }
  const imageData = await response.arrayBuffer()
  if (!imageData || imageData.byteLength <= 0) return null
  return new Uint8Array(imageData)
}

/**
 * Delete a day's recap PNG. Best-effort; returns true if it acted.
 */
export async function deleteDiscordRecapImage(env, identity) {
  const key = buildDiscordRecapImageKey(identity)

  if (env?.STRUCTURES_BUCKET) {
    await env.STRUCTURES_BUCKET.delete(key)
    return true
  }

  const writeUrl = bunnyWriteUrl(env, key)
  const password = bunnyStoragePassword(env)
  if (!writeUrl || !password) return false
  const response = await fetch(writeUrl, { method: "DELETE", headers: { AccessKey: password } })
  if (response.status === 404) return false
  if (!response.ok) {
    throw new Error(`Recap image DELETE failed (${response.status}) for ${key}`)
  }
  return true
}
