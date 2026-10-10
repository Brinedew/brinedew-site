/**
 * Discord OAuth with PKCE. The handshake and the session are sealed cookies
 * (lib/sealed-session.js, B-1069); nothing here touches a Durable Object.
 */
import { buildAvatarProxyPath, sanitizeDiscordAvatarUrl } from "./lib/avatar-proxy.js"
import {
  BrinedewAccountIdentityError,
  resolveBrinedewAccountIdentity,
} from "./lib/brinedew-account-identity.js"
import {
  isD1DailyRowLimitError,
  secondsUntilCloudflareDailyReset,
} from "./lib/cloudflare-availability.js"
import {
  SESSION_MAX_AGE_SECONDS,
  parseCookies,
  readSession,
  revokeSession,
  seal,
  sealSession,
  sessionCookie,
  unseal,
} from "./lib/sealed-session.js"

export { parseCookies }

const DISCORD_API = "https://discord.com/api/v10"
const DISCORD_OAUTH = "https://discord.com/oauth2/authorize"
const DISCORD_TOKEN = "https://discord.com/api/v10/oauth2/token"
const DISCORD_CLIENT_ID_FALLBACK = "1438111252730875984"
const INVALID_ENV_MARKERS = new Set(["", "undefined", "null"])
const OAUTH_SESSION_COOKIE_PREFIX = "oauth_session_"
export const SHARED_SESSION_PRESENCE_COOKIE = "brinedew_session_present"
export const PERSISTENT_SESSION_MAX_AGE_SECONDS = SESSION_MAX_AGE_SECONDS
const SHARED_SESSION_MAX_AGE_SECONDS = PERSISTENT_SESSION_MAX_AGE_SECONDS
const OAUTH_HANDSHAKE_SECONDS = 600

function oauthAuthorityUnavailableResponse({ oauthCookieName, cookieDomainAttr }) {
  const retryAfter = secondsUntilCloudflareDailyReset()
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

export function expiredPersistentSessionHeaders(url) {
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

/**
 * The person's guild membership and supporter role, asked by the bot (Discord's
 * Get Guild Member needs no privileged intent). Login uses the person's own
 * token once and keeps none: a stored refresh token rotates on every use, so two
 * tabs refreshing at once would leave one holding a dead token, which the
 * session Durable Object used to prevent by serializing them (B-1069).
 *
 * Returns `{ isMember, tier }`, or null when Discord didn't give an answer.
 */
export async function readDiscordGuildRoles(env, userId, { fetchImpl = fetch } = {}) {
  const botToken = readEnvString(env.DISCORD_BOT_TOKEN)
  const guildId = readEnvString(env.DISCORD_GUILD_ID)
  if (!botToken || !guildId || !userId) return null
  let response
  try {
    response = await fetchImpl(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
      headers: { Authorization: `Bot ${botToken}` },
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    return null
  }
  if (response.status === 404) return { isMember: false, tier: "registered" }
  if (!response.ok) return null
  const member = await response.json().catch(() => null)
  const roles = Array.isArray(member?.roles) ? member.roles : []
  const supporterRoleId = readEnvString(env.DISCORD_SUPPORTER_ROLE_ID)
  return {
    isMember: true,
    tier: supporterRoleId && roles.includes(supporterRoleId) ? "supporter" : "registered",
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

  // The verifier and state travel in a sealed cookie that only this browser
  // holds, for ten minutes, the way standard OAuth libraries keep them.
  const handshake = await seal(
    env,
    {
      code_verifier: codeVerifier,
      state,
      leaderboard_opt_in: leaderboardOptIn ? 1 : 0,
      return_to: returnTo,
      redirect_uri: redirectUri,
      cookie_domain: cookieDomain,
    },
    { maxAgeSeconds: OAUTH_HANDSHAKE_SECONDS, purpose: "oauth" },
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
      "Set-Cookie": `${oauthCookieName}=${handshake}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${OAUTH_HANDSHAKE_SECONDS}${cookieDomainAttr}`,
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
  const sealedHandshake = cookies[oauthCookieName]

  if (!sealedHandshake) {
    return Response.json({ error: "Missing OAuth session" }, { status: 400 })
  }

  // The sealed handshake expires on its own after ten minutes; Discord accepts
  // each authorization code once, so a replayed callback goes nowhere.
  const oauthData = await unseal(env, sealedHandshake, { purpose: "oauth" })
  if (!oauthData || oauthData.state !== state) {
    // Never log OAuth state values. They are short-lived CSRF credentials.
    console.error("OAuth callback did not match a live state")
    return Response.json({ error: "Invalid state parameter" }, { status: 400 })
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
    if (isD1DailyRowLimitError(error)) {
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
    if (!isD1DailyRowLimitError(error)) throw error
    console.error("Discord OAuth profile projection deferred until the D1 daily reset")
    return oauthAuthorityUnavailableResponse({ oauthCookieName, cookieDomainAttr })
  }

  const sealedSession = await sealSession(env, {
    sid: crypto.randomUUID(),
    user_id: user.id,
    account_id: accountIdentity.account_id,
    account_status: accountIdentity.status,
    username: user.username,
    avatar_url: toClientAvatarUrl(avatarUrl),
    tier: tier,
    leaderboard_opt_in: leaderboardOptIn === 1,
    is_guild_member: isMember,
    account_checked_at: now,
    roles_checked_at: now,
  })

  // Clear OAuth session and set persistent session cookie
  const headers = new Headers()
  headers.set(
    "Set-Cookie",
    `${oauthCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0${cookieDomainAttr}`,
  )
  headers.append("Set-Cookie", sessionCookie(sealedSession, { cookieDomain }))
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

function sessionAuthorityUnavailableResponse({ dailyLimit = false, retryAfter = null } = {}) {
  let retrySeconds = 60
  if (dailyLimit) {
    retrySeconds = secondsUntilCloudflareDailyReset()
  } else if (retryAfter) {
    const supplied = /^\d+$/.test(retryAfter)
      ? Number(retryAfter)
      : Math.ceil((Date.parse(retryAfter) - Date.now()) / 1000)
    if (Number.isFinite(supplied)) retrySeconds = Math.max(1, Math.min(86405, supplied))
  }
  return Response.json(
    {
      error: dailyLimit
        ? "Session verification is unavailable until the daily storage allowance resets."
        : "Session verification is temporarily unavailable. Try again later.",
      code: dailyLimit ? "SESSION_AUTHORITY_DAILY_LIMIT" : "SESSION_AUTHORITY_UNAVAILABLE",
      retry_after_seconds: retrySeconds,
    },
    { status: 503, headers: { "Retry-After": String(retrySeconds), "Cache-Control": "no-store" } },
  )
}

export async function resolveAuthenticatedSession(request, env) {
  const read = await readSession(request, env)
  if (read.status === "guest") {
    return { ok: false, response: Response.json({ authenticated: false }, { status: 401 }) }
  }
  if (read.status === "unavailable") {
    return {
      ok: false,
      response: sessionAuthorityUnavailableResponse({ dailyLimit: read.dailyLimit }),
    }
  }
  if (read.status === "invalid") {
    return {
      ok: false,
      response: Response.json(
        {
          authenticated: false,
          code: read.accountStatus ? "ACCOUNT_NOT_ACTIVE" : "SESSION_INVALID",
          ...(read.accountStatus ? { account_status: read.accountStatus } : {}),
        },
        { status: 401, headers: expiredPersistentSessionHeaders(new URL(request.url)) },
      ),
    }
  }
  return { ok: true, session: read.session }
}

export async function handleMe(request, env) {
  const resolved = await resolveAuthenticatedSession(request, env)
  if (!resolved.ok) return resolved.response
  const session = { ...resolved.session }

  // Re-check Discord roles to catch upgrades (registered → supporter) and
  // downgrades from outside role changes (e.g. the Boosty bot), at most once
  // per five minutes; the re-sealed cookie carries the check time. No answer
  // from Discord keeps the last known roles and retries on the next page.
  if (Date.now() - Number(session.roles_checked_at || 0) > ROLE_VERIFY_TTL) {
    const roles = await readDiscordGuildRoles(env, session.user_id)
    if (roles) {
      if (roles.tier !== session.tier) {
        try {
          await env.DB.prepare(`UPDATE users SET tier = ?, updated_at = ? WHERE discord_id = ?`)
            .bind(roles.tier, Date.now(), session.user_id)
            .run()
        } catch (error) {
          console.warn("Discord role change could not update the user projection", {
            error: error?.message || String(error || "unknown"),
          })
        }
      }
      session.tier = roles.tier
      session.is_guild_member = roles.isMember
      session.roles_checked_at = Date.now()
    }
  }
  const tier = session.tier

  const adminUserId = String(env.ADMIN_DISCORD_USER_ID || "").trim()

  const url = new URL(request.url)
  const cookieDomain = getSharedCookieDomain(url.hostname)
  const headers = new Headers()
  headers.append("Set-Cookie", sessionCookie(await sealSession(env, session), { cookieDomain }))
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
        discord_authorization_status: "active",
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

  // Clearing the cookie signs this browser out; the revocation signs out any
  // copy of it at its next account check.
  await revokeSession(request, env)

  // Do not redirect from this API endpoint because
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
