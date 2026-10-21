// The admin panel's Discord tab: one on/off switch per thing the bot posts.
// This module owns the setting: one KV key holding every switch, edited at
// /admin#discord on Iconoplasm, read fresh by each poster just before it posts.
// A switch nobody has touched is on, because each of these posted before the
// switches existed. A KV read that fails counts as off: the owner's "off" must
// hold, and a missed post costs less than one the owner had stopped.

export const DISCORD_SWITCHES_KV_KEY = "discord:integration-switches:v1"

export const DISCORD_SWITCHES = Object.freeze([
  Object.freeze({
    id: "iconoplasm_digest",
    label: "Iconoplasm daily digest",
    where: "#iconoplasm, once a day",
  }),
  Object.freeze({
    id: "iconoplasm_comments",
    label: "Gene comments",
    where: "#iconoplasm, as they are written",
  }),
  Object.freeze({
    id: "caretaker_dms",
    label: "Caretaker messages",
    where: "Direct messages: comments, supervotes and requests on their gene",
  }),
  Object.freeze({
    id: "geneguessr_recap",
    label: "GeneGuessr daily recap",
    where: "#geneguessr, once a day",
  }),
  Object.freeze({
    id: "blog_feed",
    label: "Blog feed",
    where: "#feed, new posts from followed blogs",
  }),
])

const IDS = new Set(DISCORD_SWITCHES.map((item) => item.id))

function storedSwitches(stored) {
  const on = {}
  for (const { id } of DISCORD_SWITCHES) on[id] = stored?.switches?.[id] !== false
  return on
}

export async function readDiscordSwitches(env) {
  // No KV binding means nothing was ever switched off.
  const stored = env?.KV ? await env.KV.get(DISCORD_SWITCHES_KV_KEY, { type: "json" }) : null
  return {
    switches: storedSwitches(stored),
    updated_at: stored?.updated_at || null,
    updated_by: stored?.updated_by || null,
  }
}

export async function discordSwitchIsOn(env, id) {
  if (!IDS.has(id)) throw new TypeError(`Unknown Discord switch: ${id}`)
  try {
    return (await readDiscordSwitches(env)).switches[id]
  } catch (error) {
    console.warn(`[discord-switches] could not read the switches, treating ${id} as off:`, error)
    return false
  }
}

// Sets the switches named in `changes` and keeps the rest as they are.
export async function writeDiscordSwitches(env, { changes, updatedBy, now = new Date() }) {
  const entries = Object.entries(changes && typeof changes === "object" ? changes : {})
  if (!entries.length) return { ok: false, error: "switches must name at least one switch" }
  for (const [id, value] of entries) {
    if (!IDS.has(id)) return { ok: false, error: `unknown switch: ${id}` }
    if (typeof value !== "boolean") return { ok: false, error: `${id} must be true or false` }
  }
  if (!env?.KV) return { ok: false, error: "KV binding missing" }
  const current = await readDiscordSwitches(env)
  const record = {
    switches: { ...current.switches, ...Object.fromEntries(entries) },
    updated_at: now.toISOString(),
    updated_by: String(updatedBy || "admin"),
  }
  await env.KV.put(DISCORD_SWITCHES_KV_KEY, JSON.stringify(record))
  return { ok: true, ...record }
}
