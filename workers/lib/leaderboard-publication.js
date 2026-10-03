// THE ONLY PUBLISHER OF THE "TOP STREAKS" OBJECT: DO NOT DUPLICATE.
//
// GeneGuessr's "Top Streaks" box reads `leaderboard/v1/top.json` from the CDN instead of asking the
// Worker (B-965). The box is on the first screen of every desktop, so reading it from the Worker
// cost a request on each of those visits, and each avatar in it a request more: the pictures came
// through `/api/avatar`, another Worker route, 2 Workers units apiece on a first visit. A full board
// of five was 6 requests on top of the 5 the game itself makes. The free plan counts every one, so
// that was the largest part of a desktop visit once nothing else was left to cut.
//
// The object is exactly the answer `GET /api/stats/leaderboard` gives (workers/stats.js), built from
// the same `leaderboard_streaks` read model, so it holds only the opted-in names the board may show
// and the rank, picture and streak the page draws; nothing else about an account leaves D1. The
// avatars are embedded as `data:` URIs the Worker fetches from Discord's CDN itself, so a visitor
// never contacts Discord (content/apps/geneguessr/privacy.md says so), nothing piles up in storage
// when an avatar changes, and an account that switches itself private is gone from the next object.
//
// A cron job on the Iconoplasm clock (workers/iconoplasm-background-schedule.js, `geneguessrBoard`)
// rebuilds it every ten minutes or so and writes it only when its bytes changed. Freshness is that
// interval plus Bunny's replica lag plus the pull zone's 60 s edge cache time
// (bunny/the-only-iconoplasm-pull-zone-policy.json): a finished game shows on the board within
// minutes, not at once. The page falls back to the Worker route when the CDN cannot be reached.
// The free plan allows 5 cron triggers an account and this Worker already lists 5, which is why the
// job rides on an existing expression.
import {
  LEADERBOARD_OBJECT_KEY,
  PUBLISHED_OBJECT_STORAGE_UNAVAILABLE,
  canonicalPublishedJson,
  createPublishedCardObjectStore,
} from "./iconoplasm-published-card-objects.js"
import { sanitizeDiscordAvatarUrl } from "./avatar-proxy.js"
import { boardEntry, readLeaderboard, retireLeaderboardOptInIndex } from "./leaderboard-streaks.js"

// What the page shows: five rows.
export const LEADERBOARD_OBJECT_ENTRIES = 5
// A 24 px circle at twice the pixel density, in Discord's own sizes (a power of two from 16).
const AVATAR_SIZE = 64
// A 64 px avatar is 3 to 8 KB as a PNG; five of them in base64 stay under the object's 128 KiB.
export const AVATAR_BYTE_LIMIT = 8 * 1024
const AVATAR_TIMEOUT_MS = 3000
const AVATAR_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"])
const encoder = new TextEncoder()

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

// One avatar as a `data:` URI, or null (no picture, not Discord's host, slow, not an image, too big):
// the page draws the initial of the name instead, as it does for an account with no picture.
async function avatarDataUri(rawUrl, fetchImpl) {
  const safe = sanitizeDiscordAvatarUrl(rawUrl)
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

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

// Rebuilds the object from D1 and writes it when it changed. 26 D1 rows read and 0 written, up to
// five Discord fetches (the edge caches them for a day), one storage read, and a write with its
// read-back when the board moved: well inside the 50 subrequests a free-plan invocation may make.
export async function publishLeaderboardObject(
  env,
  { fetchImpl = (...args) => fetch(...args) } = {},
) {
  if (!env?.DB) return { ok: false, reason: "missing_db" }
  await retireLeaderboardOptInIndex(env.DB)
  const rows = await readLeaderboard(env.DB, LEADERBOARD_OBJECT_ENTRIES)
  const avatars = await Promise.all(rows.map((row) => avatarDataUri(row?.avatar_url, fetchImpl)))
  const object = { entries: rows.map((row, index) => boardEntry(row, index, avatars[index])) }
  const bytes = encoder.encode(canonicalPublishedJson(object))
  const summary = {
    entries: object.entries.length,
    avatars: avatars.filter(Boolean).length,
    bytes: bytes.byteLength,
  }

  const objects = createPublishedCardObjectStore(env)
  let stored
  try {
    stored = await objects.readStable(LEADERBOARD_OBJECT_KEY)
  } catch (error) {
    if (error?.code === PUBLISHED_OBJECT_STORAGE_UNAVAILABLE) {
      return { ok: false, reason: "storage_unconfigured", ...summary }
    }
    throw error
  }
  if (stored && sameBytes(stored.bytes, bytes)) return { ok: true, published: false, ...summary }
  // No purge: a purge re-pulls a replica that may not have the new bytes yet and caches it for the
  // zone's 30 days (the 60 s edge cache time is what bounds staleness).
  await objects.writeStable(LEADERBOARD_OBJECT_KEY, object, { purge: false })
  return { ok: true, published: true, ...summary }
}
