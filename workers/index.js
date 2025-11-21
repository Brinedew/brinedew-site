// CORS headers for frontend access - supports both main domain and subdomain
function getCorsHeaders(origin) {
  const allowedOrigins = ['https://brinedew.bio', 'https://geneguessr.brinedew.bio'];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : 'https://brinedew.bio';
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };
}

// Backward compatibility - default CORS headers for main domain
const CORS_HEADERS = getCorsHeaders('https://brinedew.bio');
const JSON_HEADERS = { 'Content-Type': 'application/json' };
const STRUCTURE_TOKEN_TTL_SECONDS = 300;
const TOKEN_PREFIX = 'structure_token:';
const BYTES_PER_GB = 1024 * 1024 * 1024;
const STRUCTURE_BUCKET_CAP_BYTES = Math.floor(9.5 * BYTES_PER_GB);
const STRUCTURE_CACHE_META_PREFIX = 'structure_meta:';
const STRUCTURE_CACHE_TARGET_RATIO = 0.9;
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
  getGoSimilarityFromEmbeddings,
  markStructureFailure,
  clearStructureFailure
} from './lib/protein-store.js';
import { resolveStructureRepresentation } from './lib/structure-utils.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = getCorsHeaders(origin);
    
    // Handle geneguessr subdomain proxy - proxy NON-API requests from subdomain to main site
    if (url.hostname === 'geneguessr.brinedew.bio' && !url.pathname.startsWith('/api/')) {
      // For root path, fetch the geneguessr app page
      let targetPath = url.pathname === '/' 
        ? '/apps/geneguessr/index' 
        : url.pathname;
      
      const targetUrl = new URL('https://brinedew.bio' + targetPath + url.search);
      const response = await fetch(targetUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined
      });
      
      // For HTML, keep paths as-is (no rewriting) so subdomain requests go through this proxy
      if (response.headers.get('content-type')?.includes('text/html')) {
        const html = await response.text();
        return new Response(html, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      }
      
      return response;
    }
    
    // Handle CORS preflight requests
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders
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
        headers: corsHeaders
      });
    }

    // Normalize directory-style app path to include trailing slash.
    // This avoids edge/origin mismatches where a non-trailing-slash request
    // could resolve to an upstream origin that serves a 503/GitHub outage page.
    if (url.pathname === '/apps/geneguessr' && request.method === 'GET') {
      return new Response(null, {
        status: 301,
        headers: {
          'Location': `${url.origin}/apps/geneguessr/`
        }
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
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
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
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }
    
    if (url.pathname === '/api/stats' && request.method === 'GET') {
      const response = await handleGetStats(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }
    
    if (url.pathname === '/api/stats/update' && request.method === 'POST') {
      const response = await handleUpdateStats(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
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
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }
    
    if (url.pathname === '/api/admin/override-protein' && request.method === 'DELETE') {
      const response = await handleDeleteOverride(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }
    
    if (url.pathname === '/api/admin/feature-flags' && request.method === 'POST') {
      const response = await handleFeatureFlags(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }
    
    if (url.pathname === '/api/admin/graphics-settings' && request.method === 'POST') {
      const response = await handleGraphicsSettings(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }

    if (url.pathname === '/api/admin/protein-preview' && request.method === 'GET') {
      const response = await handleProteinPreview(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
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
        headers: corsHeaders
      });
    }
    
    if (url.pathname === '/api/admin/status' && request.method === 'GET') {
      const response = await handleAdminStatus(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }
    
    if (url.pathname === '/api/structure-token' && request.method === 'GET') {
      return handleStructureToken(request, env, corsHeaders);
    }

    if (url.pathname === '/api/structure' && request.method === 'GET') {
      return handleStructureFetch(request, env, corsHeaders);
    }

    if (url.pathname === '/api/game/bootstrap' && request.method === 'GET') {
      return handleGameBootstrap(request, env, corsHeaders);
    }

    if (url.pathname === '/api/game/guess' && request.method === 'POST') {
      return handleGuessSubmission(request, env, corsHeaders);
    }

    if (url.pathname === '/api/game/reveal-hint' && request.method === 'POST') {
      return handleHintReveal(request, env, corsHeaders);
    }

    // Public proteins endpoint for autocomplete
    if (url.pathname === '/api/protein' && request.method === 'GET') {
      try {
        const uniprot = (url.searchParams.get('uniprot') || '').toUpperCase();
        if (!uniprot) {
          return Response.json({ error: 'Missing uniprot parameter' }, { status: 400, headers: corsHeaders });
        }
        const protein = await fetchProteinByUniprot(env.DB, uniprot);
        if (!protein) {
          return Response.json({ error: 'Protein not found' }, { status: 404, headers: corsHeaders });
        }
        return Response.json(sanitizeTargetProtein(protein, { revealIdentity: true }), { headers: corsHeaders });
      } catch (error) {
        console.error('Failed to load protein details', error);
        return Response.json({ error: 'Failed to load protein' }, {
          status: 500,
          headers: corsHeaders
        });
      }
    }

    if (url.pathname === '/api/proteins' && request.method === 'GET') {
      try {
        const query = (url.searchParams.get('query') || '').trim();
        if (!query) {
          return Response.json([], { headers: corsHeaders });
        }
        const matches = await searchProteins(env.DB, query, 3);
        return Response.json(matches, { headers: corsHeaders });
      } catch (error) {
        console.error('Failed to load protein search results', error);
        return Response.json({ error: 'Failed to load protein database' }, {
          status: 500,
          headers: corsHeaders
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
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }
    
    return Response.json({ error: 'Not found' }, { 
      status: 404,
      headers: corsHeaders 
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

function resolveSessionContext(request) {
  const url = new URL(request.url);
  const practiceMode = url.searchParams.get('practice') === '1';
  const practiceRestart = practiceMode && url.searchParams.get('restart') === '1';
  const baseSessionId = getSessionId(request);
  return {
    practiceMode,
    practiceRestart,
    sessionId: practiceMode ? `practice_${baseSessionId}` : baseSessionId
  };
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

async function handleStructureToken(request, env, corsHeaders) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type');
  if (type === 'target') {
    const protein = await getDailyTargetProtein(env);
    if (!protein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: corsHeaders });
    }
    const meta = await getCanonicalStructureMeta(protein, env);
    if (!meta) {
      return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
    }
    const cached = await ensureStructureCached(env, meta, { proteinId: protein.uniprot });
    if (!cached) {
      return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
    }
    const token = await createStructureToken(env, meta);
    const structureUrl = `${url.origin}/api/structure?token=${token}`;
    return Response.json({
      token,
      sourceLabel: meta.shortLabel,
      displayLabel: meta.displayLabel,
      format: meta.format || 'cif',
      url: structureUrl
    }, { headers: corsHeaders });
  }

  const uniprot = (url.searchParams.get('uniprot') || '').toUpperCase();
  if (!uniprot) {
    return Response.json({ error: 'Missing uniprot parameter' }, { status: 400, headers: corsHeaders });
  }
  // For structure tokens, we don't require the protein to be in the database
  // Structure discovery works from UniProt APIs directly
  const protein = { uniprot }; // Minimal protein object for structure discovery
  const meta = await getCanonicalStructureMeta(protein, env);
  if (!meta) {
    return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
  }
  const cached = await ensureStructureCached(env, meta, { proteinId: uniprot });
  if (!cached) {
    return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
  }
  const token = await createStructureToken(env, meta);
  const structureUrl = `${url.origin}/api/structure?token=${token}`;
  return Response.json({
    token,
    sourceLabel: meta.shortLabel,
    displayLabel: meta.displayLabel,
    format: meta.format || 'cif',
    url: structureUrl
  }, { headers: corsHeaders });
}

async function handleStructureFetch(request, env, corsHeaders) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) {
    return Response.json({ error: 'Missing token' }, { status: 400, headers: corsHeaders });
  }
  const record = await env.STRUCTURE_TOKENS.get(`${TOKEN_PREFIX}${token}`, { type: 'json' });
  if (!record) {
    return Response.json({ error: 'Invalid or expired token' }, { status: 410, headers: corsHeaders });
  }
  const { r2Key } = record;
  if (!r2Key) {
    return Response.json({ error: 'Token missing key' }, { status: 500, headers: corsHeaders });
  }
  const cached = await ensureStructureCached(env, record);
  if (!cached) {
    return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
  }
  const object = await env.STRUCTURES_BUCKET.get(r2Key);
  if (!object) {
    return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
  }
  await touchStructureCacheEntry(env, r2Key, object.size);
  return new Response(object.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=3600'
    }
  });
}

async function handleGameBootstrap(request, env, corsHeaders) {
  try {
    const { sessionId, practiceMode, practiceRestart } = resolveSessionContext(request);
    const targetSeed = await getDailyTargetProtein(env, { practice: practiceMode });
    if (!targetSeed && !practiceMode) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: corsHeaders });
    }
    const state = await ensureSessionForToday(env, sessionId, targetSeed, { practiceMode, forceReset: practiceRestart });
    const targetProtein = targetSeed && state.targetId === targetSeed.uniprot
      ? targetSeed
      : await fetchProteinByUniprot(env.DB, state.targetId);
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: corsHeaders });
    }
    await hydrateGuessProteins(env, sessionId, state, targetProtein);
    const payload = buildGamePayload(state, targetProtein);
    return Response.json(payload, { headers: corsHeaders });
  } catch (err) {
    console.error('GeneGuessr: bootstrap failed', err);
    return Response.json({ error: 'Failed to load game state' }, { status: 500, headers: corsHeaders });
  }
}

async function handleGuessSubmission(request, env, corsHeaders) {
  try {
    const { sessionId, practiceMode } = resolveSessionContext(request);
    const targetSeed = await getDailyTargetProtein(env, { practice: practiceMode ? true : false });
    if (!targetSeed && !practiceMode) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: corsHeaders });
    }
    const body = await safeJson(request);
    const uniprot = (body?.uniprot || '').toUpperCase();
    if (!uniprot) {
      return Response.json({ error: 'Missing uniprot' }, { status: 400, headers: corsHeaders });
    }
    let state = await ensureSessionForToday(env, sessionId, targetSeed, { practiceMode });
    const targetProtein = targetSeed && state.targetId === targetSeed.uniprot
      ? targetSeed
      : await fetchProteinByUniprot(env.DB, state.targetId);
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: corsHeaders });
    }
    if (state.won || (state.guesses?.length || 0) >= MAX_GUESSES) {
      return Response.json({ error: 'Round already completed' }, { status: 409, headers: corsHeaders });
    }
    if ((state.guesses || []).some((entry) => entry.uniprot === uniprot)) {
      return Response.json({ error: 'Protein already guessed' }, { status: 409, headers: corsHeaders });
    }
    const guessProtein = await fetchProteinByUniprot(env.DB, uniprot);
    if (!guessProtein) {
      return Response.json({ error: 'Protein not found' }, { status: 404, headers: corsHeaders });
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
    const payload = buildGamePayload(state, targetProtein, { includeProteins: true });
    return Response.json(payload, { headers: corsHeaders });
  } catch (err) {
    console.error('GeneGuessr: guess submission failed', err);
    return Response.json({ error: 'Guess submission failed' }, { status: 500, headers: corsHeaders });
  }
}

async function handleHintReveal(request, env, corsHeaders) {
  try {
    const { sessionId, practiceMode } = resolveSessionContext(request);
    const targetSeed = await getDailyTargetProtein(env, { practice: practiceMode ? true : false });
    if (!targetSeed && !practiceMode) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: corsHeaders });
    }
    const body = await safeJson(request);
    const hintId = body?.hintId || body?.id;
    if (!hintId) {
      return Response.json({ error: 'Missing hintId' }, { status: 400, headers: corsHeaders });
    }
    const state = await ensureSessionForToday(env, sessionId, targetSeed, { practiceMode });
    const targetProtein = targetSeed && state.targetId === targetSeed.uniprot
      ? targetSeed
      : await fetchProteinByUniprot(env.DB, state.targetId);
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: corsHeaders });
    }
    const clueSections = buildClueSections(targetProtein);
    const hintText = extractHintText(clueSections, hintId);
    if (!hintText) {
      return Response.json({ error: 'Hint not found' }, { status: 404, headers: corsHeaders });
    }
    await hydrateGuessProteins(env, sessionId, state, targetProtein);
    if (!(state.revealedHints || []).includes(hintId)) {
      if ((state.hintBalance || 0) < DEFAULT_HINT_COST) {
        return Response.json({ error: 'Insufficient hints' }, { status: 402, headers: corsHeaders });
      }
      state.revealedHints = [...(state.revealedHints || []), hintId];
      state.hintBalance = Math.max(0, (state.hintBalance || 0) - DEFAULT_HINT_COST);
      await saveGameState(env, sessionId, state);
    }
    const payload = buildGamePayload(state, targetProtein, { clueSections });
    payload.revealedHint = { id: hintId, text: hintText };
    return Response.json(payload, { headers: corsHeaders });
  } catch (err) {
    console.error('GeneGuessr: hint reveal failed', err);
    return Response.json({ error: 'Hint reveal failed' }, { status: 500, headers: corsHeaders });
  }
}


async function createStructureToken(env, meta) {
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await env.STRUCTURE_TOKENS.put(`${TOKEN_PREFIX}${token}`, JSON.stringify(meta), {
    expirationTtl: STRUCTURE_TOKEN_TTL_SECONDS
  });
  return token;
}

async function getDailyTargetProtein(env, options = {}) {
  const eligibleIds = await getEligibleProteinIds(env.DB);
  if (!eligibleIds.length) {
    return null;
  }
  if (options.practice) {
    const randomIndex = Math.floor(Math.random() * eligibleIds.length);
    const randomId = eligibleIds[randomIndex];
    return await fetchProteinByUniprot(env.DB, randomId);
  }
  const salt = env?.DAILY_TARGET_SALT || DAILY_TARGET_SALT;
  const selection = await pickDailyTarget(env.DB, eligibleIds, salt);
  return selection?.protein || null;
}

function createInitialGameState(date, targetId, options = {}) {
  return {
    version: 2,
    date,
    targetId,
    guesses: [],
    hintBalance: DEFAULT_HINT_COST,
    revealedHints: [],
    won: false,
    statsRecorded: false,
    practiceMode: Boolean(options.practiceMode),
    createdAt: Date.now()
  };
}

async function ensureSessionForToday(env, sessionId, targetProtein, options = {}) {
  const practiceMode = Boolean(options.practiceMode);
  const forceReset = Boolean(options.forceReset);
  const today = new Date().toISOString().slice(0, 10);
  let state = null;
  try {
    state = await getGameState(env, sessionId);
  } catch (err) {
    console.warn('GeneGuessr: failed to load session, resetting', err);
    state = null;
  }
  const applyDesiredTarget = forceReset || !state;
  const desiredTargetId = applyDesiredTarget && targetProtein ? targetProtein.uniprot : null;
  const needsReset = forceReset
    || !state
    || state.date !== today
    || (desiredTargetId && state.targetId !== desiredTargetId);
  if (needsReset) {
    if (!targetProtein?.uniprot) {
      throw new Error('Target protein required to initialize session');
    }
    state = createInitialGameState(today, targetProtein.uniprot, { practiceMode });
    await saveGameState(env, sessionId, state);
  } else if (state.practiceMode !== practiceMode) {
    state.practiceMode = practiceMode;
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
  const includeProteins = Boolean(options.includeProteins);
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
      ...(includeProteins ? { protein: guessProteinCleaned } : {}),
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
      practiceMode: Boolean(state.practiceMode),
      targetId: state.targetId
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

async function getCanonicalStructureMeta(protein, env) {
  if (!protein) {
    return null;
  }
  
  // Selection thresholds (match seeder)
  const COVERAGE_THRESHOLD = 0.60;
  const PDB_RESOLUTION_MAX = 4.0;
  const AF_PLDDT_MIN = 50;
  
  // Source preference order: PDB -> SWISS-MODEL -> AlphaFold
  const SOURCE_PREFERENCE = ['pdb', 'swissmodel', 'alphafold'];
  
  // Discover candidates
  const candidates = [];
  
  // PDB candidates
  try {
    const pdbUrl = `https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/${protein.uniprot}`;
    const pdbResp = await fetch(pdbUrl, { timeout: 20000 });
    if (pdbResp.ok) {
      const pdbData = await pdbResp.json();
      const pdbMappings = pdbData[protein.uniprot] || [];
      for (const m of pdbMappings) {
        const pdbId = (m.pdb_id || '').toUpperCase();
        if (!pdbId) continue;
        const coverage = m.coverage || 0.0;
        const resolution = m.resolution;
        // Only include X-ray diffraction structures with reasonable resolution
        if (m.experimental_method === 'X-ray diffraction' && resolution && resolution <= PDB_RESOLUTION_MAX) {
          candidates.push({
            source: 'pdb',
            id: pdbId,
            upstreamUrl: `https://files.rcsb.org/download/${pdbId}.cif`,
            coverage,
            quality: resolution,  // resolution as quality metric
            raw: m
          });
        }
      }
    }
  } catch (err) {
    console.warn('GeneGuessr: failed to fetch PDB mappings for', protein.uniprot, err);
  }
  
  // AlphaFold candidate
  try {
    const afUrl = `https://alphafold.ebi.ac.uk/api/prediction/${protein.uniprot}`;
    const afResp = await fetch(afUrl, { timeout: 10000 });
    if (afResp.ok) {
      const afData = await afResp.json();
      if (Array.isArray(afData) && afData.length > 0) {
        // Pick the best model (highest globalMetricValue)
        const best = afData.reduce((a, b) => (a.globalMetricValue > b.globalMetricValue ? a : b));
        if (best.cifUrl) {
          candidates.push({
            source: 'alphafold',
            id: protein.uniprot,
            upstreamUrl: best.cifUrl,
            coverage: 1.0,
            quality: best.globalMetricValue
          });
        }
      }
    }
  } catch (err) {
    console.warn('GeneGuessr: failed to fetch AlphaFold for', protein.uniprot, err);
  }
  
  // SWISS-MODEL candidates
  try {
    const swissUrl = `https://swissmodel.expasy.org/repository/uniprot/${protein.uniprot}.json`;
    const swissResp = await fetch(swissUrl, { timeout: 20000 });
    if (swissResp.ok) {
      const swissData = await swissResp.json();
      const structures = swissData.result?.structures || [];
      for (const s of structures) {
        if (s.provider === 'SWISSMODEL' && s.method === 'HOMOLOGY MODELLING') {
          const coverage = s.coverage || 0.0;
          const gmqe = s.gmqe;
          const cifUrl = s.modelcif;
          if (cifUrl && coverage >= COVERAGE_THRESHOLD && gmqe && gmqe >= 0.5) {
            candidates.push({
              source: 'swissmodel',
              id: `${protein.uniprot}_swissmodel_${s.template || 'unknown'}`,
              upstreamUrl: cifUrl,
              coverage,
              quality: gmqe,
              raw: s
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('GeneGuessr: failed to fetch SWISS-MODEL for', protein.uniprot, err);
  }
  
  // Select best candidate following SOURCE_PREFERENCE
  let selected = null;
  for (const source of SOURCE_PREFERENCE) {
    if (source === 'pdb') {
      const pdbs = candidates.filter(c => c.source === 'pdb' && c.coverage >= COVERAGE_THRESHOLD);
      if (pdbs.length > 0) {
        pdbs.sort((a, b) => b.coverage - a.coverage || (a.quality || Infinity) - (b.quality || Infinity));  // Higher coverage, lower resolution better
        selected = pdbs[0];
        break;
      }
    } else if (source === 'swissmodel') {
      const swiss = candidates.filter(c => c.source === 'swissmodel' && c.coverage >= COVERAGE_THRESHOLD && (c.quality || 0) >= 0.5);
      if (swiss.length > 0) {
        swiss.sort((a, b) => b.coverage - a.coverage || b.quality - a.quality);  // Higher coverage, higher GMQE better
        selected = swiss[0];
        break;
      }
    } else if (source === 'alphafold') {
      const af = candidates.filter(c => c.source === 'alphafold');
      if (af.length > 0) {
        af.sort((a, b) => (b.quality || 0) - (a.quality || 0));  // Higher pLDDT better
        selected = af[0];
        break;
      }
    }
  }
  
  if (!selected) {
    if (env?.DB && protein?.uniprot) {
      await markStructureFailure(env.DB, protein.uniprot);
    }
    return null;
  }
  
  // Build meta for selected candidate
  let meta = null;
  if (selected.source === 'pdb') {
    meta = {
      source: 'pdb',
      r2Key: `pdb/${selected.id}.cif`,
      upstreamUrl: selected.upstreamUrl,
      shortLabel: 'PDB',
      displayLabel: `PDB (${selected.id})`,
      format: 'cif'
    };
  } else if (selected.source === 'swissmodel') {
    const ext = getFileExtensionFromUrl(selected.upstreamUrl);
    const normalizedFormat = ext === 'pdb' ? 'pdb' : (ext === 'bcif' ? 'bcif' : 'cif');
    meta = {
      source: 'swissmodel',
      r2Key: `swissmodel/${sanitizeKeySegment(selected.id)}.${ext}`,
      upstreamUrl: selected.upstreamUrl,
      shortLabel: 'SWISS-MODEL',
      displayLabel: `SWISS-MODEL (${selected.id})`,
      format: normalizedFormat
    };
  } else if (selected.source === 'alphafold') {
    meta = {
      source: 'alphafold',
      r2Key: `alphafold/${sanitizeKeySegment(selected.id)}.cif`,
      upstreamUrl: selected.upstreamUrl,
      shortLabel: 'AlphaFold',
      displayLabel: `AlphaFold (${selected.id})`,
      format: 'cif'
    };
  }

  if (!meta) {
    if (env?.DB && protein?.uniprot) {
      await markStructureFailure(env.DB, protein.uniprot);
    }
    return null;
  }
  if (env?.DB && protein?.uniprot) {
    await clearStructureFailure(env.DB, protein.uniprot);
  }
  return meta;
}

async function structureObjectExists(env, key) {
  if (!env?.STRUCTURES_BUCKET || !key) {
    return false;
  }
  try {
    if (typeof env.STRUCTURES_BUCKET.head === 'function') {
      const head = await env.STRUCTURES_BUCKET.head(key);
      return Boolean(head);
    }
    const existing = await env.STRUCTURES_BUCKET.get(key);
    if (existing?.body && typeof existing.body.cancel === 'function') {
      try {
        await existing.body.cancel();
      } catch {
        // ignore
      }
    }
    return Boolean(existing);
  } catch {
    return false;
  }
}

async function ensureStructureCached(env, meta, options = {}) {
  if (!meta?.r2Key) {
    return false;
  }
  const exists = await structureObjectExists(env, meta.r2Key);
  if (exists) {
    return true;
  }
  if (!meta.upstreamUrl) {
    if (options?.proteinId && env?.DB) {
      await markStructureFailure(env.DB, options.proteinId);
    }
    return false;
  }
  let usage = await getStructureBucketUsage(env);
  if (usage.bytes >= STRUCTURE_BUCKET_CAP_BYTES) {
    const targetBytes = Math.floor(STRUCTURE_BUCKET_CAP_BYTES * STRUCTURE_CACHE_TARGET_RATIO);
    const eviction = await evictStructureCache(env, targetBytes);
    if (eviction.removed > 0) {
      console.warn('GeneGuessr: structure cache eviction', eviction);
    }
    usage = { bytes: eviction.afterBytes };
    if (usage.bytes >= STRUCTURE_BUCKET_CAP_BYTES) {
      console.error('GeneGuessr: structure cache still full after eviction');
      return false;
    }
  }
  const upstreamResp = await fetch(meta.upstreamUrl, {
    method: 'GET',
    headers: { 'User-Agent': 'GeneGuessr-Worker/1.0' }
  });
  if (!upstreamResp.ok) {
    console.warn('GeneGuessr: upstream structure fetch failed', meta.upstreamUrl, upstreamResp.status);
    return false;
  }
  const arrayBuffer = await upstreamResp.arrayBuffer();
  await env.STRUCTURES_BUCKET.put(meta.r2Key, arrayBuffer, {
    httpMetadata: {
      contentType: upstreamResp.headers.get('Content-Type') || 'application/octet-stream'
    }
  });
  await recordStructureCacheEntry(env, meta.r2Key, arrayBuffer.byteLength);
  if (options?.proteinId && env?.DB) {
    await clearStructureFailure(env.DB, options.proteinId);
  }
  return true;
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

async function recordStructureCacheEntry(env, key, size) {
  if (!env?.KV || !key) {
    return;
  }
  const meta = {
    key,
    size: Number(size) || 0,
    lastAccess: Date.now()
  };
  await env.KV.put(`${STRUCTURE_CACHE_META_PREFIX}${key}`, JSON.stringify(meta), {
    expirationTtl: 60 * 60 * 24 * 30
  });
}

async function touchStructureCacheEntry(env, key, sizeHint) {
  if (!env?.KV || !key) {
    return;
  }
  const cacheKey = `${STRUCTURE_CACHE_META_PREFIX}${key}`;
  const raw = await env.KV.get(cacheKey);
  if (!raw) {
    await recordStructureCacheEntry(env, key, sizeHint);
    return;
  }
  try {
    const meta = JSON.parse(raw);
    meta.lastAccess = Date.now();
    if (typeof sizeHint === 'number' && sizeHint > 0) {
      meta.size = sizeHint;
    }
    await env.KV.put(cacheKey, JSON.stringify(meta), { expirationTtl: 60 * 60 * 24 * 30 });
  } catch (err) {
    console.warn('GeneGuessr: failed to touch cache entry, recreating', err);
    await recordStructureCacheEntry(env, key, sizeHint);
  }
}

async function listStructureCacheMeta(env) {
  if (!env?.KV) {
    return [];
  }
  const entries = [];
  let cursor = undefined;
  do {
    const resp = await env.KV.list({ prefix: STRUCTURE_CACHE_META_PREFIX, cursor });
    for (const key of resp.keys || []) {
      const raw = await env.KV.get(key.name);
      if (!raw) {
        continue;
      }
      try {
        const meta = JSON.parse(raw);
        if (meta?.key) {
          entries.push(meta);
        }
      } catch {
        // ignore malformed entry
      }
    }
    cursor = resp.list_complete ? undefined : resp.cursor;
  } while (cursor);
  return entries;
}

async function evictStructureCache(env, targetBytes) {
  const usage = await getStructureBucketUsage(env);
  if (usage.bytes <= targetBytes) {
    return { beforeBytes: usage.bytes, afterBytes: usage.bytes, removed: 0 };
  }
  const entries = await listStructureCacheMeta(env);
  entries.sort((a, b) => (a.lastAccess || 0) - (b.lastAccess || 0));
  let currentBytes = usage.bytes;
  let removed = 0;
  for (const meta of entries) {
    if (!meta?.key) {
      continue;
    }
    try {
      await env.STRUCTURES_BUCKET.delete(meta.key);
    } catch (err) {
      console.warn('GeneGuessr: failed to delete R2 object during eviction', meta.key, err);
    }
    await env.KV.delete(`${STRUCTURE_CACHE_META_PREFIX}${meta.key}`);
    currentBytes -= Number(meta.size) || 0;
    removed += 1;
    if (currentBytes <= targetBytes) {
      break;
    }
  }
  return { beforeBytes: usage.bytes, afterBytes: currentBytes, removed };
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
