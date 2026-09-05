// ARCHITECTURE FENCE [IPD-012]: job status must be independent of completed history size.
// The migration's transactional counters preserve exact totals; scoped reads
// probe only the requested primary keys. Never restore optional-OR table scans.
export const SCOPED_FINALIZATION_SUMMARY_SQL = `SELECT
      COALESCE(SUM(status = 'queued'), 0) AS queued_count,
      COALESCE(SUM(status = 'running'), 0) AS running_count,
      COALESCE(SUM(status = 'retrying'), 0) AS retrying_count,
      COALESCE(SUM(phase = 'completed_pending_finalize' AND status <> 'completed'), 0) AS pending_finalize_count,
      COALESCE(SUM(status <> 'completed'), 0) AS unfinished_count,
      COALESCE(SUM(status = 'completed'), 0) AS completed_count,
      MAX(CASE WHEN status = 'completed' AND completed_at <> '' THEN completed_at END) AS completed_at
      FROM icono_sync_finalization_jobs
      INDEXED BY sqlite_autoindex_icono_sync_finalization_jobs_1
      WHERE gene_symbol IN (SELECT value FROM json_each(?))`

export const GLOBAL_FINALIZATION_SUMMARY_SQL = `SELECT summary.*,
    (SELECT MAX(completed_at) FROM icono_sync_finalization_jobs
      INDEXED BY idx_icono_finalization_completed_at
      WHERE status = 'completed' AND completed_at <> '') AS completed_at
    FROM icono_sync_finalization_summary summary WHERE singleton = 1`

export async function readSyncFinalizationSummary(db, symbols = []) {
  if (symbols.length > 5000) throw new RangeError("At most 5000 job symbols may be summarized")
  if (symbols.length) {
    return db.prepare(SCOPED_FINALIZATION_SUMMARY_SQL).bind(JSON.stringify(symbols)).first()
  }
  const row = await db.prepare(GLOBAL_FINALIZATION_SUMMARY_SQL).first()
  if (!row) throw new Error("Finalization summary is missing; migration 0094 is required")
  return row
}
