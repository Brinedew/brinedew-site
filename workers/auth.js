/**
 * Discord OAuth with PKCE implementation
 */
import { buildAvatarProxyPath, sanitizeDiscordAvatarUrl } from "./lib/avatar-proxy.js"
import { withObservedGameSessionWrite } from "./lib/game-session-write-evidence.js"

const DISCORD_API = "https://discord.com/api/v10"
const DISCORD_OAUTH = "https://discord.com/oauth2/authorize"
const DISCORD_TOKEN = "https://discord.com/api/v10/oauth2/token"
const DISCORD_CLIENT_ID_FALLBACK = "1438111252730875984"
const INVALID_ENV_MARKERS = new Set(["", "undefined", "null"])

function readEnvString(value) {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  if (INVALID_ENV_MARKERS.has(trimmed.toLowerCase())) return ""
  return trimmed
}

function resolveDiscordClientId(env) {
  return (
    readEnvString(env.DISCORD_CLIENT_ID) ||
    readEnvString(env.DISCORD_APPLICATION_ID) ||
    DISCORD_CLIENT_ID_FALLBACK
  )
}

export function getDiscordAuthConfigStatus(env) {
  const clientId = resolveDiscordClientId(env)
  const clientSecret = readEnvString(env.DISCORD_CLIENT_SECRET)
  const guildId = readEnvString(env.DISCORD_GUILD_ID)
  const missingRequired = []
  const missingOptional = []

  if (!clientId) missingRequired.push("DISCORD_CLIENT_ID")
  if (!clientSecret) missingOptional.push("DISCORD_CLIENT_SECRET")
  if (!guildId) missingOptional.push("DISCORD_GUILD_ID")

  return {
    loginReady: missingRequired.length === 0,
    missingRequired,
    missingOptional,
    missing: [...missingRequired, ...missingOptional],
  }
}

// PKCE helper functions
function generateRandomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
  const randomValues = new Uint8Array(length)
  crypto.getRandomValues(randomValues)
  return Array.from(randomValues)
    .map((v) => chars[v % chars.length])
    .join("")
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder()
  const data = encoder.encode(verifier)
  const hash = await crypto.subtle.digest("SHA-256", data)
  return base64UrlEncode(hash)
}

function base64UrlEncode(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ""
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "")
}

function parseLeaderboardOptInFromUrl(url) {
  const raw = String(url.searchParams.get("leaderboard_opt_in") || "")
    .trim()
    .toLowerCase()
  return raw === "1" || raw === "true" || raw === "on" || raw === "yes"
}

function normalizeReturnToUrl(rawValue, requestUrl) {
  const raw = String(rawValue || "").trim()
  if (!raw) return ""
  try {
    const candidate = new URL(raw, requestUrl.origin)
    const host = String(candidate.hostname || "").toLowerCase()
    const requestHost = String(requestUrl.hostname || "").toLowerCase()
    const isLocal =
      host === "localhost" ||
      host === "127.0.0.1" ||
      requestHost === "localhost" ||
      requestHost === "127.0.0.1"
    if (isLocal && candidate.origin === requestUrl.origin) {
      return candidate.toString()
    }
    if (host === requestHost) {
      return candidate.toString()
    }
    if (host === "brinedew.bio" || host === "www.brinedew.bio" || host.endsWith(".brinedew.bio")) {
      return candidate.toString()
    }
  } catch (_err) {
    return ""
  }
  return ""
}

function getSharedCookieDomain(hostname) {
  const host = String(hostname || "").toLowerCase()
  if (host === "brinedew.bio" || host === "www.brinedew.bio" || host.endsWith(".brinedew.bio")) {
    return ".brinedew.bio"
  }
  return ""
}

function toClientAvatarUrl(raw) {
  const proxied = buildAvatarProxyPath(raw)
  return proxied || null
}

function resolveDiscordRedirectUri(url, env) {
  const configured = String(env.DISCORD_REDIRECT_URI || "").trim()
  if (configured) {
    return configured
  }

  // Keep production OAuth callback stable even when app is served from the apex domain.
  const host = String(url.hostname || "").toLowerCase()
  if (host === "brinedew.bio" || host === "www.brinedew.bio" || host.endsWith(".brinedew.bio")) {
    return "https://geneguessr.brinedew.bio/api/auth/callback"
  }

  return `${url.origin}/api/auth/callback`
}

export function resolvePostAuthAppUrl(requestUrl, cookieDomain) {
  const host = String(requestUrl.hostname || "").toLowerCase()

  // When no explicit return_to was given, send the user back to the origin
  // they started from. The cookie domain covers all *.brinedew.bio subdomains,
  // so any of them will see the session after redirect.
  if (
    host.endsWith(".workers.dev") ||
    host === "staging.brinedew.bio" ||
    host.endsWith(".pages.dev")
  ) {
    return `${requestUrl.origin}/`
  }

  // For production subdomains, stay on the same canonical app host.
  if (host === "geneguessr.brinedew.bio") return `${requestUrl.origin}/`
  if (host === "iconoplasm.brinedew.bio") return `${requestUrl.origin}/`
  if (host === "brinedew.bio" || host === "www.brinedew.bio") return `${requestUrl.origin}/`

  // Apex domain default: send GeneGuessr sessions to the canonical app host.
  return "https://geneguessr.brinedew.bio/"
}

/**
 * GET /api/auth/login
 * Initiate Discord OAuth flow with PKCE
 */
export async function handleLogin(request, env) {
  const url = new URL(request.url)
  const configStatus = getDiscordAuthConfigStatus(env)
  if (!configStatus.loginReady) {
    console.error(
      "Discord OAuth config missing required values for login:",
      configStatus.missingRequired,
    )
    return Response.json(
      {
        error: "Discord OAuth is not configured",
        missing: configStatus.missingRequired,
      },
      { status: 503 },
    )
  }

  const leaderboardOptIn = parseLeaderboardOptInFromUrl(url)
  const returnTo = normalizeReturnToUrl(url.searchParams.get("return_to"), url)
  const redirectUri = resolveDiscordRedirectUri(url, env)
  const cookieDomain = getSharedCookieDomain(url.hostname)
  const cookieDomainAttr = cookieDomain ? `; Domain=${cookieDomain}` : ""
  const clientId = resolveDiscordClientId(env)

  // Generate PKCE values
  const codeVerifier = generateRandomString(128)
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateRandomString(32)

  // Store verifier and state in session (temporary storage)
  const sessionId = crypto.randomUUID()
  const id = env.GAME_SESSIONS.idFromName(`oauth:${sessionId}`)
  const stub = env.GAME_SESSIONS.get(id)

  await withObservedGameSessionWrite(
    env,
    {
      operation: "auth_oauth_store",
      requestPath: "/api/auth/login",
      sessionId: `oauth:${sessionId}`,
    },
    async () => {
      await stub.fetch(
        new Request("http://internal/store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code_verifier: codeVerifier,
            state: state,
            leaderboard_opt_in: leaderboardOptIn ? 1 : 0,
            return_to: returnTo,
            redirect_uri: redirectUri,
            cookie_domain: cookieDomain,
            expires_at: Date.now() + 600000, // 10 minutes
          }),
        }),
      )
    },
  )

  // Build Discord OAuth URL
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify guilds.members.read",
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  })

  const discordUrl = `${DISCORD_OAUTH}?${params.toString()}`

  // Set session cookie to track OAuth session
  return new Response(null, {
    status: 302,
    headers: {
      Location: discordUrl,
      "Set-Cookie": `oauth_session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600${cookieDomainAttr}`,
    },
  })
}

/**
 * GET /api/auth/callback
 * Handle Discord OAuth callback
 */
export async function handleCallback(request, env) {
  const url = new URL(request.url)
  const configStatus = getDiscordAuthConfigStatus(env)
  if (!configStatus.loginReady) {
    console.error(
      "Discord OAuth config missing required values for callback:",
      configStatus.missingRequired,
    )
    return Response.json(
      {
        error: "Discord OAuth is not configured",
        missing: configStatus.missingRequired,
      },
      { status: 503 },
    )
  }

  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")

  if (!code || !state) {
    return Response.json({ error: "Missing code or state" }, { status: 400 })
  }

  // Get OAuth session from cookie
  const cookies = parseCookies(request.headers.get("Cookie") || "")
  const oauthSessionId = cookies.oauth_session

  if (!oauthSessionId) {
    return Response.json({ error: "Missing OAuth session" }, { status: 400 })
  }

  // Retrieve stored verifier and validate state
  const id = env.GAME_SESSIONS.idFromName(`oauth:${oauthSessionId}`)
  const stub = env.GAME_SESSIONS.get(id)

  let oauthData
  try {
    const oauthDataResp = await stub.fetch("http://internal/get")
    if (!oauthDataResp.ok) {
      console.error("Failed to fetch OAuth data from DO:", await oauthDataResp.text())
      return Response.json({ error: "Failed to retrieve OAuth session" }, { status: 500 })
    }
    oauthData = await oauthDataResp.json()
  } catch (err) {
    console.error("Error fetching OAuth data:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }

  if (!oauthData || oauthData.state !== state) {
    console.error("Invalid state. Expected:", oauthData?.state, "Got:", state)
    return Response.json({ error: "Invalid state parameter" }, { status: 400 })
  }

  if (Date.now() > oauthData.expires_at) {
    return Response.json({ error: "OAuth session expired" }, { status: 400 })
  }

  const redirectUri =
    typeof oauthData?.redirect_uri === "string" && oauthData.redirect_uri.trim()
      ? oauthData.redirect_uri.trim()
      : resolveDiscordRedirectUri(url, env)
  const cookieDomain =
    typeof oauthData?.cookie_domain === "string" && oauthData.cookie_domain.trim()
      ? oauthData.cookie_domain.trim()
      : getSharedCookieDomain(url.hostname)
  const cookieDomainAttr = cookieDomain ? `; Domain=${cookieDomain}` : ""
  const clientId = resolveDiscordClientId(env)
  const clientSecret = readEnvString(env.DISCORD_CLIENT_SECRET)
  const guildId = readEnvString(env.DISCORD_GUILD_ID)

  // Exchange code for token
  const tokenParams = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code: code,
    redirect_uri: redirectUri,
    code_verifier: oauthData.code_verifier,
  })
  if (clientSecret) {
    tokenParams.set("client_secret", clientSecret)
  }

  let tokens
  try {
    const tokenResp = await fetch(DISCORD_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
    })

    if (!tokenResp.ok) {
      const error = await tokenResp.text()
      console.error("Token exchange failed:", tokenResp.status, error)
      return Response.json({ error: "Failed to exchange code", details: error }, { status: 500 })
    }

    tokens = await tokenResp.json()
  } catch (err) {
    console.error("Token exchange error:", err)
    return Response.json({ error: "Token exchange failed" }, { status: 500 })
  }

  // Fetch user info
  const userResp = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })

  if (!userResp.ok) {
    return Response.json({ error: "Failed to fetch user info" }, { status: 500 })
  }

  const user = await userResp.json()

  // Check guild membership and roles when configured; otherwise default to false.
  let isMember = false
  let guildRoles = []
  if (guildId) {
    const guildResp = await fetch(`${DISCORD_API}/users/@me/guilds/${guildId}/member`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
    isMember = guildResp.ok
    if (guildResp.ok) {
      try {
        const memberData = await guildResp.json()
        if (Array.isArray(memberData.roles)) {
          guildRoles = memberData.roles
        }
      } catch {
        // Ignore parse errors; proceed with guild membership only.
      }
    }
  }
  const leaderboardOptIn = Number.parseInt(oauthData?.leaderboard_opt_in, 10) === 1 ? 1 : 0

  // Determine tier from Discord roles.
  const supporterRoleId = readEnvString(env.DISCORD_SUPPORTER_ROLE_ID)
  const tier = supporterRoleId && guildRoles.includes(supporterRoleId) ? "supporter" : "registered"

  // Create or update user in D1
  const avatarUrlRaw = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : null
  const avatarUrl = sanitizeDiscordAvatarUrl(avatarUrlRaw)

  const now = Date.now()
  await env.DB.prepare(
    `
    INSERT INTO users (discord_id, username, avatar_url, tier, leaderboard_opt_in, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      username = excluded.username,
      avatar_url = excluded.avatar_url,
      tier = excluded.tier,
      leaderboard_opt_in = excluded.leaderboard_opt_in,
      updated_at = excluded.updated_at
  `,
  )
    .bind(user.id, user.username, avatarUrl, tier, leaderboardOptIn, now, now)
    .run()

  // Create persistent session
  const sessionId = crypto.randomUUID()
  const sessionStubId = env.GAME_SESSIONS.idFromName(`session:${sessionId}`)
  const sessionStub = env.GAME_SESSIONS.get(sessionStubId)

  await withObservedGameSessionWrite(
    env,
    {
      operation: "auth_session_store",
      requestPath: "/api/auth/callback",
      sessionId: `session:${sessionId}`,
    },
    async () => {
      await sessionStub.fetch(
        new Request("http://internal/store", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_id: user.id,
            username: user.username,
            avatar_url: toClientAvatarUrl(avatarUrl),
            tier: tier,
            leaderboard_opt_in: leaderboardOptIn === 1,
            is_guild_member: isMember,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_at: Date.now() + tokens.expires_in * 1000,
          }),
        }),
      )
    },
  )

  // Clear OAuth session and set persistent session cookie
  const headers = new Headers()
  headers.set(
    "Set-Cookie",
    `oauth_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0${cookieDomainAttr}`,
  )
  headers.append(
    "Set-Cookie",
    `session=${sessionId}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${30 * 24 * 60 * 60}${cookieDomainAttr}`,
  ) // 30 days
  const returnTo = normalizeReturnToUrl(oauthData?.return_to, url)
  // Normalize to trailing-slash and preserve cookie visibility across environments.
  // Staging/dev must stay same-origin to retain host-only session cookies.
  headers.set("Location", returnTo || resolvePostAuthAppUrl(url, cookieDomain))

  return new Response(null, {
    status: 302,
    headers,
  })
}

/**
 * GET /api/auth/me
 * Get current user info from session
 */
const ROLE_VERIFY_TTL = 5 * 60 * 1000

export async function handleMe(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "")
  const sessionId = cookies.session

  if (!sessionId) {
    return Response.json({ authenticated: false }, { status: 401 })
  }

  const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`)
  const stub = env.GAME_SESSIONS.get(id)
  const resp = await stub.fetch("http://internal/get")
  const session = await resp.json()

  if (!session || !session.user_id) {
    return Response.json({ authenticated: false }, { status: 401 })
  }

  // Check if token needs refresh
  if (Date.now() > session.expires_at) {
    // TODO: Implement token refresh
    return Response.json({ authenticated: false, error: "Token expired" }, { status: 401 })
  }

  // Re-check Discord roles to detect both upgrades (registered → supporter)
  // and downgrades (supporter → registered) from external role assignment
  // (e.g. Boosty bot). Cached to at most once per 5 minutes via
  // session last_discord_role_verify timestamp.
  let tier = session.tier
  if (
    readEnvString(env.DISCORD_SUPPORTER_ROLE_ID) &&
    session.access_token &&
    (!session.last_discord_role_verify || Date.now() - session.last_discord_role_verify > ROLE_VERIFY_TTL)
  ) {
    try {
      const guildResp = await fetch(
        `${DISCORD_API}/users/@me/guilds/${readEnvString(env.DISCORD_GUILD_ID)}/member`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      )
      let hasRole = false
      if (guildResp.ok) {
        const memberData = await guildResp.json()
        const roles = Array.isArray(memberData.roles) ? memberData.roles : []
        hasRole = roles.includes(readEnvString(env.DISCORD_SUPPORTER_ROLE_ID))
      }
      if (hasRole !== (tier === "supporter")) {
        tier = hasRole ? "supporter" : "registered"
        session.tier = tier
        await env.DB.prepare(
          `UPDATE users SET tier = ?, updated_at = ? WHERE discord_id = ?`,
        ).bind(tier, Date.now(), session.user_id).run()
      }
      // Cache the verify timestamp so the next /api/auth/me doesn't
      // retry within the TTL window. Always update the store so the
      // timestamp persists across worker isolates.
      session.last_discord_role_verify = Date.now()
      await stub.fetch(new Request("http://internal/store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      }))
    } catch {
      // Network error / timeout — do NOT cache; next page load retries.
    }
  }

  const adminUserId = String(env.ADMIN_DISCORD_USER_ID || "").trim()

  return Response.json({
    authenticated: true,
    user: {
      id: session.user_id,
      username: session.username,
      avatar_url: toClientAvatarUrl(session.avatar_url) || session.avatar_url || null,
      tier,
      leaderboard_opt_in: Boolean(session.leaderboard_opt_in),
      is_guild_member: session.is_guild_member,
      is_admin: adminUserId.length > 0 && session.user_id === adminUserId,
    },
  })
}

/**
 * POST /api/auth/logout
 * Clear session
 */
export async function handleLogout(request, env) {
  const url = new URL(request.url)
  const cookieDomain = getSharedCookieDomain(url.hostname)
  const cookieDomainAttr = cookieDomain ? `; Domain=${cookieDomain}` : ""
  const cookies = parseCookies(request.headers.get("Cookie") || "")
  const sessionId = cookies.session

  if (sessionId) {
    // Clear session data
    const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`)
    const stub = env.GAME_SESSIONS.get(id)
    await withObservedGameSessionWrite(
      env,
      {
        operation: "auth_session_reset",
        requestPath: "/api/auth/logout",
        sessionId: `session:${sessionId}`,
      },
      async () => {
        await stub.fetch(new Request("http://internal/reset", { method: "POST" }))
      },
    )
  }

  // Clear session cookie. Do not redirect from this API endpoint because
  // `fetch(..., { credentials: "include" })` callers can hit CORS on cross-origin 302 follow.
  const headers = new Headers()
  headers.set(
    "Set-Cookie",
    `session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0${cookieDomainAttr}`,
  )

  return new Response(null, {
    status: 204,
    headers,
  })
}

/**
 * Parse cookie header
 */
export function parseCookies(cookieHeader) {
  const cookies = {}
  cookieHeader.split(";").forEach((cookie) => {
    const [name, ...rest] = cookie.trim().split("=")
    if (name) {
      cookies[name] = rest.join("=")
    }
  })
  return cookies
}
