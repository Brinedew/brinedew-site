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
import { discordAvatarDataUri } from "./avatar-proxy.js"
import { boardEntry, readLeaderboard } from "./leaderboard-streaks.js"

// What the page shows: five rows.
export const LEADERBOARD_OBJECT_ENTRIES = 5
const encoder = new TextEncoder()

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
  const rows = await readLeaderboard(env.DB, LEADERBOARD_OBJECT_ENTRIES)
  const avatars = await Promise.all(
    rows.map((row) => discordAvatarDataUri(row?.avatar_url, fetchImpl)),
  )
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
  await objects.writeStable(LEADERBOARD_OBJECT_KEY, object)
  return { ok: true, published: true, ...summary }
}
