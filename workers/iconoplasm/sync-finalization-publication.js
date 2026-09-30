// A bounded handoff from durable job completion to the existing publisher.
// This table owns wakeup delivery only; it never selects a card or commits head.
export const FINALIZATION_COMPLETION_PAGE_SIZE = 32
const readyPhases = ["completed_pending_finalize", "completed"]
export const GLOBAL_READY_FINALIZATION_SQL = `SELECT * FROM (${readyPhases
  .map(
    (phase, priority) => `
  SELECT * FROM (SELECT gene_symbol, job_version, reason, next_attempt_at, requested_at, ${priority} AS priority
  FROM icono_sync_finalization_jobs INDEXED BY idx_icono_finalization_unfinished
  WHERE status <> 'completed' AND phase = '${phase}'
  ORDER BY next_attempt_at, requested_at, gene_symbol LIMIT ${FINALIZATION_COMPLETION_PAGE_SIZE})
`,
  )
  .join(
    " UNION ALL ",
  )}) ORDER BY priority, next_attempt_at, requested_at, gene_symbol LIMIT ${FINALIZATION_COMPLETION_PAGE_SIZE}`

export const SCOPED_READY_FINALIZATION_SQL = `SELECT gene_symbol, job_version, reason
  FROM icono_sync_finalization_jobs INDEXED BY sqlite_autoindex_icono_sync_finalization_jobs_1
  WHERE gene_symbol IN (SELECT value FROM json_each(?))
    AND status <> 'completed' AND phase IN ('completed_pending_finalize', 'completed')
  ORDER BY next_attempt_at, requested_at, gene_symbol LIMIT ${FINALIZATION_COMPLETION_PAGE_SIZE}`

export const COMPLETE_READY_FINALIZATION_SQL = `WITH incoming AS MATERIALIZED (
  SELECT json_extract(value, '$[0]') AS symbol, json_extract(value, '$[1]') AS version FROM json_each(?)
)
UPDATE icono_sync_finalization_jobs SET status = 'completed', phase = 'completed',
  completed_at = ?, updated_at = CURRENT_TIMESTAMP, last_error = '', job_version = job_version + 1
WHERE rowid IN (
  SELECT job.rowid FROM incoming i CROSS JOIN icono_sync_finalization_jobs job
    INDEXED BY sqlite_autoindex_icono_sync_finalization_jobs_1
  WHERE job.gene_symbol = i.symbol AND job.job_version = i.version
    AND job.status <> 'completed' AND job.phase IN ('completed_pending_finalize', 'completed')
) RETURNING gene_symbol`

export async function readReadyFinalizationPage(db, symbols) {
  if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > 5000)
    throw new RangeError("An explicit non-empty finalization scope is required")
  const response = await db
    .prepare(SCOPED_READY_FINALIZATION_SQL)
    .bind(JSON.stringify(symbols))
    .all()
  return Array.isArray(response?.results) ? response.results : []
}

export async function completeReadyFinalizationRows(db, rows, now) {
  if (!Array.isArray(rows) || rows.length > FINALIZATION_COMPLETION_PAGE_SIZE)
    throw new RangeError("Invalid finalization completion page")
  if (!rows.length) return 0
  const completed = await db
    .prepare(COMPLETE_READY_FINALIZATION_SQL)
    .bind(JSON.stringify(rows.map((row) => [row.gene_symbol, row.job_version])), now)
    .all()
  return completed.results.length
}

// Only the explicitly requested membership is read.
export const SCOPED_FINALIZATION_REMAINDER_SQL = `SELECT COUNT(*) AS remaining,
  COALESCE(SUM(CASE WHEN phase IN ('completed_pending_finalize', 'completed') THEN 1 ELSE 0 END), 0) AS ready_remaining
  FROM icono_sync_finalization_jobs INDEXED BY sqlite_autoindex_icono_sync_finalization_jobs_1
  WHERE gene_symbol IN (SELECT value FROM json_each(?)) AND status <> 'completed'`

async function readScopedRemainder(db, symbols) {
  const row = await db
    .prepare(SCOPED_FINALIZATION_REMAINDER_SQL)
    .bind(JSON.stringify(symbols))
    .first()
  if (!row || !Number.isSafeInteger(row.remaining) || !Number.isSafeInteger(row.ready_remaining))
    throw new Error("Missing or invalid scoped finalization remainder")
  if (row.remaining < 0 || row.ready_remaining < 0 || row.ready_remaining > row.remaining)
    throw new Error("Invalid scoped finalization counters")
  return row
}

export async function drainCompletedFinalization(
  db,
  { symbols = [], rows: suppliedRows = null, notifyPublisher, now = new Date().toISOString() },
) {
  if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > 5000)
    throw new RangeError("An explicit non-empty finalization scope is required")
  if (symbols.some((symbol) => typeof symbol !== "string" || !symbol.trim()))
    throw new RangeError("Every finalization scope member must be an explicit symbol")
  if (typeof notifyPublisher !== "function")
    throw new TypeError("A durable per-gene publication handoff is required")

  const rows = suppliedRows === null ? await readReadyFinalizationPage(db, symbols) : suppliedRows
  if (!Array.isArray(rows) || rows.length > FINALIZATION_COMPLETION_PAGE_SIZE)
    throw new RangeError("Invalid supplied finalization completion page")
  let finalized = 0
  let retryAt = null
  let handoffAccepted = rows.length === 0
  if (rows.length) {
    // The V2 owner durably accepts before the exact D1 versions are acknowledged.
    // If a newer version wins concurrently, the re-read below retains its work.
    const notification = await notifyPublisher({
      symbols: rows.map((row) => row.gene_symbol),
      jobs: rows.map((row) => ({
        gene_symbol: row.gene_symbol,
        job_version: Number(row.job_version),
      })),
    })
    if (notification?.accepted === true) {
      handoffAccepted = true
      finalized = await completeReadyFinalizationRows(db, rows, now)
    } else {
      retryAt = notification?.nextAttemptAt
      if (!retryAt || !Number.isFinite(Date.parse(retryAt)))
        throw new Error("Per-gene publisher did not accept the finalization handoff")
    }
  }
  const remaining = await readScopedRemainder(db, symbols)
  return {
    ok: true,
    finalized,
    remaining: remaining.remaining,
    global_finalize_deferred: false,
    publication_pending: remaining.ready_remaining > 0,
    publication_next_attempt_at: retryAt,
    ready_remaining: remaining.ready_remaining,
    broaden_next_drain: false,
    handoff_accepted: handoffAccepted,
    terminal_noop: handoffAccepted && rows.length > 0 && finalized === 0,
  }
}
