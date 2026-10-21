// B-733: the daily digest in #iconoplasm (docs/ICONOPLASM_DAILY_DIGEST.md).
// The GitHub Actions job (scripts/post-iconoplasm-daily-digest.mjs) reads a
// finished UTC day here, draws the picture, and sends it back to be posted.
// This route is the only poster of the digest: it holds the bot token, and a KV
// marker per day makes a second run of the job (GitHub fires schedules late and
// twice) post nothing. The admin panel's "Iconoplasm daily digest" switch
// (discord-integration-switches.js) decides whether it posts at all.
import { discordSwitchIsOn } from "./discord-integration-switches.js"
import { isDigestDay, readDailyDigest } from "./iconoplasm/daily-digest.js"

const NO_STORE = Object.freeze({ "Cache-Control": "no-store" })
const REQUIRED_SERVICES = Object.freeze(["isAdmin", "json"])
const POSTED_KEY = (day) => `iconoplasm_digest_posted:${day}`
const MAX_CONTENT = 2_000
const MAX_IMAGE_BYTES = 10_000_000
const DISCORD_POST_TIMEOUT_MS = 30_000

export function createIconoplasmDailyDigestHandlers(services) {
  for (const name of REQUIRED_SERVICES) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Iconoplasm daily digest service is missing: ${name}`)
    }
  }
  const { isAdmin, json } = services
  const fetchImpl = typeof services.fetchImpl === "function" ? services.fetchImpl : fetch
  const now = typeof services.now === "function" ? services.now : () => new Date()

  async function postedMarker(env, day) {
    const raw = await env.KV?.get(POSTED_KEY(day))
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch {
      return { message_id: null }
    }
  }

  async function day({ request, env, done }) {
    if (!(await isAdmin(request, env))) {
      return done("admin_daily_digest_day_403", json({ error: "Unauthorized" }, 403, NO_STORE))
    }
    const wanted = new URL(request.url).searchParams.get("day")
    if (!isDigestDay(wanted, now())) {
      return done(
        "admin_daily_digest_day_400",
        json({ error: "day must be a finished UTC day, YYYY-MM-DD" }, 400, NO_STORE),
      )
    }
    const [digest, posted, switchedOn] = await Promise.all([
      readDailyDigest({ iconoplasmDb: env.ICONOPLASM_DB, accountDb: env.DB, day: wanted }),
      postedMarker(env, wanted),
      discordSwitchIsOn(env, "iconoplasm_digest"),
    ])
    return done(
      "admin_daily_digest_day",
      json({ ok: true, posted, switched_on: switchedOn, ...digest }, 200, NO_STORE),
    )
  }

  async function post({ request, env, done }) {
    if (!(await isAdmin(request, env))) {
      return done("admin_daily_digest_post_403", json({ error: "Unauthorized" }, 403, NO_STORE))
    }
    const refuse = (error, status = 400) =>
      done(`admin_daily_digest_post_${status}`, json({ error }, status, NO_STORE))
    let form
    try {
      form = await request.formData()
    } catch {
      return refuse("expected multipart form data: day, content, image")
    }
    const wanted = String(form.get("day") || "")
    const content = String(form.get("content") || "")
    const image = form.get("image")
    if (!isDigestDay(wanted, now())) return refuse("day must be a finished UTC day, YYYY-MM-DD")
    if (!content.trim() || content.length > MAX_CONTENT)
      return refuse("content must be 1-2000 characters")
    if (
      !image ||
      typeof image.arrayBuffer !== "function" ||
      image.size > MAX_IMAGE_BYTES ||
      image.size === 0
    ) {
      return refuse("image must be a WebP of at most 10 MB")
    }
    const bytes = new Uint8Array(await image.arrayBuffer())
    // RIFF....WEBP
    if (
      String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF" ||
      String.fromCharCode(...bytes.slice(8, 12)) !== "WEBP"
    ) {
      return refuse("image must be a WebP of at most 10 MB")
    }
    if (!(await discordSwitchIsOn(env, "iconoplasm_digest"))) {
      return done(
        "admin_daily_digest_post_off",
        json({ ok: true, switched_off: true }, 200, NO_STORE),
      )
    }
    const already = await postedMarker(env, wanted)
    if (already) {
      return done(
        "admin_daily_digest_post_already",
        json({ ok: true, already_posted: true, ...already }, 200, NO_STORE),
      )
    }
    const botToken = env.DISCORD_BOT_TOKEN
    const channelId = env.DISCORD_ICONOPLASM_CHANNEL_ID
    if (!botToken || !channelId) return refuse("Discord bot is not configured", 503)

    const discordForm = new FormData()
    discordForm.append(
      "payload_json",
      JSON.stringify({
        content,
        allowed_mentions: { parse: [] },
        // Discord drops a second message with the same nonce for a few
        // minutes, which covers two runs racing past the KV marker.
        nonce: `digest-${wanted}`,
        enforce_nonce: true,
      }),
    )
    discordForm.append(
      "files[0]",
      new Blob([bytes], { type: "image/webp" }),
      `iconoplasm-${wanted}.webp`,
    )
    const controller = new AbortController()
    const timeout = setTimeout(
      () => controller.abort("discord_post_timeout"),
      DISCORD_POST_TIMEOUT_MS,
    )
    let response
    try {
      response = await fetchImpl(`https://discord.com/api/v10/channels/${channelId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bot ${botToken}` },
        body: discordForm,
        signal: controller.signal,
      })
    } catch (error) {
      return refuse(`Discord post failed: ${String(error?.message || error)}`, 502)
    } finally {
      clearTimeout(timeout)
    }
    const bodyText = await response.text()
    let parsed = null
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null
    } catch {}
    if (!response.ok || !parsed?.id) {
      return refuse(
        `Discord API ${response.status}: ${bodyText.slice(0, 300) || "empty response"}`,
        502,
      )
    }
    const marker = { message_id: String(parsed.id), posted_at: now().toISOString() }
    // Kept a month: long enough that no late rerun can repost the day.
    await env.KV?.put(POSTED_KEY(wanted), JSON.stringify(marker), { expirationTtl: 31 * 86_400 })
    return done("admin_daily_digest_post", json({ ok: true, ...marker }, 200, NO_STORE))
  }

  return Object.freeze({
    "admin_daily_digest.day": day,
    "admin_daily_digest.post": post,
  })
}
