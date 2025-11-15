// CORS headers for frontend access
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://brinedew.bio',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Credentials': 'true',
};
const STRUCTURE_TOKEN_TTL_SECONDS = 300;
const PROTEIN_DATA_URL = 'https://brinedew.bio/static/geneguessr/data.json';
const INDEX_DATA_URL = 'https://brinedew.bio/static/geneguessr/index.json';
const DATA_CACHE_TTL_MS = 60 * 60 * 1000;
const TOKEN_PREFIX = 'structure_token:';

let proteinDataCache = null;
let proteinDataCacheTimestamp = 0;
let indexDataCache = null;
let indexDataCacheTimestamp = 0;

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

    // Public proteins endpoint for autocomplete
    if (url.pathname === '/api/proteins' && request.method === 'GET') {
      try {
        // Fetch the protein database from the static site
        const proteinsResponse = await fetch('https://brinedew.bio/static/geneguessr/data.json');
        if (!proteinsResponse.ok) {
          throw new Error('Failed to fetch protein database');
        }
        const proteins = await proteinsResponse.json();
        
        // Return simplified protein list for autocomplete
        const simplifiedProteins = proteins.map(p => ({
          uniprot: p.uniprot,
          hgnc: p.hgnc,
          synonyms: p.synonyms || [],
          full_name: p.full_name,
          structure: p.structure
        }));
        
        return Response.json(simplifiedProteins, {
          headers: CORS_HEADERS
        });
      } catch (error) {
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
      sourceLabel: meta.shortLabel
    }, { headers: CORS_HEADERS });
  }

  const uniprot = (url.searchParams.get('uniprot') || '').toUpperCase();
  if (!uniprot) {
    return Response.json({ error: 'Missing uniprot parameter' }, { status: 400, headers: CORS_HEADERS });
  }
  const protein = await getProteinByUniprot(uniprot);
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
    displayLabel: meta.displayLabel
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

async function getProteinDataset() {
  const now = Date.now();
  if (proteinDataCache && (now - proteinDataCacheTimestamp) < DATA_CACHE_TTL_MS) {
    return proteinDataCache;
  }
  const response = await fetch(PROTEIN_DATA_URL, { cf: { cacheEverything: true, cacheTtl: 300 } });
  if (!response.ok) {
    throw new Error('Failed to fetch protein dataset');
  }
  const list = await response.json();
  const map = new Map();
  list.forEach((protein) => {
    if (protein && protein.uniprot) {
      map.set(protein.uniprot.toUpperCase(), protein);
    }
  });
  proteinDataCache = map;
  proteinDataCacheTimestamp = now;
  return map;
}

async function getProteinByUniprot(uniprot) {
  const dataset = await getProteinDataset();
  return dataset.get(uniprot.toUpperCase()) || null;
}

async function getIndexData() {
  const now = Date.now();
  if (indexDataCache && (now - indexDataCacheTimestamp) < DATA_CACHE_TTL_MS) {
    return indexDataCache;
  }
  const response = await fetch(INDEX_DATA_URL, { cf: { cacheEverything: true, cacheTtl: 300 } });
  if (!response.ok) {
    throw new Error('Failed to fetch index data');
  }
  const data = await response.json();
  indexDataCache = data;
  indexDataCacheTimestamp = now;
  return data;
}

async function getDailyTargetProtein(env) {
  const indexData = await getIndexData();
  const eligibleIds = indexData?.eligible_ids || [];
  if (!eligibleIds.length) {
    return null;
  }
  const today = new Date().toISOString().slice(0, 10);
  const salt = indexData.salt_hash || '';
  const hash = await sha256(`${today}|${salt}`);
  const hashInt = parseInt(hash.slice(0, 16), 16);
  const idx = hashInt % eligibleIds.length;
  const uniprot = eligibleIds[idx];
  return getProteinByUniprot(uniprot);
}

async function createStructureToken(env, meta) {
  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  await env.STRUCTURE_TOKENS.put(`${TOKEN_PREFIX}${token}`, JSON.stringify(meta), {
    expirationTtl: STRUCTURE_TOKEN_TTL_SECONDS
  });
  return token;
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
      displayLabel: `PDB (${id})`
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
    return {
      source: 'swissmodel',
      r2Key: `swissmodel/${structureId}.${ext}`,
      upstreamUrl: url,
      shortLabel: 'SWISS-MODEL',
      displayLabel: `SWISS-MODEL (${structureId})`
    };
  }
  if (representation.source === 'alphafold' && representation.alphafold && representation.alphafold.model_url) {
    const id = representation.alphafold.id || protein.uniprot;
    return {
      source: 'alphafold',
      r2Key: `alphafold/${sanitizeKeySegment(id)}.cif`,
      upstreamUrl: representation.alphafold.model_url,
      shortLabel: 'AlphaFold',
      displayLabel: `AlphaFold (${id})`
    };
  }
  return null;
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

async function sha256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
