/**
 * Stats API endpoints for GeneGuessr
 * Handles migration from localStorage and server-side stats tracking
 */

import { resolveAuthenticatedSession } from "./auth.js"
import { buildAvatarProxyPath } from "./lib/avatar-proxy.js"
import { withObservedGameSessionWrite } from "./lib/game-session-write-evidence.js"

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
  const resolved = await resolveAuthenticatedSession(request, env)
  if (!resolved.ok) return resolved
  return { ...resolved, sessionStub: resolved.stub, userId: resolved.session.user_id }
}

// THE ONLY projection from a player's durable completed rounds to D1 stats.
// Each date is applied with one conditional SQLite upsert. If D1 refuses it,
// the result stays in the existing GameSession object for the next page visit.
async function reconcileCompletedResults(env, userId) {
  const id = env.GAME_SESSIONS.idFromName(`user_${userId}`)
  const stub = env.GAME_SESSIONS.get(id)
  let pending
  try {
    const response = await stub.fetch("https://sessions/game/results")
    if (!response.ok) throw new Error("Completed game results unavailable")
    pending = await response.json()
    if (!Array.isArray(pending)) throw new Error("Invalid completed game results")
  } catch {
    return { pendingResults: null, syncFailed: true, applied: 0 }
  }

  let remaining = pending.length
  let syncFailed = false
  let applied = 0
  for (const result of [...pending].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(result?.date || "") || typeof result.won !== "boolean") {
      syncFailed = true
      break
    }
    const won = Number(result.won)
    try {
      await env.DB.prepare(
        `
        INSERT INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date)
        VALUES (?, 1, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          total_played = stats.total_played + 1,
          total_wins = stats.total_wins + excluded.total_wins,
          current_streak = CASE
            WHEN excluded.total_wins = 0 THEN 0
            WHEN stats.last_played_date = date(excluded.last_played_date, '-1 day') THEN stats.current_streak + 1
            ELSE 1 END,
          best_streak = MAX(stats.best_streak, CASE
            WHEN excluded.total_wins = 0 THEN 0
            WHEN stats.last_played_date = date(excluded.last_played_date, '-1 day') THEN stats.current_streak + 1
            ELSE 1 END),
          last_played_date = excluded.last_played_date
        WHERE stats.last_played_date IS NULL OR stats.last_played_date < excluded.last_played_date
      `,
      )
        .bind(userId, won, won, won, result.date)
        .run()
      applied++
    } catch {
      syncFailed = true
      break
    }
    try {
      const ack = await stub.fetch("https://sessions/game/results/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: result.date }),
      })
      if (!ack.ok) throw new Error("Completed game acknowledgement failed")
      remaining--
    } catch {
      // The conditional upsert makes a later acknowledgement retry safe.
      syncFailed = true
    }
  }
  return { pendingResults: remaining, syncFailed, applied }
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
    SELECT migrated_at, total_played FROM stats WHERE user_id = ?
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
  if (Number(existing?.total_played || 0) > 0) {
    return Response.json(
      { error: "This account already has saved games; importing local totals would replace them." },
      { status: 409 },
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
  const result = await env.DB.prepare(
    `
    INSERT INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date, migrated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      total_played = excluded.total_played,
      total_wins = excluded.total_wins,
      current_streak = excluded.current_streak,
      best_streak = excluded.best_streak,
      migrated_at = excluded.migrated_at
    WHERE stats.total_played = 0 AND stats.migrated_at IS NULL
  `,
  )
    .bind(userId, played, won, currentStreak, maxStreak, today, now)
    .run()

  if (Number(result?.meta?.changes) !== 1) {
    return Response.json(
      { error: "This account already has saved games; local totals were kept on this device." },
      { status: 409 },
    )
  }

  return Response.json({
    success: true,
    message: "Stats migrated successfully",
    stats: { played, won, currentStreak, maxStreak },
  })
}

async function readAccountStats(env, userId) {
  const stats = await env.DB.prepare(
    `
    SELECT total_played, total_wins, current_streak, best_streak, last_played_date, migrated_at
    FROM stats WHERE user_id = ?
  `,
  )
    .bind(userId)
    .first()

  if (!stats) {
    return {
      played: 0,
      won: 0,
      winRate: 0,
      currentStreak: 0,
      maxStreak: 0,
      lastPlayedDate: null,
      migratedAt: null,
    }
  }

  const winRate = stats.total_played > 0 ? stats.total_wins / stats.total_played : 0
  const today = new Date().toISOString().split("T")[0]
  const effectiveCurrentStreak = getEffectiveCurrentStreak(
    stats.current_streak,
    stats.last_played_date,
    today,
  )

  return {
    played: stats.total_played,
    won: stats.total_wins,
    winRate,
    currentStreak: effectiveCurrentStreak,
    maxStreak: stats.best_streak,
    lastPlayedDate: stats.last_played_date,
    migratedAt: stats.migrated_at,
  }
}

/** GET /api/stats: recover saved rounds first, then show the account's actual totals. */
export async function handleGetStats(request, env) {
  const auth = await requireAuthenticatedSession(request, env)
  if (!auth.ok) return auth.response
  const sync = await reconcileCompletedResults(env, auth.userId)
  const stats = await readAccountStats(env, auth.userId)
  return Response.json({ ...stats, pendingResults: sync.pendingResults })
}

/**
 * POST /api/stats/update
 * Update stats after game completion
 */
export async function handleUpdateStats(request, env) {
  const auth = await requireAuthenticatedSession(request, env)
  if (!auth.ok) return auth.response

  // The client may still send { won }, but only the completed result saved by
  // the game's own session is allowed to change account statistics.
  const sync = await reconcileCompletedResults(env, auth.userId)
  const stats = await readAccountStats(env, auth.userId)
  return Response.json(
    {
      success: !sync.syncFailed,
      saved: sync.pendingResults !== null,
      alreadyRecorded: sync.applied === 0 && !sync.syncFailed,
      pendingResults: sync.pendingResults,
      stats,
    },
    { status: sync.syncFailed ? 202 : 200 },
  )
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
      avatarUrl: buildAvatarProxyPath(row?.avatar_url),
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
      await withObservedGameSessionWrite(
        env,
        {
          operation: "leaderboard_visibility_session_cache",
          requestPath: "/api/stats/leaderboard-visibility",
          sessionId: `session:${auth.sessionId}`,
        },
        async () => {
          await auth.sessionStub.fetch(
            new Request("http://internal/store", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(updatedSession),
            }),
          )
        },
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
