// A bounded handoff from durable job completion to the existing publisher.
// This table owns wakeup delivery only; it never selects a card or commits head.
export const FINALIZATION_COMPLETION_PAGE_SIZE = 32
export const FINALIZATION_BARRIER_SQL = `SELECT jobs.unfinished_count,
  jobs.unfinished_count - jobs.pending_finalize_count - handoff.terminal_phase_count AS remaining_count,
  jobs.pending_finalize_count, handoff.terminal_phase_count,
  handoff.enqueued_version, handoff.notified_version, handoff.next_attempt_at
  FROM icono_sync_finalization_summary jobs
  JOIN icono_sync_finalization_publication handoff ON handoff.singleton = jobs.singleton
  WHERE jobs.singleton = 1`

export async function readFinalizationPublicationBarrier(db) {
  const row = await db.prepare(FINALIZATION_BARRIER_SQL).first()
  if (!row)
    throw new Error("Finalization publication handoff is missing; migration 0101 is required")
  if (
    [
      "unfinished_count",
      "remaining_count",
      "pending_finalize_count",
      "terminal_phase_count",
      "enqueued_version",
      "notified_version",
    ].some((key) => !Number.isSafeInteger(row[key]) || row[key] < 0) ||
    row.notified_version > row.enqueued_version
  )
    throw new Error("Finalization publication counters are invalid")
  return row
}

const readyPhases = ["completed_pending_finalize", "completed"]
export const GLOBAL_READY_FINALIZATION_SQL = `SELECT * FROM (${readyPhases
  .map(
    (phase, priority) => `
  SELECT * FROM (SELECT gene_symbol, job_version, next_attempt_at, requested_at, ${priority} AS priority
  FROM icono_sync_finalization_jobs INDEXED BY idx_icono_finalization_unfinished
  WHERE status <> 'completed' AND phase = '${phase}'
  ORDER BY next_attempt_at, requested_at, gene_symbol LIMIT ${FINALIZATION_COMPLETION_PAGE_SIZE})
`,
  )
  .join(
    " UNION ALL ",
  )}) ORDER BY priority, next_attempt_at, requested_at, gene_symbol LIMIT ${FINALIZATION_COMPLETION_PAGE_SIZE}`

export const SCOPED_READY_FINALIZATION_SQL = `SELECT gene_symbol, job_version
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

export async function completeReadyFinalizationPage(db, symbols, now) {
  const rows = await readReadyFinalizationPage(db, symbols)
  return completeReadyFinalizationRows(db, rows, now)
}

export async function claimFinalizationPublication(db, version, now, leaseToken) {
  const until = new Date(Date.parse(now) + 120000).toISOString()
  return db
    .prepare(
      `UPDATE icono_sync_finalization_publication SET lease_token = ?, next_attempt_at = ?
    WHERE singleton = 1 AND enqueued_version = ? AND notified_version < ? AND next_attempt_at <= ?
    AND (SELECT unfinished_count FROM icono_sync_finalization_summary WHERE singleton = 1) = 0
    RETURNING enqueued_version`,
    )
    .bind(leaseToken, until, version, version, now)
    .first()
}

export async function acknowledgeFinalizationPublication(db, leaseToken, version) {
  return db
    .prepare(
      `UPDATE icono_sync_finalization_publication
    SET notified_version = MAX(notified_version, ?), lease_token = '', next_attempt_at = ''
    WHERE singleton = 1 AND lease_token = ? RETURNING notified_version`,
    )
    .bind(version, leaseToken)
    .first()
}

export async function deferFinalizationPublication(db, leaseToken, nextAttemptAt) {
  return db
    .prepare(
      `UPDATE icono_sync_finalization_publication SET lease_token = '', next_attempt_at = ?
    WHERE singleton = 1 AND lease_token = ?`,
    )
    .bind(nextAttemptAt, leaseToken)
    .run()
}

// Only the explicitly requested membership is read. The historical singleton
// remains queryable above but is never an ordinary completion barrier.
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
  { symbols = [], notifyPublisher, now = new Date().toISOString() },
) {
  if (!Array.isArray(symbols) || symbols.length < 1 || symbols.length > 5000)
    throw new RangeError("An explicit non-empty finalization scope is required")
  if (symbols.some((symbol) => typeof symbol !== "string" || !symbol.trim()))
    throw new RangeError("Every finalization scope member must be an explicit symbol")
  if (typeof notifyPublisher !== "function")
    throw new TypeError("A durable per-gene publication handoff is required")

  const rows = await readReadyFinalizationPage(db, symbols)
  let finalized = 0
  let retryAt = null
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
  }
}
