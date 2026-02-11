/**
 * Discord Bot Integration Endpoints
 *
 * Endpoints:
 * - GET  /api/discord/daily-summary  - Returns recap data for a given day
 * - POST /api/discord/interactions   - Discord webhook verification
 * - POST /api/discord/mark-posted    - Sets idempotency key after posting
 * - GET  /apps/geneguessr/render     - Minimal structure viewer for screenshots
 */

import { getDailyGuessAggregates, getWinnersCount } from "./lib/guess-aggregates.js"
import { fetchProteinByUniprot } from "./lib/protein-store.js"
import { buildStructureMetaFromStoredSource } from "./lib/structure-utils.js"

const JSON_HEADERS = { "Content-Type": "application/json" }
const DISCORD_SUMMARY_POSTED_PREFIX = "discord_summary_posted:"
const DISCORD_API_BASE = "https://discord.com/api/v10"

function isValidDay(day) {
  return Boolean(day && /^\d{4}-\d{2}-\d{2}$/.test(day))
}

function getYesterdayUtcDay(now = new Date()) {
  const date = new Date(now)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

async function getPostedMarker(env, day) {
  const postedKey = `${DISCORD_SUMMARY_POSTED_PREFIX}${day}`
  const postedRaw = await env.KV.get(postedKey)
  if (!postedRaw) {
    return null
  }
  try {
    return JSON.parse(postedRaw)
  } catch {
    return null
  }
}

async function setPostedMarker(env, day, messageId) {
  const postedKey = `${DISCORD_SUMMARY_POSTED_PREFIX}${day}`
  const postedData = {
    message_id: messageId,
    posted_at: Date.now(),
    channel_id: env.DISCORD_GENEGUESSR_CHANNEL_ID,
  }
  await env.KV.put(postedKey, JSON.stringify(postedData))
  return postedData
}

function formatDate(day) {
  const date = new Date(day + "T00:00:00Z")
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

function buildRecapMessage(summary) {
  const { target, winners_count, top_guesses, day, links } = summary
  const gene = target?.gene || "Unknown"
  const fullName = target?.full_name || ""

  let content = `GeneGuessr for ${formatDate(day)}\n**${gene}**`
  if (fullName) {
    content += `\n${fullName}`
  }
  content += "\n\n"

  if (winners_count > 0) {
    content += `${winners_count} player${winners_count === 1 ? "" : "s"} solved it!\n\n`
  } else {
    content += "No one solved it!\n\n"
  }

  if (top_guesses && top_guesses.length > 0) {
    content += "Top guesses:\n"
    for (const guess of top_guesses) {
      content += `${guess.rank}. ${guess.gene}\n`
    }
    content += "\n"
  }

  content += `Play today's puzzle: <${links?.play_url || "https://geneguessr.brinedew.bio"}>`
  if (links?.render_url) {
    content += `\nStructure: <${links.render_url}>`
  }
  return content
}

async function postDiscordMessage({ channelId, botToken, content }) {
  const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  })

  const raw = await response.text()
  let json = null
  try {
    json = raw ? JSON.parse(raw) : null
  } catch {
    json = null
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: json?.message || raw || "Discord API request failed",
      response: json || raw,
    }
  }

  return {
    ok: true,
    id: json?.id || "",
  }
}

async function buildDailySummary(env, day) {
  const puzzleKey = `puzzle_actual:${day}`
  const puzzleData = await env.KV.get(puzzleKey)

  if (!puzzleData) {
    return {
      ok: false,
      status: 404,
      error: "No puzzle data for this day",
      day,
      hint: "Either no one played, or the day hasn't happened yet",
    }
  }

  const puzzle = JSON.parse(puzzleData)
  const targetUniprot = puzzle.uniprot_id

  const targetProtein = await fetchProteinByUniprot(env.DB, targetUniprot)
  if (!targetProtein) {
    return {
      ok: false,
      status: 404,
      error: "Target protein not found in database",
      uniprot_id: targetUniprot,
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
    day,
    target: {
      uniprot_id: targetUniprot,
      gene: targetProtein.gene,
      full_name: targetProtein.full_name,
    },
    winners_count: winnersCount,
    total_guesses: totalGuesses,
    top_guesses: topGuesses,
    links: {
      play_url: "https://geneguessr.brinedew.bio",
      render_url: `https://geneguessr.brinedew.bio/apps/geneguessr/render?day=${day}&mode=structure`,
    },
  }
}

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

  // Validate day format
  if (!isValidDay(day)) {
    return new Response(JSON.stringify({ error: "Invalid day format. Use YYYY-MM-DD" }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  // Check if already posted (idempotency)
  const posted = await getPostedMarker(env, day)
  if (posted) {
    return new Response(
      JSON.stringify({
        already_posted: true,
        message_id: posted.message_id,
        posted_at: posted.posted_at,
      }),
      { headers: JSON_HEADERS },
    )
  }

  const summary = await buildDailySummary(env, day)
  if (!summary.ok) {
    return new Response(JSON.stringify(summary), { status: summary.status || 500, headers: JSON_HEADERS })
  }

  return new Response(
    JSON.stringify({
      ...summary,
      already_posted: false,
    }),
    { headers: JSON_HEADERS },
  )
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
  if (!isValidDay(day)) {
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
 * Worker cron handler for daily Discord recap posting.
 * Posts recap for yesterday (UTC) and stores idempotency marker in KV.
 */
export async function handleDailyRecapCron(env) {
  const day = getYesterdayUtcDay()
  console.log(`[CRON] Discord recap run started for day=${day}`)

  const posted = await getPostedMarker(env, day)
  if (posted?.message_id) {
    console.log(`[CRON] Discord recap already posted for ${day}: ${posted.message_id}`)
    return { ok: true, day, skipped: "already_posted", message_id: posted.message_id }
  }

  const botToken = env.DISCORD_BOT_TOKEN
  const channelId = env.DISCORD_GENEGUESSR_CHANNEL_ID
  if (!botToken || !channelId) {
    console.error("[CRON] Discord recap skipped: missing DISCORD_BOT_TOKEN or channel ID")
    return { ok: false, day, error: "discord_config_missing" }
  }

  const summary = await buildDailySummary(env, day)
  if (!summary.ok) {
    if (summary.status === 404 && summary.error === "No puzzle data for this day") {
      console.log(`[CRON] Discord recap skipped for ${day}: no puzzle data yet`)
      return { ok: true, day, skipped: "no_puzzle_data" }
    }
    console.error(`[CRON] Discord recap failed to build summary for ${day}:`, summary)
    return {
      ok: false,
      day,
      error: "summary_build_failed",
      details: summary.error || "unknown",
    }
  }

  const content = buildRecapMessage(summary)
  const postResult = await postDiscordMessage({ channelId, botToken, content })
  if (!postResult.ok || !postResult.id) {
    console.error(`[CRON] Discord recap post failed for ${day}:`, postResult)
    return {
      ok: false,
      day,
      error: "discord_post_failed",
      details: postResult.error || "unknown",
    }
  }

  await setPostedMarker(env, day, postResult.id)
  console.log(`[CRON] Discord recap posted for ${day}: ${postResult.id}`)
  return { ok: true, day, message_id: postResult.id }
}

/**
 * GET /apps/geneguessr/render?day=YYYY-MM-DD&mode=structure
 *
 * Minimal structure viewer page for Playwright screenshots.
 * Public endpoint - no auth required (displays past puzzles).
 * Uses the same cached structure approach as the main game.
 */
export async function handleRenderPage(request, env) {
  const url = new URL(request.url)
  const day = url.searchParams.get("day")
  const mode = url.searchParams.get("mode") || "structure"
  const allowDebugRender =
    url.hostname.endsWith(".workers.dev") ||
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "0.0.0.0"

  // Validate day format
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
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

  // Try to get the daily bootstrap cache which contains the structure token
  const origin = url.origin
  const bootstrapKey = `daily_bootstrap:${day}`
  const bootstrapData = await env.KV.get(bootstrapKey)

  let structureToken = null
  let protein = null

  if (bootstrapData) {
    const bootstrap = JSON.parse(bootstrapData)
    structureToken = bootstrap.structureToken
    protein = bootstrap.targetProtein
  }

  // Fallback: Get from puzzle_actual if no bootstrap cache
  if (!protein) {
    const puzzleKey = `puzzle_actual:${day}`
    const puzzleData = await env.KV.get(puzzleKey)

    if (!puzzleData) {
      // Staging/dev affordance: allow rendering an arbitrary structure URL so we can validate Mol*
      // without pre-populating KV puzzle data.
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
    structureFormat = structureToken.format || "cif"
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
    structureUrl = storedMeta.upstreamUrl
    structureFormat = storedMeta.format || "cif"
    moleculeId = storedMeta.moleculeId || moleculeId
  }

  // Generate the render HTML with injected structure data
  const html = buildRenderHTML({
    day,
    gene: protein.gene,
    fullName: protein.full_name,
    structureUrl,
    structureFormat,
    moleculeId,
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
function buildRenderHTML({ day, gene, fullName, structureUrl, structureFormat, moleculeId }) {
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

        const { loadComplete } = await window.GeneguessrMolstar.initializeViewer(container, {
          moleculeId: ${JSON.stringify(moleculeId)},
          customData: {
            url: ${JSON.stringify(structureUrl)},
            format: ${JSON.stringify(structureFormat)},
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
