/**
 * Sign-in without storage (B-1069): the session and the OAuth handshake live in
 * sealed cookies, encrypted JWTs (jose, A256GCM, a direct key from the
 * SESSION_SECRET Worker secret). Reading a session is CPU only.
 *
 * Until 2026-10-09 both lived in GameSession Durable Objects. Each signed-in
 * request cost a Durable Object request and a storage read, and six files read
 * the session their own way. That day the budget referee spent the account's
 * 5M Durable Object storage reads by 17:00 UTC, every storage read failed, and
 * nobody could sign in until 00:00 UTC, though sign-in itself had read about
 * 300 rows all day. A sealed cookie shares no wall with anything.
 *
 * Revocation keeps its guarantees through the account check: the cookie carries
 * the time its account was last found active in D1. Older than five minutes,
 * the reader checks again before trusting it, and /api/auth/me re-seals it. The
 * check also reads whether this session was signed out (auth_session_revocations,
 * keyed by the session id every re-sealed copy shares). So an erased or unlinked
 * account, or a copy of a cookie whose owner signed out, is refused within five
 * minutes.
 */
import { EncryptJWT, jwtDecrypt } from "jose"

import {
  BrinedewAccountIdentityError,
  hydrateBrinedewSessionAccountIdentity,
} from "./brinedew-account-identity.js"
import { isD1DailyRowLimitError } from "./cloudflare-availability.js"

export const SESSION_COOKIE = "session"
export const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60
export const ACCOUNT_RECHECK_MS = 5 * 60 * 1000
const SEAL_HEADER = { alg: "dir", enc: "A256GCM" }

export class SessionSecretMissingError extends Error {
  constructor() {
    super("SESSION_SECRET is not configured")
    this.name = "SessionSecretMissingError"
  }
}

const keys = new Map()
async function sealKey(env) {
  const secret = String(env?.SESSION_SECRET || "").trim()
  if (!secret) throw new SessionSecretMissingError()
  let key = keys.get(secret)
  if (!key) {
    // A 256-bit key from the secret; SESSION_SECRET is 32 random bytes.
    key = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret)))
    keys.set(secret, key)
  }
  return key
}

/** Encrypt `claims` into a cookie value that expires after `maxAgeSeconds`. */
export async function seal(env, claims, { maxAgeSeconds, purpose, now = Date.now() }) {
  return new EncryptJWT({ ...claims, purpose })
    .setProtectedHeader(SEAL_HEADER)
    .setIssuedAt(Math.floor(now / 1000))
    .setExpirationTime(Math.floor(now / 1000) + maxAgeSeconds)
    .encrypt(await sealKey(env))
}

/** The claims of a sealed value, or null if it was not sealed by us for `purpose` or has expired. */
export async function unseal(env, value, { purpose, now = Date.now() }) {
  const raw = String(value || "").trim()
  if (!raw) return null
  try {
    const { payload } = await jwtDecrypt(raw, await sealKey(env), {
      currentDate: new Date(now),
      keyManagementAlgorithms: [SEAL_HEADER.alg],
      contentEncryptionAlgorithms: [SEAL_HEADER.enc],
    })
    return payload.purpose === purpose ? payload : null
  } catch (error) {
    if (error instanceof SessionSecretMissingError) throw error
    return null
  }
}

const SESSION_FIELDS = [
  "sid",
  "user_id",
  "account_id",
  "account_status",
  "username",
  "avatar_url",
  "tier",
  "leaderboard_opt_in",
  "is_guild_member",
  "account_checked_at",
  "roles_checked_at",
]

export async function sealSession(env, session, { now = Date.now() } = {}) {
  const claims = {}
  for (const field of SESSION_FIELDS)
    if (session?.[field] !== undefined) claims[field] = session[field]
  return seal(env, claims, { maxAgeSeconds: SESSION_MAX_AGE_SECONDS, purpose: "session", now })
}

export function sessionCookie(value, { cookieDomain = "", maxAge = SESSION_MAX_AGE_SECONDS } = {}) {
  const domainAttr = cookieDomain ? `; Domain=${cookieDomain}` : ""
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=None; Max-Age=${maxAge}${domainAttr}`
}

export function parseCookies(cookieHeader) {
  const cookies = {}
  String(cookieHeader || "")
    .split(";")
    .forEach((cookie) => {
      const [name, ...rest] = cookie.trim().split("=")
      if (name) cookies[name] = rest.join("=")
    })
  return cookies
}

/**
 * The one session reader. Returns one of:
 * - `{ status: "guest" }`: no session cookie;
 * - `{ status: "invalid", accountStatus? }`: a cookie we didn't seal, an expired
 *   one, or an account no longer active (the caller clears the cookie);
 * - `{ status: "unavailable", dailyLimit }`: the account check was due and D1
 *   could not answer (a mutation must not proceed on it);
 * - `{ status: "signed_in", session, checked }`: `checked` is true when this
 *   read re-checked the account, so the caller may re-seal the cookie.
 */
export async function readSession(request, env, { now = Date.now() } = {}) {
  const cookies = parseCookies(request.headers.get("Cookie"))
  if (!cookies[SESSION_COOKIE]) return { status: "guest" }
  const session = await unseal(env, cookies[SESSION_COOKIE], { purpose: "session", now })
  if (!session?.user_id) return { status: "invalid" }
  if (now - Number(session.account_checked_at || 0) < ACCOUNT_RECHECK_MS) {
    return { status: "signed_in", session, checked: false }
  }
  if (!session.sid) return { status: "invalid" }
  let hydrated
  try {
    const revoked = await env.ICONOPLASM_DB.prepare(
      "SELECT 1 AS revoked FROM auth_session_revocations WHERE session_id = ?",
    )
      .bind(String(session.sid))
      .first()
    if (revoked) return { status: "invalid" }
    hydrated = await hydrateBrinedewSessionAccountIdentity(env.DB, session)
  } catch (error) {
    if (error instanceof BrinedewAccountIdentityError && error.status < 500) {
      return { status: "invalid", accountStatus: "identity_unlinked" }
    }
    return { status: "unavailable", dailyLimit: isD1DailyRowLimitError(error) }
  }
  if (!hydrated.active) return { status: "invalid", accountStatus: hydrated.session.account_status }
  return {
    status: "signed_in",
    session: { ...hydrated.session, account_checked_at: now },
    checked: true,
  }
}

/**
 * Sign out the session in `request`'s cookie everywhere a copy of it lives: one
 * row until the cookie would have expired, and the rows of cookies that already
 * have go. Returns false when D1 could not take the row; the browser's own
 * cookie is cleared either way.
 */
export async function revokeSession(request, env, { now = Date.now() } = {}) {
  const cookies = parseCookies(request.headers.get("Cookie"))
  const session = await unseal(env, cookies[SESSION_COOKIE], { purpose: "session", now }).catch(
    () => null,
  )
  if (!session?.sid) return true
  const expiresAt = Number(session.exp || 0) * 1000 || now + SESSION_MAX_AGE_SECONDS * 1000
  try {
    await env.ICONOPLASM_DB.batch([
      env.ICONOPLASM_DB.prepare(
        `INSERT INTO auth_session_revocations (session_id, expires_at) VALUES (?, ?)
         ON CONFLICT(session_id) DO UPDATE SET expires_at = max(expires_at, excluded.expires_at)`,
      ).bind(String(session.sid), expiresAt),
      env.ICONOPLASM_DB.prepare("DELETE FROM auth_session_revocations WHERE expires_at < ?").bind(
        now,
      ),
    ])
    return true
  } catch (error) {
    console.warn("Sign-out could not record its revocation; a copied cookie stays valid", {
      error: error?.message || String(error || "unknown"),
    })
    return false
  }
}
