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
//
// One job is allowed past the per-statement cap: the B-830 nightly
// off-Cloudflare backup (scripts/backup-d1-rotation.mjs). It copies one whole
// database a night with keyset-paged SELECTs, so each table's paging statement
// legitimately reads that table once. Those statements are recognised only by
// the exact text the backup sends, and they are reported in their own
// budgeted_backup section. Their summed reads in the window must stay within
// the backup's budget: one database a night costs at most 20% of the 5M daily
// D1 read allowance. Above that ceiling they are violations again, which is
// what a failing export retried every two hours looks like.
import { pathToFileURL } from "node:url"

import { FREE_PLAN_DAILY_LIMITS } from "../shared/iconoplasm-d1-budget-policy.js"

export const BUDGETED_BACKUP_READ_CEILING = FREE_PLAN_DAILY_LIMITS.rows_read / 5

// backup-d1-rotation.mjs quotes every identifier as "name" with "" escapes.
const BACKUP_IDENTIFIER = String.raw`"(?:[^"]|"")+"`
const BACKUP_KEYS = String.raw`${BACKUP_IDENTIFIER}(?:, ${BACKUP_IDENTIFIER})*`
const BACKUP_ROWID_PAGE = new RegExp(
  String.raw`^SELECT rowid AS __bk_rowid, \* FROM ${BACKUP_IDENTIFIER} WHERE rowid > \? ORDER BY rowid LIMIT \?$`,
)
const BACKUP_KEYSET_PAGE = new RegExp(
  String.raw`^SELECT \* FROM ${BACKUP_IDENTIFIER} WHERE \((${BACKUP_KEYS})\) > \((\?(?:, \?)*)\) ORDER BY (${BACKUP_KEYS}) LIMIT \?$`,
)

// True only for the backup's two paging shapes, after whitespace is collapsed:
//   SELECT rowid AS __bk_rowid, * FROM "t" WHERE rowid > ? ORDER BY rowid LIMIT ?
//   SELECT * FROM "t" WHERE ("k1", "k2") > (?, ?) ORDER BY "k1", "k2" LIMIT ?
// The keyset form (WITHOUT ROWID tables) must order by the same quoted keys it
// compares, with one placeholder per key. The backup's unkeyed first page of a
// WITHOUT ROWID table reads at most one page, so it stays an ordinary
// statement.
export function isBudgetedBackupStatement(query) {
  const sql = String(query ?? "")
    .replace(/\s+/g, " ")
    .trim()
  if (BACKUP_ROWID_PAGE.test(sql)) return true
  const keyset = BACKUP_KEYSET_PAGE.exec(sql)
  if (!keyset) return false
  const [, compared, placeholders, ordered] = keyset
  const keyCount = compared.match(new RegExp(BACKUP_IDENTIFIER, "g")).length
  return compared === ordered && placeholders.split(",").length === keyCount
}

function backupCeiling(value) {
  const ceiling = Number(value)
  if (!Number.isFinite(ceiling) || ceiling <= 0)
    throw new Error("D1_STATEMENT_BURN_BACKUP_CEILING_INVALID")
  return ceiling
}

function burnEntry(row) {
  return {
    database_id: String(row?.dimensions?.databaseId || ""),
    reads: Number(row?.sum?.rowsRead || 0),
    returned: Number(row?.sum?.rowsReturned || 0),
    query: String(row?.dimensions?.query || "")
      .replace(/\s+/g, " ")
      .slice(0, 240),
  }
}

export function budgetedBackupBurn(rows, { ceiling = BUDGETED_BACKUP_READ_CEILING } = {}) {
  const limit = backupCeiling(ceiling)
  const statements = (Array.isArray(rows) ? rows : [])
    .filter((row) => isBudgetedBackupStatement(row?.dimensions?.query))
    .map(burnEntry)
  const reads = statements.reduce(
    (sum, entry) => sum + (Number.isFinite(entry.reads) ? entry.reads : 0),
    0,
  )
  return { ceiling: limit, reads, ok: reads <= limit, statements }
}

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

export function statementBurnViolations(
  rows,
  { cap, backupCeiling: ceiling = BUDGETED_BACKUP_READ_CEILING } = {},
) {
  const threshold = Number(cap)
  if (!Number.isFinite(threshold) || threshold <= 0)
    throw new Error("D1_STATEMENT_BURN_CAP_INVALID")
  const backup = budgetedBackupBurn(rows, { ceiling })
  const violations = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (isBudgetedBackupStatement(row?.dimensions?.query)) continue
    const entry = burnEntry(row)
    if (!Number.isFinite(entry.reads) || entry.reads < threshold) continue
    violations.push(entry)
  }
  if (!backup.ok)
    for (const entry of backup.statements) violations.push({ ...entry, budget: "budgeted_backup" })
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
  const budgetedBackup = budgetedBackupBurn(rows)
  const result = {
    ...window,
    statements: rows.length,
    budgeted_backup: budgetedBackup,
    violations,
    ok: violations.length === 0,
  }
  console.log(JSON.stringify(result, null, 2))
  if (!budgetedBackup.ok)
    console.error(
      `D1 budgeted backup: ${budgetedBackup.reads} reads over its ${budgetedBackup.ceiling} ceiling`,
    )
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
