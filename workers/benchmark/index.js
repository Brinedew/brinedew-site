/**
 * GeneGuessr Benchmark API Worker — Phase 1
 *
 * Real game logic wired up. An LLM agent can play a full game through this API:
 *   1. POST /sessions         — start a game (picks a protein)
 *   2. POST /actions           — search, guess, reveal hints, get clues
 *   3. GET  /sessions/:id      — check current state
 *   4. POST /sessions/:id/end  — close session, get final score
 *
 * State is stored as a JSON blob in benchmark_sessions.state.
 * Shares D1 with the main geneguessr-api Worker.
 */

import {
  scoreGuess,
  buildClueSections,
  buildFeedbackSections,
  maskClueSections,
  extractHintData,
  collectMatchedHintTexts,
  sanitizeTargetProtein,
  MAX_GUESSES,
  DEFAULT_HINT_COST,
  HINT_REWARD_ON_INCORRECT,
} from "../lib/game-engine.js"

import {
  searchProteins,
  fetchProteinByUniprot,
  fetchProteinByGene,
  getBlendedSimilarity,
  pickRandomProteinBalanced,
} from "../lib/protein-store.js"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ACTIONS_PER_SESSION = 50 // bumped from 30 — agents need search + guess + hint cycles
const SESSION_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes (agents are slower than humans)
const CORS_ORIGIN = "https://geneguessr-bench.brinedew.bio"
const JSON_HEADERS = { "Content-Type": "application/json" }

// Valid action types that the benchmark accepts
const VALID_ACTIONS = new Set(["search", "guess", "reveal_hint", "get_clues"])

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

async function verifyApiKey(request, db) {
  const authHeader = request.headers.get("Authorization") || ""
  const match = authHeader.match(/^Bearer\s+(\S+)$/i)
  if (!match) {
    return { ok: false, status: 401, message: "Missing or malformed Authorization header" }
  }

  const token = match[1]
  const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))
  const keyHash = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const row = await db
    .prepare("SELECT key_hash, name, active FROM benchmark_api_keys WHERE key_hash = ?")
    .bind(keyHash)
    .first()

  if (!row) return { ok: false, status: 401, message: "Invalid API key" }
  if (!row.active) return { ok: false, status: 403, message: "API key is deactivated" }

  return { ok: true, keyHash: row.key_hash, name: row.name }
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || ""
  const allowed =
    origin === CORS_ORIGIN ||
    origin.startsWith("http://localhost:") ||
    origin.startsWith("http://127.0.0.1:")

  return {
    "Access-Control-Allow-Origin": allowed ? origin : CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  }
}

function handleOptions(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...corsHeaders(request) },
  })
}

async function safeJson(request) {
  try {
    return await request.json()
  } catch {
    return null
  }
}

function generateId(prefix) {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
  return `${prefix}_${hex}`
}

// ---------------------------------------------------------------------------
// Game state helpers
// ---------------------------------------------------------------------------

function makeInitialState(targetProtein) {
  return {
    targetUniprot: targetProtein.uniprot,
    targetGene: targetProtein.gene,
    guesses: [],
    hintCredits: 1,
    revealedHints: [],
    won: false,
    guessCount: 0,
  }
}

function parseState(stateStr) {
  if (!stateStr) return null
  try {
    return JSON.parse(stateStr)
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Route: GET /health
// ---------------------------------------------------------------------------

async function handleHealth(request, db) {
  try {
    const result = await db.prepare("SELECT 1 as ok").first()
    if (!result?.ok) throw new Error("D1 ping failed")

    const tables = await db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type='table' AND name LIKE 'benchmark_%'
         ORDER BY name`,
      )
      .all()

    const tableNames = (tables?.results || []).map((r) => r.name)

    return jsonResponse(
      {
        ok: true,
        phase: 1,
        tables: tableNames,
        timestamp: new Date().toISOString(),
      },
      200,
      request,
    )
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err.message) }, 500, request)
  }
}

// ---------------------------------------------------------------------------
// Route: POST /sessions — start a new game
// ---------------------------------------------------------------------------

async function handleCreateSession(request, db, auth) {
  const body = await safeJson(request)
  const corpusVersion = body?.corpus_version || "v1"

  let targetProtein = null

  if (body?.protein_id) {
    // Specific protein requested (for reproducible evals)
    targetProtein = await fetchProteinByUniprot(db, body.protein_id.toUpperCase())
    if (!targetProtein) {
      return jsonResponse({ error: `Protein ${body.protein_id} not found` }, 404, request)
    }
  } else {
    // Random balanced pick
    const pick = await pickRandomProteinBalanced(db)
    if (!pick?.protein) {
      return jsonResponse({ error: "Failed to pick a target protein" }, 500, request)
    }
    targetProtein = pick.protein
  }

  const sessionId = generateId("bench")
  const state = makeInitialState(targetProtein)

  // Build initial clues so the agent knows what sections exist
  const clueSections = buildClueSections(targetProtein)
  const maskedClues = maskClueSections(clueSections, new Set())

  await db
    .prepare(
      `INSERT INTO benchmark_sessions (id, api_key_hash, protein_id, status, corpus_version, state)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
    .bind(sessionId, auth.keyHash, targetProtein.uniprot, corpusVersion, JSON.stringify(state))
    .run()

  return jsonResponse(
    {
      session_id: sessionId,
      status: "active",
      corpus_version: corpusVersion,
      max_guesses: MAX_GUESSES,
      max_actions: MAX_ACTIONS_PER_SESSION,
      timeout_ms: SESSION_TIMEOUT_MS,
      hint_credits: state.hintCredits,
      clues: maskedClues,
      available_actions: ["search", "guess", "reveal_hint", "get_clues"],
    },
    201,
    request,
  )
}

// ---------------------------------------------------------------------------
// Route: POST /actions — the main game loop
// ---------------------------------------------------------------------------

async function handleAction(request, db, auth) {
  const body = await safeJson(request)
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400, request)
  }

  const { session_id, action, payload } = body
  if (!session_id || !action) {
    return jsonResponse({ error: "Missing session_id or action" }, 400, request)
  }
  if (!VALID_ACTIONS.has(action)) {
    return jsonResponse(
      { error: `Unknown action "${action}". Valid: ${[...VALID_ACTIONS].join(", ")}` },
      400,
      request,
    )
  }

  // Load session
  const session = await db
    .prepare(
      "SELECT id, api_key_hash, status, action_count, started_at, state FROM benchmark_sessions WHERE id = ?",
    )
    .bind(session_id)
    .first()

  if (!session) return jsonResponse({ error: "Session not found" }, 404, request)
  if (session.api_key_hash !== auth.keyHash) {
    return jsonResponse({ error: "Session belongs to a different API key" }, 403, request)
  }
  if (session.status !== "active") {
    return jsonResponse({ error: `Session is ${session.status}, not active` }, 409, request)
  }

  // Budget check
  if (session.action_count >= MAX_ACTIONS_PER_SESSION) {
    return jsonResponse(
      {
        error: `Action limit reached (${MAX_ACTIONS_PER_SESSION})`,
        session_id,
        action_count: session.action_count,
      },
      429,
      request,
    )
  }

  // Timeout check
  const elapsed = Date.now() - new Date(session.started_at + "Z").getTime()
  if (elapsed > SESSION_TIMEOUT_MS) {
    await db
      .prepare(
        "UPDATE benchmark_sessions SET status = 'expired', ended_at = datetime('now') WHERE id = ?",
      )
      .bind(session_id)
      .run()
    return jsonResponse({ error: "Session expired", session_id, elapsed_ms: elapsed }, 410, request)
  }

  const state = parseState(session.state)
  if (!state) {
    return jsonResponse({ error: "Corrupt session state" }, 500, request)
  }

  const actionSeq = session.action_count + 1
  const startTime = Date.now()

  // Dispatch to the right handler
  let result
  try {
    switch (action) {
      case "search":
        result = await executeSearch(db, state, payload)
        break
      case "guess":
        result = await executeGuess(db, state, payload)
        break
      case "reveal_hint":
        result = await executeRevealHint(db, state, payload)
        break
      case "get_clues":
        result = await executeGetClues(db, state)
        break
      default:
        result = { error: `Unhandled action: ${action}` }
    }
  } catch (err) {
    console.error(`Action ${action} failed:`, err)
    result = { error: `Action failed: ${err.message}` }
  }

  const latencyMs = Date.now() - startTime

  // Check if game just ended
  const gameOver = state.won || state.guessCount >= MAX_GUESSES

  // Persist updated state + action log in one batch
  const batchOps = [
    db
      .prepare(
        `INSERT INTO benchmark_actions (session_id, action_seq, action, payload, result, latency_ms)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        session_id,
        actionSeq,
        action,
        JSON.stringify(payload || {}),
        JSON.stringify(result),
        latencyMs,
      ),
    db
      .prepare("UPDATE benchmark_sessions SET action_count = ?, state = ? WHERE id = ?")
      .bind(actionSeq, JSON.stringify(state), session_id),
  ]

  // Track hints_used on every action so it stays current
  if (state.revealedHints.length > 0) {
    batchOps.push(
      db
        .prepare("UPDATE benchmark_sessions SET hints_used = ? WHERE id = ?")
        .bind(state.revealedHints.length, session_id),
    )
  }

  await db.batch(batchOps)

  return jsonResponse(
    {
      session_id,
      action_seq: actionSeq,
      action,
      result,
      latency_ms: latencyMs,
      remaining_actions: MAX_ACTIONS_PER_SESSION - actionSeq,
      game_over: gameOver,
      won: state.won,
    },
    200,
    request,
  )
}

// ---------------------------------------------------------------------------
// Action: search — autocomplete protein search
// ---------------------------------------------------------------------------

async function executeSearch(db, state, payload) {
  const query = (payload?.query || "").trim()
  if (!query) {
    return { error: "Missing payload.query" }
  }
  if (query.length < 2) {
    return { error: "Query too short (min 2 chars)" }
  }

  const guessedUniprots = state.guesses.map((g) => g.uniprot)
  const results = await searchProteins(db, query, 10, guessedUniprots)

  return {
    query,
    results: results.map((r) => ({
      gene: r.gene || r.hgnc,
      full_name: r.full_name,
    })),
    count: results.length,
  }
}

// ---------------------------------------------------------------------------
// Action: guess — submit a protein guess
// ---------------------------------------------------------------------------

async function executeGuess(db, state, payload) {
  const gene = (payload?.gene || "").toUpperCase().trim()
  const uniprot = (payload?.uniprot || "").toUpperCase().trim()
  if (!gene && !uniprot) {
    return { error: "Missing payload.gene (gene symbol)" }
  }

  if (state.won) {
    return { error: "Already won -- game is over" }
  }
  if (state.guessCount >= MAX_GUESSES) {
    return { error: `Out of guesses (max ${MAX_GUESSES})` }
  }
  if (state.guesses.some((g) => (gene && g.gene === gene) || (uniprot && g.uniprot === uniprot))) {
    return { error: `Already guessed ${gene || uniprot}` }
  }

  // Resolve protein: prefer gene lookup, fall back to uniprot
  let guessProtein = null
  if (gene) {
    guessProtein = await fetchProteinByGene(db, gene)
  }
  if (!guessProtein && uniprot) {
    guessProtein = await fetchProteinByUniprot(db, uniprot)
  }
  const targetProtein = await fetchProteinByUniprot(db, state.targetUniprot)

  if (!guessProtein) {
    return { error: `Protein '${gene || uniprot}' not found` }
  }
  if (!targetProtein) {
    return { error: "Target protein unavailable (internal error)" }
  }

  const correct = guessProtein.uniprot === targetProtein.uniprot

  // Calculate similarity synchronously (benchmark needs deterministic results)
  let similarity = null
  let isLadder = false
  let ladderRank = null

  if (!correct) {
    const simResult = await getBlendedSimilarity(db, guessProtein.gene, targetProtein.gene, {
      targetNeighbors: targetProtein.neighbors,
    })
    similarity = simResult.blended
    isLadder = simResult.isLadder
    ladderRank = simResult.ladderRank
  } else {
    similarity = 100
  }

  const score = scoreGuess(guessProtein, targetProtein, { similarity, isLadder, ladderRank })
  const matchedHints = collectMatchedHintTexts(targetProtein, guessProtein, score)
  const guessSections = buildFeedbackSections(guessProtein)

  // Update state
  state.guesses.push({
    uniprot: guessProtein.uniprot,
    gene: guessProtein.gene || guessProtein.hgnc,
    correct,
    similarity,
    isLadder,
    ladderRank,
  })
  state.guessCount = state.guesses.length

  if (correct) {
    state.won = true
  } else {
    state.hintCredits = (state.hintCredits || 0) + HINT_REWARD_ON_INCORRECT
  }

  const response = {
    correct,
    guess: {
      uniprot: guessProtein.uniprot,
      gene: guessProtein.gene,
      full_name: guessProtein.full_name,
    },
    score: {
      similarity: score.similarity,
      percent: score.percent,
      isLadder: score.isLadder,
      ladderRank: score.ladderRank,
      domainMatches: score.domainMatches,
      lengthBinMatch: score.lengthBinMatch,
      tmMatch: score.tmMatch,
      secretedMatch: score.secretedMatch,
      tissueMatch: score.tissueMatch,
    },
    matched_hints: matchedHints,
    guess_sections: guessSections,
    game_state: {
      guesses_used: state.guessCount,
      guesses_remaining: MAX_GUESSES - state.guessCount,
      hint_credits: state.hintCredits,
      hints_revealed: state.revealedHints.length,
      won: state.won,
    },
  }

  if (correct) {
    response.target = {
      uniprot: targetProtein.uniprot,
      gene: targetProtein.gene,
      full_name: targetProtein.full_name,
    }
  }

  return response
}

// ---------------------------------------------------------------------------
// Action: reveal_hint — spend a hint credit to reveal a clue section
// ---------------------------------------------------------------------------

async function executeRevealHint(db, state, payload) {
  const hintId = payload?.hint_id || payload?.hintId
  if (!hintId) {
    return { error: "Missing payload.hint_id" }
  }

  if (state.revealedHints.includes(hintId)) {
    return { error: `Hint "${hintId}" already revealed` }
  }

  const targetProtein = await fetchProteinByUniprot(db, state.targetUniprot)
  if (!targetProtein) {
    return { error: "Target protein unavailable (internal error)" }
  }

  const clueSections = buildClueSections(targetProtein)
  const hintData = extractHintData(clueSections, hintId)

  if (!hintData || !hintData.text) {
    const availableIds = clueSections.flatMap((s) =>
      (s.items || []).map((item) => item.id).filter(Boolean),
    )
    return { error: `Hint "${hintId}" not found`, available_hint_ids: availableIds }
  }

  if (hintData.locked) {
    return {
      locked: true,
      hint_id: hintId,
      message: "This hint is locked because it would reveal the answer",
    }
  }

  if ((state.hintCredits || 0) < DEFAULT_HINT_COST) {
    return {
      error: "Not enough hint credits",
      hint_credits: state.hintCredits,
      cost: DEFAULT_HINT_COST,
      message: "Make a guess to earn hint credits",
    }
  }

  state.revealedHints.push(hintId)
  state.hintCredits = Math.max(0, (state.hintCredits || 0) - DEFAULT_HINT_COST)

  return {
    hint_id: hintId,
    text: hintData.text,
    hint_credits_remaining: state.hintCredits,
    hints_revealed: state.revealedHints.length,
  }
}

// ---------------------------------------------------------------------------
// Action: get_clues — get the current masked clue state
// ---------------------------------------------------------------------------

async function executeGetClues(db, state) {
  const targetProtein = await fetchProteinByUniprot(db, state.targetUniprot)
  if (!targetProtein) {
    return { error: "Target protein unavailable (internal error)" }
  }

  const clueSections = buildClueSections(targetProtein)
  const maskedClues = maskClueSections(clueSections, new Set(state.revealedHints))

  return {
    clues: maskedClues,
    hint_credits: state.hintCredits,
    hints_revealed: state.revealedHints.length,
    guesses_used: state.guessCount,
    guesses_remaining: MAX_GUESSES - state.guessCount,
    won: state.won,
  }
}

// ---------------------------------------------------------------------------
// Route: GET /sessions/:id — get session state + action history
// ---------------------------------------------------------------------------

async function handleGetSession(request, db, auth, sessionId) {
  const session = await db
    .prepare("SELECT * FROM benchmark_sessions WHERE id = ?")
    .bind(sessionId)
    .first()

  if (!session) return jsonResponse({ error: "Session not found" }, 404, request)
  if (session.api_key_hash !== auth.keyHash) {
    return jsonResponse({ error: "Session belongs to a different API key" }, 403, request)
  }

  const state = parseState(session.state)

  // Build current clues if session has state
  let clues = null
  if (state?.targetUniprot) {
    try {
      const targetProtein = await fetchProteinByUniprot(db, state.targetUniprot)
      if (targetProtein) {
        const clueSections = buildClueSections(targetProtein)
        clues = maskClueSections(clueSections, new Set(state?.revealedHints || []))
      }
    } catch {
      // Non-fatal
    }
  }

  const actions = await db
    .prepare(
      "SELECT action_seq, action, payload, result, latency_ms, created_at FROM benchmark_actions WHERE session_id = ? ORDER BY action_seq",
    )
    .bind(sessionId)
    .all()

  // Only reveal target protein_id after session is completed or expired.
  // During active play, showing it would let the agent cheat.
  const isFinished = session.status !== "active"

  return jsonResponse(
    {
      session: {
        id: session.id,
        status: session.status,
        protein_id: isFinished ? session.protein_id : undefined,
        corpus_version: session.corpus_version,
        action_count: session.action_count,
        hints_used: session.hints_used,
        final_score: session.final_score,
        exact_match: session.exact_match,
        started_at: session.started_at,
        ended_at: session.ended_at,
        checksum: session.checksum,
      },
      game_state: state
        ? {
            guesses_used: state.guessCount,
            guesses_remaining: MAX_GUESSES - (state.guessCount || 0),
            hint_credits: state.hintCredits,
            hints_revealed: (state.revealedHints || []).length,
            won: state.won,
            guesses: state.guesses,
          }
        : null,
      clues,
      actions: (actions?.results || []).map((a) => ({
        ...a,
        payload: JSON.parse(a.payload || "{}"),
        result: JSON.parse(a.result || "null"),
      })),
    },
    200,
    request,
  )
}

// ---------------------------------------------------------------------------
// Route: POST /sessions/:id/end — finalize session
// ---------------------------------------------------------------------------

async function handleEndSession(request, db, auth, sessionId) {
  const session = await db
    .prepare("SELECT id, api_key_hash, status, state FROM benchmark_sessions WHERE id = ?")
    .bind(sessionId)
    .first()

  if (!session) return jsonResponse({ error: "Session not found" }, 404, request)
  if (session.api_key_hash !== auth.keyHash) {
    return jsonResponse({ error: "Session belongs to a different API key" }, 403, request)
  }
  if (session.status !== "active") {
    return jsonResponse({ error: `Session is already ${session.status}` }, 409, request)
  }

  const state = parseState(session.state)

  // Compute checksum over all actions
  const actions = await db
    .prepare(
      "SELECT action_seq, action, payload FROM benchmark_actions WHERE session_id = ? ORDER BY action_seq",
    )
    .bind(sessionId)
    .all()

  const checksumInput = (actions?.results || [])
    .map((a) => `${a.action_seq}:${a.action}:${a.payload}`)
    .join("|")

  const checksumBuffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(checksumInput),
  )
  const checksum = Array.from(new Uint8Array(checksumBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")

  const won = state?.won || false
  const guessCount = state?.guessCount || 0
  const hintsUsed = (state?.revealedHints || []).length

  // Score = max similarity achieved across all guesses, as a 0-1 float.
  // Correct guess = 100% similarity = 1.0. Never guessed = 0.0.
  const similarities = (state?.guesses || []).map((g) => g.similarity ?? 0)
  let finalScore = similarities.length ? Math.max(...similarities) / 100 : 0
  finalScore = Math.round(finalScore * 1000) / 1000

  await db
    .prepare(
      `UPDATE benchmark_sessions
       SET status = 'completed', ended_at = datetime('now'),
           checksum = ?, final_score = ?, exact_match = ?, hints_used = ?
       WHERE id = ?`,
    )
    .bind(checksum, finalScore, won ? 1 : 0, hintsUsed, sessionId)
    .run()

  const response = {
    session_id: sessionId,
    status: "completed",
    checksum,
    action_count: (actions?.results || []).length,
    final_score: finalScore,
    exact_match: won,
    guesses_used: guessCount,
    hints_used: hintsUsed,
  }

  if (state?.targetUniprot) {
    response.target = {
      uniprot: state.targetUniprot,
      gene: state.targetGene,
    }
  }

  return jsonResponse(response, 200, request)
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    if (method === "OPTIONS") {
      return handleOptions(request)
    }

    if (path === "/health" && method === "GET") {
      return handleHealth(request, env.DB)
    }

    const auth = await verifyApiKey(request, env.DB)
    if (!auth.ok) {
      return jsonResponse({ error: auth.message }, auth.status, request)
    }

    if (path === "/sessions" && method === "POST") {
      return handleCreateSession(request, env.DB, auth)
    }

    if (path === "/actions" && method === "POST") {
      return handleAction(request, env.DB, auth)
    }

    const sessionMatch = path.match(/^\/sessions\/([a-z0-9_]+)$/)
    if (sessionMatch && method === "GET") {
      return handleGetSession(request, env.DB, auth, sessionMatch[1])
    }

    const endMatch = path.match(/^\/sessions\/([a-z0-9_]+)\/end$/)
    if (endMatch && method === "POST") {
      return handleEndSession(request, env.DB, auth, endMatch[1])
    }

    return jsonResponse({ error: "Not found" }, 404, request)
  },
}
