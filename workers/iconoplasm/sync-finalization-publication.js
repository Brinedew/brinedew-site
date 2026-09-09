// A bounded handoff from durable job completion to the existing publisher.
// This table owns wakeup delivery only; it never selects a card or commits head.
export const FINALIZATION_COMPLETION_PAGE_SIZE = 100
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

export async function completeReadyFinalizationPage(db, symbols, now) {
  if (!Array.isArray(symbols) || symbols.length > 5000)
    throw new RangeError("Invalid finalization completion scope")
  const response = symbols.length
    ? await db.prepare(SCOPED_READY_FINALIZATION_SQL).bind(JSON.stringify(symbols)).all()
    : await db.prepare(GLOBAL_READY_FINALIZATION_SQL).all()
  const rows = response.results || []
  if (!rows.length) return 0
  const completed = await db
    .prepare(COMPLETE_READY_FINALIZATION_SQL)
    .bind(JSON.stringify(rows.map((row) => [row.gene_symbol, row.job_version])), now)
    .all()
  return completed.results.length
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

export async function drainCompletedFinalization(
  db,
  { symbols = [], notifyPublisher, now = new Date().toISOString() },
) {
  let barrier = await readFinalizationPublicationBarrier(db)
  const finalized = await completeReadyFinalizationPage(db, symbols, now)
  barrier = await readFinalizationPublicationBarrier(db)
  const result = () => ({
    ok: true,
    finalized,
    remaining: Number(barrier.unfinished_count),
    global_finalize_deferred:
      Number(barrier.unfinished_count) > 0 ||
      Number(barrier.enqueued_version) > Number(barrier.notified_version),
    publication_pending: Number(barrier.enqueued_version) > Number(barrier.notified_version),
    publication_next_attempt_at: barrier.next_attempt_at || null,
    ready_remaining: Number(barrier.pending_finalize_count) + Number(barrier.terminal_phase_count),
    broaden_next_drain: symbols.length > 0 && Number(barrier.unfinished_count) > 0,
  })
  if (
    Number(barrier.unfinished_count) > 0 ||
    Number(barrier.enqueued_version) <= Number(barrier.notified_version)
  )
    return result()
  const leaseToken = crypto.randomUUID()
  const claim = await claimFinalizationPublication(
    db,
    Number(barrier.enqueued_version),
    now,
    leaseToken,
  )
  if (!claim) {
    barrier = await readFinalizationPublicationBarrier(db)
    return result()
  }
  try {
    const notification = await notifyPublisher()
    if (notification?.accepted === true) {
      await acknowledgeFinalizationPublication(db, leaseToken, Number(claim.enqueued_version))
    } else {
      const retryAt = notification?.nextAttemptAt
      if (!retryAt || !Number.isFinite(Date.parse(retryAt)))
        throw new Error("Publisher did not accept the finalization handoff")
      await deferFinalizationPublication(db, leaseToken, retryAt)
    }
  } catch (error) {
    await deferFinalizationPublication(
      db,
      leaseToken,
      new Date(Date.parse(now) + 900000).toISOString(),
    )
    throw error
  }
  barrier = await readFinalizationPublicationBarrier(db)
  return result()
}
