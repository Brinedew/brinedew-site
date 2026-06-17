function positiveNumber(raw, fallback) {
  const parsed = Number.parseFloat(String(raw || ""))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10)
}

async function main() {
  const accountTag = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!accountTag || !token) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required")
  }
  const day = process.env.ICONOPLASM_BUDGET_WATCH_DAY || todayUtc()
  const readsLimit = positiveNumber(process.env.ICONOPLASM_KV_DAILY_READ_LIMIT, 100000)
  const writesListsDeletesLimit = positiveNumber(
    process.env.ICONOPLASM_KV_DAILY_WRITE_LIST_DELETE_LIMIT,
    1000,
  )
  const alertRatio = Math.min(
    1,
    Math.max(0.1, positiveNumber(process.env.ICONOPLASM_KV_BUDGET_ALERT_RATIO, 0.8)),
  )
  const deleteAlertRatio = Math.min(
    1,
    Math.max(0.1, positiveNumber(process.env.ICONOPLASM_KV_DELETE_BUDGET_ALERT_RATIO, 0.95)),
  )
  const query = `query IconoplasmKvBudgetWatch($accountTag: string, $day: Date) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        kvOperationsAdaptiveGroups(
          limit: 10000
          filter: { date_geq: $day, date_leq: $day }
          orderBy: [date_ASC]
        ) {
          dimensions {
            date
            actionType
            namespaceId
            result
          }
          sum {
            requests
          }
          count
        }
      }
    }
  }`
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables: { accountTag, day } }),
  })
  const payload = await response.json()
  if (!response.ok || !payload.data) {
    throw new Error(`Cloudflare GraphQL query failed: ${JSON.stringify(payload.errors || payload)}`)
  }
  const account = payload.data.viewer.accounts?.[0]
  if (!account) throw new Error("Cloudflare GraphQL response did not include the account")
  const usage = { read: 0, write: 0, list: 0, delete: 0, other: 0 }
  for (const row of Array.isArray(account.kvOperationsAdaptiveGroups)
    ? account.kvOperationsAdaptiveGroups
    : []) {
    const action = String(row?.dimensions?.actionType || "other").toLowerCase()
    const requests = Number(row?.sum?.requests || row?.count || 0) || 0
    if (action.includes("read")) usage.read += requests
    else if (action.includes("write")) usage.write += requests
    else if (action.includes("list")) usage.list += requests
    else if (action.includes("delete")) usage.delete += requests
    else usage.other += requests
  }
  const checks = [
    { name: "kv_reads", used: usage.read, limit: readsLimit, ratio: alertRatio },
    { name: "kv_writes", used: usage.write, limit: writesListsDeletesLimit, ratio: alertRatio },
    { name: "kv_lists", used: usage.list, limit: writesListsDeletesLimit, ratio: alertRatio },
    {
      name: "kv_deletes",
      used: usage.delete,
      limit: writesListsDeletesLimit,
      ratio: deleteAlertRatio,
    },
  ].map((check) => ({
    name: check.name,
    used: check.used,
    limit: check.limit,
    threshold: Math.floor(check.limit * check.ratio),
    ratio: check.limit > 0 ? check.used / check.limit : 0,
    alertRatio: check.ratio,
    ok: check.limit <= 0 || check.used < Math.floor(check.limit * check.ratio),
  }))
  const failures = checks.filter((check) => !check.ok)
  console.log(
    JSON.stringify({ day, alertRatio, usage, checks, ok: failures.length === 0 }, null, 2),
  )
  if (failures.length) {
    throw new Error(
      `Iconoplasm Cloudflare KV budget watch failed: ${failures.map((f) => `${f.name} ${f.used}/${f.limit}`).join(", ")}`,
    )
  }
}

main().catch((error) => {
  console.error(error?.stack || error)
  process.exitCode = 1
})
