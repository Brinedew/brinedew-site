const DISCORD_RECAP_IMAGE_PREFIX = "discord-recap-images/"

export function isValidIsoDay(value) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value))
}

export function buildDiscordRecapImageKey(day) {
  return `${DISCORD_RECAP_IMAGE_PREFIX}${day}.png`
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
  const raw = String(
    env?.ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL || env?.ICONOPLASM_PORTRAIT_BASE_URL || "",
  ).trim()
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
export async function putDiscordRecapImage(env, day, bytes, { contentType = "image/png" } = {}) {
  const key = buildDiscordRecapImageKey(day)

  if (env?.STRUCTURES_BUCKET) {
    await env.STRUCTURES_BUCKET.put(key, bytes, {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: {
        day,
        uploadedBy: "admin",
        uploadedAt: new Date().toISOString(),
      },
    })
    return { key }
  }

  const writeUrl = bunnyWriteUrl(env, key)
  const password = bunnyStoragePassword(env)
  if (!writeUrl || !password) {
    throw new Error(
      "Recap image storage is not configured for writes (Bunny zone/password missing)",
    )
  }
  const response = await fetch(writeUrl, {
    method: "PUT",
    headers: {
      AccessKey: password,
      "Content-Type": contentType,
    },
    body: bytes,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => "")
    throw new Error(`Recap image PUT failed (${response.status}) for ${key}: ${text || "no body"}`)
  }
  return { key }
}

/**
 * Return existence/metadata for a day's recap PNG, or null if missing.
 */
export async function headDiscordRecapImage(env, day) {
  const key = buildDiscordRecapImageKey(day)

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
export async function loadDiscordRecapImageBytes(env, day) {
  const key = buildDiscordRecapImageKey(day)

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
export async function deleteDiscordRecapImage(env, day) {
  const key = buildDiscordRecapImageKey(day)

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
