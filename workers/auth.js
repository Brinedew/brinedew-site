/**
 * Discord OAuth with PKCE implementation
 */

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_OAUTH = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN = 'https://discord.com/api/v10/oauth2/token';

// PKCE helper functions
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);
  return Array.from(randomValues)
    .map(v => chars[v % chars.length])
    .join('');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(hash);
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * GET /api/auth/login
 * Initiate Discord OAuth flow with PKCE
 */
export async function handleLogin(request, env) {
  const url = new URL(request.url);
  
  // Generate PKCE values
  const codeVerifier = generateRandomString(128);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(32);
  
  // Store verifier and state in session (temporary storage)
  const sessionId = crypto.randomUUID();
  const id = env.GAME_SESSIONS.idFromName(`oauth:${sessionId}`);
  const stub = env.GAME_SESSIONS.get(id);
  
  await stub.fetch(new Request('http://internal/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code_verifier: codeVerifier,
      state: state,
      expires_at: Date.now() + 600000 // 10 minutes
    })
  }));
  
  // Build Discord OAuth URL
  const redirectUri = `${url.origin}/api/auth/callback`;
  const params = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds.members.read',
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });
  
  const discordUrl = `${DISCORD_OAUTH}?${params.toString()}`;
  
  // Set session cookie to track OAuth session
  return new Response(null, {
    status: 302,
    headers: {
      'Location': discordUrl,
      'Set-Cookie': `oauth_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`
    }
  });
}

/**
 * GET /api/auth/callback
 * Handle Discord OAuth callback
 */
export async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  
  if (!code || !state) {
    return Response.json({ error: 'Missing code or state' }, { status: 400 });
  }
  
  // Get OAuth session from cookie
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const oauthSessionId = cookies.oauth_session;
  
  if (!oauthSessionId) {
    return Response.json({ error: 'Missing OAuth session' }, { status: 400 });
  }
  
  // Retrieve stored verifier and validate state
  const id = env.GAME_SESSIONS.idFromName(`oauth:${oauthSessionId}`);
  const stub = env.GAME_SESSIONS.get(id);
  const oauthDataResp = await stub.fetch('http://internal/get');
  const oauthData = await oauthDataResp.json();
  
  if (!oauthData || oauthData.state !== state) {
    return Response.json({ error: 'Invalid state parameter' }, { status: 400 });
  }
  
  if (Date.now() > oauthData.expires_at) {
    return Response.json({ error: 'OAuth session expired' }, { status: 400 });
  }
  
  // Exchange code for token
  const tokenParams = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    client_secret: env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: `${url.origin}/api/auth/callback`,
    code_verifier: oauthData.code_verifier
  });
  
  const tokenResp = await fetch(DISCORD_TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenParams.toString()
  });
  
  if (!tokenResp.ok) {
    const error = await tokenResp.text();
    console.error('Token exchange failed:', error);
    return Response.json({ error: 'Failed to exchange code' }, { status: 500 });
  }
  
  const tokens = await tokenResp.json();
  
  // Fetch user info
  const userResp = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` }
  });
  
  if (!userResp.ok) {
    return Response.json({ error: 'Failed to fetch user info' }, { status: 500 });
  }
  
  const user = await userResp.json();
  
  // Check guild membership
  const guildResp = await fetch(`${DISCORD_API}/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, {
    headers: { 'Authorization': `Bearer ${tokens.access_token}` }
  });
  
  const isMember = guildResp.ok;
  
  // Create or update user in D1
  await env.DB.prepare(`
    INSERT INTO users (discord_id, username, discriminator, avatar, tier, created_at, last_login)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      username = excluded.username,
      discriminator = excluded.discriminator,
      avatar = excluded.avatar,
      last_login = excluded.last_login
  `).bind(
    user.id,
    user.username,
    user.discriminator || '0',
    user.avatar,
    'registered',
    Date.now(),
    Date.now()
  ).run();
  
  // Create persistent session
  const sessionId = crypto.randomUUID();
  const sessionStubId = env.GAME_SESSIONS.idFromName(`session:${sessionId}`);
  const sessionStub = env.GAME_SESSIONS.get(sessionStubId);
  
  await sessionStub.fetch(new Request('http://internal/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user_id: user.id,
      username: user.username,
      discriminator: user.discriminator || '0',
      avatar: user.avatar,
      tier: 'registered',
      is_guild_member: isMember,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Date.now() + (tokens.expires_in * 1000)
    })
  }));
  
  // Clear OAuth session and set persistent session cookie
  const headers = new Headers();
  headers.set('Set-Cookie', `oauth_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  headers.append('Set-Cookie', `session=${sessionId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`); // 30 days
  headers.set('Location', '/geneguessr/');
  
  return new Response(null, {
    status: 302,
    headers
  });
}

/**
 * GET /api/auth/me
 * Get current user info from session
 */
export async function handleMe(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionId = cookies.session;
  
  if (!sessionId) {
    return Response.json({ authenticated: false }, { status: 401 });
  }
  
  const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`);
  const stub = env.GAME_SESSIONS.get(id);
  const resp = await stub.fetch('http://internal/get');
  const session = await resp.json();
  
  if (!session || !session.user_id) {
    return Response.json({ authenticated: false }, { status: 401 });
  }
  
  // Check if token needs refresh
  if (Date.now() > session.expires_at) {
    // TODO: Implement token refresh
    return Response.json({ authenticated: false, error: 'Token expired' }, { status: 401 });
  }
  
  return Response.json({
    authenticated: true,
    user: {
      id: session.user_id,
      username: session.username,
      discriminator: session.discriminator,
      avatar: session.avatar,
      tier: session.tier,
      is_guild_member: session.is_guild_member
    }
  });
}

/**
 * POST /api/auth/logout
 * Clear session
 */
export async function handleLogout(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionId = cookies.session;
  
  if (sessionId) {
    // Clear session data
    const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`);
    const stub = env.GAME_SESSIONS.get(id);
    await stub.fetch(new Request('http://internal/reset', { method: 'POST' }));
  }
  
  // Clear session cookie
  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/geneguessr/',
      'Set-Cookie': `session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
    }
  });
}

/**
 * Parse cookie header
 */
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
