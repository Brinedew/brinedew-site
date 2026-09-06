import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { KV_COST_METERS } from "../lib/operation-cost-meters.js"

const QUERY = `query OperationCostAdmission($accountTag: string, $day: Date) {
  viewer { accounts(filter: { accountTag: $accountTag }) {
    workersInvocationsAdaptive(limit: 10000, filter: { date_geq: $day, date_leq: $day }) { sum { requests } }
    d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date_geq: $day, date_leq: $day }) {
      dimensions { date databaseId } sum { rowsRead rowsWritten }
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

const unavailable = () => new OperationCostError("COST_ACCOUNT_USAGE_UNAVAILABLE")

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
  const usage = { day, measured_at: measuredAt, rows_read: 0, rows_written: 0, requests: 0 }
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

// Lives on the one budget authority, not in every public request isolate.
// No background polling, retries or application-D1 queries. One concurrent
// control-plane request refreshes a 30-second cache while operations need it.
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
              variables: { accountTag: accountId, day },
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
        } catch {
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
