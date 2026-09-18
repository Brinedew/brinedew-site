// Per-statement D1 burn watch.
//
// The black-swan sensor: instead of enumerating "bad SQL shapes", this reads
// Cloudflare's per-statement analytics for one UTC day and fails when any
// single statement's accumulated rows_read crosses an absolute cap. Any shape
// that burns the budget is caught by measurement, including statements nobody
// predicted. It complements the account-level budget watch and never runs
// inside the Worker request path.
import { pathToFileURL } from "node:url"

export const STATEMENT_BURN_QUERY = `query StatementBurns($accountTag:String!,$day:Date) {
  viewer { accounts(filter:{accountTag:$accountTag}) {
    d1QueriesAdaptiveGroups(limit:200,filter:{date_geq:$day,date_leq:$day},orderBy:[sum_rowsRead_DESC]) {
      dimensions { databaseId query }
      sum { rowsRead rowsReturned }
    }
  } }
}`

export function statementBurnViolations(rows, { cap } = {}) {
  const threshold = Number(cap)
  if (!Number.isFinite(threshold) || threshold <= 0)
    throw new Error("D1_STATEMENT_BURN_CAP_INVALID")
  const violations = []
  for (const row of Array.isArray(rows) ? rows : []) {
    const reads = Number(row?.sum?.rowsRead || 0)
    if (!Number.isFinite(reads) || reads < threshold) continue
    violations.push({
      database_id: String(row?.dimensions?.databaseId || ""),
      reads,
      returned: Number(row?.sum?.rowsReturned || 0),
      query: String(row?.dimensions?.query || "")
        .replace(/\s+/g, " ")
        .slice(0, 240),
    })
  }
  return violations
}

export async function readStatementBurns({ accountId, token, day, fetcher = fetch } = {}) {
  if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token || !/^\d{4}-\d{2}-\d{2}$/.test(day || ""))
    throw new Error("D1_STATEMENT_WATCH_UNAVAILABLE")
  const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: STATEMENT_BURN_QUERY,
      variables: { accountTag: accountId, day },
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error(`D1_STATEMENT_WATCH_HTTP_${response.status}`)
  const payload = await response.json()
  if (Array.isArray(payload?.errors) && payload.errors.length)
    throw new Error(
      `D1_STATEMENT_WATCH_GRAPHQL_${String(payload.errors[0]?.message || "").slice(0, 120)}`,
    )
  return payload?.data?.viewer?.accounts?.[0]?.d1QueriesAdaptiveGroups || []
}

export async function checkStatementBurns() {
  const day = process.env.ICONOPLASM_BUDGET_WATCH_DAY || new Date().toISOString().slice(0, 10)
  const cap = Number(process.env.ICONOPLASM_STATEMENT_READ_ALERT || 500000)
  const rows = await readStatementBurns({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    day,
  })
  const violations = statementBurnViolations(rows, { cap })
  const result = { day, cap, statements: rows.length, violations, ok: violations.length === 0 }
  console.log(JSON.stringify(result, null, 2))
  if (violations.length)
    console.error(
      `D1 statement burn: ${violations
        .map((violation) => `${violation.reads} reads (${violation.database_id})`)
        .join(", ")}`,
    )
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  checkStatementBurns()
    .then((result) => {
      if (!result.ok) process.exitCode = 1
    })
    .catch((error) => {
      console.error(error.message)
      process.exitCode = 1
    })
}
