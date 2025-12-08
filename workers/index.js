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
const BYTES_PER_GB = 1024 * 1024 * 1024;
const STRUCTURE_BUCKET_CAP_BYTES = Math.floor(9.5 * BYTES_PER_GB);
const STRUCTURE_CACHE_META_PREFIX = 'structure_meta:';
const STRUCTURE_CACHE_TARGET_RATIO = 0.9;
const DAILY_TARGET_SALT = 'geneguessr-v2-939b5a0b';

// Similarity configuration
// SIMILARITY_MODE: 'legacy' (HiG2Vec only), 'blended' (HiG2Vec + ESM2)
// ESM2_WEIGHT: 0-1, how much to weight ESM2 structural similarity (0.5 = equal blend)
const SIMILARITY_MODE = 'blended';
const ESM2_WEIGHT = 0.5;


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
import { ADMIN_V2_HTML } from './admin-v2-html.js';
import {
  DEFAULT_HINT_COST,
  HINT_REWARD_ON_INCORRECT,
  MAX_GUESSES,
  cleanGeneSummary,
  buildClueSections,
  buildFeedbackSections,
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
  getBlendedSimilarity,
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

    // Admin panel v2 - auto-generated controls from Mol* runtime
    if (url.pathname === '/admin-v2' && request.method === 'GET') {
      return new Response(ADMIN_V2_HTML, {
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

    // Graphics profiles for v2 admin panel - full Mol* props snapshots
    if (url.pathname === '/api/admin/graphics-profiles' && request.method === 'GET') {
      const stored = await env.KV.get('graphics_profiles_v2');
      const profiles = stored ? JSON.parse(stored) : {};
      return Response.json({ profiles }, { headers: corsHeaders });
    }
    
    if (url.pathname === '/api/admin/graphics-profiles' && request.method === 'POST') {
      try {
        const body = await request.json();
        await env.KV.put('graphics_profiles_v2', JSON.stringify(body.profiles || {}));
        return Response.json({ success: true }, { headers: corsHeaders });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 400, headers: corsHeaders });
      }
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

    // Debug endpoint for cache stats (no sensitive data)
    if (url.pathname === '/api/debug/cache-stats' && request.method === 'GET') {
      const usage = await getStructureBucketUsage(env);
      return Response.json({
        structures: usage.objects,
        bytes: usage.bytes,
        megabytes: Math.round(usage.bytes / 1024 / 1024),
        capMegabytes: Math.round(STRUCTURE_BUCKET_CAP_BYTES / 1024 / 1024),
        percentFull: Math.round((usage.bytes / STRUCTURE_BUCKET_CAP_BYTES) * 100)
      }, { headers: corsHeaders });
    }
    
    if (url.pathname === '/api/structure-token' && request.method === 'GET') {
      return handleStructureToken(request, env, corsHeaders);
    }

    // Direct structure access by cacheKey - stable URLs for client-side caching
    // Safe because cacheKey (e.g., "pdb/8J07.bcif") doesn't reveal protein identity
    if (url.pathname === '/api/structure-cached' && request.method === 'GET') {
      return handleCachedStructureFetch(request, env, corsHeaders);
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
        const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 100);
        const excludeRaw = url.searchParams.get('exclude') || '';
        const exclude = excludeRaw ? excludeRaw.split(',').map(id => id.trim().toUpperCase()).filter(Boolean) : [];
        const matches = await searchProteins(env.DB, query, limit, exclude);
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
 * Uses user ID if authenticated, session cookie for guests, IP hash as fallback
 */
function getSessionId(request) {
  // TODO: Extract from auth cookie when B-94 (Discord OAuth) is implemented
  
  // Check for existing session cookie
  const cookieHeader = request.headers.get('Cookie') || '';
  const sessionMatch = cookieHeader.match(/geneguessr_session=([a-zA-Z0-9_-]+)/);
  if (sessionMatch) {
    return `guest_${sessionMatch[1]}`;
  }
  
  // Fallback to IP hash (for clients without cookies, like some bots)
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  return `guest_${hashIP(ip)}`;
}

/**
 * Check if request has a session cookie, if not generate one
 * Returns { sessionToken, isNew } where isNew indicates we need to set the cookie
 */
function resolveSessionCookie(request) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const sessionMatch = cookieHeader.match(/geneguessr_session=([a-zA-Z0-9_-]+)/);
  
  if (sessionMatch) {
    return { sessionToken: sessionMatch[1], isNew: false };
  }
  
  // Generate a new random session token (URL-safe base64-ish)
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const sessionToken = Array.from(bytes)
    .map(b => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  
  return { sessionToken, isNew: true };
}

function resolveSessionContext(request) {
  const url = new URL(request.url);
  const practiceMode = url.searchParams.get('practice') === '1';
  const practiceRestart = practiceMode && url.searchParams.get('restart') === '1';
  
  const { sessionToken, isNew } = resolveSessionCookie(request);
  const baseSessionId = `guest_${sessionToken}`;
  
  return {
    practiceMode,
    practiceRestart,
    sessionId: practiceMode ? `practice_${baseSessionId}` : baseSessionId,
    sessionToken,
    needsSessionCookie: isNew
  };
}

/**
 * Build response headers, optionally adding Set-Cookie for new sessions
 * Cookie is HttpOnly, SameSite=Lax, 1 year expiry - "strictly necessary" for game function
 */
function buildResponseHeaders(corsHeaders, sessionContext) {
  if (!sessionContext?.needsSessionCookie) {
    return corsHeaders;
  }
  
  const maxAge = 365 * 24 * 60 * 60; // 1 year in seconds
  const cookie = `geneguessr_session=${sessionContext.sessionToken}; Path=/; Max-Age=${maxAge}; SameSite=Lax; HttpOnly; Secure`;
  
  return {
    ...corsHeaders,
    'Set-Cookie': cookie
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
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    if (type === 'target') {
      // Use session state to get the actual target protein, not getDailyTargetProtein.
      // This is critical for practice mode where the target is a random protein stored
      // in the session, not the daily target.
      const { sessionId, practiceMode } = resolveSessionContext(request);
      let protein = null;
      
      // Try to get target from session state first
      try {
        const state = await getGameState(env, sessionId);
        if (state?.targetId) {
          protein = await fetchProteinByUniprot(env.DB, state.targetId);
        }
      } catch (err) {
        console.warn('GeneGuessr: failed to get target from session, falling back to daily', err);
      }
      
      // Fall back to daily target if session lookup failed
      if (!protein) {
        protein = await getDailyTargetProtein(env, { practice: practiceMode });
      }
      
      if (!protein) {
        console.error('GeneGuessr: handleStructureToken - no target protein found');
        return Response.json({ error: 'Target unavailable' }, { status: 500, headers: corsHeaders });
      }
      console.log('GeneGuessr: handleStructureToken - got protein', protein.uniprot);
      const meta = await getCanonicalStructureMeta(protein, env);
      if (!meta) {
        console.warn('GeneGuessr: handleStructureToken - no structure meta for', protein.uniprot);
        return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
      }
      console.log('GeneGuessr: handleStructureToken - got meta', meta.source, meta.id);
      const cached = await ensureStructureCached(env, meta, { proteinId: protein.uniprot });
      if (!cached) {
        console.warn('GeneGuessr: handleStructureToken - failed to cache structure for', protein.uniprot);
        return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
      }
      console.log('GeneGuessr: handleStructureToken - structure cached');
      
      // Get file size for client-side cache decisions
      let sizeBytes = 0;
      try {
        const head = await env.STRUCTURES_BUCKET.head(meta.r2Key);
        sizeBytes = head?.size || 0;
      } catch { /* ignore */ }
      
      // SECURITY: Use opaque URL for target - no key visible to client
      const structureUrl = `${url.origin}/api/structure-cached?type=target`;
    
    // Parse chain labels to create redacted version for target
    // SECURITY: Only send chain IDs + is_target flag, never gene names
    let targetChainHints = null;
    let totalChainCount = 0;
    const chainLabelsRaw = meta.source === 'swissmodel' 
      ? protein.swissmodel_chain_labels 
      : protein.pdb_chain_labels;
    if (chainLabelsRaw) {
      try {
        const chainLabels = typeof chainLabelsRaw === 'string'
          ? JSON.parse(chainLabelsRaw)
          : chainLabelsRaw;
        // Count ALL chains in the structure (for deciding whether to show labels)
        totalChainCount = chainLabels?.reduce((sum, l) => sum + (l.chains?.length || 0), 0) || 0;
        // Redact: only keep chains array for target entries, no gene/name
        targetChainHints = chainLabels
          ?.filter(l => l.is_target)
          ?.map(l => ({ chains: l.chains }));
        if (targetChainHints?.length === 0) targetChainHints = null;
      } catch (e) {
        console.warn('Failed to parse chain_labels for target hints', e);
      }
    }
    
    // SECURITY: For target structures, redact identifying info (PDB ID, etc)
    // The URL still works (server-side routing), but client can't extract the ID
    return Response.json({
      sourceLabel: meta.shortLabel,  // "PDB" / "AlphaFold" / "SWISS-MODEL" - ok to reveal source type
      displayLabel: `Source: ${meta.shortLabel}`,  // Redact structure ID (was "PDB (3BDW)")
      format: meta.format || 'cif',
      url: structureUrl,  // URL is opaque enough - key is encoded, not human-readable at a glance
      // SECURITY: Don't send cacheKey to client for target - it contains the structure ID
      // cacheKey: meta.r2Key,  // REMOVED - was "pdb/3BDW.bcif"
      sizeBytes,
      targetChainHints,
      totalChainCount
    }, { headers: corsHeaders });
  }

  const uniprot = (url.searchParams.get('uniprot') || '').toUpperCase();
  if (!uniprot) {
    return Response.json({ error: 'Missing uniprot parameter' }, { status: 400, headers: corsHeaders });
  }
  // Try to fetch full protein from database first (has pre-seeded structure metadata)
  // Falls back to minimal object for API discovery if not in database
  let protein = await fetchProteinByUniprot(env.DB, uniprot);
  if (!protein) {
    protein = { uniprot }; // Minimal object - will trigger slow API discovery path
  }
  const meta = await getCanonicalStructureMeta(protein, env);
  if (!meta) {
    return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
  }
  const cached = await ensureStructureCached(env, meta, { proteinId: uniprot });
  if (!cached) {
    return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
  }
  
  // Get file size for client-side cache decisions
  let sizeBytes = 0;
  try {
    const head = await env.STRUCTURES_BUCKET.head(meta.r2Key);
    sizeBytes = head?.size || 0;
  } catch { /* ignore */ }
  
  const structureUrl = `${url.origin}/api/structure-cached?key=${encodeURIComponent(meta.r2Key)}`;
  // Parse chain labels if present (stored as JSON string in D1)
  // Use the right chain labels based on structure source
  let chainLabels = null;
  const chainLabelsRaw = meta.source === 'swissmodel' 
    ? protein.swissmodel_chain_labels 
    : protein.pdb_chain_labels;
  if (chainLabelsRaw) {
    try {
      chainLabels = typeof chainLabelsRaw === 'string'
        ? JSON.parse(chainLabelsRaw)
        : chainLabelsRaw;
    } catch (e) {
      console.warn('Failed to parse chain_labels', e);
    }
  }
  return Response.json({
    sourceLabel: meta.shortLabel,
    displayLabel: meta.displayLabel,
    format: meta.format || 'cif',
    url: structureUrl,
    cacheKey: meta.r2Key,
    sizeBytes,
    chainLabels
  }, { headers: corsHeaders });
  } catch (err) {
    console.error('GeneGuessr: handleStructureToken unhandled error', err);
    return Response.json({ error: 'Internal server error', details: String(err) }, { status: 500, headers: corsHeaders });
  }
}

/**
 * Direct structure fetch by cacheKey (r2Key).
 * Returns structure with long cache headers since the URL is stable.
 */
async function handleCachedStructureFetch(request, env, corsHeaders) {
  const url = new URL(request.url);
  let cacheKey = url.searchParams.get('key');
  
  // SECURITY: Support type=target to fetch target structure without exposing the key
  // This prevents cheating by inspecting the URL to see the PDB ID
  const type = url.searchParams.get('type');
  if (type === 'target') {
    const { sessionId, practiceMode } = resolveSessionContext(request);
    let protein = null;
    
    try {
      const state = await getGameState(env, sessionId);
      if (state?.targetId) {
        protein = await fetchProteinByUniprot(env.DB, state.targetId);
      }
    } catch (err) {
      console.warn('GeneGuessr: structure-cached target lookup failed', err);
    }
    
    if (!protein) {
      protein = await getDailyTargetProtein(env, { practice: practiceMode });
    }
    
    if (!protein) {
      return Response.json({ error: 'Target unavailable' }, { status: 404, headers: corsHeaders });
    }
    
    const meta = await getCanonicalStructureMeta(protein, env);
    if (!meta?.r2Key) {
      return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
    }
    cacheKey = meta.r2Key;
  }
  
  if (!cacheKey) {
    return Response.json({ error: 'Missing key parameter' }, { status: 400, headers: corsHeaders });
  }
  
  // Validate cacheKey format to prevent path traversal
  // Valid formats: "pdb/XXXX.bcif", "alphafold/XXXXX.cif", "swissmodel/XXXXX.pdb"
  const validKeyPattern = /^(pdb|alphafold|swissmodel)\/[A-Za-z0-9_-]+\.(bcif|cif|pdb)$/;
  if (!validKeyPattern.test(cacheKey)) {
    return Response.json({ error: 'Invalid key format' }, { status: 400, headers: corsHeaders });
  }
  
  const object = await env.STRUCTURES_BUCKET.get(cacheKey);
  if (!object) {
    return Response.json({ error: 'Structure not cached' }, { status: 404, headers: corsHeaders });
  }
  
  await touchStructureCacheEntry(env, cacheKey, object.size);
  
  // Long cache - 7 days. Structure files don't change.
  return new Response(object.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': 'public, max-age=604800, immutable'
    }
  });
}

async function handleGameBootstrap(request, env, corsHeaders) {
  try {
    const sessionContext = resolveSessionContext(request);
    const { sessionId, practiceMode, practiceRestart } = sessionContext;
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext);
    
    const targetSeed = await getDailyTargetProtein(env, { practice: practiceMode });
    if (!targetSeed && !practiceMode) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
    }
    const state = await ensureSessionForToday(env, sessionId, targetSeed, { practiceMode, forceReset: practiceRestart });
    const targetProtein = targetSeed && state.targetId === targetSeed.uniprot
      ? targetSeed
      : await fetchProteinByUniprot(env.DB, state.targetId);
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
    }
    await hydrateGuessProteins(env, sessionId, state, targetProtein);
    const payload = buildGamePayload(state, targetProtein);
    return Response.json(payload, { headers: responseHeaders });
  } catch (err) {
    console.error('GeneGuessr: bootstrap failed', err);
    return Response.json({ error: 'Failed to load game state' }, { status: 500, headers: corsHeaders });
  }
}

async function handleGuessSubmission(request, env, corsHeaders) {
  try {
    const sessionContext = resolveSessionContext(request);
    const { sessionId, practiceMode } = sessionContext;
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext);
    
    const targetSeed = await getDailyTargetProtein(env, { practice: practiceMode ? true : false });
    if (!targetSeed && !practiceMode) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
    }
    const body = await safeJson(request);
    const uniprot = (body?.uniprot || '').toUpperCase();
    if (!uniprot) {
      return Response.json({ error: 'Missing uniprot' }, { status: 400, headers: responseHeaders });
    }
    let state = await ensureSessionForToday(env, sessionId, targetSeed, { practiceMode });
    const targetProtein = targetSeed && state.targetId === targetSeed.uniprot
      ? targetSeed
      : await fetchProteinByUniprot(env.DB, state.targetId);
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
    }
    if (state.won || (state.guesses?.length || 0) >= MAX_GUESSES) {
      return Response.json({ error: 'Round already completed' }, { status: 409, headers: responseHeaders });
    }
    if ((state.guesses || []).some((entry) => entry.uniprot === uniprot)) {
      return Response.json({ error: 'Protein already guessed' }, { status: 409, headers: responseHeaders });
    }
    const guessProtein = await fetchProteinByUniprot(env.DB, uniprot);
    if (!guessProtein) {
      return Response.json({ error: 'Protein not found' }, { status: 404, headers: responseHeaders });
    }
    // Calculate similarity - use blended (HiG2Vec + ESM2) or legacy (HiG2Vec only)
    let goSimilarity;
    if (SIMILARITY_MODE === 'blended') {
      const simResult = await getBlendedSimilarity(
        env.DB,
        guessProtein.gene,
        targetProtein.gene,
        { esm2Weight: ESM2_WEIGHT }
      );
      goSimilarity = simResult.blended;
    } else {
      goSimilarity = await getGoSimilarityFromEmbeddings(
        env.DB,
        guessProtein.gene,
        targetProtein.gene
      );
    }
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
    return Response.json(payload, { headers: responseHeaders });
  } catch (err) {
    console.error('GeneGuessr: guess submission failed', err);
    return Response.json({ error: 'Guess submission failed' }, { status: 500, headers: corsHeaders });
  }
}

async function handleHintReveal(request, env, corsHeaders) {
  try {
    const sessionContext = resolveSessionContext(request);
    const { sessionId, practiceMode } = sessionContext;
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext);
    
    const targetSeed = await getDailyTargetProtein(env, { practice: practiceMode ? true : false });
    if (!targetSeed && !practiceMode) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
    }
    const body = await safeJson(request);
    const hintId = body?.hintId || body?.id;
    if (!hintId) {
      return Response.json({ error: 'Missing hintId' }, { status: 400, headers: responseHeaders });
    }
    const state = await ensureSessionForToday(env, sessionId, targetSeed, { practiceMode });
    const targetProtein = targetSeed && state.targetId === targetSeed.uniprot
      ? targetSeed
      : await fetchProteinByUniprot(env.DB, state.targetId);
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
    }
    const clueSections = buildClueSections(targetProtein);
    const hintText = extractHintText(clueSections, hintId);
    if (!hintText) {
      return Response.json({ error: 'Hint not found' }, { status: 404, headers: responseHeaders });
    }
    await hydrateGuessProteins(env, sessionId, state, targetProtein);
    if (!(state.revealedHints || []).includes(hintId)) {
      if ((state.hintBalance || 0) < DEFAULT_HINT_COST) {
        return Response.json({ error: 'Insufficient hints' }, { status: 402, headers: responseHeaders });
      }
      state.revealedHints = [...(state.revealedHints || []), hintId];
      state.hintBalance = Math.max(0, (state.hintBalance || 0) - DEFAULT_HINT_COST);
      await saveGameState(env, sessionId, state);
    }
    const payload = buildGamePayload(state, targetProtein, { clueSections });
    payload.revealedHint = { id: hintId, text: hintText };
    return Response.json(payload, { headers: responseHeaders });
  } catch (err) {
    console.error('GeneGuessr: hint reveal failed', err);
    return Response.json({ error: 'Hint reveal failed' }, { status: 500, headers: corsHeaders });
  }
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

  // Check for manual override
  const today = new Date().toISOString().slice(0, 10);
  const overrideId = await env.KV.get(`puzzle_override:${today}`);
  if (overrideId) {
    const overrideProtein = await fetchProteinByUniprot(env.DB, overrideId);
    if (overrideProtein) {
      return overrideProtein;
    }
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
      // Calculate similarity - use blended (HiG2Vec + ESM2) or legacy (HiG2Vec only)
      let goSimilarity;
      if (SIMILARITY_MODE === 'blended') {
        const simResult = await getBlendedSimilarity(
          env.DB,
          entry.protein.gene || entry.protein.hgnc,
          targetProtein.gene,
          { esm2Weight: ESM2_WEIGHT }
        );
        goSimilarity = simResult.blended;
      } else {
        goSimilarity = await getGoSimilarityFromEmbeddings(
          env.DB,
          entry.protein.gene || entry.protein.hgnc,
          targetProtein.gene
        );
      }
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
      sections: buildFeedbackSections(guessProteinCleaned),
      headerLabel: guessProtein.hgnc || guessProtein.uniprot,
      fullName: guessProtein.full_name || '',
      isLatest
    });
  });
  const lost = !state.won && guessEntries.length >= MAX_GUESSES;
  const targetReveal = (state.won || lost)
    ? sanitizeTargetProtein(targetProtein, { revealIdentity: true })
    : null;
  const targetRevealSections = targetReveal ? buildFeedbackSections(targetProtein) : null;
  const shareText = targetReveal ? buildShareText(state, guessEntries) : null;
  applyMatchReveals(maskedSections, aggregatedMatches);
  applyLatestHighlights(maskedSections, latestMatches);
  // Only reveal targetId after game ends (won or lost) to prevent cheating
  const gameOver = Boolean(state.won) || lost;
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
      ...(gameOver && { targetId: state.targetId })
    },
    clueTarget,
    clue: {
      sections: maskedSections,
      allMatches: aggregatedMatches,
      latestMatches
    },
    guesses: guessEntries,
    targetReveal,
    targetRevealSections,
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

/**
 * Build structure metadata from flat protein columns.
 * Returns null if structure data is missing or incomplete.
 */
function buildMetaFromStoredStructure(protein) {
  if (!protein) {
    return null;
  }
  
  const primarySource = protein.structure_source;
  if (!primarySource) {
    return null;
  }
  
  // Build meta based on the preferred source
  if (primarySource === 'pdb' && protein.pdb_id) {
    const pdbId = protein.pdb_id.toUpperCase();
    // Use RCSB ModelServer with BCIF encoding - much smaller than raw CIF
    // e.g. 8J07: 337MB as CIF vs 42MB as BCIF (8x reduction)
    // copy_all_categories=false strips metadata we don't need for visualization
    const upstreamUrl = `https://models.rcsb.org/v1/${pdbId}/full?encoding=bcif&copy_all_categories=false`;
    const r2Key = `pdb/${pdbId}.bcif`;
    
    return {
      source: 'pdb',
      r2Key,
      upstreamUrl,
      shortLabel: 'PDB',
      displayLabel: `PDB (${pdbId})`,
      format: 'bcif'
    };
  }
  
  if (primarySource === 'swissmodel' && protein.swissmodel_url) {
    const template = protein.swissmodel_template || 'model';
    const modelId = `${protein.uniprot}_${template}`;
    const url = protein.swissmodel_url;
    // Check for format in URL (handles query strings like .pdb?range=...)
    const ext = url.includes('.pdb') ? 'pdb' : (url.includes('.bcif') ? 'bcif' : 'cif');
    return {
      source: 'swissmodel',
      r2Key: `swissmodel/${sanitizeKeySegment(modelId)}.${ext}`,
      upstreamUrl: url,
      shortLabel: 'SWISS-MODEL',
      displayLabel: `SWISS-MODEL (${modelId})`,
      format: ext
    };
  }
  
  if (primarySource === 'alphafold' && protein.alphafold_url) {
    const url = protein.alphafold_url;
    // Check for format in URL (handles query strings)
    const format = url.includes('.pdb') ? 'pdb' : 'cif';
    return {
      source: 'alphafold',
      r2Key: `alphafold/${sanitizeKeySegment(protein.uniprot)}.${format}`,
      upstreamUrl: url,
      shortLabel: 'AlphaFold',
      displayLabel: `AlphaFold (${protein.uniprot})`,
      format
    };
  }
  
  // Fallback: try any available source
  if (protein.swissmodel_url) {
    const template = protein.swissmodel_template || 'model';
    const modelId = `${protein.uniprot}_${template}`;
    const url = protein.swissmodel_url;
    // Check for format in URL (handles query strings like .pdb?range=...)
    const ext = url.includes('.pdb') ? 'pdb' : 'cif';
    return {
      source: 'swissmodel',
      r2Key: `swissmodel/${sanitizeKeySegment(modelId)}.${ext}`,
      upstreamUrl: url,
      shortLabel: 'SWISS-MODEL',
      displayLabel: `SWISS-MODEL (${modelId})`,
      format: ext
    };
  }
  
  if (protein.alphafold_url) {
    const url = protein.alphafold_url;
    // Check for format in URL (handles query strings)
    const format = url.includes('.pdb') ? 'pdb' : 'cif';
    return {
      source: 'alphafold',
      r2Key: `alphafold/${sanitizeKeySegment(protein.uniprot)}.${format}`,
      upstreamUrl: url,
      shortLabel: 'AlphaFold',
      displayLabel: `AlphaFold (${protein.uniprot})`,
      format
    };
  }
  
  if (protein.pdb_id) {
    const pdbId = protein.pdb_id.toUpperCase();
    // Use RCSB ModelServer with BCIF encoding for smaller file size
    const upstreamUrl = `https://models.rcsb.org/v1/${pdbId}/full?encoding=bcif&copy_all_categories=false`;
    const r2Key = `pdb/${pdbId}.bcif`;
    
    return {
      source: 'pdb',
      r2Key,
      upstreamUrl,
      shortLabel: 'PDB',
      displayLabel: `PDB (${pdbId})`,
      format: 'bcif'
    };
  }
  
  return null;
}

const STRUCTURE_SOURCE_CACHE_PREFIX = 'structure_source:';
const STRUCTURE_SOURCE_CACHE_TTL = 60 * 60 * 24; // 24 hours

async function getCanonicalStructureMeta(protein, env) {
  if (!protein) {
    return null;
  }
  
  // FAST PATH: Use pre-seeded structure metadata from database
  // This avoids 3 slow external API calls (PDB, AlphaFold, SWISS-MODEL)
  const storedMeta = buildMetaFromStoredStructure(protein);
  if (storedMeta) {
    console.log(`GeneGuessr: using stored structure metadata for ${protein.uniprot}`);
    return storedMeta;
  }
  
  // SLOW PATH: Discover structure from external APIs (for proteins not in our database)
  // Check KV cache first to avoid re-discovering
  const cacheKey = `${STRUCTURE_SOURCE_CACHE_PREFIX}${protein.uniprot}`;
  try {
    const cached = await env.KV?.get(cacheKey, { type: 'json' });
    if (cached) {
      console.log(`GeneGuessr: structure source cache hit for ${protein.uniprot}`);
      return cached;
    }
  } catch (err) {
    console.warn('GeneGuessr: failed to read structure source cache', err);
  }
  console.log(`GeneGuessr: structure source cache miss for ${protein.uniprot}, discovering from APIs...`);
  
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
        const chainCount = m.chain_id ? m.chain_id.split(',').length : 1;  // Count chains in structure
        // Only include X-ray diffraction structures with reasonable resolution
        if (m.experimental_method === 'X-ray diffraction' && resolution && resolution <= PDB_RESOLUTION_MAX) {
          candidates.push({
            source: 'pdb',
            id: pdbId,
            // Use RCSB ModelServer with BCIF encoding - much smaller than raw CIF
            upstreamUrl: `https://models.rcsb.org/v1/${pdbId}/full?encoding=bcif&copy_all_categories=false`,
            format: 'bcif',
            coverage,
            chainCount,  // Number of chains (prefer fewer for simpler structures)
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
    let afAdded = false;
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
          afAdded = true;
        }
      }
    }
    // Fallback: if API returned empty/invalid, construct v6 URL directly
    // AlphaFold has predictions for virtually all human proteins, so worth trying
    if (!afAdded) {
      const fallbackCifUrl = `https://alphafold.ebi.ac.uk/files/AF-${protein.uniprot}-F1-model_v6.cif`;
      candidates.push({
        source: 'alphafold',
        id: protein.uniprot,
        upstreamUrl: fallbackCifUrl,
        coverage: 1.0,
        quality: 70  // Default reasonable pLDDT assumption
      });
    }
  } catch (err) {
    console.warn('GeneGuessr: failed to fetch AlphaFold for', protein.uniprot, err);
    // Fallback on error: try constructed v6 URL anyway
    const fallbackCifUrl = `https://alphafold.ebi.ac.uk/files/AF-${protein.uniprot}-F1-model_v6.cif`;
    candidates.push({
      source: 'alphafold',
      id: protein.uniprot,
      upstreamUrl: fallbackCifUrl,
      coverage: 1.0,
      quality: 70
    });
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
          if (cifUrl && coverage >= COVERAGE_THRESHOLD && gmqe && gmqe >= 0.6) {
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
        pdbs.sort((a, b) => b.coverage - a.coverage || (a.chainCount || Infinity) - (b.chainCount || Infinity));  // Higher coverage, fewer chains better
        selected = pdbs[0];
        break;
      }
    } else if (source === 'swissmodel') {
      const swiss = candidates.filter(c => c.source === 'swissmodel' && c.coverage >= COVERAGE_THRESHOLD && (c.quality || 0) >= 0.6);
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
    // Use BCIF format from ModelServer
    const ext = selected.format === 'bcif' ? 'bcif' : 'cif';
    meta = {
      source: 'pdb',
      r2Key: `pdb/${selected.id}.${ext}`,
      upstreamUrl: selected.upstreamUrl,
      shortLabel: 'PDB',
      displayLabel: `PDB (${selected.id})`,
      format: ext
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
  
  // Cache the discovered structure source
  try {
    await env.KV?.put(cacheKey, JSON.stringify(meta), { expirationTtl: STRUCTURE_SOURCE_CACHE_TTL });
    console.log(`GeneGuessr: cached structure source for ${protein.uniprot}`);
  } catch (err) {
    console.warn('GeneGuessr: failed to cache structure source', err);
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

// Threshold for switching to multipart upload (10MB)
// Worker memory limit is 128MB, multipart keeps memory bounded to ~8MB chunks
const MULTIPART_THRESHOLD_BYTES = 10 * 1024 * 1024;
const MULTIPART_PART_SIZE = 8 * 1024 * 1024; // 8MB parts (minimum is 5MB)

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
  if (!upstreamResp.ok || !upstreamResp.body) {
    console.warn('GeneGuessr: upstream structure fetch failed', meta.upstreamUrl, upstreamResp.status);
    return false;
  }
  
  // Determine content type based on format
  const contentType = meta.format === 'bcif' 
    ? 'application/octet-stream' 
    : (upstreamResp.headers.get('Content-Type') || 'chemical/x-cif');
  
  // Check if we need multipart upload (Content-Length may be missing for chunked responses)
  const contentLength = upstreamResp.headers.get('Content-Length');
  const estimatedSize = contentLength ? parseInt(contentLength, 10) : MULTIPART_THRESHOLD_BYTES + 1;
  
  if (estimatedSize <= MULTIPART_THRESHOLD_BYTES) {
    // Small file: simple put (streams directly, low memory)
    await env.STRUCTURES_BUCKET.put(meta.r2Key, upstreamResp.body, {
      httpMetadata: { contentType }
    });
  } else {
    // Large file: use multipart upload to keep memory bounded
    // This handles files up to 5TB in ~8MB chunks without exceeding Worker memory
    console.log(`GeneGuessr: using multipart upload for ${meta.r2Key} (estimated ${Math.round(estimatedSize/1024/1024)}MB)`);
    await multipartUploadFromStream(env, meta.r2Key, upstreamResp.body, contentType);
  }
  
  // Get actual size from R2 object (Content-Length may be missing from upstream)
  const uploaded = await env.STRUCTURES_BUCKET.head(meta.r2Key);
  const uploadedSize = uploaded?.size || 0;
  await recordStructureCacheEntry(env, meta.r2Key, uploadedSize);
  if (options?.proteinId && env?.DB) {
    await clearStructureFailure(env.DB, options.proteinId);
  }
  return true;
}

/**
 * Upload a stream to R2 using multipart upload.
 * Keeps memory bounded by processing in MULTIPART_PART_SIZE chunks.
 * See: https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/
 */
async function multipartUploadFromStream(env, r2Key, stream, contentType) {
  const mpu = await env.STRUCTURES_BUCKET.createMultipartUpload(r2Key, {
    httpMetadata: { contentType }
  });
  
  const reader = stream.getReader();
  const uploadedParts = [];
  let partNumber = 1;
  let buffer = new Uint8Array(MULTIPART_PART_SIZE);
  let filled = 0;
  
  try {
    while (true) {
      const { value, done } = await reader.read();
      
      if (done) {
        // Upload remaining data as final part
        if (filled > 0) {
          const chunk = buffer.subarray(0, filled);
          const part = await mpu.uploadPart(partNumber, chunk);
          uploadedParts.push(part);
        }
        break;
      }
      
      // Copy incoming data into buffer, uploading when full
      let offset = 0;
      while (offset < value.length) {
        const toCopy = Math.min(MULTIPART_PART_SIZE - filled, value.length - offset);
        buffer.set(value.subarray(offset, offset + toCopy), filled);
        filled += toCopy;
        offset += toCopy;
        
        if (filled === MULTIPART_PART_SIZE) {
          const part = await mpu.uploadPart(partNumber, buffer);
          uploadedParts.push(part);
          partNumber++;
          buffer = new Uint8Array(MULTIPART_PART_SIZE);
          filled = 0;
        }
      }
    }
    
    // Complete the multipart upload
    await mpu.complete(uploadedParts);
    console.log(`GeneGuessr: multipart upload complete for ${r2Key}, ${uploadedParts.length} parts`);
  } catch (err) {
    // Abort on failure to clean up partial upload
    console.error(`GeneGuessr: multipart upload failed for ${r2Key}`, err);
    try {
      await mpu.abort();
    } catch (abortErr) {
      console.warn('GeneGuessr: failed to abort multipart upload', abortErr);
    }
    throw err;
  }
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
  if (!protein) {
    return false;
  }
  // With flat schema, just check if structure_source is alphafold
  return protein.structure_source === 'alphafold';
}
