/**
 * Stats API endpoints for GeneGuessr
 * Handles migration from localStorage and server-side stats tracking
 */

import { parseCookies } from "./auth.js"

const LEADERBOARD_DEFAULT_LIMIT = 5
const LEADERBOARD_MAX_LIMIT = 25

const MS_PER_DAY = 24 * 60 * 60 * 1000

function parseLeaderboardLimit(raw, fallback = LEADERBOARD_DEFAULT_LIMIT) {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(1, Math.min(parsed, LEADERBOARD_MAX_LIMIT))
}

function parseLeaderboardOptInValue(value) {
  if (value === true || value === 1 || value === "1" || value === "true") return 1
  if (value === false || value === 0 || value === "0" || value === "false") return 0
  return null
}

function sanitizeDiscordAvatarUrl(raw) {
  const value = String(raw || "").trim()
  if (!value) return null
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:") return null
    if (parsed.hostname !== "cdn.discordapp.com") return null
    return parsed.toString()
  } catch {
    return null
  }
}

function parseUtcDateOnly(value) {
  const raw = String(value || "").trim()
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  return Date.UTC(year, month - 1, day)
}

function getUtcDateGapDays(fromDate, toDate) {
  const fromTs = parseUtcDateOnly(fromDate)
  const toTs = parseUtcDateOnly(toDate)
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) return null
  return Math.floor((toTs - fromTs) / MS_PER_DAY)
}

function getEffectiveCurrentStreak(currentStreak, lastPlayedDate, today) {
  const streak = Math.max(0, Number.parseInt(currentStreak, 10) || 0)
  if (streak === 0) return 0
  const gapDays = getUtcDateGapDays(lastPlayedDate, today)
  if (!Number.isFinite(gapDays)) return streak
  // If the user has not played for at least one full missed day, streak is broken.
  if (gapDays > 1) return 0
  return streak
}

async function requireAuthenticatedSession(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "")
  const sessionId = cookies.session
  if (!sessionId) {
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) }
  }

  const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`)
  const sessionStub = env.GAME_SESSIONS.get(id)
  const sessionResp = await sessionStub.fetch("http://internal/get")
  const session = await sessionResp.json()
  if (!session || !session.user_id) {
    return { ok: false, response: Response.json({ error: "Invalid session" }, { status: 401 }) }
  }

  return {
    ok: true,
    cookies,
    sessionId,
    session,
    sessionStub,
    userId: session.user_id,
  }
}

function getGuestSessionTokenFromCookies(cookies) {
  const token = cookies.geneguessr_session
  if (!token) return null
  // Keep in sync with resolveSessionCookie() regex in workers/index.js
  if (!/^[a-zA-Z0-9_-]+$/.test(token)) return null
  return token
}

async function loadGameState(env, sessionId) {
  const id = env.GAME_SESSIONS.idFromName(sessionId)
  const stub = env.GAME_SESSIONS.get(id)
  const resp = await stub.fetch("https://sessions/game/state", { method: "GET" })
  if (!resp.ok) return null
  return await resp.json()
}

function validateDailyCompletedState(state) {
  if (!state || typeof state !== "object") return { ok: false, reason: "no_state" }
  if (state.practiceMode) return { ok: false, reason: "practice_mode" }
  const today = new Date().toISOString().split("T")[0]
  if (state.date !== today) return { ok: false, reason: "wrong_day" }
  const guesses = Array.isArray(state.guesses) ? state.guesses : []
  const completed = Boolean(state.won) || guesses.length >= 10
  if (!completed) return { ok: false, reason: "not_completed" }
  return { ok: true, today, won: Boolean(state.won), statsRecorded: Boolean(state.statsRecorded) }
}

async function tryLoadAuthoritativeDailyResultForUser(env, userId) {
  const sessionId = `user_${userId}`
  let state
  try {
    state = await loadGameState(env, sessionId)
  } catch {
    state = null
  }
  const validation = validateDailyCompletedState(state)
  if (!validation.ok) {
    return { ok: false, reason: validation.reason }
  }
  return {
    ok: true,
    won: validation.won,
    statsRecorded: validation.statsRecorded,
    sessionId,
    state,
    today: validation.today,
  }
}

async function tryLoadAuthoritativeDailyResultFromGuest(env, cookies) {
  const token = getGuestSessionTokenFromCookies(cookies)
  if (!token) {
    return { ok: false, reason: "missing_cookie" }
  }
  const sessionId = `guest_${token}`
  let state
  try {
    state = await loadGameState(env, sessionId)
  } catch {
    state = null
  }
  const validation = validateDailyCompletedState(state)
  if (!validation.ok) {
    return { ok: false, reason: validation.reason }
  }
  return {
    ok: true,
    won: validation.won,
    statsRecorded: validation.statsRecorded,
    sessionId,
    state,
    today: validation.today,
  }
}

/**
 * POST /api/migrate-stats
 * Migrate localStorage stats to D1 (one-time operation)
 */
export async function handleMigrateStats(request, env) {
  const auth = await requireAuthenticatedSession(request, env)
  if (!auth.ok) {
    return auth.response
  }
  const userId = auth.userId

  // Check if already migrated
  const existing = await env.DB.prepare(
    `
    SELECT migrated_at FROM stats WHERE user_id = ?
  `,
  )
    .bind(userId)
    .first()

  if (existing && existing.migrated_at) {
    return Response.json(
      {
        success: false,
        message: "Stats already migrated",
        migrated_at: existing.migrated_at,
      },
      { status: 400 },
    )
  }

  // Parse submitted stats
  let stats
  try {
    stats = await request.json()
  } catch (err) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Validate stats structure
  const played = parseInt(stats.played) || 0
  const won = parseInt(stats.won) || 0
  const currentStreak = parseInt(stats.currentStreak) || 0
  const maxStreak = parseInt(stats.maxStreak) || 0

  if (played < 0 || won < 0 || won > played || currentStreak < 0 || maxStreak < 0) {
    return Response.json({ error: "Invalid stats values" }, { status: 400 })
  }

  const now = Date.now()
  const today = new Date().toISOString().split("T")[0]

  // Insert or update stats with migration timestamp
  await env.DB.prepare(
    `
    INSERT INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date, migrated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      total_played = excluded.total_played,
      total_wins = excluded.total_wins,
      current_streak = excluded.current_streak,
      best_streak = excluded.best_streak,
      migrated_at = excluded.migrated_at
  `,
  )
    .bind(userId, played, won, currentStreak, maxStreak, today, now)
    .run()

  return Response.json({
    success: true,
    message: "Stats migrated successfully",
    stats: { played, won, currentStreak, maxStreak },
  })
}

/**
 * GET /api/stats
 * Get current user stats from D1
 */
export async function handleGetStats(request, env) {
  const auth = await requireAuthenticatedSession(request, env)
  if (!auth.ok) {
    return auth.response
  }
  const userId = auth.userId

  // Fetch stats from D1
  const stats = await env.DB.prepare(
    `
    SELECT total_played, total_wins, current_streak, best_streak, last_played_date, migrated_at
    FROM stats WHERE user_id = ?
  `,
  )
    .bind(userId)
    .first()

  if (!stats) {
    // Return empty stats if user hasn't played yet
    return Response.json({
      played: 0,
      won: 0,
      winRate: 0,
      currentStreak: 0,
      maxStreak: 0,
      lastPlayedDate: null,
      migratedAt: null,
    })
  }

  const winRate = stats.total_played > 0 ? stats.total_wins / stats.total_played : 0
  const today = new Date().toISOString().split("T")[0]
  const effectiveCurrentStreak = getEffectiveCurrentStreak(
    stats.current_streak,
    stats.last_played_date,
    today,
  )

  return Response.json({
    played: stats.total_played,
    won: stats.total_wins,
    winRate: winRate,
    currentStreak: effectiveCurrentStreak,
    maxStreak: stats.best_streak,
    lastPlayedDate: stats.last_played_date,
    migratedAt: stats.migrated_at,
  })
}

/**
 * POST /api/stats/update
 * Update stats after game completion
 */
export async function handleUpdateStats(request, env) {
  const auth = await requireAuthenticatedSession(request, env)
  if (!auth.ok) {
    return auth.response
  }
  const userId = auth.userId
  const cookies = auth.cookies

  // Parse update payload (kept for backwards compatibility; we prefer server-derived result).
  let payload
  try {
    payload = await request.json()
  } catch (err) {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Prefer the authenticated user session. If missing (e.g., user played as guest then logged in),
  // migrate same-day completed state from the guest session once.
  let authoritative = await tryLoadAuthoritativeDailyResultForUser(env, userId)
  if (!authoritative.ok) {
    const guest = await tryLoadAuthoritativeDailyResultFromGuest(env, cookies)
    if (guest.ok) {
      try {
        const userSessionId = `user_${userId}`
        const doId = env.GAME_SESSIONS.idFromName(userSessionId)
        const userStub = env.GAME_SESSIONS.get(doId)
        await userStub.fetch("https://sessions/game/state", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...guest.state,
            statsRecorded: Boolean(guest.state?.statsRecorded),
          }),
        })
      } catch {
        // If migration fails, we can still proceed based on guest state.
      }
      authoritative = {
        ...guest,
        sessionId: `user_${userId}`,
      }
    }
  }
  if (!authoritative.ok) {
    const status = authoritative.reason === "not_completed" ? 409 : 400
    return Response.json(
      {
        error: "Unable to validate completed daily game session",
        reason: authoritative.reason,
      },
      { status },
    )
  }

  const today = authoritative.today
  const won = authoritative.won

  // Fetch current stats
  const current = await env.DB.prepare(
    `
    SELECT total_played, total_wins, current_streak, best_streak
         , last_played_date
    FROM stats WHERE user_id = ?
  `,
  )
    .bind(userId)
    .first()

  let played = current ? current.total_played : 0
  let wins = current ? current.total_wins : 0
  let currentStreak = current ? current.current_streak : 0
  let bestStreak = current ? current.best_streak : 0

  // Break streak if one or more full days were missed since last played date.
  if (current?.last_played_date) {
    const gapDays = getUtcDateGapDays(current.last_played_date, today)
    if (Number.isFinite(gapDays) && gapDays > 1) {
      currentStreak = 0
    }
  }

  // Idempotence guard: allow at most one stats record per user per day.
  if (current?.last_played_date === today) {
    const winRate = played > 0 ? wins / played : 0
    return Response.json({
      success: true,
      alreadyRecorded: true,
      stats: {
        played,
        won: wins,
        winRate,
        currentStreak,
        maxStreak: bestStreak,
      },
    })
  }

  // If we have authoritative game state and it says we already recorded stats, also treat as idempotent.
  if (authoritative.ok && authoritative.statsRecorded) {
    const winRate = played > 0 ? wins / played : 0
    return Response.json({
      success: true,
      alreadyRecorded: true,
      stats: {
        played,
        won: wins,
        winRate,
        currentStreak,
        maxStreak: bestStreak,
      },
    })
  }

  // Update stats
  played++
  if (won) {
    wins++
    currentStreak++
    bestStreak = Math.max(bestStreak, currentStreak)
  } else {
    currentStreak = 0
  }

  // Save to D1
  await env.DB.prepare(
    `
    INSERT INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      total_played = excluded.total_played,
      total_wins = excluded.total_wins,
      current_streak = excluded.current_streak,
      best_streak = excluded.best_streak,
      last_played_date = excluded.last_played_date
  `,
  )
    .bind(userId, played, wins, currentStreak, bestStreak, today)
    .run()

  // Mark the daily game session as having recorded stats, to prevent repeat submissions.
  if (authoritative.sessionId && authoritative.state) {
    try {
      const updatedState = { ...authoritative.state, statsRecorded: true }
      const doId = env.GAME_SESSIONS.idFromName(authoritative.sessionId)
      const stub = env.GAME_SESSIONS.get(doId)
      await stub.fetch("https://sessions/game/state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedState),
      })
    } catch {
      // Non-fatal: D1 is the source of truth for user stats.
    }
  }

  const winRate = played > 0 ? wins / played : 0

  return Response.json({
    success: true,
    stats: {
      played,
      won: wins,
      winRate,
      currentStreak,
      maxStreak: bestStreak,
    },
  })
}

/**
 * GET /api/stats/leaderboard?limit=5
 * Public current streak leaderboard (opt-in users only).
 */
export async function handleGetLeaderboard(request, env) {
  try {
    const url = new URL(request.url)
    const limit = parseLeaderboardLimit(url.searchParams.get("limit"))

    const query = await env.DB.prepare(
      `
      SELECT
        users.discord_id AS user_id,
        users.username AS username,
        users.avatar_url AS avatar_url,
        stats.current_streak AS current_streak,
        stats.total_wins AS total_wins,
        stats.last_played_date AS last_played_date
      FROM stats
      INNER JOIN users ON users.discord_id = stats.user_id
      WHERE COALESCE(users.leaderboard_opt_in, 0) = 1
        AND COALESCE(stats.current_streak, 0) > 0
        AND date(stats.last_played_date) >= date('now', '-1 day')
      ORDER BY
        stats.current_streak DESC,
        stats.total_wins DESC,
        COALESCE(stats.last_played_date, '9999-12-31') ASC,
        users.discord_id ASC
      LIMIT ?
    `,
    )
      .bind(limit)
      .all()

    const rows = Array.isArray(query?.results) ? query.results : []
    const entries = rows.map((row, idx) => ({
      rank: idx + 1,
      username: String(row?.username || "Player"),
      avatarUrl: sanitizeDiscordAvatarUrl(row?.avatar_url),
      currentStreak: Math.max(0, Number.parseInt(row?.current_streak, 10) || 0),
    }))

    return Response.json({ entries })
  } catch (err) {
    console.error("Error in handleGetLeaderboard:", err)
    return Response.json({ error: "Failed to load leaderboard" }, { status: 500 })
  }
}

/**
 * POST /api/stats/leaderboard-visibility
 * Update whether the authenticated user appears on the public leaderboard.
 */
export async function handleSetLeaderboardVisibility(request, env) {
  const auth = await requireAuthenticatedSession(request, env)
  if (!auth.ok) {
    return auth.response
  }

  let body
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = parseLeaderboardOptInValue(body?.optIn)
  if (parsed == null) {
    return Response.json({ error: "optIn must be a boolean" }, { status: 400 })
  }

  try {
    await env.DB.prepare(
      `
      UPDATE users
      SET leaderboard_opt_in = ?, updated_at = ?
      WHERE discord_id = ?
    `,
    )
      .bind(parsed, Date.now(), auth.userId)
      .run()

    try {
      const updatedSession = {
        ...auth.session,
        leaderboard_opt_in: parsed === 1,
      }
      await auth.sessionStub.fetch(
        new Request("http://internal/store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updatedSession),
        }),
      )
    } catch (sessionErr) {
      console.warn("Failed to update session leaderboard visibility cache:", sessionErr)
    }

    return Response.json({
      success: true,
      leaderboardOptIn: parsed === 1,
    })
  } catch (err) {
    console.error("Error in handleSetLeaderboardVisibility:", err)
    return Response.json({ error: "Failed to update leaderboard visibility" }, { status: 500 })
  }
}
