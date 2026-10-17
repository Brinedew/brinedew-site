// THE ONLY PUBLISHER OF THE DISCORD INVITE OBJECT: DO NOT DUPLICATE.
//
// The gene page's invite card (Discord's own embed shape: server icon, Online and Members counts,
// Join) used to ask Discord for the counts and the icon from the reader's browser, so every gene
// view, signed in or not, sent the reader's address to discord.com and cdn.discordapp.com. The
// privacy page (content/apps/iconoplasm/privacy.md) says only the signed-in site contacts Discord,
// and the comment pictures and GeneGuessr's board were already moved onto the CDN for that promise
// (B-1101, B-965). B-1102, 2026-10-17: the counts and the icon now ride in `community/v1/discord.json`
// on the CDN, built here by a cron step and written only when its bytes change.
//
// Cost per run: two Discord fetches (the invite with counts, then the icon, which the edge caches
// for a day), one storage read and, when the counts moved, a write with its read-back. No D1, and
// readers cost nothing: the object is a CDN file. Counts lag by the cron interval plus the pull
// zone's 60 s edge cache, which an invite card never needs fresher. When Discord does not answer,
// the previous object stays.
import {
  DISCORD_INVITE_OBJECT_KEY,
  PUBLISHED_OBJECT_STORAGE_UNAVAILABLE,
  canonicalPublishedJson,
  createPublishedCardObjectStore,
} from "./iconoplasm-published-card-objects.js"
import { discordAvatarDataUri } from "./avatar-proxy.js"

export const DISCORD_INVITE_CODE = "kx8FVzUrpf"
const encoder = new TextEncoder()

function sameBytes(left, right) {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

export async function publishDiscordInviteObject(
  env,
  { fetchImpl = (...args) => fetch(...args) } = {},
) {
  let invite
  try {
    const response = await fetchImpl(
      `https://discord.com/api/v10/invites/${DISCORD_INVITE_CODE}?with_counts=true`,
      { signal: AbortSignal.timeout(5000) },
    )
    if (!response.ok) {
      await response.body?.cancel().catch(() => {})
      return { ok: false, reason: `discord_${response.status}` }
    }
    invite = await response.json()
  } catch (error) {
    return { ok: false, reason: "discord_unreachable", error: String(error?.message || error) }
  }
  const guild = invite?.guild || {}
  const shaped = (value, pattern) => (typeof value === "string" && pattern.test(value) ? value : "")
  const iconHash = shaped(guild.icon, /^(a_)?[a-f0-9]{32}$/)
  const guildId = shaped(guild.id, /^[0-9]{1,24}$/)
  const icon =
    iconHash && guildId
      ? await discordAvatarDataUri(
          `https://cdn.discordapp.com/icons/${guildId}/${iconHash}.png`,
          fetchImpl,
        )
      : null
  const object = {
    online: Math.max(0, Number(invite?.approximate_presence_count) || 0),
    members: Math.max(0, Number(invite?.approximate_member_count) || 0),
    icon,
  }
  if (!object.members) return { ok: false, reason: "discord_no_counts" }
  const bytes = encoder.encode(canonicalPublishedJson(object))
  const summary = { members: object.members, icon: Boolean(icon), bytes: bytes.byteLength }

  const objects = createPublishedCardObjectStore(env)
  let stored
  try {
    stored = await objects.readStable(DISCORD_INVITE_OBJECT_KEY)
  } catch (error) {
    if (error?.code === PUBLISHED_OBJECT_STORAGE_UNAVAILABLE) {
      return { ok: false, reason: "storage_unconfigured", ...summary }
    }
    throw error
  }
  if (stored && sameBytes(stored.bytes, bytes)) return { ok: true, published: false, ...summary }
  await objects.writeStable(DISCORD_INVITE_OBJECT_KEY, object)
  return { ok: true, published: true, ...summary }
}
