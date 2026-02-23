/**
 * GeneGuessr Benchmark API Worker
 *
 * Handles benchmark session lifecycle and action logging.
 * Shares D1 with the main geneguessr-api Worker but runs independently.
 *
 * Endpoints:
 *   GET  /health          — connectivity check (no auth)
 *   POST /sessions        — create a benchmark session
 *   POST /actions         — log a benchmark action
 *   GET  /sessions/:id    — get session state
 *   POST /sessions/:id/end — end a session, compute final scores
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_ACTIONS_PER_SESSION = 30
const SESSION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const CORS_ORIGIN = "https://benchmark.geneguessr.brinedew.bio"
const JSON_HEADERS = { "Content-Type": "application/json" }

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/**
 * Extract Bearer token from Authorization header, SHA-256 hash it,
 * and look up the hash in benchmark_api_keys.
 * Returns { ok: true, keyHash, name } or { ok: false, status, message }.
 */
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

  if (!row) {
    return { ok: false, status: 401, message: "Invalid API key" }
  }
  if (!row.active) {
    return { ok: false, status: 403, message: "API key is deactivated" }
  }

  return { ok: true, keyHash: row.key_hash, name: row.name }
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || ""
  // Allow the benchmark subdomain and localhost for dev
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
// Route: GET /health
// ---------------------------------------------------------------------------

async function handleHealth(request, db) {
  try {
    const result = await db.prepare("SELECT 1 as ok").first()
    if (!result?.ok) throw new Error("D1 ping failed")

    // Check benchmark tables exist
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
// Route: POST /sessions
// ---------------------------------------------------------------------------

async function handleCreateSession(request, db, auth) {
  const body = await safeJson(request)

  const sessionId = generateId("bench")
  const corpusVersion = body?.corpus_version || "v0"

  await db
    .prepare(
      `INSERT INTO benchmark_sessions (id, api_key_hash, status, corpus_version)
       VALUES (?, ?, 'active', ?)`,
    )
    .bind(sessionId, auth.keyHash, corpusVersion)
    .run()

  return jsonResponse(
    {
      session_id: sessionId,
      status: "active",
      corpus_version: corpusVersion,
      max_actions: MAX_ACTIONS_PER_SESSION,
      timeout_ms: SESSION_TIMEOUT_MS,
    },
    201,
    request,
  )
}

// ---------------------------------------------------------------------------
// Route: POST /actions
// ---------------------------------------------------------------------------

async function handleLogAction(request, db, auth) {
  const body = await safeJson(request)
  if (!body) {
    return jsonResponse({ error: "Invalid JSON body" }, 400, request)
  }

  const { session_id, action, payload } = body
  if (!session_id || !action) {
    return jsonResponse({ error: "Missing session_id or action" }, 400, request)
  }

  // Verify session exists and belongs to this API key
  const session = await db
    .prepare(
      "SELECT id, api_key_hash, status, action_count, started_at FROM benchmark_sessions WHERE id = ?",
    )
    .bind(session_id)
    .first()

  if (!session) {
    return jsonResponse({ error: "Session not found" }, 404, request)
  }
  if (session.api_key_hash !== auth.keyHash) {
    return jsonResponse({ error: "Session belongs to a different API key" }, 403, request)
  }
  if (session.status !== "active") {
    return jsonResponse({ error: `Session is ${session.status}, not active` }, 409, request)
  }

  // Check action budget
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

  // Check session timeout
  const elapsed = Date.now() - new Date(session.started_at + "Z").getTime()
  if (elapsed > SESSION_TIMEOUT_MS) {
    // Auto-close expired session
    await db
      .prepare(
        "UPDATE benchmark_sessions SET status = 'expired', ended_at = datetime('now') WHERE id = ?",
      )
      .bind(session_id)
      .run()

    return jsonResponse(
      { error: "Session expired", session_id, elapsed_ms: elapsed },
      410,
      request,
    )
  }

  const actionSeq = session.action_count + 1
  const startTime = Date.now()

  // For now, we only log. Game logic (executing the action) comes in Phase 1.
  // The result will be populated once we wire up game-engine imports.
  const result = { logged: true, note: "Action logging only (Phase 0). Game logic not yet wired." }

  const latencyMs = Date.now() - startTime

  // Write action log and update session in a batch
  await db.batch([
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
      .prepare("UPDATE benchmark_sessions SET action_count = ? WHERE id = ?")
      .bind(actionSeq, session_id),
  ])

  return jsonResponse(
    {
      session_id,
      action_seq: actionSeq,
      action,
      result,
      latency_ms: latencyMs,
      remaining_actions: MAX_ACTIONS_PER_SESSION - actionSeq,
    },
    200,
    request,
  )
}

// ---------------------------------------------------------------------------
// Route: GET /sessions/:id
// ---------------------------------------------------------------------------

async function handleGetSession(request, db, auth, sessionId) {
  const session = await db
    .prepare("SELECT * FROM benchmark_sessions WHERE id = ?")
    .bind(sessionId)
    .first()

  if (!session) {
    return jsonResponse({ error: "Session not found" }, 404, request)
  }
  if (session.api_key_hash !== auth.keyHash) {
    return jsonResponse({ error: "Session belongs to a different API key" }, 403, request)
  }

  const actions = await db
    .prepare(
      "SELECT action_seq, action, payload, result, latency_ms, created_at FROM benchmark_actions WHERE session_id = ? ORDER BY action_seq",
    )
    .bind(sessionId)
    .all()

  return jsonResponse(
    {
      session: {
        id: session.id,
        status: session.status,
        protein_id: session.protein_id,
        corpus_version: session.corpus_version,
        action_count: session.action_count,
        hints_used: session.hints_used,
        final_score: session.final_score,
        exact_match: session.exact_match,
        started_at: session.started_at,
        ended_at: session.ended_at,
        checksum: session.checksum,
      },
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
// Route: POST /sessions/:id/end
// ---------------------------------------------------------------------------

async function handleEndSession(request, db, auth, sessionId) {
  const session = await db
    .prepare("SELECT id, api_key_hash, status FROM benchmark_sessions WHERE id = ?")
    .bind(sessionId)
    .first()

  if (!session) {
    return jsonResponse({ error: "Session not found" }, 404, request)
  }
  if (session.api_key_hash !== auth.keyHash) {
    return jsonResponse({ error: "Session belongs to a different API key" }, 403, request)
  }
  if (session.status !== "active") {
    return jsonResponse({ error: `Session is already ${session.status}` }, 409, request)
  }

  // Compute checksum over all actions for reproducibility
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

  await db
    .prepare(
      `UPDATE benchmark_sessions
       SET status = 'completed', ended_at = datetime('now'), checksum = ?
       WHERE id = ?`,
    )
    .bind(checksum, sessionId)
    .run()

  return jsonResponse(
    {
      session_id: sessionId,
      status: "completed",
      checksum,
      action_count: (actions?.results || []).length,
    },
    200,
    request,
  )
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    const path = url.pathname
    const method = request.method

    // CORS preflight
    if (method === "OPTIONS") {
      return handleOptions(request)
    }

    // Health check — no auth required
    if (path === "/health" && method === "GET") {
      return handleHealth(request, env.DB)
    }

    // Everything below requires auth
    const auth = await verifyApiKey(request, env.DB)
    if (!auth.ok) {
      return jsonResponse({ error: auth.message }, auth.status, request)
    }

    // POST /sessions — create a new benchmark session
    if (path === "/sessions" && method === "POST") {
      return handleCreateSession(request, env.DB, auth)
    }

    // POST /actions — log a benchmark action
    if (path === "/actions" && method === "POST") {
      return handleLogAction(request, env.DB, auth)
    }

    // GET /sessions/:id — get session state + action history
    const sessionMatch = path.match(/^\/sessions\/([a-z0-9_]+)$/)
    if (sessionMatch && method === "GET") {
      return handleGetSession(request, env.DB, auth, sessionMatch[1])
    }

    // POST /sessions/:id/end — close a session
    const endMatch = path.match(/^\/sessions\/([a-z0-9_]+)\/end$/)
    if (endMatch && method === "POST") {
      return handleEndSession(request, env.DB, auth, endMatch[1])
    }

    return jsonResponse({ error: "Not found" }, 404, request)
  },
}
