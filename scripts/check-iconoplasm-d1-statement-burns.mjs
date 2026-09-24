// Per-statement D1 burn watch.
//
// After-the-fact signal, not a budget guarantee: Cloudflare's per-statement
// analytics shows which SQL already spent a large share of the daily allowance.
// Prevent the first burn by keeping user-triggered reads indexed and bounded;
// this monitor can only point to a missed query after it has run.
//
// It reads a trailing window, not the UTC day. A day-sum stayed red for 18
// hours after the 2026-09-24 picker fix (#264) and would have hidden any new
// burn behind the old one. The window cap is the daily cap pro-rated, so a
// steady leak at the old 500k/day alert rate still trips it.
import { pathToFileURL } from "node:url"

export const STATEMENT_BURN_QUERY = `query StatementBurns($accountTag:String!,$since:Time!,$until:Time!) {
  viewer { accounts(filter:{accountTag:$accountTag}) {
    d1QueriesAdaptiveGroups(limit:200,filter:{datetime_geq:$since,datetime_leq:$until},orderBy:[sum_rowsRead_DESC]) {
      dimensions { databaseId query }
      sum { rowsRead rowsReturned }
    }
  } }
}`

export function statementBurnWindow({ now = Date.now(), hours = 6, dailyCap = 500000 } = {}) {
  const span = Number(hours)
  if (!Number.isFinite(now) || !Number.isFinite(span) || span <= 0 || span > 24)
    throw new Error("D1_STATEMENT_BURN_WINDOW_INVALID")
  const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z")
  return {
    since: iso(now - span * 3600000),
    until: iso(now),
    hours: span,
    cap: Math.floor((Number(dailyCap) * span) / 24),
  }
}

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

export async function readStatementBurns({ accountId, token, since, until, fetcher = fetch } = {}) {
  if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token || !since || !until)
    throw new Error("D1_STATEMENT_WATCH_UNAVAILABLE")
  const response = await fetcher("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      query: STATEMENT_BURN_QUERY,
      variables: { accountTag: accountId, since, until },
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
  const window = statementBurnWindow({
    hours: Number(process.env.ICONOPLASM_STATEMENT_WINDOW_HOURS || 6),
    dailyCap: Number(process.env.ICONOPLASM_STATEMENT_READ_ALERT || 500000),
  })
  const rows = await readStatementBurns({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_API_TOKEN,
    since: window.since,
    until: window.until,
  })
  const violations = statementBurnViolations(rows, window)
  const result = { ...window, statements: rows.length, violations, ok: violations.length === 0 }
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
