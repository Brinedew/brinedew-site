// CORS headers for frontend access
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'https://brinedew.bio',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Import auth handlers
import { handleLogin, handleCallback, handleMe, handleLogout } from './auth.js';

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
