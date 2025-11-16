// CORS headers for frontend access
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://brinedew.bio',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
};
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const STRUCTURE_TOKEN_TTL_SECONDS = 300;
const TOKEN_PREFIX = 'structure_token:';
const BYTES_PER_GB = 1024 * 1024 * 1024;
const STRUCTURE_BUCKET_CAP_BYTES = Math.floor(9.5 * BYTES_PER_GB);
const DAILY_TARGET_SALT = 'geneguessr-v2-939b5a0b';


// Import auth handlers
import { handleLogin, handleCallback, handleMe, handleLogout } from './auth.js';
// Import stats handlers
import { handleMigrateStats, handleGetStats, handleUpdateStats } from './stats.js';
// Import admin handlers
import { 
  handleOverrideProtein, 
  handleFeatureFlags, 
  handleAdminStatus, 
  handleDeleteOverride, 
  handleGraphicsSettings,
  DEFAULT_GRAPHICS_SETTINGS,
  normalizeGraphicsSettings,
  handleProteinPreview
} from './admin.js';
// Import admin HTML
import { ADMIN_HTML } from './admin-html.js';
import {
  DEFAULT_HINT_COST,
  HINT_REWARD_ON_INCORRECT,
  MAX_GUESSES,
  cleanGeneSummary,
  buildClueSections,
  collectMatchedHintTexts,
  extractHintText,
  maskClueSections,
  sanitizeTargetProtein,
  scoreGuess
} from './lib/game-engine.js';
import {
  fetchProteinByUniprot,
  searchProteins,
  getEligibleProteinIds,
  pickDailyTarget,
  getGoSimilarityFromEmbeddings
} from './lib/protein-store.js';
import { resolveStructureRepresentation } from './lib/structure-utils.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: CORS_HEADERS
      });
    }
    
    // Health check endpoint
    if (url.pathname === '/api/health') {
      return Response.json({
        status: 'ok',
        timestamp: Date.now(),
        database: await checkD1Health(env.DB),
        kv: await checkKVHealth(env.KV),
        durableObjects: 'configured'
      }, {
        headers: CORS_HEADERS
      });
    }

    // Auth endpoints
    if (url.pathname === '/api/auth/login' && request.method === 'GET') {
      return handleLogin(request, env);
    }
    
    if (url.pathname === '/api/auth/callback' && request.method === 'GET') {
      return handleCallback(request, env);
    }
    
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const response = await handleMe(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }
    
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }

    // Stats endpoints
    if (url.pathname === '/api/migrate-stats' && request.method === 'POST') {
      const response = await handleMigrateStats(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }
    
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      const response = await handleGetStats(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }
    
    if (url.pathname === '/api/stats/update' && request.method === 'POST') {
      const response = await handleUpdateStats(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }

    // Admin panel UI (protected by Cloudflare Access)
    if (url.pathname === '/admin' && request.method === 'GET') {
      // Serve admin HTML directly from Worker
      return new Response(ADMIN_HTML, {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
        }
      });
    }

    // Admin endpoints (protected by Cloudflare Access)
    if (url.pathname === '/api/admin/override-protein' && request.method === 'POST') {
      const response = await handleOverrideProtein(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }
    
    if (url.pathname === '/api/admin/override-protein' && request.method === 'DELETE') {
      const response = await handleDeleteOverride(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }
    
    if (url.pathname === '/api/admin/feature-flags' && request.method === 'POST') {
      const response = await handleFeatureFlags(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }
    
    if (url.pathname === '/api/admin/graphics-settings' && request.method === 'POST') {
      const response = await handleGraphicsSettings(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }

    if (url.pathname === '/api/admin/protein-preview' && request.method === 'GET') {
      const response = await handleProteinPreview(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }
    
    // Public graphics settings endpoint (no auth required)
    if (url.pathname === '/api/graphics-settings' && request.method === 'GET') {
      const storedSettings = await env.KV.get('graphics_settings');
      let graphicsPayload = JSON.parse(JSON.stringify(DEFAULT_GRAPHICS_SETTINGS));
      if (storedSettings) {
        try {
          graphicsPayload = normalizeGraphicsSettings(JSON.parse(storedSettings));
        } catch (err) {
          console.error('Failed to parse stored graphics settings, serving defaults', err);
          graphicsPayload = JSON.parse(JSON.stringify(DEFAULT_GRAPHICS_SETTINGS));
        }
      }
      return Response.json(graphicsPayload, {
        headers: CORS_HEADERS
      });
    }
    
    if (url.pathname === '/api/admin/status' && request.method === 'GET') {
      const response = await handleAdminStatus(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }
    
    if (url.pathname === '/api/structure-token' && request.method === 'GET') {
      return handleStructureToken(request, env);
    }

    if (url.pathname === '/api/structure' && request.method === 'GET') {
      return handleStructureFetch(request, env);
    }

    if (url.pathname === '/api/game/bootstrap' && request.method === 'GET') {
      return handleGameBootstrap(request, env);
    }

    if (url.pathname === '/api/game/guess' && request.method === 'POST') {
      return handleGuessSubmission(request, env);
    }

    if (url.pathname === '/api/game/reveal-hint' && request.method === 'POST') {
      return handleHintReveal(request, env);
    }

    // Public proteins endpoint for autocomplete
    if (url.pathname === '/api/proteins' && request.method === 'GET') {
      try {
        const query = (url.searchParams.get('query') || '').trim();
        if (!query) {
          return Response.json([], { headers: CORS_HEADERS });
        }
        const matches = await searchProteins(env.DB, query, 3);
        return Response.json(matches, { headers: CORS_HEADERS });
      } catch (error) {
        console.error('Failed to load protein search results', error);
        return Response.json({ error: 'Failed to load protein database' }, {
          status: 500,
          headers: CORS_HEADERS
        });
      }
    }

    // Session management endpoints
    if (url.pathname.startsWith('/api/session')) {
      const response = await handleSession(request, env);
      // Clone response with CORS headers
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: { ...Object.fromEntries(response.headers), ...CORS_HEADERS }
      });
    }
    
    return Response.json({ error: 'Not found' }, { 
      status: 404,
      headers: CORS_HEADERS 
    });
  }
};

/**
 * Handle session management requests
 */
async function handleSession(request, env) {
  const url = new URL(request.url);
  
  // Get session identifier (user ID or IP hash)
  const sessionId = getSessionId(request);
  
  // Get Durable Object stub
  const id = env.GAME_SESSIONS.idFromName(sessionId);
  const stub = env.GAME_SESSIONS.get(id);
  
  // Forward request to Durable Object
  return stub.fetch(request);
}

/**
 * Get session identifier from request
 * Uses user ID if authenticated, otherwise IP hash for guests
 */
function getSessionId(request) {
  // TODO: Extract from auth cookie when B-94 (Discord OAuth) is implemented
  // For now, use IP address for guest sessions
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return `guest_${hashIP(ip)}`;
}

/**
 * Hash IP address for guest session identification
 */
function hashIP(ip) {
  // Simple hash for demo - replace with proper hashing in production
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(36);
}

async function getGameState(env, sessionId) {
  const id = env.GAME_SESSIONS.idFromName(sessionId);
  const stub = env.GAME_SESSIONS.get(id);
  const response = await stub.fetch('https://sessions/game/state', { method: 'GET' });
  if (!response.ok) {
    throw new Error('Failed to load session state');
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function saveGameState(env, sessionId, state) {
  const id = env.GAME_SESSIONS.idFromName(sessionId);
  const stub = env.GAME_SESSIONS.get(id);
  const response = await stub.fetch('https://sessions/game/state', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(state || null)
  });
  if (!response.ok) {
    throw new Error('Failed to persist session state');
  }
}

async function checkD1Health(db) {
  try {
    const result = await db.prepare('SELECT 1 as test').first();
    return result?.test === 1 ? 'connected' : 'error';
  } catch (e) {
    return 'error';
  }
}

async function checkKVHealth(kv) {
  try {
    await kv.put('health_check', Date.now().toString(), { expirationTtl: 60 });
    const value = await kv.get('health_check');
    return value ? 'connected' : 'error';
  } catch (e) {
    return 'error';
  }
}

/**
 * GameSession Durable Object
 * Manages per-user game sessions and guest rate limiting
 */
export class GameSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Route requests
    if (path === '/api/session/get' && request.method === 'GET') {
      return this.getSession();
    } else if (path === '/api/session/update' && request.method === 'POST') {
      return this.updateSession(request);
    } else if (path === '/api/session/reset' && request.method === 'POST') {
      return this.resetSession();
    } else if (path === '/api/session/check-played-today' && request.method === 'GET') {
      return this.checkPlayedToday();
    } else if (path === '/game/state' && request.method === 'GET') {
      return this.getGameState();
    } else if (path === '/game/state' && request.method === 'POST') {
      return this.setGameState(request);
    } else if (path === '/store' && request.method === 'POST') {
      // Internal route for OAuth session storage
      return this.storeData(request);
    } else if (path === '/get' && request.method === 'GET') {
      // Internal route for OAuth session retrieval
      return this.getData();
    } else if (path === '/reset' && request.method === 'POST') {
      // Internal route for clearing OAuth session
      return this.clearData();
    } else {
      return new Response('Not found', { status: 404 });
    }
  }

  /**
   * Get current session state
   */
  async getSession() {
    const session = await this.state.storage.get('session') || {
      wrong_guesses: 0,
      hints_revealed: [],
      played_today: false,
      last_played_date: null,
      created_at: Date.now()
    };

    return new Response(JSON.stringify(session), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Update session state
   */
  async updateSession(request) {
    const updates = await request.json();
    const session = await this.state.storage.get('session') || {
      wrong_guesses: 0,
      hints_revealed: [],
      played_today: false,
      last_played_date: null,
      created_at: Date.now()
    };

    // Merge updates
    const updatedSession = { ...session, ...updates };
    await this.state.storage.put('session', updatedSession);

    return new Response(JSON.stringify(updatedSession), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Reset session (new game)
   */
  async resetSession() {
    const session = {
      wrong_guesses: 0,
      hints_revealed: [],
      played_today: true,
      last_played_date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
      created_at: Date.now()
    };

    await this.state.storage.put('session', session);

    return new Response(JSON.stringify(session), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Check if user/guest has played today
   */
  async checkPlayedToday() {
    const session = await this.state.storage.get('session');
    if (!session) {
      return new Response(JSON.stringify({ played_today: false }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const today = new Date().toISOString().split('T')[0];
    const played_today = session.last_played_date === today;

    return new Response(JSON.stringify({ 
      played_today,
      last_played_date: session.last_played_date 
    }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  async getGameState() {
    const state = await this.state.storage.get('game_state');
    return new Response(JSON.stringify(state || null), {
      headers: JSON_HEADERS
    });
  }

  async setGameState(request) {
    const payload = await request.json();
    await this.state.storage.put('game_state', payload);
    return new Response(JSON.stringify({ success: true }), {
      headers: JSON_HEADERS
    });
  }

  /**
   * Store arbitrary data (for OAuth sessions)
   * Internal route only
   */
  async storeData(request) {
    const data = await request.json();
    await this.state.storage.put('data', data);
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Get stored data (for OAuth sessions)
   * Internal route only
   */
  async getData() {
    const data = await this.state.storage.get('data');
    return new Response(JSON.stringify(data || {}), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  /**
   * Clear stored data (for logout)
   * Internal route only
   */
  async clearData() {
    await this.state.storage.deleteAll();
    return new Response(JSON.stringify({ success: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function handleStructureToken(request, env) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  if (type === 'target') {
    const protein = await getDailyTargetProtein(env);
    if (!protein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: CORS_HEADERS });
    }
    const meta = await getCanonicalStructureMeta(protein);
    if (!meta) {
      return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: CORS_HEADERS });
    }
    const token = await createStructureToken(env, meta);
    return Response.json({
      token,
      sourceLabel: meta.shortLabel,
      displayLabel: meta.displayLabel,
      format: meta.format || 'cif'
    }, { headers: CORS_HEADERS });
  }

  const uniprot = (url.searchParams.get('uniprot') || '').toUpperCase();
  if (!uniprot) {
    return Response.json({ error: 'Missing uniprot parameter' }, { status: 400, headers: CORS_HEADERS });
  }
  const protein = await fetchProteinByUniprot(env.DB, uniprot);
  if (!protein) {
    return Response.json({ error: 'Protein not found' }, { status: 404, headers: CORS_HEADERS });
  }
  const meta = await getCanonicalStructureMeta(protein);
  if (!meta) {
    return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: CORS_HEADERS });
  }
  const token = await createStructureToken(env, meta);
  return Response.json({
    token,
    sourceLabel: meta.shortLabel,
    displayLabel: meta.displayLabel,
    format: meta.format || 'cif'
  }, { headers: CORS_HEADERS });
}

async function handleStructureFetch(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return Response.json({ error: 'Missing token' }, { status: 400, headers: CORS_HEADERS });
  }
  const record = await env.STRUCTURE_TOKENS.get(`${TOKEN_PREFIX}${token}`, { type: 'json' });
  if (!record) {
    return Response.json({ error: 'Invalid or expired token' }, { status: 410, headers: CORS_HEADERS });
  }
  const { r2Key, upstreamUrl } = record;
  if (!r2Key) {
    return Response.json({ error: 'Token missing key' }, { status: 500, headers: CORS_HEADERS });
  }
  let object = await env.STRUCTURES_BUCKET.get(r2Key);
  if (!object) {
    const usage = await getStructureBucketUsage(env);
    if (usage.bytes >= STRUCTURE_BUCKET_CAP_BYTES) {
      return Response.json({
        error: 'Structure downloads temporarily paused',
        detail: 'Storage cap reached. Please try again later.'
      }, { status: 507, headers: CORS_HEADERS });
    }
    if (!upstreamUrl) {
      return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: CORS_HEADERS });
    }
    const upstreamResp = await fetch(upstreamUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'GeneGuessr-Worker/1.0' }
    });
    if (!upstreamResp.ok) {
      return new Response(upstreamResp.body, { status: upstreamResp.status, headers: CORS_HEADERS });
    }
    const arrayBuffer = await upstreamResp.arrayBuffer();
    await env.STRUCTURES_BUCKET.put(r2Key, arrayBuffer, {
      httpMetadata: {
        contentType: upstreamResp.headers.get('Content-Type') || 'application/octet-stream'
      }
    });
    return new Response(arrayBuffer, {
      headers: {
        ...CORS_HEADERS,
        'Content-Type': upstreamResp.headers.get('Content-Type') || 'application/octet-stream'
      }
    });
  }

  return new Response(object.body, {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

async function handleGameBootstrap(request, env) {
  try {
    const sessionId = getSessionId(request);
    const targetProtein = await getDailyTargetProtein(env);
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: CORS_HEADERS });
    }
    const state = await ensureSessionForToday(env, sessionId, targetProtein);
    await hydrateGuessProteins(env, sessionId, state, targetProtein);
    const payload = buildGamePayload(state, targetProtein);
    return Response.json(payload, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('GeneGuessr: bootstrap failed', err);
    return Response.json({ error: 'Failed to load game state' }, { status: 500, headers: CORS_HEADERS });
  }
}

async function handleGuessSubmission(request, env) {
  try {
    const sessionId = getSessionId(request);
    const targetProtein = await getDailyTargetProtein(env);
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: CORS_HEADERS });
    }
    const body = await safeJson(request);
    const uniprot = (body?.uniprot || '').toUpperCase();
    if (!uniprot) {
      return Response.json({ error: 'Missing uniprot' }, { status: 400, headers: CORS_HEADERS });
    }
    let state = await ensureSessionForToday(env, sessionId, targetProtein);
    if (state.won || (state.guesses?.length || 0) >= MAX_GUESSES) {
      return Response.json({ error: 'Round already completed' }, { status: 409, headers: CORS_HEADERS });
    }
    if ((state.guesses || []).some((entry) => entry.uniprot === uniprot)) {
      return Response.json({ error: 'Protein already guessed' }, { status: 409, headers: CORS_HEADERS });
    }
    const guessProtein = await fetchProteinByUniprot(env.DB, uniprot);
    if (!guessProtein) {
      return Response.json({ error: 'Protein not found' }, { status: 404, headers: CORS_HEADERS });
    }
    const goSimilarity = await getGoSimilarityFromEmbeddings(
      env.DB,
      guessProtein.uniprot,
      targetProtein.uniprot
    );
    const score = scoreGuess(guessProtein, targetProtein, { goSimilarity });
    const correct = guessProtein.uniprot === targetProtein.uniprot;
    const guessEntry = {
      guessId: crypto.randomUUID(),
      uniprot,
      correct,
      score,
      createdAt: Date.now(),
      protein: {
        ...guessProtein,
        gene_summary: cleanGeneSummary(guessProtein.gene_summary)
      }
    };
    state.guesses = [...(state.guesses || []), guessEntry];
    if (correct) {
      state.won = true;
    } else {
      state.hintBalance = (state.hintBalance || 0) + HINT_REWARD_ON_INCORRECT;
    }
    await saveGameState(env, sessionId, state);
    const payload = buildGamePayload(state, targetProtein);
    return Response.json(payload, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('GeneGuessr: guess submission failed', err);
    return Response.json({ error: 'Guess submission failed' }, { status: 500, headers: CORS_HEADERS });
  }
}

async function handleHintReveal(request, env) {
  try {
    const sessionId = getSessionId(request);
    const targetProtein = await getDailyTargetProtein(env);
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: CORS_HEADERS });
    }
    const body = await safeJson(request);
    const hintId = body?.hintId || body?.id;
    if (!hintId) {
      return Response.json({ error: 'Missing hintId' }, { status: 400, headers: CORS_HEADERS });
    }
    const clueSections = buildClueSections(targetProtein);
    const hintText = extractHintText(clueSections, hintId);
    if (!hintText) {
      return Response.json({ error: 'Hint not found' }, { status: 404, headers: CORS_HEADERS });
    }
    const state = await ensureSessionForToday(env, sessionId, targetProtein);
    await hydrateGuessProteins(env, sessionId, state, targetProtein);
    if (!(state.revealedHints || []).includes(hintId)) {
      if ((state.hintBalance || 0) < DEFAULT_HINT_COST) {
        return Response.json({ error: 'Insufficient hints' }, { status: 402, headers: CORS_HEADERS });
      }
      state.revealedHints = [...(state.revealedHints || []), hintId];
      state.hintBalance = Math.max(0, (state.hintBalance || 0) - DEFAULT_HINT_COST);
      await saveGameState(env, sessionId, state);
    }
    const payload = buildGamePayload(state, targetProtein, { clueSections });
    payload.revealedHint = { id: hintId, text: hintText };
    return Response.json(payload, { headers: CORS_HEADERS });
  } catch (err) {
    console.error('GeneGuessr: hint reveal failed', err);
    return Response.json({ error: 'Hint reveal failed' }, { status: 500, headers: CORS_HEADERS });
  }
}


async function createStructureToken(env, meta) {
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await env.STRUCTURE_TOKENS.put(`${TOKEN_PREFIX}${token}`, JSON.stringify(meta), {
    expirationTtl: STRUCTURE_TOKEN_TTL_SECONDS
  });
  return token;
}

async function getDailyTargetProtein(env) {
  const eligibleIds = await getEligibleProteinIds(env.DB);
  if (!eligibleIds.length) {
    return null;
  }
  const salt = env?.DAILY_TARGET_SALT || DAILY_TARGET_SALT;
  const selection = await pickDailyTarget(env.DB, eligibleIds, salt);
  return selection?.protein || null;
}

function createInitialGameState(date, targetId) {
  return {
    version: 2,
    date,
    targetId,
    guesses: [],
    hintBalance: DEFAULT_HINT_COST,
    revealedHints: [],
    won: false,
    statsRecorded: false,
    practiceMode: false,
    createdAt: Date.now()
  };
}

async function ensureSessionForToday(env, sessionId, targetProtein) {
  const today = new Date().toISOString().slice(0, 10);
  let state = null;
  try {
    state = await getGameState(env, sessionId);
  } catch (err) {
    console.warn('GeneGuessr: failed to load session, resetting', err);
    state = null;
  }
  if (!state || state.date !== today || state.targetId !== targetProtein.uniprot) {
    state = createInitialGameState(today, targetProtein.uniprot);
    await saveGameState(env, sessionId, state);
  }
  return state;
}

async function hydrateGuessProteins(env, sessionId, state, targetProtein) {
  if (!Array.isArray(state?.guesses)) {
    return;
  }
  let dirty = false;
  for (const entry of state.guesses) {
    if (!entry) {
      continue;
    }
    if (!entry.protein) {
      const protein = await fetchProteinByUniprot(env.DB, entry.uniprot);
      if (protein) {
        entry.protein = {
          ...protein,
          gene_summary: cleanGeneSummary(protein.gene_summary)
        };
        dirty = true;
      }
    }
    if (entry.protein && targetProtein) {
      const goSimilarity = await getGoSimilarityFromEmbeddings(
        env.DB,
        entry.uniprot,
        targetProtein.uniprot
      );
      const nextScore = scoreGuess(entry.protein, targetProtein, { goSimilarity });
      const prevGoPercent = entry.score?.goPercent ?? null;
      entry.score = nextScore;
      if (nextScore?.goPercent !== prevGoPercent) {
        dirty = true;
      }
    }
  }
  if (dirty && sessionId) {
    await saveGameState(env, sessionId, state);
  }
}

function buildGamePayload(state, targetProtein, options = {}) {
  const revealedHints = new Set(state.revealedHints || []);
  const clueSections = options.clueSections || buildClueSections(targetProtein);
  const maskedSections = maskClueSections(clueSections, revealedHints);
  const clueTarget = sanitizeTargetProtein(targetProtein, {
    revealIdentity: state.won || (state.guesses?.length || 0) >= MAX_GUESSES
  });
  const guessEntries = [];
  const aggregatedMatches = {};
  let latestMatches = {};
  (state.guesses || []).forEach((entry, index) => {
    const guessProtein = entry.protein || null;
    if (!guessProtein) {
      return;
    }
    const guessProteinCleaned = {
      ...guessProtein,
      gene_summary: cleanGeneSummary(guessProtein.gene_summary)
    };
    const resolvedScore = entry.score || scoreGuess(guessProtein, targetProtein, {
      goSimilarity: entry.score?.goSimilarity
    });
    const matches = collectMatchedHintTexts(targetProtein, guessProtein, resolvedScore);
    aggregateMatches(aggregatedMatches, matches);
    const isLatest = index === (state.guesses.length - 1);
    if (isLatest) {
      latestMatches = matches;
    }
    guessEntries.push({
      guessId: entry.guessId,
      uniprot: entry.uniprot,
      correct: Boolean(entry.correct),
      createdAt: entry.createdAt,
      score: resolvedScore,
      matchedHints: matches,
      protein: guessProteinCleaned,
      isLatest
    });
  });
  const lost = !state.won && guessEntries.length >= MAX_GUESSES;
  const targetReveal = (state.won || lost)
    ? sanitizeTargetProtein(targetProtein, { revealIdentity: true })
    : null;
  const shareText = targetReveal ? buildShareText(state, guessEntries) : null;
  applyMatchReveals(maskedSections, aggregatedMatches);
  applyLatestHighlights(maskedSections, latestMatches);
  return {
    status: {
      date: state.date,
      won: Boolean(state.won),
      lost,
      guessCount: guessEntries.length,
      maxGuesses: MAX_GUESSES,
      hintBalance: state.hintBalance,
      revealedHints: state.revealedHints || [],
      practiceMode: Boolean(state.practiceMode)
    },
    clueTarget,
    clue: {
      sections: maskedSections,
      allMatches: aggregatedMatches,
      latestMatches
    },
    guesses: guessEntries,
    targetReveal,
    shareText
  };
}

function aggregateMatches(destination, matches) {
  Object.entries(matches || {}).forEach(([sectionId, values]) => {
    if (!destination[sectionId]) {
      destination[sectionId] = [];
    }
    values.forEach((value) => {
      if (!destination[sectionId].includes(value)) {
        destination[sectionId].push(value);
      }
    });
  });
}

function buildShareText(state, guesses) {
  const emoji = state.won ? 'You Win!' : 'Game Over';
  const guessCount = guesses.length;
  const today = state.date || new Date().toISOString().slice(0, 10);
  const grid = guesses.map((entry) => {
    if (entry.correct) {
      return '??';
    }
    const simScore = typeof entry.score?.goSimilarity === 'number' ? entry.score.goSimilarity : 0;
    return simScore >= 0.35 ? '??' : '?';
  }).join('');
  return `Geneguessr ${today}
${emoji} ${guessCount}/${MAX_GUESSES}

${grid}

https://brinedew.bio/apps/geneguessr/`;
}

function applyMatchReveals(sections, matches) {
  if (!Array.isArray(sections)) {
    return;
  }
  sections.forEach((section) => {
    const matchedValues = matches?.[section.id];
    if (!Array.isArray(matchedValues) || matchedValues.length === 0) {
      return;
    }
    const set = new Set(matchedValues);
    section.items.forEach((item) => {
      if (!item || !item.fullText) {
        return;
      }
      if (set.has(item.fullText)) {
        item.revealed = true;
        item.text = item.fullText;
      }
    });
  });
}

function applyLatestHighlights(sections, latestMatches) {
  if (!Array.isArray(sections) || !latestMatches) {
    return;
  }
  sections.forEach((section) => {
    const values = latestMatches?.[section.id];
    if (!Array.isArray(values) || !values.length) {
      section.items.forEach((item) => {
        if (item) {
          item.highlighted = false;
        }
      });
      return;
    }
    const set = new Set(values);
    section.items.forEach((item) => {
      if (!item || !item.fullText) {
        item && (item.highlighted = false);
        return;
      }
      item.highlighted = set.has(item.fullText);
    });
  });
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function getCanonicalStructureMeta(protein) {
  if (!protein || !protein.structure) {
    return null;
  }
  const representation = resolveStructureRepresentation(protein.structure, protein.length || 0);
  if (!representation) {
    return null;
  }
  if (representation.source === 'pdb' && representation.pdb && representation.pdb.id) {
    const id = representation.pdb.id.toUpperCase();
    return {
      source: 'pdb',
      r2Key: `pdb/${id}.cif`,
      upstreamUrl: `https://files.rcsb.org/download/${id}.cif`,
      shortLabel: 'PDB',
      displayLabel: `PDB (${id})`,
      format: 'cif'
    };
  }
  if (representation.source === 'swissmodel' && representation.swissModel) {
    const url = representation.swissModel.coordinates_url ||
      representation.swissModel.coordinatesUrl ||
      representation.swissModel.model_url ||
      representation.swissModel.modelcif;
    if (!url) {
      return null;
    }
    const ext = getFileExtensionFromUrl(url);
    const structureId = sanitizeKeySegment(
      representation.structureId ||
      representation.swissModel.model_id ||
      representation.swissModel.template ||
      protein.uniprot
    );
    const normalizedFormat = ext === 'pdb' ? 'pdb' : (ext === 'bcif' ? 'bcif' : 'cif');
    return {
      source: 'swissmodel',
      r2Key: `swissmodel/${structureId}.${ext}`,
      upstreamUrl: url,
      shortLabel: 'SWISS-MODEL',
      displayLabel: `SWISS-MODEL (${structureId})`,
      format: normalizedFormat
    };
  }
  if (representation.source === 'alphafold' && representation.alphafold && representation.alphafold.model_url) {
    const id = representation.alphafold.id || protein.uniprot;
    return {
      source: 'alphafold',
      r2Key: `alphafold/${sanitizeKeySegment(id)}.cif`,
      upstreamUrl: representation.alphafold.model_url,
      shortLabel: 'AlphaFold',
      displayLabel: `AlphaFold (${id})`,
      format: 'cif'
    };
  }
  return null;
}

async function getStructureBucketUsage(env) {
  let cursor = undefined;
  let bytes = 0;
  let objects = 0;
  do {
    const listResp = await env.STRUCTURES_BUCKET.list({ cursor, limit: 1000 });
    const currentObjects = listResp?.objects || [];
    currentObjects.forEach((obj) => {
      bytes += obj.size || 0;
      objects += 1;
    });
    cursor = listResp?.truncated ? listResp?.cursor : undefined;
  } while (cursor);
  return { bytes, objects };
}

function sanitizeKeySegment(value) {
  return (value || 'unknown').toString().replace(/[^A-Za-z0-9_\-]/g, '_');
}

function getFileExtensionFromUrl(url) {
  const lower = url.toLowerCase();
  if (lower.includes('.bcif')) return 'bcif';
  if (lower.includes('.pdb')) return 'pdb';
  return 'cif';
}

function isAlphaFoldOnlyProtein(protein) {
  if (!protein || !protein.structure) {
    return false;
  }
  const representation = resolveStructureRepresentation(protein.structure, protein.length || 0);
  return Boolean(representation && representation.source === 'alphafold');
}
