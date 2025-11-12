/**
 * Stats API endpoints for GeneGuessr
 * Handles migration from localStorage and server-side stats tracking
 */

import { parseCookies } from './auth.js';

/**
 * POST /api/migrate-stats
 * Migrate localStorage stats to D1 (one-time operation)
 */
export async function handleMigrateStats(request, env) {
  // Require authentication
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionId = cookies.session;
  
  if (!sessionId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Get user from session
  const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`);
  const stub = env.GAME_SESSIONS.get(id);
  const sessionResp = await stub.fetch('http://internal/get');
  const session = await sessionResp.json();
  
  if (!session || !session.user_id) {
    return Response.json({ error: 'Invalid session' }, { status: 401 });
  }
  
  const userId = session.user_id;
  
  // Check if already migrated
  const existing = await env.DB.prepare(`
    SELECT migrated_at FROM stats WHERE user_id = ?
  `).bind(userId).first();
  
  if (existing && existing.migrated_at) {
    return Response.json({ 
      success: false, 
      message: 'Stats already migrated',
      migrated_at: existing.migrated_at 
    }, { status: 400 });
  }
  
  // Parse submitted stats
  let stats;
  try {
    stats = await request.json();
  } catch (err) {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  
  // Validate stats structure
  const played = parseInt(stats.played) || 0;
  const won = parseInt(stats.won) || 0;
  const currentStreak = parseInt(stats.currentStreak) || 0;
  const maxStreak = parseInt(stats.maxStreak) || 0;
  
  if (played < 0 || won < 0 || won > played || currentStreak < 0 || maxStreak < 0) {
    return Response.json({ error: 'Invalid stats values' }, { status: 400 });
  }
  
  const now = Date.now();
  const today = new Date().toISOString().split('T')[0];
  
  // Insert or update stats with migration timestamp
  await env.DB.prepare(`
    INSERT INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date, migrated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      total_played = excluded.total_played,
      total_wins = excluded.total_wins,
      current_streak = excluded.current_streak,
      best_streak = excluded.best_streak,
      migrated_at = excluded.migrated_at
  `).bind(userId, played, won, currentStreak, maxStreak, today, now).run();
  
  return Response.json({ 
    success: true,
    message: 'Stats migrated successfully',
    stats: { played, won, currentStreak, maxStreak }
  });
}

/**
 * GET /api/stats
 * Get current user stats from D1
 */
export async function handleGetStats(request, env) {
  // Require authentication
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionId = cookies.session;
  
  if (!sessionId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Get user from session
  const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`);
  const stub = env.GAME_SESSIONS.get(id);
  const sessionResp = await stub.fetch('http://internal/get');
  const session = await sessionResp.json();
  
  if (!session || !session.user_id) {
    return Response.json({ error: 'Invalid session' }, { status: 401 });
  }
  
  const userId = session.user_id;
  
  // Fetch stats from D1
  const stats = await env.DB.prepare(`
    SELECT total_played, total_wins, current_streak, best_streak, last_played_date, migrated_at
    FROM stats WHERE user_id = ?
  `).bind(userId).first();
  
  if (!stats) {
    // Return empty stats if user hasn't played yet
    return Response.json({
      played: 0,
      won: 0,
      winRate: 0,
      currentStreak: 0,
      maxStreak: 0,
      lastPlayedDate: null,
      migratedAt: null
    });
  }
  
  const winRate = stats.total_played > 0 ? stats.total_wins / stats.total_played : 0;
  
  return Response.json({
    played: stats.total_played,
    won: stats.total_wins,
    winRate: winRate,
    currentStreak: stats.current_streak,
    maxStreak: stats.best_streak,
    lastPlayedDate: stats.last_played_date,
    migratedAt: stats.migrated_at
  });
}

/**
 * POST /api/stats/update
 * Update stats after game completion
 */
export async function handleUpdateStats(request, env) {
  // Require authentication
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionId = cookies.session;
  
  if (!sessionId) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  // Get user from session
  const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`);
  const stub = env.GAME_SESSIONS.get(id);
  const sessionResp = await stub.fetch('http://internal/get');
  const session = await sessionResp.json();
  
  if (!session || !session.user_id) {
    return Response.json({ error: 'Invalid session' }, { status: 401 });
  }
  
  const userId = session.user_id;
  
  // Parse update payload
  let payload;
  try {
    payload = await request.json();
  } catch (err) {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  
  const won = Boolean(payload.won);
  const today = new Date().toISOString().split('T')[0];
  
  // Fetch current stats
  const current = await env.DB.prepare(`
    SELECT total_played, total_wins, current_streak, best_streak
    FROM stats WHERE user_id = ?
  `).bind(userId).first();
  
  let played = current ? current.total_played : 0;
  let wins = current ? current.total_wins : 0;
  let currentStreak = current ? current.current_streak : 0;
  let bestStreak = current ? current.best_streak : 0;
  
  // Update stats
  played++;
  if (won) {
    wins++;
    currentStreak++;
    bestStreak = Math.max(bestStreak, currentStreak);
  } else {
    currentStreak = 0;
  }
  
  // Save to D1
  await env.DB.prepare(`
    INSERT INTO stats (user_id, total_played, total_wins, current_streak, best_streak, last_played_date)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      total_played = excluded.total_played,
      total_wins = excluded.total_wins,
      current_streak = excluded.current_streak,
      best_streak = excluded.best_streak,
      last_played_date = excluded.last_played_date
  `).bind(userId, played, wins, currentStreak, bestStreak, today).run();
  
  const winRate = played > 0 ? wins / played : 0;
  
  return Response.json({
    success: true,
    stats: {
      played,
      won: wins,
      winRate,
      currentStreak,
      maxStreak: bestStreak
    }
  });
}
