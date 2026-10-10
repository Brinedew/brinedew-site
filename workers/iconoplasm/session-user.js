import { secondsUntilCloudflareDailyReset } from "../lib/cloudflare-availability.js"
import { readSession } from "../lib/sealed-session.js"

export class IconoplasmSessionUnavailableError extends Error {
  constructor({ dailyLimit = false, retryAfter = 60 } = {}) {
    super("Account verification is temporarily unavailable. Please try again later.")
    this.code = dailyLimit ? "SESSION_AUTHORITY_DAILY_LIMIT" : "SESSION_AUTHORITY_UNAVAILABLE"
    this.status = 503
    this.retryAfter = dailyLimit
      ? secondsUntilCloudflareDailyReset()
      : Math.max(1, Math.min(86405, Math.ceil(Number(retryAfter) || 60)))
  }
}

// A missing, expired or revoked credential is a guest. An account check that
// D1 could not answer cannot establish that verdict, and must not clear
// identity or authorize a mutation.
export async function iconoplasmSessionUser(request, env) {
  const read = await readSession(request, env)
  if (read.status === "unavailable") {
    throw new IconoplasmSessionUnavailableError({ dailyLimit: read.dailyLimit })
  }
  if (read.status !== "signed_in") return null
  const session = read.session
  return {
    user_id: String(session.user_id),
    account_id: String(session.account_id || "").trim() || null,
    username: String(session.username || "").trim() || null,
    avatar_url: String(session.avatar_url || "").trim() || null,
  }
}
