const ordering = `CASE WHEN phase = 'completed_pending_finalize' THEN 0 ELSE 1 END,
  next_attempt_at, requested_at, gene_symbol`

export const GLOBAL_FINALIZATION_STATUS_LIST_SQL = `SELECT * FROM icono_sync_finalization_jobs
  INDEXED BY idx_icono_finalization_status_list WHERE status <> 'completed'
  ORDER BY ${ordering} LIMIT ?`

export const SCOPED_FINALIZATION_STATUS_LIST_SQL = `SELECT * FROM icono_sync_finalization_jobs
  INDEXED BY sqlite_autoindex_icono_sync_finalization_jobs_1
  WHERE gene_symbol IN (SELECT value FROM json_each(?)) AND status <> 'completed'
  ORDER BY ${ordering} LIMIT ?`
