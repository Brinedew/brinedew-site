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

export function secondsUntilD1DailyReset(now = Date.now()) {
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
