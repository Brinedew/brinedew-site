// B-1158: the hourly trigger of "Observe Cloudflare capacity"
// (.github/workflows/refresh-iconoplasm-observability-snapshot.yml), which
// bakes the cost snapshot and writes the request rollup the cockpit's
// "Channels today" reads. GitHub's own `schedule` fired it about every 4 to 6
// hours (30 runs from 2026-10-21 to 10-27 against a "17 * * * *" cron), so a
// share link's landings showed up hours late. The Worker's clock is exact:
// once an hour, on the gallery tick at minute 23, it sends one
// repository_dispatch. One GitHub request; no D1, KV or Bunny meter.
export const REQUEST_ROLLUP_DISPATCH_EVENT_TYPE = "iconoplasm-request-rollup"
export const REQUEST_ROLLUP_DISPATCH_MINUTE = 23
const DISPATCH_URL = "https://api.github.com/repos/Brinedew/brinedew-site/dispatches"

export async function dispatchIconoplasmRequestRollup(
  env,
  scheduledTime,
  { fetchImpl = fetch } = {},
) {
  if (new Date(scheduledTime || Date.now()).getUTCMinutes() !== REQUEST_ROLLUP_DISPATCH_MINUTE) {
    return { dispatched: false, reason: "not_this_minute" }
  }
  const token = String(env?.GITHUB_RECAP_DISPATCH_TOKEN || "").trim()
  if (!token) return { dispatched: false, reason: "no_token" }
  const response = await fetchImpl(DISPATCH_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "iconoplasm-worker",
    },
    body: JSON.stringify({ event_type: REQUEST_ROLLUP_DISPATCH_EVENT_TYPE }),
  })
  await response.body?.cancel().catch(() => {})
  return response.ok
    ? { dispatched: true }
    : { dispatched: false, reason: `github_${response.status}` }
}
