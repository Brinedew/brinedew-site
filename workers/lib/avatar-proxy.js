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
