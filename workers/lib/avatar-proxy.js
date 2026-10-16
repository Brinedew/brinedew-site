const DISCORD_AVATAR_HOST = "cdn.discordapp.com"

export function sanitizeDiscordAvatarUrl(raw) {
  const value = String(raw || "").trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:") return null
    if (parsed.hostname !== DISCORD_AVATAR_HOST) return null
    return parsed.toString()
  } catch {
    return null
  }
}

export function buildAvatarProxyPath(raw) {
  const safe = sanitizeDiscordAvatarUrl(raw)
  if (!safe) return null
  const encoded = encodeURIComponent(safe)
  return `/api/avatar?src=${encoded}`
}

export function extractAvatarUpstreamFromRequest(url) {
  const raw = String(url?.searchParams?.get("src") || "")
  if (!raw) return null
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    decoded = raw
  }
  return sanitizeDiscordAvatarUrl(decoded)
}

// Discord pictures embedded in published objects (the GeneGuessr board, a gene's public comments),
// so a reader who is not signed in never contacts Discord and makes no `/api/avatar` request.
// A 24 px circle at twice the pixel density, in Discord's own sizes (a power of two from 16).
const AVATAR_SIZE = 64
// A 64 px avatar is 3 to 8 KB as a PNG, about 11 KB once in base64.
export const AVATAR_BYTE_LIMIT = 8 * 1024
const AVATAR_TIMEOUT_MS = 3000
const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])

async function boundedBytes(response, limit) {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel().catch(() => {})
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks = []
  let length = 0
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > limit) return null
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

// The Discord address behind a picture, given either that address or the `/api/avatar?src=` path
// the comment rows store.
export function discordAvatarSource(raw) {
  const value = String(raw || "").trim()
  if (value.startsWith("/api/avatar")) {
    try {
      return extractAvatarUpstreamFromRequest(new URL(value, "https://iconoplasm.invalid"))
    } catch {
      return null
    }
  }
  return sanitizeDiscordAvatarUrl(value)
}

// One avatar as a `data:` URI, or null (no picture, not Discord's host, slow, not an image, too big):
// the page draws the initial of the name instead, as it does for an account with no picture.
export async function discordAvatarDataUri(raw, fetchImpl = (...args) => fetch(...args)) {
  const safe = discordAvatarSource(raw)
  if (!safe) return null
  try {
    const url = new URL(safe)
    url.searchParams.set("size", String(AVATAR_SIZE))
    const response = await fetchImpl(url.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
      cf: { cacheEverything: true, cacheTtl: 86400 },
    })
    const type = String(response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase()
    if (!response.ok || !AVATAR_TYPES.has(type)) {
      await response.body?.cancel().catch(() => {})
      return null
    }
    const bytes = await boundedBytes(response, AVATAR_BYTE_LIMIT)
    if (!bytes?.byteLength) return null
    let binary = ""
    for (const byte of bytes) binary += String.fromCharCode(byte)
    return `data:${type};base64,${btoa(binary)}`
  } catch {
    return null
  }
}
