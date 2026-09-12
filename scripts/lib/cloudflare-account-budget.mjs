import { parseOperationCostAccountUsage } from "../../workers/iconoplasm/operation-cost-account-usage.js"

export const FREE_DAILY_LIMITS = Object.freeze({
  rows_read: 5000000,
  rows_written: 100000,
  requests: 100000,
  kv_reads: 100000,
  kv_writes: 1000,
  kv_deletes: 1000,
  kv_lists: 1000,
  do_rows_read: 5000000,
  do_rows_written: 100000,
  do_requests: 100000,
  do_duration_gb_seconds: 13000,
  queue_operations: 10000,
})

export const ACCOUNT_BUDGET_QUERY = `query AccountBudgetWatch($accountTag:string,$day:Date) {
  viewer { accounts(filter:{accountTag:$accountTag}) {
    workersInvocationsAdaptive(limit:10000,filter:{date_geq:$day,date_leq:$day}) { sum { requests } }
    d1AnalyticsAdaptiveGroups(limit:1000,filter:{date_geq:$day,date_leq:$day}) { dimensions { date databaseId } sum { rowsRead rowsWritten } }
    kvOperationsAdaptiveGroups(limit:10000,filter:{date_geq:$day,date_leq:$day}) { dimensions { date actionType } sum { requests } }
    durableObjectsInvocationsAdaptiveGroups(limit:10000,filter:{date_geq:$day,date_leq:$day}) { dimensions { date } sum { requests } }
    durableObjectsPeriodicGroups(limit:10000,filter:{date_geq:$day,date_leq:$day}) { dimensions { date } sum { rowsRead rowsWritten duration } }
    queueMessageOperationsAdaptiveGroups(limit:10000,filter:{date_geq:$day,date_leq:$day}) { dimensions { date } sum { billableOperations } }
  } }
}`

export function parseAccountBudget(payload, day, measuredAt) {
  const usage = parseOperationCostAccountUsage(payload, day, measuredAt, { includeKv: true })
  const account = payload.data.viewer.accounts[0]
  for (const [name, fields] of [
    ["durableObjectsInvocationsAdaptiveGroups", { requests: "do_requests" }],
    [
      "durableObjectsPeriodicGroups",
      {
        rowsRead: "do_rows_read",
        rowsWritten: "do_rows_written",
        duration: "do_duration_gb_seconds",
      },
    ],
    ["queueMessageOperationsAdaptiveGroups", { billableOperations: "queue_operations" }],
  ]) {
    const rows = account[name]
    if (!Array.isArray(rows) || rows.length >= 10000) throw new Error("COST_DO_USAGE_UNAVAILABLE")
    for (const meter of Object.values(fields)) usage[meter] = 0
    for (const row of rows) {
      if (row?.dimensions?.date !== day) throw new Error("COST_DO_USAGE_UNAVAILABLE")
      for (const [field, meter] of Object.entries(fields)) {
        const value = row?.sum?.[field]
        if (
          (meter === "do_duration_gb_seconds"
            ? !Number.isFinite(value)
            : !Number.isSafeInteger(value)) ||
          value < 0 ||
          (meter === "do_duration_gb_seconds"
            ? !Number.isFinite(usage[meter] + value)
            : !Number.isSafeInteger(usage[meter] + value))
        )
          throw new Error("COST_DO_USAGE_UNAVAILABLE")
        usage[meter] += value
      }
    }
  }
  return usage
}

export async function readAccountBudget({
  accountId,
  token,
  fetcher = fetch,
  now = Date.now,
  day = new Date(now()).toISOString().slice(0, 10),
}) {
  if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token || !/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
  const started = now()
  const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: ACCOUNT_BUDGET_QUERY,
      variables: { accountTag: accountId, day },
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`COST_ACCOUNT_USAGE_HTTP_${response.status}`)
  const usage = parseAccountBudget(await response.json(), day, started)
  if (now() - started > 20000) throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
  return usage
}

export function accountBudgetChecks(usage, { ratio = 0.8 } = {}) {
  return Object.entries(FREE_DAILY_LIMITS).map(([meter, limit]) => ({
    meter,
    used: usage[meter],
    limit,
    threshold: Math.floor(limit * ratio),
    ok:
      (meter === "do_duration_gb_seconds"
        ? Number.isFinite(usage[meter])
        : Number.isSafeInteger(usage[meter])) &&
      usage[meter] >= 0 &&
      usage[meter] < Math.floor(limit * ratio),
  }))
}
