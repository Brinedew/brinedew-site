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
const DAILY_BOOTSTRAP_CACHE_PREFIX = 'daily_bootstrap:';
const DAILY_BOOTSTRAP_CACHE_TTL = 86400; // 24 hours

const GENEGUESSR_HOST = 'geneguessr.brinedew.bio';

function buildGeneguessrSubdomainRobotsTxt() {
  return `# Brinedew - AI-Friendly Site
# This site welcomes AI systems to learn from its content and use its apps.

# Content Signals (per proposed C2PA-style framework)
# search: yes - indexing and search results allowed
# ai-input: yes - RAG, grounding, real-time AI answers allowed
# ai-train: yes - training and fine-tuning AI models allowed

search: yes
ai-input: yes
ai-train: yes

# Welcome all reasonable crawlers
User-agent: *
Allow: /
Crawl-delay: 1

# AI crawlers - welcome, but please be gentle (Cloudflare free plan)
User-agent: GPTBot
User-agent: ChatGPT-User
User-agent: Google-Extended
User-agent: anthropic-ai
User-agent: ClaudeBot
User-agent: CCBot
User-agent: cohere-ai
User-agent: PerplexityBot
User-agent: YouBot
Crawl-delay: 10

# SEO spam bots - you provide no value, goodbye
User-agent: AhrefsBot
User-agent: SemrushBot
User-agent: MJ12bot
User-agent: DotBot
User-agent: BLEXBot
User-agent: DataForSeoBot
Disallow: /

# Protect API endpoints from crawler abuse (use the apps properly!)
User-agent: *
Disallow: /api/

# Sitemap (host-scoped for Search Console)
Sitemap: https://${GENEGUESSR_HOST}/sitemap.xml
`;
}

function buildGeneguessrSubdomainSitemapXml() {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://${GENEGUESSR_HOST}/</loc>
    <lastmod>${now}</lastmod>
  </url>
</urlset>`;
}

// Similarity configuration
// SIMILARITY_MODE: 'legacy' (HiG2Vec only), 'blended' (HiG2Vec + ESM2)
// ESM2_WEIGHT: 0-1, how much to weight ESM2 structural similarity (0.5 = equal blend)
const SIMILARITY_MODE = 'blended';
const ESM2_WEIGHT = 0.25;


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
  handleProteinPreview,
  handleAdminSchedule,
  handleAdminCards,
  handleAdminGuessStats,
  handleAdminSimilarity,
  isAdmin
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
  getDomainSpoilerTokensFromFullName,
  collectMatchedHintTexts,
  extractHintData,
  maskClueSections,
  sanitizeTargetProtein,
  scoreGuess
} from './lib/game-engine.js';
import {
  fetchProteinByUniprot,
  searchProteins,
  getEligibleProteinIds,
  pickDailyTarget,
  pickRandomProteinBalanced,
  getBlendedSimilarity,
  getHig2vecSimilarity,
  markStructureFailure,
  clearStructureFailure
} from './lib/protein-store.js';
import { resolveStructureRepresentation } from './lib/structure-utils.js';
import { recordDailyGuessAggregates } from './lib/guess-aggregates.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    console.log(`[WORKER] Incoming: ${request.method} ${url.pathname}`);
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = getCorsHeaders(origin);

    // Serve host-scoped robots/sitemap for the geneguessr subdomain.
    // This prevents Google Search Console from seeing a sitemap full of brinedew.bio URLs.
    if (url.hostname === GENEGUESSR_HOST && (request.method === 'GET' || request.method === 'HEAD')) {
      if (url.pathname === '/robots.txt') {
        return new Response(request.method === 'HEAD' ? null : buildGeneguessrSubdomainRobotsTxt(), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'max-age=600',
          },
        });
      }

      if (url.pathname === '/sitemap.xml') {
        return new Response(request.method === 'HEAD' ? null : buildGeneguessrSubdomainSitemapXml(), {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': 'max-age=600',
          },
        });
      }
    }
    
    // Handle geneguessr subdomain proxy - proxy NON-API, NON-ADMIN requests from subdomain to main site
    // NOTE: /admin and /admin-v2 are served by the Worker and must NOT be proxied.
    if (
      url.hostname === GENEGUESSR_HOST &&
      !url.pathname.startsWith('/api/') &&
      url.pathname !== '/admin' &&
      url.pathname !== '/admin-v2'
    ) {
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
      
      // For HTML, rewrite links so navigation goes to main site, not subdomain
      if (response.headers.get('content-type')?.includes('text/html')) {
        let html = await response.text();
        // Rewrite relative homepage links to absolute main site URL
        // The PageTitle component renders: <a href={baseDir} class="site-brand">
        // On subdomain root, baseDir is "/" which we need to change to "https://brinedew.bio/"
        html = html.replace(
          /<a\s+href=["']\/["']\s+class=["']site-brand["']/g,
          '<a href="https://brinedew.bio/" class="site-brand"'
        );

        // Rewrite all internal navigation links to point to main domain
        // This prevents SPA navigation on the subdomain from going to wrong paths
        // Match href="/tags/...", href="/posts/...", href="/wiki/...", etc.
        html = html.replace(
          /href=["']\/(tags|posts|wiki|About|index)([^"']*)["']/g,
          'href="https://brinedew.bio/$1$2"'
        );

        // Keep share/debug metadata consistent with the subdomain host.
        if (url.pathname === '/') {
          html = html.replace(
            /<meta\b[^>]*\b(?:property|name)=["']og:url["'][^>]*>/gi,
            `<meta property="og:url" content="https://${GENEGUESSR_HOST}/">`
          );
          html = html.replace(
            /<meta\b[^>]*\b(?:property|name)=["']twitter:url["'][^>]*>/gi,
            `<meta name="twitter:url" content="https://${GENEGUESSR_HOST}/">`
          );
          // Use GeneGuessr-specific og:image for Discord/social embeds
          const geneGuessrOgImage = 'https://brinedew.bio/static/geneguessr/og-image.png';
          html = html.replace(
            /<meta\b[^>]*\b(?:property)=["']og:image["'][^>]*>/gi,
            `<meta property="og:image" content="${geneGuessrOgImage}">`
          );
          html = html.replace(
            /<meta\b[^>]*\b(?:property)=["']og:image:url["'][^>]*>/gi,
            `<meta property="og:image:url" content="${geneGuessrOgImage}">`
          );
          html = html.replace(
            /<meta\b[^>]*\b(?:name)=["']twitter:image["'][^>]*>/gi,
            `<meta name="twitter:image" content="${geneGuessrOgImage}">`
          );
        }
        html = html.replace(
          /<meta\b[^>]*\b(?:property|name)=["']twitter:domain["'][^>]*>/gi,
          `<meta name="twitter:domain" content="${GENEGUESSR_HOST}">`
        );

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

    // Admin panel UI (restricted to admin Discord session)
    if (url.pathname === '/admin' && request.method === 'GET') {
      if (!(await isAdmin(request, env))) {
        return new Response('Unauthorized', { status: 403 });
      }
      return new Response(ADMIN_HTML, {
        headers: {
          'Content-Type': 'text/html;charset=UTF-8',
        }
      });
    }

    // Admin panel v2 - auto-generated controls from Mol* runtime
    if (url.pathname === '/admin-v2' && request.method === 'GET') {
      if (!(await isAdmin(request, env))) {
        return new Response('Unauthorized', { status: 403 });
      }
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
      if (!(await isAdmin(request, env))) {
        return Response.json({ error: 'Unauthorized' }, { status: 403, headers: corsHeaders });
      }
      const stored = await env.KV.get('graphics_profiles_v2');
      const profiles = stored ? JSON.parse(stored) : {};
      return Response.json({ profiles }, { headers: corsHeaders });
    }
    
    if (url.pathname === '/api/admin/graphics-profiles' && request.method === 'POST') {
      if (!(await isAdmin(request, env))) {
        return Response.json({ error: 'Unauthorized' }, { status: 403, headers: corsHeaders });
      }
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

    if (url.pathname === '/api/admin/similarity' && request.method === 'GET') {
      const response = await handleAdminSimilarity(request, env);
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

    if (url.pathname === '/api/admin/schedule' && request.method === 'GET') {
      const response = await handleAdminSchedule(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }

    if (url.pathname === '/api/admin/cards' && request.method === 'GET') {
      const response = await handleAdminCards(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }

    if (url.pathname === '/api/admin/guess-stats' && request.method === 'GET') {
      const response = await handleAdminGuessStats(request, env);
      return new Response(response.body, {
        status: response.status,
        headers: { ...Object.fromEntries(response.headers), ...corsHeaders }
      });
    }

    // Maintenance: purge orphaned structure objects from R2.
    // Orphan = object exists in R2 but KV has no structure_meta:<key> record.
    // Cursor-based so it can be run repeatedly without timing out.
    if (url.pathname === '/api/admin/purge-orphan-structures' && request.method === 'POST') {
      return handleAdminPurgeOrphanStructures(request, env, corsHeaders);
    }

    // Maintenance: delete a specific structure object from R2 by key.
    // This is for removing large or problematic cached blobs even when they are not orphans.
    if (url.pathname === '/api/admin/delete-structure' && request.method === 'POST') {
      return handleAdminDeleteStructure(request, env, corsHeaders);
    }

    // Maintenance: purge any structure objects that are no longer referenced by the current DB.
    // This cleans up blobs that became obsolete after reseeding/rebuilding structure columns.
    if (url.pathname === '/api/admin/purge-unreferenced-structures' && request.method === 'POST') {
      return handleAdminPurgeUnreferencedStructures(request, env, corsHeaders);
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
    // Support both GET (fetch) and HEAD (validation) requests
    if (url.pathname === '/api/structure-cached' && (request.method === 'GET' || request.method === 'HEAD')) {
      return handleCachedStructureFetch(request, env, ctx, corsHeaders);
    }

    if (url.pathname === '/api/game/bootstrap' && request.method === 'GET') {
      return handleGameBootstrap(request, env, ctx, corsHeaders);
    }

    if (url.pathname === '/api/game/guess' && request.method === 'POST') {
      return handleGuessSubmission(request, env, corsHeaders);
    }

    if (url.pathname === '/api/game/reveal-hint' && request.method === 'POST') {
      return handleHintReveal(request, env, corsHeaders);
    }

    // Lazy similarity calculation - called after guess card is shown
    if (url.pathname === '/api/game/guess-similarity' && request.method === 'POST') {
      return handleGuessSimilarity(request, env, corsHeaders);
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

    return Response.json({ error: 'Not found' }, { 
      status: 404,
      headers: corsHeaders 
    });
  }
};

function parseCookies(cookieHeader) {
  const cookies = {};
  cookieHeader.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) {
      cookies[name] = rest.join('=');
    }
  });
  return cookies;
}

async function getAuthenticatedUserIdFromRequest(request, env) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const cookies = parseCookies(cookieHeader);
  const authSession = cookies.session;
  if (!authSession) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(authSession)) return null;

  try {
    const id = env.GAME_SESSIONS.idFromName(`session:${authSession}`);
    const stub = env.GAME_SESSIONS.get(id);
    const resp = await stub.fetch('http://internal/get');
    if (!resp.ok) return null;
    const session = await resp.json();
    return session?.user_id || null;
  } catch {
    return null;
  }
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

async function resolveSessionContextAsync(request, env, options = {}) {
  const url = new URL(request.url);
  const practiceMode = url.searchParams.get('practice') === '1';
  const practiceRestart = practiceMode && url.searchParams.get('restart') === '1';
  const { sessionToken, isNew } = resolveSessionCookie(request);
  const guestBaseSessionId = `guest_${sessionToken}`;

  const authenticatedUserId = await getAuthenticatedUserIdFromRequest(request, env);
  const baseSessionId = authenticatedUserId ? `user_${authenticatedUserId}` : guestBaseSessionId;

  // Optional migration: if the user just logged in, keep their current same-day progress.
  // Only do this on bootstrap to avoid extra DO reads on every guess/hint.
  if (options.migrateGuestState && authenticatedUserId) {
    const today = new Date().toISOString().slice(0, 10);
    const userSessionId = practiceMode ? `practice_user_${authenticatedUserId}` : `user_${authenticatedUserId}`;
    const guestSessionId = practiceMode ? `practice_${guestBaseSessionId}` : guestBaseSessionId;
    try {
      const [userState, guestState] = await Promise.all([
        getGameState(env, userSessionId).catch(() => null),
        getGameState(env, guestSessionId).catch(() => null)
      ]);

      const userGuesses = Array.isArray(userState?.guesses) ? userState.guesses.length : 0;
      const guestGuesses = Array.isArray(guestState?.guesses) ? guestState.guesses.length : 0;
      const shouldMigrate =
        guestState?.date === today &&
        (userState?.date !== today || userGuesses === 0) &&
        guestGuesses > 0;

      if (shouldMigrate) {
        await saveGameState(env, userSessionId, guestState);
      }
    } catch {
      // Non-fatal: fallback is a fresh user session.
    }
  }

  return {
    practiceMode,
    practiceRestart,
    sessionId: practiceMode ? `practice_${baseSessionId}` : baseSessionId,
    sessionToken,
    needsSessionCookie: isNew,
    authenticatedUserId
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
    if (path === '/game/state' && request.method === 'GET') {
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

/**
 * Build structure token payload for a target protein.
 * Shared by bootstrap (embedded) and structure-token endpoint (fallback).
 * Returns null if structure unavailable.
 */
async function buildTargetStructureToken(protein, env, { practiceMode, origin }) {
  if (!protein) return null;
  
  const meta = await getCanonicalStructureMeta(protein, env);
  if (!meta) {
    console.warn('GeneGuessr: buildTargetStructureToken - no structure meta for', protein.uniprot);
    return null;
  }
  
  // ⚠️ LAZY LOADING: Don't pre-cache structure on bootstrap
  // Structure will be cached on first /api/structure-cached request
  // This eliminates 3-10s network delay on page load
  
  // Get file size if already cached (fast R2 head operation)
  let sizeBytes = 0;
  try {
    const head = await env.STRUCTURES_BUCKET.head(meta.r2Key);
    sizeBytes = head?.size || 0;
  } catch { /* ignore - not cached yet */ }
  
  // Build opaque URL for target
  const practiceParam = practiceMode ? '&practice=1' : '';
  const structureUrl = `${origin}/api/structure-cached?type=target${practiceParam}`;
  
  // Parse chain labels to create redacted version for target
  let targetChainHints = null;
  let totalChainCount = 0;
  const chainLabelsRaw = meta.source === 'alphafold'
    ? null
    : (meta.source === 'swissmodel' 
      ? protein.swissmodel_chain_labels 
      : protein.pdb_chain_labels);
  if (chainLabelsRaw) {
    try {
      const chainLabels = typeof chainLabelsRaw === 'string'
        ? JSON.parse(chainLabelsRaw)
        : chainLabelsRaw;
      totalChainCount = chainLabels?.reduce((sum, l) => sum + (l.chains?.length || 0), 0) || 0;
      targetChainHints = chainLabels
        ?.filter(l => l.is_target)
        ?.map(l => ({ chains: l.chains }));
      if (targetChainHints?.length === 0) targetChainHints = null;
    } catch (e) {
      console.warn('Failed to parse chain_labels for target hints', e);
    }
  }
  
  return {
    sourceLabel: meta.shortLabel,
    displayLabel: `Source: ${meta.shortLabel}`,
    format: meta.format || 'cif',
    url: structureUrl,
    sizeBytes,
    targetChainHints,
    totalChainCount
  };
}

/**
 * Build structure token for a guess protein.
 * Returns data suitable for client-side IndexedDB caching.
 * Returns null if structure unavailable.
 */
async function buildGuessStructureToken(protein, env, { origin }) {
  if (!protein) return null;
  
  const meta = await getCanonicalStructureMeta(protein, env);
  if (!meta) {
    console.warn('GeneGuessr: buildGuessStructureToken - no structure meta for', protein.uniprot);
    return null;
  }
  
  // ⚡ LAZY STRUCTURE: Don't block on structure caching during guess submission
  // Just check if it exists in R2 - if not, client will trigger caching via /api/structure-cached
  // This saves 2-4 seconds when structure isn't cached yet
  let sizeBytes = 0;
  let cached = false;
  try {
    const head = await env.STRUCTURES_BUCKET.head(meta.r2Key);
    if (head) {
      cached = true;
      sizeBytes = head.size || 0;
    }
  } catch { /* ignore */ }
  
  let structureUrl = `${origin}/api/structure-cached?key=${encodeURIComponent(meta.r2Key)}`;
  // CRITICAL: For SWISS-MODEL and AlphaFold, we MUST include the upstream URL in the request.
  // SWISS-MODEL URLs are custom per-protein (e.g., with template/range params).
  // AlphaFold URLs include isoform numbers (e.g., AF-P11532-3-F1 not AF-P11532-F1).
  // The worker cannot derive these from the r2Key pattern alone.
  // Without this, guess cards for multi-isoform proteins return 404/502.
  // Only needed when not cached - if already in R2, worker serves directly.
  if (!cached && (meta.source === 'swissmodel' || meta.source === 'alphafold') && meta.upstreamUrl) {
    structureUrl += `&upstream=${encodeURIComponent(meta.upstreamUrl)}`;
  }
  
  // Parse chain labels if present
  let chainLabels = null;
  const chainLabelsRaw = meta.source === 'alphafold' 
    ? null
    : (meta.source === 'swissmodel' 
      ? protein.swissmodel_chain_labels 
      : protein.pdb_chain_labels);
  if (chainLabelsRaw) {
    try {
      chainLabels = typeof chainLabelsRaw === 'string'
        ? JSON.parse(chainLabelsRaw)
        : chainLabelsRaw;
    } catch (e) {
      console.warn('Failed to parse chain_labels for guess', e);
    }
  }
  
  return {
    sourceLabel: meta.shortLabel,
    displayLabel: meta.displayLabel,
    format: meta.format || 'cif',
    url: structureUrl,
    cacheKey: meta.r2Key,
    sizeBytes,
    cached, // Tell client whether it needs to trigger caching
    // ALWAYS send upstreamUrl so client can store it in IndexedDB.
    // The client needs this if local blob is evicted and R2 cache expires later.
    // Only matters for SWISS-MODEL and AlphaFold - PDB has predictable URLs.
    upstreamUrl: meta.upstreamUrl || undefined,
    chainLabels,
    linkUrl: meta.linkUrl
  };
}

async function handleStructureToken(request, env, corsHeaders) {
  try {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    if (type === 'target') {
      // Fallback endpoint for clients without embedded bootstrap token.
      // Most calls should be eliminated by embedding token in bootstrap payload.
      const { sessionId, practiceMode } = await resolveSessionContextAsync(request, env);
      let protein = null;
      
      try {
        const state = await getGameState(env, sessionId);
        console.log(`[B-206] structure-token: sessionId=${sessionId}, targetId=${state?.targetId}`);
        if (state?.targetId) {
          protein = await fetchProteinByUniprot(env.DB, state.targetId);
        }
      } catch (err) {
        console.warn('GeneGuessr: failed to get target from session, falling back to daily', err);
      }
      
      if (!protein) {
        protein = await getDailyTargetProtein(env, { practice: practiceMode });
      }
      
      if (!protein) {
        console.error('GeneGuessr: handleStructureToken - no target protein found');
        return Response.json({ error: 'Target unavailable' }, { status: 500, headers: corsHeaders });
      }
      
      console.log('GeneGuessr: handleStructureToken (fallback) - building token for', protein.uniprot);
      const token = await buildTargetStructureToken(protein, env, {
        practiceMode,
        origin: url.origin
      });
      
      if (!token) {
        return Response.json({ error: 'Structure unavailable' }, { status: 404, headers: corsHeaders });
      }
      
      return Response.json(token, { headers: corsHeaders });
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
  // AlphaFold structures are single-chain predictions, so no chain labels needed
  let chainLabels = null;
  const chainLabelsRaw = meta.source === 'alphafold' 
    ? null
    : (meta.source === 'swissmodel' 
      ? protein.swissmodel_chain_labels 
      : protein.pdb_chain_labels);
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
    chainLabels,
    linkUrl: meta.linkUrl
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
/**
 * Serves structure files from R2 cache with lazy upstream fetching.
 * 
 * CRITICAL ARCHITECTURE DECISIONS (do not revert without understanding):
 * 
 * 1. Function signature must include `ctx` (execution context) - NOT just `env`.
 *    The `ctx.waitUntil()` API is on the execution context, not environment bindings.
 *    Using `env.waitUntil()` causes "waitUntil is not a function" crashes.
 *    See: https://developers.cloudflare.com/workers/runtime-apis/context/
 * 
 * 2. SWISS-MODEL structures require `upstream` query parameter for lazy loading.
 *    Unlike PDB (models.rcsb.org) and AlphaFold (alphafold.ebi.ac.uk) where URLs
 *    can be derived from the r2Key pattern, SWISS-MODEL URLs are custom per-protein
 *    and stored in the database. The client must pass the upstream URL explicitly.
 * 
 * 3. Lazy caching via ctx.waitUntil() is intentional for performance.
 *    Structure files are cached to R2 in the background AFTER the response is sent.
 *    This saves 2-4 seconds on first load vs blocking on R2 write.
 */
async function handleCachedStructureFetch(request, env, ctx, corsHeaders) {
  const url = new URL(request.url);
  let cacheKey = url.searchParams.get('key');
  let protein = null;  // Hoist to function scope for lazy loading
  
  // SECURITY: Support type=target to fetch target structure without exposing the key
  // This prevents cheating by inspecting the URL to see the PDB ID
  const type = url.searchParams.get('type');
  if (type === 'target') {
    const { sessionId, practiceMode } = await resolveSessionContextAsync(request, env);
    
    try {
      const state = await getGameState(env, sessionId);
      console.log('GeneGuessr: structure-cached targetId from session:', state?.targetId);
      if (state?.targetId) {
        protein = await fetchProteinByUniprot(env.DB, state.targetId);
        console.log('GeneGuessr: structure-cached protein from DB:', protein?.uniprot, protein?.gene, protein?.structure_source);
      }
    } catch (err) {
      console.warn('GeneGuessr: structure-cached target lookup failed', err);
    }
    
    if (!protein) {
      protein = await getDailyTargetProtein(env, { practice: practiceMode });
      console.log('GeneGuessr: structure-cached fallback to daily:', protein?.uniprot, protein?.gene);
    }
    
    if (!protein) {
      return Response.json({ error: 'Target unavailable' }, { status: 404, headers: corsHeaders });
    }
    
    const meta = await getCanonicalStructureMeta(protein, env);
    console.log('GeneGuessr: structure-cached meta:', meta?.source, meta?.r2Key);
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
  
  let object = await env.STRUCTURES_BUCKET.get(cacheKey);
  
  // ⚠️ LAZY CACHING: If not in R2, fetch from upstream and cache
  // This happens on first request after bootstrap (which no longer pre-caches)
  if (!object) {
    // We need the protein to get upstream URL - for type=target we already have it
    // For key-based requests, derive source from the key prefix
    let meta = null;
    if (type === 'target' && protein) {
      meta = await getCanonicalStructureMeta(protein, env);
    } else {
      // Parse key to build minimal meta for upstream fetch
      const [source, filename] = cacheKey.split('/');
      const format = filename.endsWith('.bcif') ? 'bcif' : (filename.endsWith('.pdb') ? 'pdb' : 'cif');
      const id = filename.replace(/\.(bcif|cif|pdb)$/, '');
      
      // Build upstream URL based on source
      // CRITICAL: Check for client-provided upstream URL FIRST.
      // SWISS-MODEL and AlphaFold URLs cannot be derived from r2Key:
      // - SWISS-MODEL: custom per-protein with template/range params
      // - AlphaFold: includes isoform number (AF-P11532-3-F1 not AF-P11532-F1)
      // The client gets these URLs from buildGuessStructureToken which reads from the database.
      // Only PDB has a truly predictable URL pattern (RCSB ModelServer).
      let upstreamUrl = url.searchParams.get('upstream');
      if (!upstreamUrl) {
        if (source === 'pdb') {
          // PDB: predictable pattern from RCSB ModelServer
          upstreamUrl = `https://models.rcsb.org/${id}.bcif`;
        } else if (source === 'alphafold') {
          // AlphaFold: NO predictable pattern - URL must come from client
          // Multi-isoform proteins like DMD (P11532) have URLs like AF-P11532-3-F1
          // We can't derive the isoform number from the key alone.
          return Response.json({ error: 'AlphaFold structure requires upstream URL parameter' }, { status: 400, headers: corsHeaders });
        } else if (source === 'swissmodel') {
          // SWISS-MODEL: NO predictable pattern - URL must come from client
          // If we get here, the client didn't pass upstream param (old client code)
          return Response.json({ error: 'SwissModel structure requires upstream URL parameter' }, { status: 400, headers: corsHeaders });
        }
      }
      
      meta = { r2Key: cacheKey, upstreamUrl, format, source };
    }
    
    if (!meta?.upstreamUrl) {
      return Response.json({ error: 'Structure not cached and no upstream available' }, { status: 404, headers: corsHeaders });
    }
    
    // Fetch from upstream and stream to client while caching in background
    console.log(`[LAZY-CACHE] Fetching ${cacheKey} from ${meta.upstreamUrl}`);
    const upstreamResp = await fetch(meta.upstreamUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'GeneGuessr-Worker/1.0' }
    });
    
    if (!upstreamResp.ok || !upstreamResp.body) {
      console.warn('GeneGuessr: upstream structure fetch failed', meta.upstreamUrl, upstreamResp.status);
      return Response.json({ error: 'Upstream structure unavailable' }, { status: 502, headers: corsHeaders });
    }
    
    // Clone the response - one for client, one for R2 cache
    const [clientStream, cacheStream] = upstreamResp.body.tee();
    
    // Fire-and-forget: cache to R2 in background
    const contentType = meta.format === 'bcif' 
      ? 'application/octet-stream' 
      : (upstreamResp.headers.get('Content-Type') || 'chemical/x-cif');
    
    // CRITICAL: Must use ctx.waitUntil(), NOT env.waitUntil()
    // `ctx` = execution context (has waitUntil), `env` = environment bindings (does not)
    // Using env.waitUntil() causes \"waitUntil is not a function\" error and 500 response
    ctx.waitUntil((async () => {
      try {
        const arrayBuffer = await new Response(cacheStream).arrayBuffer();
        await env.STRUCTURES_BUCKET.put(cacheKey, arrayBuffer, {
          httpMetadata: { contentType }
        });
        await recordStructureCacheEntry(env, cacheKey, arrayBuffer.byteLength);
        console.log(`[LAZY-CACHE] Cached ${cacheKey} (${Math.round(arrayBuffer.byteLength/1024)}KB)`);
      } catch (e) {
        console.warn('[LAZY-CACHE] Background cache failed:', e);
      }
    })());
    
    // Stream to client immediately (don't wait for cache)
    const isSwissModelPdb = cacheKey.startsWith('swissmodel/') && cacheKey.endsWith('.pdb');
    // Note: SwissModel PDB header fix won't work here since we're streaming
    // But SwissModel should always be pre-cached anyway (fallback above)
    
    return new Response(clientStream, {
      headers: {
        ...corsHeaders,
        'Content-Type': contentType,
        'Cache-Control': type === 'target' 
          ? 'private, no-store, must-revalidate'
          : 'public, max-age=604800, immutable'
      }
    });
  }
  
  await touchStructureCacheEntry(env, cacheKey, object.size);
  
  // For type=target, don't cache at edge - the "target" changes daily but URL is static
  // For key-based requests, cache 7 days - the key includes the structure ID so it's stable
  const cacheControl = type === 'target' 
    ? 'private, no-store, must-revalidate'
    : 'public, max-age=604800, immutable';
  
  // SWISS-MODEL PDB files lack the HEADER record that Mol* requires for parsing.
  // Mol*'s PDB parser needs a HEADER to create an "entry" object; without it,
  // we get "Cannot read properties of undefined (reading 'entry')" errors.
  // We prepend a minimal anonymous HEADER that doesn't leak protein identity.
  const isSwissModelPdb = cacheKey.startsWith('swissmodel/') && cacheKey.endsWith('.pdb');
  if (isSwissModelPdb) {
    // PDB HEADER format: cols 11-50=classification, 51-59=date, 63-66=id_code
    // Using completely anonymous values that satisfy Mol* without revealing protein identity
    const syntheticHeader = 'HEADER    MODEL                                   01-JAN-00   0000\n';
    const originalData = await object.arrayBuffer();
    const headerBytes = new TextEncoder().encode(syntheticHeader);
    const combinedBuffer = new Uint8Array(headerBytes.length + originalData.byteLength);
    combinedBuffer.set(headerBytes, 0);
    combinedBuffer.set(new Uint8Array(originalData), headerBytes.length);
    
    return new Response(combinedBuffer, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'chemical/x-pdb',
        'Cache-Control': cacheControl
      }
    });
  }
  
  return new Response(object.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream',
      'Cache-Control': cacheControl
    }
  });
}

/**
 * ⚠️ DAILY BOOTSTRAP CACHE ⚠️
 * 
 * Caches the expensive-to-compute parts of daily mode bootstrap:
 * - Target protein metadata
 * - Structure token (source, URL, chain hints, etc.)
 * 
 * This eliminates D1 queries + R2 head calls for repeat visitors on the same day.
 * KV lookup: ~1-5ms vs full computation: ~500-2000ms
 */
async function getDailyBootstrapCache(env, date, origin) {
  const cacheKey = `${DAILY_BOOTSTRAP_CACHE_PREFIX}${date}`;
  try {
    const cached = await env.KV.get(cacheKey, { type: 'json' });
    if (cached && cached.origin === origin) {
      console.log(`[PERF] Daily bootstrap cache HIT for ${date}`);
      return cached;
    }
  } catch (e) {
    console.warn('Daily bootstrap cache read failed:', e);
  }
  return null;
}

async function setDailyBootstrapCache(env, date, origin, targetProtein, structureToken) {
  const cacheKey = `${DAILY_BOOTSTRAP_CACHE_PREFIX}${date}`;
  const payload = {
    origin,
    targetProtein,
    structureToken,
    cachedAt: Date.now()
  };
  try {
    // Calculate TTL to expire at end of day (UTC)
    const now = new Date();
    const endOfDay = new Date(date + 'T23:59:59.999Z');
    const ttlSeconds = Math.max(60, Math.floor((endOfDay - now) / 1000));
    await env.KV.put(cacheKey, JSON.stringify(payload), { expirationTtl: ttlSeconds });
    console.log(`[PERF] Daily bootstrap cache SET for ${date} (TTL: ${ttlSeconds}s)`);
  } catch (e) {
    console.warn('Daily bootstrap cache write failed:', e);
  }
}

/**
 * ⚠️ PERFORMANCE CRITICAL - BOOTSTRAP LATENCY DIRECTLY AFFECTS TTFP ⚠️
 * 
 * This handler is the main bottleneck for initial page load.
 * Every millisecond here = millisecond of blank screen for users.
 * 
 * OPTIMIZATIONS APPLIED:
 * 1. DAILY CACHE: KV lookup for target + structure token (~1-5ms vs ~500-2000ms)
 * 2. Parallel fetch: getDailyTargetProtein runs concurrently with session load
 * 3. Batched hydration: hydrateGuessProteins uses Promise.all, not sequential loop
 * 4. Skip redundant work: similarity scores not recalculated if already stored
 * 
 * DO NOT add sequential awaits here without measuring impact.
 * DO NOT call hydrateGuessProteins with sequential DB calls.
 */
async function handleGameBootstrap(request, env, ctx, corsHeaders) {
  console.log('[BOOTSTRAP] Handler started');
  try {
    const sessionContext = await resolveSessionContextAsync(request, env, { migrateGuestState: true });
    const { sessionId, practiceMode, practiceRestart } = sessionContext;
    console.log(`[BOOTSTRAP] Session resolved: practiceMode=${practiceMode}`);
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext);
    const url = new URL(request.url);
    const today = new Date().toISOString().slice(0, 10);
    
    // ⚠️ DAILY MODE: CHECK KV CACHE FIRST ⚠️
    // Eliminates D1 + R2 queries for repeat visitors (~500-2000ms savings)
    let cachedDaily = null;
    if (!practiceMode) {
      cachedDaily = await getDailyBootstrapCache(env, today, url.origin);
    }
    console.log(`[BOOTSTRAP] Cache checked: ${cachedDaily ? 'HIT' : 'MISS'}`);
    
    // ⚠️ PARALLEL FETCH - DO NOT SERIALIZE ⚠️
    // Target protein lookup and session state load are independent
    // Running in parallel saves 50-150ms per request
    console.log('[BOOTSTRAP] Starting parallel fetch: targetSeed + existingState');
    const [targetSeedRaw, existingState] = await Promise.all([
      cachedDaily?.targetProtein 
        ? Promise.resolve(cachedDaily.targetProtein)  // Use cached target
        : getDailyTargetProtein(env, { practice: practiceMode, returnAudit: !practiceMode }),
      getGameState(env, sessionId).catch(() => null)  // Graceful fallback if session doesn't exist
    ]);
    const targetSeed = targetSeedRaw?.protein ? targetSeedRaw.protein : targetSeedRaw;
    const targetAudit = targetSeedRaw?.audit ? targetSeedRaw.audit : null;
    console.log(`[BOOTSTRAP] Parallel fetch complete: targetSeed=${targetSeed?.uniprot || 'null'}`);
    
    if (!targetSeed && !practiceMode) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
    }
    
    // Determine if session needs reset (uses pre-fetched existingState)
    const state = await ensureSessionForTodayWithState(env, sessionId, targetSeed, existingState, { practiceMode, forceReset: practiceRestart });
    console.log(`[B-206] bootstrap: sessionId=${sessionId}, forceReset=${practiceRestart}, targetId=${state.targetId}, seedId=${targetSeed?.uniprot}`);
    const targetProtein = targetSeed && state.targetId === targetSeed.uniprot
      ? targetSeed
      : await fetchProteinByUniprot(env.DB, state.targetId);
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
    }
    
    // ⚠️ PARALLEL EXECUTION - structure token + guess hydration run concurrently
    // This eliminates client-side /api/structure-token round-trip (~3s savings)
    let structureToken = cachedDaily?.structureToken || null;
    const needsStructureToken = !structureToken;
    
    const [_, freshStructureToken] = await Promise.all([
      hydrateGuessProteins(env, sessionId, state, targetProtein),
      needsStructureToken
        ? buildTargetStructureToken(targetProtein, env, {
            practiceMode,
            origin: url.origin
          }).catch(err => {
            console.warn('GeneGuessr: bootstrap structure token failed (non-fatal)', err);
            return null;  // Client falls back to /api/structure-token if null
          })
        : Promise.resolve(null)  // Already have cached token
    ]);
    
    // Use fresh token if we computed one
    if (freshStructureToken) {
      structureToken = freshStructureToken;
    }
    
    // ⚠️ POPULATE CACHE FOR NEXT REQUEST (daily mode only) ⚠️
    if (!practiceMode && !cachedDaily && targetProtein && structureToken) {
      ctx.waitUntil(
        setDailyBootstrapCache(env, today, url.origin, targetProtein, structureToken)
          .catch(e => console.warn('Cache population failed:', e))
      );
    }

    // Record what was actually shown to players (daily mode only).
    // Uses waitUntil so we don't add latency to bootstrap.
    if (!practiceMode && targetProtein?.uniprot) {
      const audit = targetAudit && targetAudit.date === today
        ? targetAudit
        : { date: today, source: 'unknown', rejected: [] };
      ctx.waitUntil(recordDailyPickOnce(env, today, targetProtein.uniprot, audit));
    }

    // If a completed daily game never got recorded (retry/crash), backfill aggregates in the background.
    // This stores only per-day guess counts (no user ids, no IPs).
    const guessStatsThrough = Number(state?.guessStatsRecordedThrough || 0);
    if (!practiceMode && (!Number.isFinite(guessStatsThrough) || guessStatsThrough === 0)) {
      ctx.waitUntil((async () => {
        try {
          const latest = await getGameState(env, sessionId).catch(() => null);
          if (!latest) return;
          const didUpdate = await maybeRecordDailyGuessAggregatesDelta(env, latest, { practiceMode });
          if (didUpdate) {
            await saveGameState(env, sessionId, latest);
          }
        } catch (err) {
          console.warn('Guess aggregate backfill failed (non-fatal):', err?.message || err);
        }
      })());
    }
    
    const payload = buildGamePayload(state, targetProtein);
    // Embed structure token in bootstrap response - client uses this instead of separate API call
    if (structureToken) {
      payload.targetStructureToken = structureToken;
    }
    return Response.json(payload, { headers: responseHeaders });
  } catch (err) {
    console.error('GeneGuessr: bootstrap failed', err);
    return Response.json({ error: 'Failed to load game state' }, { status: 500, headers: corsHeaders });
  }
}

async function recordDailyPickOnce(env, date, uniprotId, audit) {
  try {
    const key = `puzzle_actual:${date}`;
    const existing = await env.KV.get(key);
    if (existing) {
      return;
    }
    const record = {
      date,
      uniprot_id: uniprotId,
      source: audit?.source || 'unknown',
      override_id: audit?.override_id || null,
      rejected: Array.isArray(audit?.rejected) ? audit.rejected : [],
      skipped_alpha_fold: Number.isFinite(audit?.skipped_alpha_fold) ? audit.skipped_alpha_fold : null,
      recorded_at: Date.now()
    };
    const rejectedCount = Array.isArray(record.rejected) ? record.rejected.length : 0;
    await env.KV.put(key, JSON.stringify(record), {
      metadata: {
        uniprot_id: record.uniprot_id,
        source: record.source,
        override_id: record.override_id,
        rejected_count: rejectedCount,
        recorded_at: record.recorded_at
      }
    });
  } catch (err) {
    console.warn('Daily pick record write failed:', err);
  }
}

async function handleGuessSubmission(request, env, corsHeaders) {
  try {
    const sessionContext = await resolveSessionContextAsync(request, env);
    const { sessionId, practiceMode } = sessionContext;
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext);
    
    const body = await safeJson(request);
    const uniprot = (body?.uniprot || '').toUpperCase();
    if (!uniprot) {
      return Response.json({ error: 'Missing uniprot' }, { status: 400, headers: responseHeaders });
    }
    
    // ⚡ PERFORMANCE: Get state FIRST - it already contains the targetId
    // Avoids slow getDailyTargetProtein call on every guess (was ~2-3s for practice mode)
    let state = null;
    try {
      state = await getGameState(env, sessionId);
    } catch (err) {
      console.warn('GeneGuessr: failed to load session for guess', err);
    }
    
    if (!state?.targetId) {
      // No session or missing target - this shouldn't happen in normal flow
      // Fall back to daily target lookup (slow path)
      const targetSeed = await getDailyTargetProtein(env, { practice: practiceMode });
      if (!targetSeed && !practiceMode) {
        return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
      }
      state = await ensureSessionForToday(env, sessionId, targetSeed, { practiceMode });
    }
    
    // ⚡ PERFORMANCE: Fetch target and guess proteins in parallel
    const [targetProtein, guessProtein] = await Promise.all([
      fetchProteinByUniprot(env.DB, state.targetId),
      fetchProteinByUniprot(env.DB, uniprot)
    ]);
    
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
    }
    if (!guessProtein) {
      return Response.json({ error: 'Protein not found' }, { status: 404, headers: responseHeaders });
    }
    if (state.won || (state.guesses?.length || 0) >= MAX_GUESSES) {
      return Response.json({ error: 'Round already completed' }, { status: 409, headers: responseHeaders });
    }
    if ((state.guesses || []).some((entry) => entry.uniprot === uniprot)) {
      return Response.json({ error: 'Protein already guessed' }, { status: 409, headers: responseHeaders });
    }
    
    // ⚡ LAZY SIMILARITY: Skip slow similarity calculation here
    // Return immediately with score: null, client will fetch via /api/game/guess-similarity
    // This saves ~1-2 seconds on guess submission
    const correct = guessProtein.uniprot === targetProtein.uniprot;
    const guessEntry = {
      guessId: crypto.randomUUID(),
      uniprot,
      correct,
      score: correct ? 100 : null, // 100% if correct, null (pending) otherwise
      similarityPending: !correct, // Client should fetch similarity
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
    
    // Record aggregate guess stats for daily mode as the player guesses.
    // Stores only per-day counts (no user ids, no IPs) and is safe to retry.
    try {
      await maybeRecordDailyGuessAggregatesDelta(env, state, { practiceMode });
    } catch (err) {
      console.warn('Guess aggregate recording failed (non-fatal):', err?.message || err);
    }

    // ⚡ PERFORMANCE: Build guess structure token in parallel with saveGameState
    // This eliminates ~3s API round-trip on client after guess submission
    const url = new URL(request.url);
    const [, guessStructureToken] = await Promise.all([
      saveGameState(env, sessionId, state),
      buildGuessStructureToken(guessProtein, env, { origin: url.origin })
    ]);
    
    const payload = buildGamePayload(state, targetProtein, { includeProteins: true });
    // Embed structure token so client can cache it immediately
    if (guessStructureToken) {
      payload.guessStructureToken = guessStructureToken;
    }
    return Response.json(payload, { headers: responseHeaders });
  } catch (err) {
    console.error('GeneGuessr: guess submission failed', err);
    return Response.json({ error: 'Guess submission failed' }, { status: 500, headers: corsHeaders });
  }
}

/**
 * ⚠️ PERFORMANCE CRITICAL - HINT REVEAL MUST BE FAST ⚠️
 * 
 * This endpoint reveals a single hint. It should be INSTANT.
 * 
 * BEFORE (slow - 2-3 seconds):
 *   - getDailyTargetProtein (2-3 DB queries)
 *   - ensureSessionForToday (DO read)
 *   - hydrateGuessProteins (N × 2-3 DB queries for ALL guesses)
 *   - buildGamePayload (CPU work to build full payload)
 * 
 * AFTER (fast - <200ms):
 *   - Parallel: session state + target lookup
 *   - NO hydrateGuessProteins (client already has guess data!)
 *   - Minimal payload: just the hint text + updated status
 * 
 * The client already has all guess proteins from bootstrap.
 * Hint reveal only needs to return the revealed text and updated hint balance.
 * 
 * DO NOT add hydrateGuessProteins back. It's not needed here.
 * See Linear issue B-205 for full context.
 */
async function handleHintReveal(request, env, corsHeaders) {
  const t0 = Date.now();
  try {
    const sessionContext = await resolveSessionContextAsync(request, env);
    const { sessionId, practiceMode } = sessionContext;
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext);
    
    const body = await safeJson(request);
    const hintId = body?.hintId || body?.id;
    if (!hintId) {
      return Response.json({ error: 'Missing hintId' }, { status: 400, headers: responseHeaders });
    }
    const t1 = Date.now();
    
    // ⚠️ PERFORMANCE FIX: DON'T call getDailyTargetProtein here! ⚠️
    // getDailyTargetProtein validates structure availability with HTTP requests to upstream,
    // which takes 500-800ms. For hint reveals, we already HAVE a session with targetId.
    // Just load the existing state and fetch the protein directly from D1.
    const existingState = await getGameState(env, sessionId).catch(() => null);
    const t2 = Date.now();
    
    // For hint reveal, we MUST have an existing session (you can't reveal hints without playing)
    if (!existingState || !existingState.targetId) {
      return Response.json({ error: 'No active game session' }, { status: 400, headers: responseHeaders });
    }
    
    // Use existing state directly - no need for ensureSessionForTodayWithState
    const state = existingState;
    const t3 = Date.now();
    const targetProtein = await fetchProteinByUniprot(env.DB, state.targetId);
    const t4 = Date.now();
    if (!targetProtein) {
      return Response.json({ error: 'Target unavailable' }, { status: 500, headers: responseHeaders });
    }
    
    const clueSections = buildClueSections(targetProtein);
    const hintData = extractHintData(clueSections, hintId);
    if (!hintData || !hintData.text) {
      return Response.json({ error: 'Hint not found' }, { status: 404, headers: responseHeaders });
    }

    // B-222: Locked hints are visible as spoiler bars but cannot be revealed early.
    // Clicking them should not spend credits.
    if (hintData.locked) {
      return Response.json({
        lockedHint: { id: hintId, locked: true },
        status: {
          hintBalance: state.hintBalance,
          revealedHints: state.revealedHints || []
        }
      }, { headers: responseHeaders });
    }
    
    // ⚠️ DO NOT CALL hydrateGuessProteins HERE ⚠️
    // Client already has guess data from bootstrap. We just need to reveal the hint.
    // Adding guess hydration here caused 3+ second delays (B-205).
    
    let t5 = t4;
    if (!(state.revealedHints || []).includes(hintId)) {
      if ((state.hintBalance || 0) < DEFAULT_HINT_COST) {
        return Response.json({ error: 'Insufficient hints' }, { status: 402, headers: responseHeaders });
      }
      state.revealedHints = [...(state.revealedHints || []), hintId];
      state.hintBalance = Math.max(0, (state.hintBalance || 0) - DEFAULT_HINT_COST);
      await saveGameState(env, sessionId, state);
      t5 = Date.now();
    }
    console.log(`[HINT REVEAL TIMING] parse:${t1-t0}ms parallel:${t2-t1}ms session:${t3-t2}ms protein:${t4-t3}ms save:${t5-t4}ms total:${t5-t0}ms`);
    
    // ⚠️ CRITICAL PERFORMANCE - MINIMAL PAYLOAD ONLY ⚠️
    // DO NOT add guesses, clue, target, or ANY other data here!
    // The client does a surgical DOM update (just swaps the redaction span).
    // Adding more data triggers full re-render + 3D viewer reload = 3+ second delay.
    // See B-205 for the full horror story. This exact format is REQUIRED:
    return Response.json({
      revealedHint: { id: hintId, text: hintData.text },
      status: {
        hintBalance: state.hintBalance,
        revealedHints: state.revealedHints
      }
    }, { headers: responseHeaders });
  } catch (err) {
    console.error('GeneGuessr: hint reveal failed', err);
    return Response.json({ error: 'Hint reveal failed' }, { status: 500, headers: corsHeaders });
  }
}

/**
 * ⚡ LAZY SIMILARITY CALCULATION
 * 
 * Called after guess card is displayed to calculate and return similarity score.
 * This allows the guess card to appear instantly (~200ms) while similarity
 * calculation happens in the background (~1-2s).
 * 
 * Client shows a spinner for the score, then updates when this returns.
 */
async function handleGuessSimilarity(request, env, corsHeaders) {
  try {
    const sessionContext = await resolveSessionContextAsync(request, env);
    const { sessionId } = sessionContext;
    const responseHeaders = buildResponseHeaders(corsHeaders, sessionContext);
    
    const body = await safeJson(request);
    const guessId = body?.guessId;
    if (!guessId) {
      return Response.json({ error: 'Missing guessId' }, { status: 400, headers: responseHeaders });
    }
    
    // Get current game state
    const state = await getGameState(env, sessionId);
    if (!state) {
      return Response.json({ error: 'Session not found' }, { status: 404, headers: responseHeaders });
    }
    
    // Find the guess entry
    const guessIndex = (state.guesses || []).findIndex(g => g.guessId === guessId);
    if (guessIndex === -1) {
      return Response.json({ error: 'Guess not found' }, { status: 404, headers: responseHeaders });
    }
    
    const guessEntry = state.guesses[guessIndex];
    
    // If similarity already calculated, return it immediately
    if (guessEntry.score !== null && !guessEntry.similarityPending) {
      return Response.json({ guessId, score: guessEntry.score }, { headers: responseHeaders });
    }
    
    // Fetch proteins for similarity calculation
    const [guessProtein, targetProtein] = await Promise.all([
      fetchProteinByUniprot(env.DB, guessEntry.uniprot),
      fetchProteinByUniprot(env.DB, state.targetId)
    ]);
    
    if (!guessProtein || !targetProtein) {
      return Response.json({ error: 'Protein data unavailable' }, { status: 500, headers: responseHeaders });
    }
    
    // Calculate similarity
    let similarity;
    let isLadder = false;
    let ladderRank = null;
    if (SIMILARITY_MODE === 'blended') {
      const simResult = await getBlendedSimilarity(
        env.DB,
        guessProtein.gene,
        targetProtein.gene,
        { esm2Weight: ESM2_WEIGHT, targetNeighbors: targetProtein.neighbors }
      );
      similarity = simResult.blended;
      isLadder = simResult.isLadder;
      ladderRank = simResult.ladderRank;
    } else {
      similarity = await getHig2vecSimilarity(
        env.DB,
        guessProtein.gene,
        targetProtein.gene
      );
    }
    
    const score = scoreGuess(guessProtein, targetProtein, { similarity, isLadder, ladderRank });
    
    // Update session state with calculated score
    state.guesses[guessIndex].score = score;
    state.guesses[guessIndex].similarityPending = false;
    await saveGameState(env, sessionId, state);
    
    return Response.json({ guessId, score }, { headers: responseHeaders });
  } catch (err) {
    console.error('GeneGuessr: similarity calculation failed', err);
    return Response.json({ error: 'Similarity calculation failed' }, { status: 500, headers: corsHeaders });
  }
}


async function getDailyTargetProtein(env, options = {}) {
  const eligibleIds = await getEligibleProteinIds(env.DB);
  if (!eligibleIds.length) {
    return null;
  }
  
  let protein = null;
  let startIdx = 0;
  let balancedPick = null;  // Track surname info for practice mode
  
  const wantsAudit = Boolean(options.returnAudit);
  const audit = wantsAudit
    ? {
        date: null,
        source: options.practice ? 'practice' : 'computed',
        override_id: null,
        rejected: [],
        skipped_alpha_fold: null
      }
    : null;

  if (options.practice) {
    // Practice mode: Use surname-based balanced picking
    // This prevents over-representation of large gene families like ZNF, OR, KRTAP
    balancedPick = await pickRandomProteinBalanced(env.DB);
    
    if (balancedPick?.protein) {
      protein = balancedPick.protein;
      startIdx = eligibleIds.indexOf(protein.uniprot);
      if (startIdx < 0) startIdx = 0;
      console.log(`[PRACTICE] Balanced pick: ${protein.gene} from ${balancedPick.surname} family (${balancedPick.familySize} members)`);
    } else {
      // Fallback to unbalanced random if surname-based fails
      console.warn('[PRACTICE] Balanced pick failed, using unbalanced random');
      startIdx = Math.floor(Math.random() * eligibleIds.length);
      const randomId = eligibleIds[startIdx];
      protein = await fetchProteinByUniprot(env.DB, randomId);
    }
  } else {
    // Daily mode: check for manual override first
    const today = new Date().toISOString().slice(0, 10);
    if (audit) {
      audit.date = today;
    }
    const overrideId = await env.KV.get(`puzzle_override:${today}`);
    if (overrideId) {
      const overrideProtein = await fetchProteinByUniprot(env.DB, overrideId);
      if (overrideProtein) {
        if (audit) {
          audit.source = 'override';
          audit.override_id = overrideId;
          audit.skipped_alpha_fold = 0;
        }
        return audit ? { protein: overrideProtein, audit } : overrideProtein;
      }
    }
    
    const salt = env?.DAILY_TARGET_SALT || DAILY_TARGET_SALT;
    const selection = await pickDailyTarget(env.DB, eligibleIds, salt);
    protein = selection?.protein || null;
    if (audit) {
      audit.source = 'computed';
      audit.skipped_alpha_fold = Number.isFinite(selection?.skippedAlphaFold) ? selection.skippedAlphaFold : null;
    }
    startIdx = eligibleIds.indexOf(protein?.uniprot);
    if (startIdx < 0) startIdx = 0;
  }

  // Validate structure availability before committing to this pick.
  // If upstream (SWISS-MODEL/AlphaFold/PDB) is down or URL is broken, try next candidate.
  // This prevents serving a game with a broken structure viewer.
  if (protein && env) {
    const MAX_ATTEMPTS = 10;
    let attempts = 0;
    let currentIdx = startIdx;
    
    while (attempts < MAX_ATTEMPTS) {
      const structureMeta = buildMetaFromStoredStructure(protein);
      
      // If no upstream URL needed (e.g., structure pre-baked), accept it
      if (structureMeta && !structureMeta.upstreamUrl) {
        console.log(`[TARGET-PICK] ${protein.uniprot} has no upstream dependency, using it`);
        break;
      }
      
      if (structureMeta?.upstreamUrl) {
        // Check if structure is cached in R2 (instant, no upstream needed)
        try {
          const head = await env.STRUCTURES_BUCKET.head(structureMeta.r2Key);
          if (head) {
            console.log(`[TARGET-PICK] ${protein.uniprot} cached in R2, using it`);
            break;
          }
        } catch { /* not cached */ }
        
        // Not cached - validate upstream with Range GET (SWISS-MODEL blocks HEAD)
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const upstreamResp = await fetch(structureMeta.upstreamUrl, {
            method: 'GET',
            headers: { 
              'User-Agent': 'GeneGuessr-Worker/1.0',
              'Range': 'bytes=0-0'
            },
            signal: controller.signal
          });
          clearTimeout(timeout);
          if (upstreamResp.ok || upstreamResp.status === 206) {
            console.log(`[TARGET-PICK] ${protein.uniprot} upstream OK (${upstreamResp.status})`);
            break;
          }
          console.warn(`[TARGET-PICK] ${protein.uniprot} upstream failed (${upstreamResp.status}), trying next`);
          if (audit) {
            audit.rejected.push({ uniprot_id: protein.uniprot, reason: `upstream_failed_${upstreamResp.status}` });
          }
        } catch (err) {
          console.warn(`[TARGET-PICK] ${protein.uniprot} upstream error:`, err.message);
          if (audit) {
            audit.rejected.push({ uniprot_id: protein.uniprot, reason: 'upstream_error' });
          }
        }
      } else if (!structureMeta) {
        console.warn(`[TARGET-PICK] ${protein.uniprot} has no structure meta, trying next`);
        if (audit) {
          audit.rejected.push({ uniprot_id: protein.uniprot, reason: 'no_structure_meta' });
        }
      }
      
      // This protein's structure is unavailable - try next candidate
      attempts++;
      currentIdx = (currentIdx + 1) % eligibleIds.length;
      const nextId = eligibleIds[currentIdx];
      const nextProtein = await fetchProteinByUniprot(env.DB, nextId);
      if (nextProtein && !isAlphaFoldOnlyProtein(nextProtein)) {
        protein = nextProtein;
      }
    }
    
    if (attempts >= MAX_ATTEMPTS) {
      console.error(`[TARGET-PICK] Failed to find protein with working structure after ${attempts} attempts`);
    } else if (attempts > 0) {
      console.log(`[TARGET-PICK] Skipped ${attempts} proteins with unavailable structures`);
    }
  }

  return audit ? { protein, audit } : protein;
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
    guessStatsRecordedThrough: 0,
    practiceMode: Boolean(options.practiceMode),
    createdAt: Date.now()
  };
}

async function maybeRecordDailyGuessAggregatesDelta(env, state, { practiceMode }) {
  const isPractice = Boolean(practiceMode) || Boolean(state?.practiceMode);
  if (isPractice) return false;
  if (!state?.date || !state?.targetId) return false;

  const guesses = Array.isArray(state.guesses) ? state.guesses : [];
  let recordedThrough = Number(state.guessStatsRecordedThrough);
  if (!Number.isFinite(recordedThrough) || recordedThrough < 0) recordedThrough = 0;

  // Backwards-compat: if an older session already marked aggregates as recorded, don't double-count.
  if (state.guessStatsRecorded === true && state.guessStatsRecordedThrough == null) {
    state.guessStatsRecordedThrough = guesses.length;
    return false;
  }

  if (guesses.length <= recordedThrough) return false;

  const delta = guesses.slice(recordedThrough);
  const result = await recordDailyGuessAggregates(env.DB, {
    day: state.date,
    targetUniprot: state.targetId,
    guesses: delta,
  });

  if (!result.ok) return false;
  state.guessStatsRecordedThrough = guesses.length;
  return true;
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
  return ensureSessionForTodayWithState(env, sessionId, targetProtein, state, options);
}

/**
 * ⚠️ PERFORMANCE OPTIMIZATION - ACCEPTS PRE-FETCHED STATE ⚠️
 * 
 * This variant accepts an already-fetched state to avoid redundant DO calls.
 * Used by handleGameBootstrap which fetches state in parallel with target protein.
 * 
 * DO NOT remove this function or inline it - the parallel fetch optimization depends on it.
 */
async function ensureSessionForTodayWithState(env, sessionId, targetProtein, existingState, options = {}) {
  const practiceMode = Boolean(options.practiceMode);
  const forceReset = Boolean(options.forceReset);
  const today = new Date().toISOString().slice(0, 10);
  let state = existingState;
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

/**
 * ⚠️ PERFORMANCE CRITICAL - BATCHED HYDRATION ⚠️
 * 
 * This function hydrates protein data and similarity scores for all guesses.
 * 
 * BEFORE (slow): Sequential for-loop, N guesses × 2-3 DB calls each = 15+ serial queries
 * AFTER (fast): Promise.all for protein fetches, skip similarity if already stored
 * 
 * For a returning player with 5 guesses, this saves 500-1500ms.
 * 
 * DO NOT change this back to a sequential for-loop.
 * DO NOT recalculate similarity if entry.score already exists.
 */
async function hydrateGuessProteins(env, sessionId, state, targetProtein) {
  if (!Array.isArray(state?.guesses) || state.guesses.length === 0) {
    return;
  }
  
  let dirty = false;
  const validEntries = state.guesses.filter(e => e != null);
  
  // ⚠️ BATCH PROTEIN FETCHES - DO NOT SERIALIZE ⚠️
  // Fetch all missing proteins in parallel
  const proteinFetchPromises = validEntries.map(async (entry) => {
    if (!entry.protein) {
      const protein = await fetchProteinByUniprot(env.DB, entry.uniprot);
      if (protein) {
        entry.protein = {
          ...protein,
          gene_summary: cleanGeneSummary(protein.gene_summary)
        };
        return true; // indicates dirty
      }
    }
    return false;
  });
  
  const proteinResults = await Promise.all(proteinFetchPromises);
  if (proteinResults.some(r => r)) {
    dirty = true;
  }
  
  // ⚠️ SKIP SIMILARITY RECALC IF SCORE EXISTS OR PENDING ⚠️
  // Scores are stored in session state and only need calculation on first guess.
  // Recalculating every bootstrap wastes 100-300ms per guess.
  // ⚡ LAZY SIMILARITY: Skip entries with similarityPending - client will fetch via /api/game/guess-similarity
  const entriesNeedingScore = validEntries.filter(entry => 
    entry.protein && targetProtein && !entry.score?.similarity && !entry.similarityPending
  );
  
  if (entriesNeedingScore.length > 0) {
    // Batch similarity calculations for entries that need them
    const similarityPromises = entriesNeedingScore.map(async (entry) => {
      let similarity;
      let isLadder = false;
      let ladderRank = null;
      if (SIMILARITY_MODE === 'blended') {
        const simResult = await getBlendedSimilarity(
          env.DB,
          entry.protein.gene || entry.protein.hgnc,
          targetProtein.gene,
          { esm2Weight: ESM2_WEIGHT, targetNeighbors: targetProtein.neighbors }
        );
        similarity = simResult.blended;
        isLadder = simResult.isLadder;
        ladderRank = simResult.ladderRank;
      } else {
        similarity = await getHig2vecSimilarity(
          env.DB,
          entry.protein.gene || entry.protein.hgnc,
          targetProtein.gene
        );
      }
      const nextScore = scoreGuess(entry.protein, targetProtein, { similarity, isLadder, ladderRank });
      entry.score = nextScore;
      return true; // dirty
    });
    
    await Promise.all(similarityPromises);
    dirty = true;
  }
  
  if (dirty && sessionId) {
    await saveGameState(env, sessionId, state);
  }
}

function buildGamePayload(state, targetProtein, options = {}) {
  const revealedHints = new Set(state.revealedHints || []);
  const domainSpoilerTokens = getDomainSpoilerTokensFromFullName(targetProtein?.full_name);
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
    // ⚡ LAZY SIMILARITY: If similarity is pending, don't call scoreGuess - preserve null score
    const resolvedScore = entry.similarityPending 
      ? null  // Keep null, client will fetch via /api/game/guess-similarity
      : (entry.score || scoreGuess(guessProtein, targetProtein, {
          similarity: entry.score?.similarity
        }));
    const matches = collectMatchedHintTexts(targetProtein, guessProtein, resolvedScore, { domainSpoilerTokens });
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
      similarityPending: Boolean(entry.similarityPending),  // ⚡ Pass through to client
      matchedHints: matches,
      sections: buildFeedbackSections(guessProteinCleaned, { domainSpoilerTokens }),
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

  // B-217: Some clue-domain items may be filtered out server-side.
  // Ensure clue highlight metadata only refers to items that actually exist in clue sections.
  const latestMatchesForClue = filterMatchesToExistingSectionItems(maskedSections, latestMatches);
  applyLatestHighlights(maskedSections, latestMatchesForClue);
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
      latestMatches: latestMatchesForClue
    },
    guesses: guessEntries,
    targetReveal,
    targetRevealSections,
    shareText
  };
}

function filterMatchesToExistingSectionItems(sections, matches) {
  if (!matches || typeof matches !== 'object' || !Array.isArray(sections)) {
    return matches || {};
  }
  const filtered = {};
  for (const section of sections) {
    if (!section?.id || !Array.isArray(section.items)) {
      continue;
    }
    const values = matches?.[section.id];
    if (!Array.isArray(values) || values.length === 0) {
      continue;
    }
    const allowed = new Set(
      section.items
        .map((item) => (item?.fullText ? String(item.fullText) : (item?.text ? String(item.text) : '')))
        .filter(Boolean)
    );
    const kept = values.filter((value) => allowed.has(value));
    if (kept.length) {
      filtered[section.id] = kept;
    }
  }
  return filtered;
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
    const simScore = typeof entry.score?.similarity === 'number' ? entry.score.similarity : 0;
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

function parseBoolParam(raw, fallback = false) {
  if (raw === null || raw === undefined) {
    return fallback;
  }
  const value = String(raw).trim().toLowerCase();
  if (value === '1' || value === 'true' || value === 'yes' || value === 'y') return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'n') return false;
  return fallback;
}

function clampInt(value, min, max, fallback) {
  const numeric = Number.parseInt(String(value), 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numeric));
}

async function handleAdminPurgeOrphanStructures(request, env, corsHeaders) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: 'Unauthorized' }, { status: 403, headers: corsHeaders });
  }
  if (!env?.STRUCTURES_BUCKET || !env?.KV) {
    return Response.json({ error: 'Missing STRUCTURES_BUCKET or KV binding' }, { status: 500, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const cursorIn = url.searchParams.get('cursor') || undefined;
  const prefixRaw = (url.searchParams.get('prefix') || '').trim();
  const prefix = prefixRaw === '' ? undefined : prefixRaw;
  const dryRun = parseBoolParam(url.searchParams.get('dryRun'), true);
  const limit = clampInt(url.searchParams.get('limit'), 1, 1000, 250);

  // Safety: only allow the known structure prefixes.
  const allowedPrefixes = new Set(['pdb/', 'alphafold/', 'swissmodel/']);
  if (prefix && !allowedPrefixes.has(prefix)) {
    return Response.json({
      error: 'Invalid prefix. Allowed: pdb/, alphafold/, swissmodel/',
      prefix
    }, { status: 400, headers: corsHeaders });
  }

  const listResp = await env.STRUCTURES_BUCKET.list({ cursor: cursorIn, limit, prefix });
  const objects = listResp?.objects || [];

  let scanned = 0;
  let orphaned = 0;
  let deleted = 0;
  let errors = 0;
  const sampleOrphans = [];

  for (const obj of objects) {
    const key = obj?.key || obj?.name;
    if (!key) {
      continue;
    }
    scanned += 1;
    let metaRaw = null;
    try {
      metaRaw = await env.KV.get(`${STRUCTURE_CACHE_META_PREFIX}${key}`);
    } catch {
      // If KV read fails, don't delete blindly.
      errors += 1;
      continue;
    }

    if (metaRaw) {
      continue;
    }

    orphaned += 1;
    if (sampleOrphans.length < 25) {
      sampleOrphans.push({ key, size: obj?.size || 0, uploaded: obj?.uploaded || null });
    }

    if (dryRun) {
      continue;
    }

    try {
      await env.STRUCTURES_BUCKET.delete(key);
      deleted += 1;
    } catch {
      errors += 1;
    }
  }

  const nextCursor = listResp?.truncated ? (listResp?.cursor || null) : null;

  return Response.json({
    dryRun,
    limit,
    prefix: prefix || null,
    cursorIn: cursorIn || null,
    nextCursor,
    scanned,
    orphaned,
    deleted,
    errors,
    sampleOrphans
  }, { headers: corsHeaders });
}

async function handleAdminDeleteStructure(request, env, corsHeaders) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: 'Unauthorized' }, { status: 403, headers: corsHeaders });
  }
  if (!env?.STRUCTURES_BUCKET || !env?.KV) {
    return Response.json({ error: 'Missing STRUCTURES_BUCKET or KV binding' }, { status: 500, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const key = (url.searchParams.get('key') || '').trim();
  const dryRun = parseBoolParam(url.searchParams.get('dryRun'), true);
  const deleteMeta = parseBoolParam(url.searchParams.get('deleteMeta'), true);

  if (!key) {
    return Response.json({ error: 'Missing key' }, { status: 400, headers: corsHeaders });
  }
  if (key.startsWith('/') || key.includes('..')) {
    return Response.json({ error: 'Invalid key' }, { status: 400, headers: corsHeaders });
  }

  const allowedPrefixes = new Set(['pdb/', 'alphafold/', 'swissmodel/']);
  const keyPrefix = [...allowedPrefixes].find((p) => key.startsWith(p)) || null;
  if (!keyPrefix) {
    return Response.json({
      error: 'Invalid key prefix. Allowed: pdb/, alphafold/, swissmodel/',
      key
    }, { status: 400, headers: corsHeaders });
  }

  let exists = false;
  let size = null;
  try {
    const head = await env.STRUCTURES_BUCKET.head(key);
    exists = Boolean(head);
    size = head?.size ?? null;
  } catch {
    // If head fails, don't delete blindly.
    return Response.json({ error: 'Failed to read object metadata', key }, { status: 500, headers: corsHeaders });
  }

  let deletedObject = false;
  let deletedMeta = false;

  if (!dryRun && exists) {
    try {
      await env.STRUCTURES_BUCKET.delete(key);
      deletedObject = true;
    } catch {
      return Response.json({ error: 'Failed to delete object', key }, { status: 500, headers: corsHeaders });
    }
  }

  if (!dryRun && deleteMeta) {
    try {
      await env.KV.delete(`${STRUCTURE_CACHE_META_PREFIX}${key}`);
      deletedMeta = true;
    } catch {
      // Non-fatal. Meta is best-effort.
      deletedMeta = false;
    }
  }

  return Response.json({
    dryRun,
    key,
    keyPrefix,
    exists,
    size,
    deleteMeta,
    deletedObject,
    deletedMeta
  }, { headers: corsHeaders });
}

async function listReferencedStructureKeys(env) {
  const keys = new Set();
  const stats = {
    rows: 0,
    referenced: 0,
    referencedBySource: {
      pdb: 0,
      alphafold: 0,
      swissmodel: 0,
      other: 0
    },
    nullMetaRows: 0
  };

  if (!env?.DB) {
    return { keys, stats };
  }

  const PAGE = 1000;
  let offset = 0;
  while (true) {
    const resp = await env.DB
      .prepare(
        `SELECT uniprot, structure_source, pdb_id, alphafold_url, swissmodel_url, swissmodel_template
         FROM proteins
         WHERE structure_source IS NOT NULL
         LIMIT ? OFFSET ?`
      )
      .bind(PAGE, offset)
      .all();

    const rows = resp?.results || [];
    stats.rows += rows.length;
    if (rows.length === 0) {
      break;
    }

    for (const row of rows) {
      const meta = buildMetaFromStoredStructure(row);
      if (!meta?.r2Key) {
        stats.nullMetaRows += 1;
        continue;
      }
      keys.add(meta.r2Key);
      stats.referenced += 1;
      const source = meta.source || row.structure_source;
      if (source === 'pdb') stats.referencedBySource.pdb += 1;
      else if (source === 'alphafold') stats.referencedBySource.alphafold += 1;
      else if (source === 'swissmodel') stats.referencedBySource.swissmodel += 1;
      else stats.referencedBySource.other += 1;
    }

    if (rows.length < PAGE) {
      break;
    }
    offset += PAGE;
  }

  return { keys, stats };
}

async function handleAdminPurgeUnreferencedStructures(request, env, corsHeaders) {
  if (!(await isAdmin(request, env))) {
    return Response.json({ error: 'Unauthorized' }, { status: 403, headers: corsHeaders });
  }
  if (!env?.STRUCTURES_BUCKET || !env?.KV || !env?.DB) {
    return Response.json({ error: 'Missing STRUCTURES_BUCKET, KV, or DB binding' }, { status: 500, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const cursorIn = url.searchParams.get('cursor') || undefined;
  const prefixRaw = (url.searchParams.get('prefix') || '').trim();
  const prefix = prefixRaw === '' ? undefined : prefixRaw;
  const dryRun = parseBoolParam(url.searchParams.get('dryRun'), true);
  const limit = clampInt(url.searchParams.get('limit'), 1, 1000, 250);
  const deleteMeta = parseBoolParam(url.searchParams.get('deleteMeta'), true);

  const allowedPrefixes = new Set(['pdb/', 'alphafold/', 'swissmodel/']);
  if (prefix && !allowedPrefixes.has(prefix)) {
    return Response.json({
      error: 'Invalid prefix. Allowed: pdb/, alphafold/, swissmodel/',
      prefix
    }, { status: 400, headers: corsHeaders });
  }

  // Build the referenced set from the current DB.
  const { keys: referencedKeys, stats: referenceStats } = await listReferencedStructureKeys(env);

  const listResp = await env.STRUCTURES_BUCKET.list({ cursor: cursorIn, limit, prefix });
  const objects = listResp?.objects || [];

  let scanned = 0;
  let unreferenced = 0;
  let deleted = 0;
  let deletedBytes = 0;
  let errors = 0;
  const sampleUnreferenced = [];

  for (const obj of objects) {
    const key = obj?.key || obj?.name;
    if (!key) {
      continue;
    }
    scanned += 1;
    if (referencedKeys.has(key)) {
      continue;
    }

    unreferenced += 1;
    if (sampleUnreferenced.length < 25) {
      sampleUnreferenced.push({ key, size: obj?.size || 0, uploaded: obj?.uploaded || null });
    }

    if (dryRun) {
      continue;
    }

    try {
      await env.STRUCTURES_BUCKET.delete(key);
      deleted += 1;
      deletedBytes += obj?.size || 0;
    } catch {
      errors += 1;
      continue;
    }

    if (deleteMeta) {
      try {
        await env.KV.delete(`${STRUCTURE_CACHE_META_PREFIX}${key}`);
      } catch {
        // Best-effort.
      }
    }
  }

  const nextCursor = listResp?.truncated ? (listResp?.cursor || null) : null;

  return Response.json({
    dryRun,
    limit,
    prefix: prefix || null,
    cursorIn: cursorIn || null,
    nextCursor,
    deleteMeta,
    scanned,
    unreferenced,
    deleted,
    deletedBytes,
    errors,
    sampleUnreferenced,
    referenceStats,
    referencedKeyCount: referencedKeys.size
  }, { headers: corsHeaders });
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
      shortLabel: 'RCSB PDB',
      displayLabel: `RCSB PDB (${pdbId})`,
      format: 'bcif',
      linkUrl: `https://www.rcsb.org/structure/${pdbId}`
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
      format: ext,
      linkUrl: null  // SWISS-MODEL URLs are direct downloads, not webpages
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
      format,
      linkUrl: `https://alphafold.ebi.ac.uk/entry/${protein.uniprot}`
    };
  }
  
  // All proteins with structure data have structure_source set
  // No fallback paths needed (verified via database query 2025-12-10)
  return null;
}

const STRUCTURE_SOURCE_CACHE_PREFIX = 'structure_source:';
const STRUCTURE_SOURCE_CACHE_TTL = 60 * 60 * 24; // 24 hours

// Cache index metadata (KV).
//
// We keep an index of R2 objects in KV (size + lastAccess) so we can evict old
// structures when the bucket hits a cap.
//
// These entries have NO TTL - they persist until explicitly deleted by evictStructureCache().
// This prevents orphaning: if KV expired but R2 didn't, eviction couldn't find/delete the R2 object.

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
      shortLabel: 'RCSB PDB',
      displayLabel: `RCSB PDB (${selected.id})`,
      format: ext,
      linkUrl: `https://www.rcsb.org/structure/${selected.id}`
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
      format: normalizedFormat,
      linkUrl: null  // SWISS-MODEL URLs are direct downloads, not webpages
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
  // No TTL - entries persist until explicitly deleted by evictStructureCache()
  await env.KV.put(`${STRUCTURE_CACHE_META_PREFIX}${key}`, JSON.stringify(meta));
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
    // No TTL - entries persist until explicitly deleted by evictStructureCache()
    await env.KV.put(cacheKey, JSON.stringify(meta));
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
