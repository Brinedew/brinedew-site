const DAILY_ROW_READ_LIMIT_MARKERS = [
  "exceeded d1's free tier daily row read limit",
  "d1 free tier daily row read limit exceeded",
]

export function isD1DailyRowReadLimitError(error) {
  const visited = new Set()
  let current = error
  while (current && !visited.has(current)) {
    visited.add(current)
    const message = String(current?.message || current || "").toLowerCase()
    if (DAILY_ROW_READ_LIMIT_MARKERS.some((marker) => message.includes(marker))) return true
    current = current?.cause
  }
  return false
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

export function secondsUntilCloudflareDailyReset(now = Date.now()) {
  const current = new Date(now)
  const resetAt = Date.UTC(
    current.getUTCFullYear(),
    current.getUTCMonth(),
    current.getUTCDate() + 1,
    0,
    0,
    5,
  )
  return Math.max(1, Math.ceil((resetAt - current.getTime()) / 1000))
}
