// Cloudflare's two daily D1 walls on the free plan, as its errors word them. On
// 2026-10-09 at about 21:00 UTC the write wall answered "Your account has
// exceeded D1's free tier daily row write limit"; the register route turned it
// into a 500, and the factory failed a publication instead of waiting.
const DAILY_ROW_LIMIT_MARKERS = {
  read: [
    "exceeded d1's free tier daily row read limit",
    "d1 free tier daily row read limit exceeded",
  ],
  write: [
    "exceeded d1's free tier daily row write limit",
    "d1 free tier daily row write limit exceeded",
  ],
}

// "read" or "write" when the error (or one of its causes) is Cloudflare's daily D1
// limit, otherwise null.
export function d1DailyRowLimitKind(error) {
  const visited = new Set()
  let current = error
  while (current && !visited.has(current)) {
    visited.add(current)
    const message = String(current?.message || current || "").toLowerCase()
    for (const [kind, markers] of Object.entries(DAILY_ROW_LIMIT_MARKERS))
      if (markers.some((marker) => message.includes(marker))) return kind
    current = current?.cause
  }
  return null
}

export function isD1DailyRowLimitError(error) {
  return d1DailyRowLimitKind(error) !== null
}

export function isDurableObjectDailyDurationLimitError(error) {
  const visited = new Set()
  for (let current = error; current && !visited.has(current); current = current?.cause) {
    visited.add(current)
    const message = String(current?.message || current || "").toLowerCase()
    if (message.includes("exceeded allowed duration in durable objects free tier")) return true
    if (
      message.includes("exceeded the daily cloudflare durable objects free tier limit") &&
      message.includes("duration")
    )
      return true
  }
  return false
}

// The one answer to "how many seconds until the UTC day rolls over", plus `marginSeconds`.
// The default 5 s is slack for Cloudflare's own daily meters to reset. A caller whose day
// rolls over exactly at 00:00:00 UTC (the vote budget row and the browser-render budget row are
// keyed on a UTC date) passes 0. Rounded up, so nobody asks a moment early, and never below 1.
export function secondsUntilCloudflareDailyReset(now = Date.now(), marginSeconds = 5) {
  const current = new Date(now)
  const resetAt = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate() + 1,
    0,
    0,
    marginSeconds,
  )
  return Math.max(1, Math.ceil((resetAt - current.getTime()) / 1000))
}

export function d1DailyRowLimitResponse(error, now = Date.now()) {
  const kind = d1DailyRowLimitKind(error)
  if (!kind) return null
  const retryAfter = secondsUntilCloudflareDailyReset(now)
  const code = kind === "write" ? "D1_ACCOUNT_WRITE_LIMIT" : "D1_ACCOUNT_READ_LIMIT"
  return Response.json(
    {
      ok: false,
      code,
      error: {
        code,
        message: `Website database ${kind}s are paused because the account's daily allowance is exhausted. Saved work is retained.`,
      },
      retry_after_seconds: retryAfter,
      reset_at: new Date(now + retryAfter * 1000).toISOString(),
    },
    {
      status: 503,
      headers: { "Cache-Control": "private, no-store", "Retry-After": String(retryAfter) },
    },
  )
}
