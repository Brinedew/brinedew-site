/**
 * Discord Bot Integration Endpoints
 *
 * Endpoints:
 * - GET  /api/discord/daily-summary  - Returns recap data for a given day
 * - POST /api/discord/interactions   - Discord webhook verification
 * - POST /api/discord/post-recap     - Trigger recap post from cached day image (auth required)
 * - POST /api/discord/mark-posted    - Sets idempotency key after posting
 * - GET  /apps/geneguessr/render     - Minimal structure viewer for screenshots
 */

import { getDailyGuessAggregates, getWinnersCount } from "./lib/guess-aggregates.js"
import { fetchProteinByUniprot } from "./lib/protein-store.js"
import { buildStructureMetaFromStoredSource } from "./lib/structure-utils.js"
import { buildDiscordRecapImageKey, isValidIsoDay } from "./lib/discord-recap-images.js"

const JSON_HEADERS = { "Content-Type": "application/json" }
const DISCORD_SUMMARY_POSTED_PREFIX = "discord_summary_posted:"
const DISCORD_SUMMARY_POST_FAILURE_PREFIX = "discord_summary_post_failure:"
const DISCORD_POST_FAILURE_TTL = 14 * 24 * 60 * 60
const DISCORD_POST_TIMEOUT_MS = 20000
const PLAY_URL = "https://geneguessr.brinedew.bio"
const RENDER_BASE_URL = "https://geneguessr.brinedew.bio/apps/geneguessr/render"

/**
 * Validate Bearer token for bot authentication
 */
function validateBotToken(request, env) {
  const authHeader = request.headers.get("Authorization") || ""
  const expectedToken = env.BOT_CRON_TOKEN

  if (!expectedToken) {
    return { valid: false, error: "BOT_CRON_TOKEN not configured" }
  }

  if (!authHeader.startsWith("Bearer ")) {
    return { valid: false, error: "Missing or invalid Authorization header" }
  }

  const token = authHeader.slice(7)
  if (token !== expectedToken) {
    return { valid: false, error: "Invalid token" }
  }

  return { valid: true }
}

function getYesterdayUtcDay() {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

function isValidDay(day) {
  return isValidIsoDay(day)
}

function getPostedKey(day) {
  return `${DISCORD_SUMMARY_POSTED_PREFIX}${day}`
}

function getPostFailureKey(day) {
  return `${DISCORD_SUMMARY_POST_FAILURE_PREFIX}${day}`
}

async function readPostedMarker(env, day) {
  const raw = await env.KV.get(getPostedKey(day))
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object") return null
    return parsed
  } catch {
    return null
  }
}

async function setPostFailure(env, payload) {
  try {
    const day = payload?.day
    if (!isValidDay(day)) return
    await env.KV.put(getPostFailureKey(day), JSON.stringify(payload), {
      expirationTtl: DISCORD_POST_FAILURE_TTL,
    })
  } catch (err) {
    console.warn("[CRON] Failed to persist recap post failure payload:", err)
  }
}

async function clearPostFailure(env, day) {
  try {
    if (!isValidDay(day)) return
    await env.KV.delete(getPostFailureKey(day))
  } catch (err) {
    console.warn("[CRON] Failed to clear recap post failure payload:", err)
  }
}

async function setPostedMarker(env, day, messageId) {
  const postedData = {
    message_id: String(messageId),
    posted_at: Date.now(),
    channel_id: env.DISCORD_GENEGUESSR_CHANNEL_ID || null,
  }
  await env.KV.put(getPostedKey(day), JSON.stringify(postedData))
  return postedData
}

function formatRecapDate(day) {
  const date = new Date(`${day}T00:00:00Z`)
  const dayNum = date.getUTCDate()
  const suffix =
    dayNum === 1 || dayNum === 21 || dayNum === 31
      ? "st"
      : dayNum === 2 || dayNum === 22
        ? "nd"
        : dayNum === 3 || dayNum === 23
          ? "rd"
          : "th"
  const month = date.toLocaleString("en-US", { month: "long", timeZone: "UTC" })
  const year = date.getUTCFullYear()
  return `${dayNum}${suffix} of ${month}, ${year}`
}

function buildDiscordRecapContent(recap) {
  const { target, winners_count: winnersCount, top_guesses: topGuesses, day } = recap
  const gene = target?.gene || "Unknown"
  const fullName = target?.full_name || ""

  let content = `GeneGuessr for ${formatRecapDate(day)}\n**${gene}**`
  if (fullName) {
    content += `\n${fullName}`
  }
  content += "\n\n"

  if (winnersCount > 0) {
    content += `${winnersCount} player${winnersCount === 1 ? "" : "s"} solved it!\n\n`
  } else {
    content += "No one solved it!\n\n"
  }

  if (Array.isArray(topGuesses) && topGuesses.length > 0) {
    content += "Top guesses:\n"
    for (const guess of topGuesses) {
      content += `${guess.rank}. ${guess.gene}\n`
    }
    content += "\n"
  }

  content += `Play today's puzzle: <${PLAY_URL}>`
  return content
}

async function buildDailySummaryData(env, day) {
  if (!isValidDay(day)) {
    return {
      ok: false,
      status: 400,
      body: { error: "Invalid day format. Use YYYY-MM-DD" },
    }
  }

  const alreadyPosted = await readPostedMarker(env, day)
  if (alreadyPosted) {
    return {
      ok: true,
      status: 200,
      body: {
        already_posted: true,
        message_id: alreadyPosted.message_id || null,
        posted_at: alreadyPosted.posted_at || null,
      },
    }
  }

  const puzzleData = await env.KV.get(`puzzle_actual:${day}`)
  if (!puzzleData) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "No puzzle data for this day",
        day,
        hint: "Either no one played, or the day hasn't happened yet",
      },
    }
  }

  const puzzle = JSON.parse(puzzleData)
  const targetUniprot = puzzle.uniprot_id
  const targetProtein = await fetchProteinByUniprot(env.DB, targetUniprot)
  if (!targetProtein) {
    return {
      ok: false,
      status: 404,
      body: {
        error: "Target protein not found in database",
        uniprot_id: targetUniprot,
      },
    }
  }

  const winnersResult = await getWinnersCount(env.DB, { day })
  const winnersCount = winnersResult.ok ? winnersResult.winnersCount : 0

  const guessResult = await getDailyGuessAggregates(env.DB, { day, limit: 5 })
  const topGuesses = guessResult.ok
    ? guessResult.guesses.map((g, idx) => ({
        rank: idx + 1,
        gene: g.gene || g.uniprot,
      }))
    : []
  const totalGuesses = guessResult.ok ? guessResult.totalGuesses : 0

  return {
    ok: true,
    status: 200,
    body: {
      ok: true,
      day,
      already_posted: false,
      target: {
        uniprot_id: targetUniprot,
        gene: targetProtein.gene,
        full_name: targetProtein.full_name,
      },
      winners_count: winnersCount,
      total_guesses: totalGuesses,
      top_guesses: topGuesses,
      links: {
        play_url: PLAY_URL,
        render_url: `${RENDER_BASE_URL}?day=${day}&mode=structure`,
      },
    },
  }
}

async function loadCachedRecapImage(env, day) {
  if (!env.STRUCTURES_BUCKET) {
    throw new Error("STRUCTURES_BUCKET binding is not configured")
  }
  const key = buildDiscordRecapImageKey(day)
  const object = await env.STRUCTURES_BUCKET.get(key)
  if (!object) return null
  const imageData = await object.arrayBuffer()
  if (!imageData || imageData.byteLength <= 0) return null
  return {
    key,
    uploadedAt: object.uploaded ? object.uploaded.toISOString() : null,
    bytes: new Uint8Array(imageData),
  }
}

function decodeBase64Png(value) {
  const input = String(value || "").trim()
  if (!input) return null

  const cleaned = input.replace(/^data:image\/png;base64,/i, "").replace(/\s+/g, "")
  if (!cleaned) return null

  try {
    const binary = atob(cleaned)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.byteLength > 0 ? bytes : null
  } catch {
    return null
  }
}

function toErrorMessage(err) {
  if (err instanceof Error) return err.message
  return String(err)
}

async function postRecapToDiscord(env, { day, content, screenshotBytes }) {
  const botToken = env.DISCORD_BOT_TOKEN
  const channelId = env.DISCORD_GENEGUESSR_CHANNEL_ID
  if (!botToken) throw new Error("DISCORD_BOT_TOKEN not configured")
  if (!channelId) throw new Error("DISCORD_GENEGUESSR_CHANNEL_ID not configured")

  const payload = { content }
  const form = new FormData()
  form.append("payload_json", JSON.stringify(payload))
  form.append(
    "files[0]",
    new Blob([screenshotBytes], { type: "image/png" }),
    `structure-${day}.png`,
  )

  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort("discord_post_timeout"),
    DISCORD_POST_TIMEOUT_MS,
  )
  let response
  try {
    response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${botToken}` },
      body: form,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }

  const bodyText = await response.text()
  let parsed = null
  try {
    parsed = bodyText ? JSON.parse(bodyText) : null
  } catch {
    parsed = null
  }
  if (!response.ok) {
    throw new Error(`Discord API ${response.status}: ${bodyText || "empty_response"}`)
  }
  const messageId = parsed?.id
  if (!messageId) {
    throw new Error("Discord response missing message id")
  }
  return {
    messageId,
    raw: parsed,
  }
}

/**
 * Worker cron helper: post daily recap directly from Cloudflare Worker.
 */
export async function handlePostDailyRecap(env, options = {}) {
  const day = options?.day || getYesterdayUtcDay()
  if (!isValidDay(day)) {
    return { ok: false, error: "invalid_day", day }
  }

  const summary = await buildDailySummaryData(env, day)
  if (!summary.ok) {
    if (summary.status === 404 && summary.body?.error === "No puzzle data for this day") {
      return { ok: true, skipped: "no_puzzle_data", day }
    }
    return {
      ok: false,
      error: "summary_failed",
      day,
      status: summary.status,
      details: summary.body?.error || "unknown_error",
    }
  }

  const recap = summary.body
  if (recap.already_posted) {
    return { ok: true, skipped: "already_posted", day, message_id: recap.message_id || null }
  }

  let stage = "load_cached_image"
  try {
    const providedScreenshotBytes = options?.screenshotBytes
    let screenshotBytes = null
    let imageSource = "cached_r2"

    if (providedScreenshotBytes instanceof Uint8Array && providedScreenshotBytes.byteLength > 0) {
      screenshotBytes = providedScreenshotBytes
      imageSource = "request_body"
    } else {
      const cached = await loadCachedRecapImage(env, day)
      if (!cached?.bytes) {
        throw new Error(
          `Missing cached recap image for ${day}. Upload ${buildDiscordRecapImageKey(day)} via admin panel.`,
        )
      }
      screenshotBytes = cached.bytes
    }
    stage = "discord_post"
    const content = buildDiscordRecapContent(recap)
    const post = await postRecapToDiscord(env, {
      day,
      content,
      screenshotBytes,
    })
    stage = "mark_posted"
    const marker = await setPostedMarker(env, day, post.messageId)
    await clearPostFailure(env, day)
    return {
      ok: true,
      day,
      message_id: post.messageId,
      posted_at: marker.posted_at,
      screenshot_bytes: screenshotBytes.byteLength,
      image_source: imageSource,
    }
  } catch (err) {
    const failure = {
      day,
      failed_at: new Date().toISOString(),
      stage,
      error: toErrorMessage(err),
    }
    await setPostFailure(env, failure)
    return { ok: false, error: "post_failed", day, stage, details: failure.error }
  }
}

/**
 * POST /api/discord/post-recap
 * Optional body: { day: "YYYY-MM-DD" }.
 */
export async function handlePostRecap(request, env) {
  const auth = validateBotToken(request, env)
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: JSON_HEADERS,
    })
  }

  let day = new URL(request.url).searchParams.get("day")
  let screenshotBytes = null
  if (!day) {
    try {
      const body = await request.json()
      if (typeof body?.day === "string") day = body.day
      if (typeof body?.image_base64 === "string" && body.image_base64.trim()) {
        screenshotBytes = decodeBase64Png(body.image_base64)
      }
    } catch {
      // Optional JSON body; ignore parse errors.
    }
  }
  const result = await handlePostDailyRecap(env, {
    day: day || undefined,
    screenshotBytes: screenshotBytes || undefined,
  })
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 500,
    headers: JSON_HEADERS,
  })
}

function inferStructureFormatFromCacheKey(cacheKey, fallback = "cif") {
  const key = typeof cacheKey === "string" ? cacheKey.trim().toLowerCase() : ""
  if (key.endsWith(".bcif")) return "bcif"
  if (key.endsWith(".pdb")) return "pdb"
  if (key.endsWith(".cif")) return "cif"
  return fallback
}

/**
 * GET /api/discord/daily-summary?day=YYYY-MM-DD
 *
 * Returns recap data for posting to Discord:
 * - target: { uniprot_id, gene, full_name }
 * - winners_count
 * - top_guesses: [{ rank, gene }]
 * - total_guesses
 * - already_posted: boolean
 * - links: { play_url, render_url }
 */
export async function handleDailySummary(request, env) {
  // Validate bot token
  const auth = validateBotToken(request, env)
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: JSON_HEADERS,
    })
  }

  const url = new URL(request.url)
  const day = url.searchParams.get("day")
  const summary = await buildDailySummaryData(env, day)
  return new Response(JSON.stringify(summary.body), {
    status: summary.status,
    headers: JSON_HEADERS,
  })
}

/**
 * POST /api/discord/interactions
 *
 * Discord Interactions endpoint for webhook verification.
 * Validates Ed25519 signature and handles PING/PONG.
 */
export async function handleInteractions(request, env) {
  // Discord sends signature headers for verification
  const signature = request.headers.get("X-Signature-Ed25519")
  const timestamp = request.headers.get("X-Signature-Timestamp")

  if (!signature || !timestamp) {
    return new Response(JSON.stringify({ error: "Missing signature headers" }), {
      status: 401,
      headers: JSON_HEADERS,
    })
  }

  const body = await request.text()

  // Verify signature using the public key
  const isValid = await verifyDiscordSignature(body, signature, timestamp, env.DISCORD_PUBLIC_KEY)
  if (!isValid) {
    return new Response(JSON.stringify({ error: "Invalid request signature" }), {
      status: 401,
      headers: JSON_HEADERS,
    })
  }

  // Parse the interaction
  const interaction = JSON.parse(body)

  // Handle PING (type 1) - required for Discord to verify the endpoint
  if (interaction.type === 1) {
    return new Response(JSON.stringify({ type: 1 }), { headers: JSON_HEADERS })
  }

  // For now, respond with "not implemented" for other interaction types
  // Future: handle slash commands here
  return new Response(
    JSON.stringify({
      type: 4, // CHANNEL_MESSAGE_WITH_SOURCE
      data: {
        content: "This command is not yet implemented.",
      },
    }),
    { headers: JSON_HEADERS },
  )
}

/**
 * Verify Discord Ed25519 signature
 */
async function verifyDiscordSignature(body, signature, timestamp, publicKey) {
  if (!publicKey) {
    console.error("DISCORD_PUBLIC_KEY not configured")
    return false
  }

  try {
    const encoder = new TextEncoder()
    const message = encoder.encode(timestamp + body)

    // Import the public key
    const keyData = hexToUint8Array(publicKey)
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "Ed25519", namedCurve: "Ed25519" },
      false,
      ["verify"],
    )

    // Verify the signature
    const signatureData = hexToUint8Array(signature)
    return await crypto.subtle.verify("Ed25519", cryptoKey, signatureData, message)
  } catch (err) {
    console.error("Signature verification failed:", err)
    return false
  }
}

/**
 * Convert hex string to Uint8Array
 */
function hexToUint8Array(hex) {
  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return bytes
}

/**
 * POST /api/discord/mark-posted
 *
 * Sets idempotency key after successfully posting to Discord.
 * Body: { day: "YYYY-MM-DD", message_id: "..." }
 */
export async function handleMarkPosted(request, env) {
  // Validate bot token
  const auth = validateBotToken(request, env)
  if (!auth.valid) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: 401,
      headers: JSON_HEADERS,
    })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  const { day, message_id } = body

  // Validate day format
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return new Response(JSON.stringify({ error: "Invalid day format. Use YYYY-MM-DD" }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  if (!message_id) {
    return new Response(JSON.stringify({ error: "message_id is required" }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  const postedData = await setPostedMarker(env, day, message_id)

  return new Response(
    JSON.stringify({
      ok: true,
      day,
      message_id,
      posted_at: postedData.posted_at,
    }),
    { headers: JSON_HEADERS },
  )
}

/**
 * GET /apps/geneguessr/render?day=YYYY-MM-DD&mode=structure
 * GET /apps/geneguessr/render?protein_id=UNIPROT_ID&mode=structure
 *
 * Minimal structure viewer page for Playwright screenshots.
 * Public endpoint - no auth required.
 * Accepts either ?day= (daily puzzle) or ?protein_id= (direct protein lookup).
 * When chain labels are available, adds floating "Target" callouts.
 * Exposes window.setCameraView(name) for automated multi-angle capture.
 */
export async function handleRenderPage(request, env) {
  const url = new URL(request.url)
  const day = url.searchParams.get("day")
  const proteinId = url.searchParams.get("protein_id")
  const mode = url.searchParams.get("mode") || "structure"
  const allowDebugRender =
    url.hostname.endsWith(".workers.dev") ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "0.0.0.0"

  // Need either day or protein_id
  if (!day && !proteinId) {
    return new Response("Provide ?day=YYYY-MM-DD or ?protein_id=UNIPROT_ID", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    })
  }

  if (day && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return new Response("Invalid day format. Use ?day=YYYY-MM-DD", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    })
  }

  // Only structure mode supported for now
  if (mode !== "structure") {
    return new Response("Only mode=structure is supported", {
      status: 400,
      headers: { "Content-Type": "text/plain" },
    })
  }

  const origin = url.origin
  let structureToken = null
  let protein = null

  if (proteinId) {
    // Direct protein lookup by UniProt ID (used by benchmark screenshot tool)
    protein = await fetchProteinByUniprot(env.DB, proteinId)
    if (!protein) {
      return new Response(`Protein ${proteinId} not found`, {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      })
    }
  } else {
    // Day-based path: try bootstrap cache, then puzzle_actual
    const bootstrapKey = `daily_bootstrap:${day}`
    const bootstrapData = await env.KV.get(bootstrapKey)

    if (bootstrapData) {
      const bootstrap = JSON.parse(bootstrapData)
      structureToken = bootstrap.structureToken
      protein = bootstrap.targetProtein
    }

    if (!protein) {
      const puzzleKey = `puzzle_actual:${day}`
      const puzzleData = await env.KV.get(puzzleKey)

      if (!puzzleData) {
        // Staging/dev affordance: render arbitrary structure URL for Mol* validation
        const debugStructureUrl = url.searchParams.get("structure_url")
        const debugFormat = url.searchParams.get("format") || "cif"
        const debugMoleculeId = url.searchParams.get("molecule_id") || "debug"
        const debugGene = url.searchParams.get("gene") || "Debug"
        const debugFullName = url.searchParams.get("full_name") || "Debug render"
        if (allowDebugRender && debugStructureUrl && /^https:\/\//i.test(debugStructureUrl)) {
          const html = buildRenderHTML({
            day,
            gene: debugGene,
            fullName: debugFullName,
            structureUrl: debugStructureUrl,
            structureFormat: debugFormat,
            moleculeId: debugMoleculeId,
          })
          return new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-cache",
            },
          })
        }
        return new Response(`No puzzle data for ${day}`, {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        })
      }

      const puzzle = JSON.parse(puzzleData)
      protein = await fetchProteinByUniprot(env.DB, puzzle.uniprot_id)

      if (!protein) {
        return new Response(`Protein ${puzzle.uniprot_id} not found`, {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        })
      }
    }
  }

  // Build structure URL from cache key (same approach as main app)
  let structureUrl
  let structureFormat = "cif"
  let moleculeId = protein.pdb_id || protein.uniprot || "structure"

  if (structureToken && structureToken.cacheKey) {
    // Use cached structure endpoint (same as main app)
    structureUrl = `${origin}/api/structure-cached?key=${encodeURIComponent(structureToken.cacheKey)}`
    if (structureToken.upstreamUrl) {
      structureUrl += `&upstream=${encodeURIComponent(structureToken.upstreamUrl)}`
    }
    // Guard against stale bootstrap tokens where format drifted from cacheKey extension.
    structureFormat = inferStructureFormatFromCacheKey(
      structureToken.cacheKey,
      structureToken.format || "cif",
    )
    moleculeId = structureToken.moleculeId || moleculeId
  } else {
    // Fallback to the same canonical metadata resolver used by the main app.
    const storedMeta = buildStructureMetaFromStoredSource(protein)
    if (!storedMeta || !storedMeta.upstreamUrl) {
      return new Response(`No structure available for ${protein.gene}`, {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      })
    }
    // Always proxy through /api/structure-cached so all sources get consistent handling:
    // - content-type normalization
    // - SwissModel PDB header fix
    // - lazy cache + source-specific upstream rules
    if (storedMeta.r2Key) {
      structureUrl = `${origin}/api/structure-cached?key=${encodeURIComponent(storedMeta.r2Key)}`
      if (
        storedMeta.upstreamUrl &&
        (storedMeta.source === "swissmodel" || storedMeta.source === "alphafold")
      ) {
        structureUrl += `&upstream=${encodeURIComponent(storedMeta.upstreamUrl)}`
      }
      structureFormat = inferStructureFormatFromCacheKey(
        storedMeta.r2Key,
        storedMeta.format || "cif",
      )
    } else {
      structureUrl = storedMeta.upstreamUrl
      structureFormat = storedMeta.format || "cif"
    }
    moleculeId = storedMeta.moleculeId || moleculeId
  }

  // Build chain labels for floating callouts (multi-chain structures only)
  let chainLabelsData = null
  let totalChainCount = 0
  const chainLabelsRaw =
    protein.structure_source === "alphafold"
      ? null
      : protein.structure_source === "swissmodel"
        ? protein.swissmodel_chain_labels
        : protein.pdb_chain_labels
  if (chainLabelsRaw) {
    try {
      chainLabelsData =
        typeof chainLabelsRaw === "string" ? JSON.parse(chainLabelsRaw) : chainLabelsRaw
      totalChainCount = chainLabelsData?.reduce((sum, l) => sum + (l.chains?.length || 0), 0) || 0
    } catch (e) {
      console.warn("Failed to parse chain_labels for render:", e)
    }
  }

  // Generate the render HTML with injected structure data
  const html = buildRenderHTML({
    day: day || proteinId,
    gene: protein.gene,
    fullName: protein.full_name,
    structureUrl,
    structureFormat,
    moleculeId,
    chainLabels: chainLabelsData,
    totalChainCount,
  })

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  })
}

/**
 * Build minimal HTML for structure rendering
 */
function buildRenderHTML({
  day,
  gene,
  fullName,
  structureUrl,
  structureFormat,
  moleculeId,
  chainLabels,
  totalChainCount,
}) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex, nofollow">
  <title>GeneGuessr - ${gene}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 800px;
      height: 600px;
      overflow: hidden;
    }
    #viewer {
      width: 100%;
      height: 100%;
      position: relative;
    }
    #loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #888;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
    }
    #error {
      display: none;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #ff6b6b;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div id="viewer">
    <div id="loading">Loading structure...</div>
    <div id="error"></div>
  </div>
  <script>
    (async function() {
      const container = document.getElementById('viewer');
      const loading = document.getElementById('loading');
      const error = document.getElementById('error');

      try {
        function loadScript(src) {
          return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = () => resolve();
            s.onerror = (e) => reject(e || new Error('Failed to load ' + src));
            document.head.appendChild(s);
          });
        }

        // Avoid sticky caching on staging workers.dev during rapid deploy iterations.
        const sharedSrc = location.hostname.endsWith('.workers.dev')
          ? '/static/geneguessr/molstar-shared.js?v=' + Date.now()
          : '/static/geneguessr/molstar-shared.js';

        await loadScript(sharedSrc);

        if (!window.GeneguessrMolstar || !window.GeneguessrMolstar.initializeViewer) {
          throw new Error('Mol* shared initializer not available after load');
        }

        // PDBe Mol* expects BCIF as format='cif' with binary=true.
        // Passing format='bcif' can route through text parser and intermittently fail.
        const sourceFormat = ${JSON.stringify(structureFormat)};
        const isBinary = sourceFormat === 'bcif';

        const { viewer, loadComplete } = await window.GeneguessrMolstar.initializeViewer(container, {
          moleculeId: ${JSON.stringify(moleculeId)},
          customData: {
            url: ${JSON.stringify(structureUrl)},
            format: isBinary ? 'cif' : sourceFormat,
            binary: isBinary,
          },
        }, {
          interactive: false,
          loadTimeoutMs: 60000,
        });

        const markSuccess = () => {
          loading.style.display = 'none';
          document.body.setAttribute('data-loaded', 'true');
          console.log('[molstar] loadComplete fired - render success');
        };

        const markTimeout = () => {
          loading.style.display = 'none';
          document.body.setAttribute('data-loaded', 'timeout');
          console.error('[molstar] loadComplete did not fire before timeout');
        };

        const result = await loadComplete;
        if (result && result.ok) {
          markSuccess();

          // Floating chain labels (multi-chain structures)
          const injectedChainLabels = ${JSON.stringify(chainLabels || null)};
          const injectedTotalChainCount = ${JSON.stringify(totalChainCount || 0)};
          if (injectedChainLabels && injectedTotalChainCount > 1 &&
              window.GeneguessrMolstar.setFloatingLabels) {
            window.GeneguessrMolstar.setFloatingLabels(viewer, container, {
              mode: 'hidden',
              chainLabels: injectedChainLabels,
              totalChainCount: injectedTotalChainCount,
            });
          }

          // Camera control for automated multi-view screenshots
          window.setCameraView = async function(viewName) {
            if (!viewer || !viewer.plugin) return false;
            const canvas3d = viewer.plugin.canvas3d;
            if (!canvas3d || !canvas3d.camera) return false;
            const cam = canvas3d.camera;
            const snap = typeof cam.getSnapshot === 'function' ? cam.getSnapshot() : cam.snapshot;
            const cx = snap.target[0], cy = snap.target[1], cz = snap.target[2];
            const dx = snap.position[0] - cx, dy = snap.position[1] - cy, dz = snap.position[2] - cz;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const views = {
              front:  { p: [cx, cy, cz + dist],  u: [0, 1, 0] },
              back:   { p: [cx, cy, cz - dist],  u: [0, 1, 0] },
              left:   { p: [cx - dist, cy, cz],  u: [0, 1, 0] },
              right:  { p: [cx + dist, cy, cz],  u: [0, 1, 0] },
              top:    { p: [cx, cy + dist, cz],  u: [0, 0, -1] },
              bottom: { p: [cx, cy - dist, cz],  u: [0, 0, 1] },
            };
            const v = views[viewName];
            if (!v) return false;
            cam.setState({ ...snap, position: v.p, target: [cx, cy, cz], up: v.u }, 0);
            if (canvas3d.requestDraw) canvas3d.requestDraw(true);
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
            await new Promise(r => setTimeout(r, 300));
            return true;
          };
          window.viewReady = true;
        } else {
          markTimeout();
        }

      } catch (err) {
        loading.style.display = 'none';
        error.style.display = 'block';
        error.textContent = 'Failed to load structure: ' + err.message;
        console.error('Render error:', err);
      }
    })();
  </script>
</body>
</html>`
}
