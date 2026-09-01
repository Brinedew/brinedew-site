/**
 * Discord OAuth with PKCE implementation
 */
import { buildAvatarProxyPath, sanitizeDiscordAvatarUrl } from "./lib/avatar-proxy.js"
import {
  BrinedewAccountIdentityError,
  resolveBrinedewAccountIdentity,
} from "./lib/brinedew-account-identity.js"
import { withObservedGameSessionWrite } from "./lib/game-session-write-evidence.js"
import {
  isD1DailyRowReadLimitError,
  secondsUntilD1DailyReset,
} from "./lib/cloudflare-d1-availability.js"

const DISCORD_API = "https://discord.com/api/v10"
const DISCORD_OAUTH = "https://discord.com/oauth2/authorize"
const DISCORD_TOKEN = "https://discord.com/api/v10/oauth2/token"
const DISCORD_CLIENT_ID_FALLBACK = "1438111252730875984"
const INVALID_ENV_MARKERS = new Set(["", "undefined", "null"])
const OAUTH_SESSION_COOKIE_PREFIX = "oauth_session_"
export const SHARED_SESSION_PRESENCE_COOKIE = "brinedew_session_present"
export const PERSISTENT_SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60
const SHARED_SESSION_MAX_AGE_SECONDS = PERSISTENT_SESSION_MAX_AGE_SECONDS
const ACCESS_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

function oauthAuthorityUnavailableResponse({ oauthCookieName, cookieDomainAttr }) {
  const retryAfter = secondsUntilD1DailyReset()
  const headers = new Headers({
    "Retry-After": String(retryAfter),
    "Set-Cookie": `${oauthCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0${cookieDomainAttr}`,
  })
  return Response.json(
    {
      error: "Sign-in is temporarily unavailable while account storage resets.",
      code: "AUTHORITY_STORAGE_DAILY_LIMIT",
      retry_after_seconds: retryAfter,
    },
    { status: 503, headers },
  )
}

export function sharedSessionPresenceCookie({
  present,
  cookieDomain = "",
  maxAge = SHARED_SESSION_MAX_AGE_SECONDS,
} = {}) {
  const domain = String(cookieDomain || "").trim()
  const domainAttr = domain ? `; Domain=${domain}` : ""
  return `${SHARED_SESSION_PRESENCE_COOKIE}=${present ? "1" : ""}; Path=/; Secure; SameSite=Lax; Max-Age=${
    present ? Math.max(0, Number(maxAge) || SHARED_SESSION_MAX_AGE_SECONDS) : 0
  }${domainAttr}`
}

export function persistentSessionCookie({ sessionId, cookieDomain = "" } = {}) {
  const id = String(sessionId || "").trim()
  if (!id) throw new Error("A session id is required")
  const domain = String(cookieDomain || "").trim()
  const domainAttr = domain ? `; Domain=${domain}` : ""
  return `session=${id}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${PERSISTENT_SESSION_MAX_AGE_SECONDS}${domainAttr}`
}

function expiredPersistentSessionHeaders(url) {
  const cookieDomain = getSharedCookieDomain(url.hostname)
  const domainAttr = cookieDomain ? `; Domain=${cookieDomain}` : ""
  const headers = new Headers()
  headers.append(
    "Set-Cookie",
    `session=; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=0${domainAttr}`,
  )
  headers.append("Set-Cookie", sharedSessionPresenceCookie({ present: false, cookieDomain }))
  return headers
}

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

function discordAuthorizationUnavailable(session, now) {
  return {
    ...session,
    access_token: null,
    refresh_token: null,
    expires_at: 0,
    tier: "registered",
    is_guild_member: false,
    discord_authorization_status: "reauthorization_required",
    discord_authorization_checked_at: now,
  }
}

export async function resolveDiscordSessionAuthorization(
  session,
  env,
  { now = Date.now(), fetchImpl = fetch } = {},
) {
  const current = session && typeof session === "object" ? session : {}
  const expiresAt = Number(current.expires_at) || 0
  if (!current.user_id || expiresAt > now + ACCESS_TOKEN_REFRESH_SKEW_MS) {
    return { session: current, outcome: "fresh", changed: false }
  }

  const refreshToken = String(current.refresh_token || "").trim()
  if (!refreshToken) {
    return {
      session: discordAuthorizationUnavailable(current, now),
      outcome: "reauthorization_required",
      changed: true,
    }
  }

  const tokenParams = new URLSearchParams({
    client_id: resolveDiscordClientId(env),
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  })
  const clientSecret = readEnvString(env.DISCORD_CLIENT_SECRET)
  if (clientSecret) tokenParams.set("client_secret", clientSecret)

  let response
  try {
    response = await fetchImpl(DISCORD_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: tokenParams.toString(),
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return { session: current, outcome: "temporarily_unavailable", changed: false }
  }

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null)
    if (String(errorPayload?.error || "").trim() === "invalid_grant") {
      return {
        session: discordAuthorizationUnavailable(current, now),
        outcome: "reauthorization_required",
        changed: true,
      }
    }
    return { session: current, outcome: "temporarily_unavailable", changed: false }
  }

  const tokens = await response.json().catch(() => null)
  const accessToken = String(tokens?.access_token || "").trim()
  const expiresInSeconds = Number(tokens?.expires_in) || 0
  if (!accessToken || expiresInSeconds <= 0) {
    return { session: current, outcome: "temporarily_unavailable", changed: false }
  }

  return {
    session: {
      ...current,
      access_token: accessToken,
      refresh_token: String(tokens?.refresh_token || "").trim() || refreshToken,
      expires_at: now + expiresInSeconds * 1000,
      discord_authorization_status: "active",
      discord_authorization_checked_at: now,
      last_discord_token_refresh_at: now,
    },
    outcome: "refreshed",
    changed: true,
  }
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

async function oauthSessionCookieName(state) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(state))
  // A state-bound name lets independent tabs keep independent HttpOnly
  // browser bindings. Do not replace this with one global OAuth cookie: a
  // second login would overwrite the first and break its callback.
  return `${OAUTH_SESSION_COOKIE_PREFIX}${base64UrlEncode(digest).slice(0, 24)}`
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
  const expiresAt = Date.now() + 600000

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
            expires_at: expiresAt, // 10 minutes
            delete_storage_at: expiresAt,
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
  const oauthCookieName = await oauthSessionCookieName(state)

  // Bind this specific OAuth attempt to this browser. The state-derived cookie
  // name is essential: mobile browsers and multiple app tabs can legitimately
  // have overlapping Discord flows, and a fixed name makes them overwrite.
  return new Response(null, {
    status: 302,
    headers: {
      Location: discordUrl,
      "Set-Cookie": `${oauthCookieName}=${sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600${cookieDomainAttr}`,
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

  // The callback's state identifies the matching browser-bound OAuth cookie.
  // This supports concurrent flows without weakening the login-CSRF binding.
  const cookies = parseCookies(request.headers.get("Cookie") || "")
  const oauthCookieName = await oauthSessionCookieName(state)
  const oauthSessionId = cookies[oauthCookieName]

  if (!oauthSessionId) {
    return Response.json({ error: "Missing OAuth session" }, { status: 400 })
  }

  // Retrieve stored verifier and validate state
  const id = env.GAME_SESSIONS.idFromName(`oauth:${oauthSessionId}`)
  const stub = env.GAME_SESSIONS.get(id)

  let oauthData
  try {
    const oauthDataResp = await stub.fetch(
      new Request("http://internal/consume", { method: "POST" }),
    )
    if (!oauthDataResp.ok) {
      console.error("Failed to consume OAuth data from DO:", await oauthDataResp.text())
      return Response.json({ error: "Failed to retrieve OAuth session" }, { status: 500 })
    }
    oauthData = await oauthDataResp.json()
  } catch (err) {
    console.error("Error consuming OAuth data:", err)
    return Response.json({ error: "Internal server error" }, { status: 500 })
  }

  if (!oauthData || oauthData.state !== state) {
    // Never log OAuth state values. They are short-lived CSRF credentials.
    console.error("OAuth callback did not match a live, unused state")
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

  // Resolve the provider subject to a permanent Brinedew account before
  // updating the mutable Discord profile projection. Username/avatar/role
  // changes must never create a new owner identity.
  const avatarUrlRaw = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
    : null
  const avatarUrl = sanitizeDiscordAvatarUrl(avatarUrlRaw)

  const now = Date.now()
  let accountIdentity
  try {
    accountIdentity = await resolveBrinedewAccountIdentity(env.DB, {
      provider: "discord",
      providerSubject: user.id,
      now,
    })
  } catch (error) {
    if (isD1DailyRowReadLimitError(error)) {
      console.error("Discord OAuth account resolution deferred until the D1 daily reset")
      return oauthAuthorityUnavailableResponse({ oauthCookieName, cookieDomainAttr })
    }
    if (!(error instanceof BrinedewAccountIdentityError)) throw error
    const headers = new Headers({
      "Set-Cookie": `${oauthCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0${cookieDomainAttr}`,
    })
    return Response.json(
      {
        error: "This provider identity cannot currently sign in.",
        code: error.code,
      },
      { status: error.status, headers },
    )
  }
  if (accountIdentity.status !== "active") {
    const headers = new Headers({
      "Set-Cookie": `${oauthCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0${cookieDomainAttr}`,
    })
    return Response.json(
      {
        error: "This Brinedew account is not active.",
        code: "ACCOUNT_NOT_ACTIVE",
        account_status: accountIdentity.status,
      },
      { status: 403, headers },
    )
  }
  try {
    await env.DB.prepare(
      `
    INSERT INTO users (
      discord_id,
      username,
      avatar_url,
      tier,
      leaderboard_opt_in,
      created_at,
      updated_at,
      account_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(discord_id) DO UPDATE SET
      username = excluded.username,
      avatar_url = excluded.avatar_url,
      tier = excluded.tier,
      leaderboard_opt_in = excluded.leaderboard_opt_in,
      updated_at = excluded.updated_at,
      account_id = excluded.account_id
  `,
    )
      .bind(
        user.id,
        user.username,
        avatarUrl,
        tier,
        leaderboardOptIn,
        now,
        now,
        accountIdentity.account_id,
      )
      .run()
  } catch (error) {
    if (!isD1DailyRowReadLimitError(error)) throw error
    console.error("Discord OAuth profile projection deferred until the D1 daily reset")
    return oauthAuthorityUnavailableResponse({ oauthCookieName, cookieDomainAttr })
  }

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
            account_id: accountIdentity.account_id,
            account_status: accountIdentity.status,
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
    `${oauthCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0${cookieDomainAttr}`,
  )
  headers.append("Set-Cookie", persistentSessionCookie({ sessionId, cookieDomain }))
  // This marker contains no identity or authority. Static pages use it only to
  // avoid asking /api/auth/me for every anonymous visitor. The HttpOnly session
  // cookie remains the sole authentication credential.
  headers.append("Set-Cookie", sharedSessionPresenceCookie({ present: true, cookieDomain }))
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
  let resp = await stub.fetch(new Request("http://internal/auth/resolve", { method: "POST" }))
  if (resp.status === 404) resp = await stub.fetch("http://internal/get")
  const discordAuthorizationOutcome = String(
    resp.headers.get("X-Brinedew-Discord-Authorization") || "",
  ).trim()
  if (discordAuthorizationOutcome && discordAuthorizationOutcome !== "fresh") {
    console.info("Discord OAuth session lifecycle", { outcome: discordAuthorizationOutcome })
  }
  if (!resp.ok) {
    const accountStatus = String(resp.headers.get("X-Brinedew-Account-Status") || "").trim()
    return Response.json(
      {
        authenticated: false,
        code: accountStatus ? "ACCOUNT_NOT_ACTIVE" : "SESSION_INVALID",
        ...(accountStatus ? { account_status: accountStatus } : {}),
      },
      { status: 401, headers: expiredPersistentSessionHeaders(new URL(request.url)) },
    )
  }
  const session = await resp.json()

  if (!session || !session.user_id) {
    return Response.json(
      { authenticated: false },
      { status: 401, headers: expiredPersistentSessionHeaders(new URL(request.url)) },
    )
  }

  // Re-check Discord roles to detect both upgrades (registered → supporter)
  // and downgrades (supporter → registered) from external role assignment
  // (e.g. Boosty bot). Cached to at most once per 5 minutes via
  // session last_discord_role_verify timestamp.
  let tier = session.tier
  const providerAccessUsable =
    discordAuthorizationOutcome !== "temporarily_unavailable" &&
    Number(session.expires_at) > Date.now()
  if (
    readEnvString(env.DISCORD_SUPPORTER_ROLE_ID) &&
    session.access_token &&
    providerAccessUsable &&
    (!session.last_discord_role_verify ||
      Date.now() - session.last_discord_role_verify > ROLE_VERIFY_TTL)
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
      if (!guildResp.ok) throw new Error(`Discord role verification failed (${guildResp.status})`)
      if (hasRole !== (tier === "supporter")) {
        tier = hasRole ? "supporter" : "registered"
        session.tier = tier
        await env.DB.prepare(`UPDATE users SET tier = ?, updated_at = ? WHERE discord_id = ?`)
          .bind(tier, Date.now(), session.user_id)
          .run()
      }
      // Cache the verify timestamp so the next /api/auth/me doesn't
      // retry within the TTL window. Always update the store so the
      // timestamp persists across worker isolates.
      session.last_discord_role_verify = Date.now()
      const patchResponse = await stub.fetch(
        new Request("http://internal/auth/patch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expected_access_token: session.access_token,
            tier: session.tier,
            last_discord_role_verify: session.last_discord_role_verify,
          }),
        }),
      )
      if (patchResponse.status === 404) {
        await stub.fetch(
          new Request("http://internal/store", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(session),
          }),
        )
      }
    } catch {
      // Network error / timeout — do NOT cache; next page load retries.
    }
  }

  const adminUserId = String(env.ADMIN_DISCORD_USER_ID || "").trim()

  const url = new URL(request.url)
  const cookieDomain = getSharedCookieDomain(url.hostname)
  const headers = new Headers()
  headers.append("Set-Cookie", persistentSessionCookie({ sessionId, cookieDomain }))
  headers.append("Set-Cookie", sharedSessionPresenceCookie({ present: true, cookieDomain }))

  return Response.json(
    {
      authenticated: true,
      user: {
        id: session.user_id,
        account_id: session.account_id || null,
        account_status: session.account_status || "active",
        username: session.username,
        avatar_url: toClientAvatarUrl(session.avatar_url) || session.avatar_url || null,
        tier,
        leaderboard_opt_in: Boolean(session.leaderboard_opt_in),
        is_guild_member: session.is_guild_member,
        is_admin: adminUserId.length > 0 && session.user_id === adminUserId,
        discord_authorization_status:
          String(session.discord_authorization_status || "").trim() || "active",
      },
    },
    { headers },
  )
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
  headers.append("Set-Cookie", sharedSessionPresenceCookie({ present: false, cookieDomain }))

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
