// Cloudflare's own daily usage for the account, read from its GraphQL analytics.
// It is the meter B-1085's batch admission prices against (batch-admission.js).
const KV_COST_METERS = Object.freeze(["kv_reads", "kv_writes", "kv_deletes", "kv_lists"])

class AccountUsageUnavailableError extends Error {
  constructor() {
    super("COST_ACCOUNT_USAGE_UNAVAILABLE")
    this.name = "AccountUsageUnavailableError"
    this.code = "COST_ACCOUNT_USAGE_UNAVAILABLE"
  }
}

// B-1085: `recent` is the newest minute the meter has shown. The meter runs one
// to two minutes behind (measured 2026-10-11: at 10:44:58 UTC the newest minute
// was 10:43), so everything after that minute is spend it hasn't counted yet.
const QUERY = `query OperationCostAdmission($accountTag: string, $day: Date, $since: Time) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    workersInvocationsAdaptive(limit: 10000, filter: { date_geq: $day, date_leq: $day }) { sum { requests } }
    d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date_geq: $day, date_leq: $day }) {
      dimensions { date databaseId } sum { rowsRead rowsWritten }
    }
    recent: d1AnalyticsAdaptiveGroups(limit: 1, filter: { datetimeMinute_geq: $since }, orderBy: [datetimeMinute_DESC]) {
      dimensions { datetimeMinute }
    }
  } }
}`
const KV_QUERY = QUERY.replace(
  "    d1AnalyticsAdaptiveGroups",
  `    kvOperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $day, date_leq: $day }) {
      dimensions { date actionType } sum { requests }
    }
    d1AnalyticsAdaptiveGroups`,
)

const WINDOW_QUERY = `query D1Window($accountTag: string, $from: Time, $to: Time) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    d1QueriesAdaptiveGroups(limit: 1, filter: { datetime_geq: $from, datetime_leq: $to }) {
      sum { rowsRead rowsWritten }
    }
  } }
}`

const unavailable = () => new AccountUsageUnavailableError()

// How far back the newest-minute probe looks. A quiet account shows no minute in
// it, and then everything older is in the day total.
const RECENT_WINDOW_MS = 10 * 60_000

// B-1059: the whole account's D1 rows between two instants, from Cloudflare's own
// analytics. The Drain asks for a publication's window once the analytics have
// caught up (about 20 minutes) and learns what a portrait costs from it, instead
// of a seed someone measured once. Readers active in the window count too: it is
// what the account spent while the publication ran. Checked live on 2026-10-10:
// 00:00-00:10 UTC answered 47,760 rows read and 9,460 written.
export async function readD1WindowUsage({ accountId, token, from, to, fetcher = fetch }) {
  if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token) throw unavailable()
  const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: WINDOW_QUERY, variables: { accountTag: accountId, from, to } }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw unavailable()
  const payload = await response.json()
  const accounts = payload?.data?.viewer?.accounts
  if (payload?.errors?.length || !Array.isArray(accounts) || accounts.length !== 1)
    throw unavailable()
  const groups = accounts[0]?.d1QueriesAdaptiveGroups
  if (!Array.isArray(groups) || groups.length > 1) throw unavailable()
  const sum = groups[0]?.sum ?? { rowsRead: 0, rowsWritten: 0 }
  const usage = { from, to, rows_read: sum.rowsRead, rows_written: sum.rowsWritten }
  if (![usage.rows_read, usage.rows_written].every((n) => Number.isSafeInteger(n) && n >= 0))
    throw unavailable()
  return usage
}

export function parseOperationCostAccountUsage(
  payload,
  day,
  measuredAt,
  { includeKv = false } = {},
) {
  const accounts = payload?.data?.viewer?.accounts
  if (
    (payload?.errors && (!Array.isArray(payload.errors) || payload.errors.length)) ||
    !Array.isArray(accounts) ||
    accounts.length !== 1
  )
    throw unavailable()
  const account = accounts[0]
  const workers = account?.workersInvocationsAdaptive
  const databases = account?.d1AnalyticsAdaptiveGroups
  if (
    !Array.isArray(workers) ||
    !Array.isArray(databases) ||
    workers.length >= 10000 ||
    databases.length >= 1000
  )
    throw unavailable()
  // Callers with a query of their own (scripts/lib/cloudflare-account-budget.mjs)
  // ask no newest minute; theirs counts from the start of the window.
  const recent = account?.recent ?? []
  if (!Array.isArray(recent) || recent.length > 1) throw unavailable()
  const newest = recent.length ? Date.parse(recent[0]?.dimensions?.datetimeMinute) : null
  if (newest !== null && !Number.isFinite(newest)) throw unavailable()
  const usage = {
    day,
    measured_at: measuredAt,
    // The first minute the meter may not have counted in full: its newest minute
    // (still filling), or the start of the window when it shows none.
    meter_counted_before: new Date(newest ?? measuredAt - RECENT_WINDOW_MS).toISOString(),
    rows_read: 0,
    rows_written: 0,
    requests: 0,
  }
  const add = (meter, value) => {
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(usage[meter] + value))
      throw unavailable()
    usage[meter] += value
  }
  for (const row of workers) add("requests", row?.sum?.requests)
  for (const row of databases) {
    if (row?.dimensions?.date !== day || typeof row.dimensions.databaseId !== "string")
      throw unavailable()
    add("rows_read", row.sum?.rowsRead)
    add("rows_written", row.sum?.rowsWritten)
  }
  if (includeKv) {
    const operations = account.kvOperationsAdaptiveGroups
    if (!Array.isArray(operations) || operations.length >= 10000) throw unavailable()
    for (const meter of KV_COST_METERS) usage[meter] = 0
    const meters = { read: "kv_reads", write: "kv_writes", delete: "kv_deletes", list: "kv_lists" }
    for (const row of operations) {
      const action = row?.dimensions?.actionType
      if (row?.dimensions?.date !== day || !Object.hasOwn(meters, action)) throw unavailable()
      add(meters[action], row?.sum?.requests)
    }
    usage.kv_measured_at = measuredAt
  }
  return usage
}

// One reader per isolate. No background polling, retries or application-D1
// queries: one concurrent request refreshes a 30-second cache when batch work
// asks, and a failure backs off for 30 seconds.
export function createOperationCostAccountUsageReader({
  accountId,
  token,
  fetcher = fetch,
  now = () => Date.now(),
}) {
  let snapshot = null
  let pending = null
  let retryAfter = 0
  return {
    current: () => snapshot,
    async refresh({ includeKv = false } = {}) {
      const started = now()
      const day = new Date(started).toISOString().slice(0, 10)
      if (
        snapshot?.day === day &&
        (!includeKv || Number.isSafeInteger(snapshot.kv_measured_at)) &&
        started - snapshot.measured_at >= 0 &&
        started - snapshot.measured_at < 30_000
      )
        return snapshot
      if (pending) {
        const shared = await pending
        return includeKv && !Number.isSafeInteger(shared?.kv_measured_at)
          ? this.refresh({ includeKv: true })
          : shared
      }
      // A failed sample is still a provider request. Repeated rejected work
      // must not turn an analytics outage into a control-plane polling loop.
      if (started < retryAfter) throw unavailable()
      if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token) throw unavailable()
      pending = Promise.resolve().then(async () => {
        try {
          const queryKv = includeKv || Number.isSafeInteger(snapshot?.kv_measured_at)
          const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              query: queryKv ? KV_QUERY : QUERY,
              variables: {
                accountTag: accountId,
                day,
                since: new Date(started - RECENT_WINDOW_MS).toISOString(),
              },
            }),
            signal: AbortSignal.timeout(10_000),
          })
          if (!response.ok) throw unavailable()
          const next = parseOperationCostAccountUsage(await response.json(), day, started, {
            includeKv: queryKv,
          })
          if (new Date(now()).toISOString().slice(0, 10) !== day || now() - started > 10_000)
            throw unavailable()
          // A lower same-day sample must not erase previously observed usage.
          if (snapshot?.day === day) {
            for (const meter of ["rows_read", "rows_written", "requests"])
              next[meter] = Math.max(next[meter], snapshot[meter])
            if (queryKv)
              for (const meter of KV_COST_METERS)
                next[meter] = Math.max(next[meter], snapshot[meter] ?? 0)
          }
          snapshot = next
          return snapshot
        } catch (error) {
          // B-1036: say why there's no sample. A silent catch here hid a whole day of
          // "no provider sample" behind a guess. At most one line per 30 seconds.
          console.warn("[d1-usage] account usage sample failed", {
            code: String(error?.code || error?.name || "unknown").slice(0, 80),
            message: String(error?.message || "").slice(0, 160),
          })
          snapshot = null
          retryAfter = now() + 30_000
          throw unavailable()
        } finally {
          pending = null
        }
      })
      return pending
    },
  }
}

let isolateReader = null

// Today's account-wide usage, through this isolate's one reader.
export function accountD1Usage(env) {
  isolateReader ??= createOperationCostAccountUsageReader({
    accountId: env?.CLOUDFLARE_ACCOUNT_ID,
    token: env?.CLOUDFLARE_BUDGET_ANALYTICS_TOKEN,
  })
  return isolateReader.refresh()
}
