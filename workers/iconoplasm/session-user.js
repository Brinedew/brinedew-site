import { parseCookies } from "../auth.js"
import {
  isDurableObjectDailyDurationLimitError,
  secondsUntilCloudflareDailyReset,
} from "../lib/cloudflare-availability.js"

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

// A missing/expired credential is a guest. A failed session service cannot
// establish that verdict, and must not clear identity or authorize a mutation.
export async function iconoplasmSessionUser(request, env) {
  const cookies = parseCookies(request.headers.get("Cookie") || "")
  const sessionId = String(cookies.session || "").trim()
  if (!sessionId) return null
  if (!env.GAME_SESSIONS) throw new IconoplasmSessionUnavailableError()
  try {
    const id = env.GAME_SESSIONS.idFromName(`session:${sessionId}`)
    const response = await env.GAME_SESSIONS.get(id).fetch("http://internal/get")
    if ([401, 403, 404].includes(response.status)) return null
    if (!response.ok) {
      throw new IconoplasmSessionUnavailableError({
        retryAfter: response.headers.get("Retry-After"),
      })
    }
    const session = await response.json()
    // The existing /get contract returns {} after a session was removed.
    if (
      session &&
      typeof session === "object" &&
      !Array.isArray(session) &&
      Object.keys(session).length === 0
    )
      return null
    const userId = String(session?.user_id || "").trim()
    if (!userId) throw new IconoplasmSessionUnavailableError()
    return {
      user_id: userId,
      account_id: String(session?.account_id || "").trim() || null,
      username: String(session?.username || "").trim() || null,
      avatar_url: String(session?.avatar_url || "").trim() || null,
    }
  } catch (error) {
    if (error instanceof IconoplasmSessionUnavailableError) throw error
    throw new IconoplasmSessionUnavailableError({
      dailyLimit: isDurableObjectDailyDurationLimitError(error),
    })
  }
}
