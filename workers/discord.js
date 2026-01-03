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

// Mol* CDN URLs (same versions as main app)
const MOLSTAR_VERSION = "3.8.0"
const MOLSTAR_SCRIPT_URL = `https://cdn.jsdelivr.net/npm/pdbe-molstar@${MOLSTAR_VERSION}/build/pdbe-molstar-plugin.js`
const MOLSTAR_CSS_URL = `https://cdn.jsdelivr.net/npm/pdbe-molstar@${MOLSTAR_VERSION}/build/pdbe-molstar.css`

const JSON_HEADERS = { "Content-Type": "application/json" }
const DISCORD_SUMMARY_POSTED_PREFIX = "discord_summary_posted:"

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
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return new Response(JSON.stringify({ error: "Invalid day format. Use YYYY-MM-DD" }), {
      status: 400,
      headers: JSON_HEADERS,
    })
  }

  // Check if already posted (idempotency)
  const postedKey = `${DISCORD_SUMMARY_POSTED_PREFIX}${day}`
  const alreadyPosted = await env.KV.get(postedKey)
  if (alreadyPosted) {
    const posted = JSON.parse(alreadyPosted)
    return new Response(
      JSON.stringify({
        already_posted: true,
        message_id: posted.message_id,
        posted_at: posted.posted_at,
      }),
      { headers: JSON_HEADERS },
    )
  }

  // Get the puzzle_actual for this day
  const puzzleKey = `puzzle_actual:${day}`
  const puzzleData = await env.KV.get(puzzleKey)

  if (!puzzleData) {
    return new Response(
      JSON.stringify({
        error: "No puzzle data for this day",
        day,
        hint: "Either no one played, or the day hasn't happened yet",
      }),
      { status: 404, headers: JSON_HEADERS },
    )
  }

  const puzzle = JSON.parse(puzzleData)
  const targetUniprot = puzzle.uniprot_id

  // Fetch target protein details
  const targetProtein = await fetchProteinByUniprot(env.DB, targetUniprot)
  if (!targetProtein) {
    return new Response(
      JSON.stringify({
        error: "Target protein not found in database",
        uniprot_id: targetUniprot,
      }),
      { status: 404, headers: JSON_HEADERS },
    )
  }

  // Get winners count
  const winnersResult = await getWinnersCount(env.DB, { day })
  const winnersCount = winnersResult.ok ? winnersResult.winnersCount : 0

  // Get top guesses (just gene names, no counts/similarities per user request)
  const guessResult = await getDailyGuessAggregates(env.DB, { day, limit: 5 })
  const topGuesses = guessResult.ok
    ? guessResult.guesses.map((g, idx) => ({
        rank: idx + 1,
        gene: g.gene || g.uniprot,
      }))
    : []

  const totalGuesses = guessResult.ok ? guessResult.totalGuesses : 0

  return new Response(
    JSON.stringify({
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
        play_url: "https://geneguessr.brinedew.bio",
        render_url: `https://geneguessr.brinedew.bio/apps/geneguessr/render?day=${day}&mode=structure`,
      },
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

  // Store the posted marker in KV
  const postedKey = `${DISCORD_SUMMARY_POSTED_PREFIX}${day}`
  const postedData = {
    message_id,
    posted_at: Date.now(),
    channel_id: env.DISCORD_GENEGUESSR_CHANNEL_ID,
  }

  await env.KV.put(postedKey, JSON.stringify(postedData))

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
 *
 * Minimal structure viewer page for Playwright screenshots.
 * Public endpoint - no auth required (displays past puzzles).
 * Uses the same cached structure approach as the main game.
 */
export async function handleRenderPage(request, env) {
  const url = new URL(request.url)
  const day = url.searchParams.get("day")
  const mode = url.searchParams.get("mode") || "structure"

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
  const origin = "https://geneguessr.brinedew.bio"
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

  if (structureToken && structureToken.cacheKey) {
    // Use cached structure endpoint (same as main app)
    structureUrl = `${origin}/api/structure-cached?key=${encodeURIComponent(structureToken.cacheKey)}`
    if (structureToken.upstreamUrl) {
      structureUrl += `&upstream=${encodeURIComponent(structureToken.upstreamUrl)}`
    }
    structureFormat = structureToken.format || "cif"
  } else {
    // Fallback to direct URLs if no cache
    const info = getStructureInfo(protein)
    if (!info) {
      return new Response(`No structure available for ${protein.gene}`, {
        status: 404,
        headers: { "Content-Type": "text/plain" },
      })
    }
    structureUrl = info.url
    structureFormat = info.format
  }

  // Generate the render HTML with injected structure data
  const html = buildRenderHTML({
    day,
    gene: protein.gene,
    fullName: protein.full_name,
    structureUrl,
    structureFormat,
    moleculeId: protein.pdb_id || protein.uniprot || "structure",
  })

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  })
}

/**
 * Get structure info for a protein
 */
function getStructureInfo(protein) {
  // Priority: PDB > SWISS-MODEL > AlphaFold
  if (protein.structure_source === "pdb" && protein.pdb_id) {
    return {
      url: `https://files.rcsb.org/download/${protein.pdb_id}.cif`,
      format: "cif",
      moleculeId: protein.pdb_id,
    }
  }

  if (protein.structure_source === "swissmodel" && protein.swissmodel_url) {
    // SwissModel URLs end in .pdb - detect from URL like main app does
    const url = protein.swissmodel_url
    const format = url.toLowerCase().includes(".pdb") ? "pdb" : "cif"
    return {
      url,
      format,
      moleculeId: protein.swissmodel_template || "SWISS",
    }
  }

  if (protein.structure_source === "alphafold" && protein.alphafold_url) {
    return {
      url: protein.alphafold_url,
      format: "cif",
      moleculeId: protein.uniprot,
    }
  }

  return null
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
  <link rel="stylesheet" href="${MOLSTAR_CSS_URL}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body {
      width: 800px;
      height: 600px;
      background: #1a1a2e;
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
  <script src="${MOLSTAR_SCRIPT_URL}"></script>
  <script>
    (async function() {
      const container = document.getElementById('viewer');
      const loading = document.getElementById('loading');
      const error = document.getElementById('error');

      try {
        // Wait for PDBeMolstarPlugin to be available
        let attempts = 0;
        while (!window.PDBeMolstarPlugin && attempts < 50) {
          await new Promise(r => setTimeout(r, 100));
          attempts++;
        }

        if (!window.PDBeMolstarPlugin) {
          throw new Error('Failed to load Mol* viewer');
        }

        const viewer = new window.PDBeMolstarPlugin();

        await viewer.render(container, {
          moleculeId: ${JSON.stringify(moleculeId)},
          customData: {
            url: ${JSON.stringify(structureUrl)},
            format: ${JSON.stringify(structureFormat)},
          },
          hideControls: true,
          hideCanvasControls: ['expand', 'controlToggle', 'controlInfo', 'selection', 'animation', 'trajectory', 'screenshot', 'reset'],
          pdbeLink: false,
          visualStyle: 'cartoon',
          lighting: 'glossy',
          loadMaps: false,
          selectInteraction: false,
          lowPrecisionCoords: false,
          hideStructureSourceTooltip: true,
          bgColor: { r: 26, g: 26, b: 46 },
        });

        // Apply post-load styling (matches main game's applyViewerStylizationProfile)
        function applyPostLoadStyling() {
          try {
            // Hide axes (same as main game)
            if (viewer.plugin?.canvas3d) {
              viewer.plugin.canvas3d.setProps({
                camera: { helper: { axes: { name: 'off' } } }
              });
            }
          } catch (e) {
            console.warn('Post-load styling failed:', e);
          }
        }

        // Signal ready when viewer finishes loading
        let loadCompleted = false;

        const markSuccess = () => {
          if (loadCompleted) return;
          loadCompleted = true;
          loading.style.display = 'none';
          applyPostLoadStyling();
          document.body.setAttribute('data-loaded', 'true');
          console.log('[molstar] loadComplete fired - render success');
        };

        const markTimeout = () => {
          if (loadCompleted) return;
          loadCompleted = true;
          loading.style.display = 'none';
          document.body.setAttribute('data-loaded', 'timeout');
          console.error('[molstar] loadComplete did not fire before timeout');
        };

        // Listen for loadComplete event
        if (viewer.events && viewer.events.loadComplete) {
          viewer.events.loadComplete.subscribe(markSuccess);
        }

        // Timeout marks failure, not false success
        setTimeout(markTimeout, 60000);

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
