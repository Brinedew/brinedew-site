// These partial indexes contain only dispatchable/running jobs. Every due
// range has an equality prefix and LIMIT before any cross-phase merge.
const priority =
  "CASE phase WHEN 'vision_rollups' THEN 0 WHEN 'gene_rollups' THEN 1 WHEN 'vote_summaries' THEN 2 ELSE 3 END"
const eligible = "status IN ('queued', 'retrying') AND phase <> 'completed_pending_finalize'"
const order = "next_attempt_at, requested_at, gene_symbol"

export const GLOBAL_RUNNING_FINALIZATION_SQL = `SELECT gene_symbol, phase, attempts, requested_at, last_attempt_at, job_version
  FROM icono_sync_finalization_jobs INDEXED BY idx_icono_finalization_running
  WHERE status = 'running' AND phase <> 'completed_pending_finalize'
  ORDER BY COALESCE(NULLIF(last_attempt_at, ''), NULLIF(requested_at, '')), gene_symbol LIMIT ?`

export const GLOBAL_DUE_FINALIZATION_SQL = `SELECT * FROM (${[0, 1, 2, 3]
  .map(
    (n) =>
      `SELECT * FROM (SELECT *, ${n} AS dispatch_priority FROM icono_sync_finalization_jobs
    INDEXED BY idx_icono_finalization_due WHERE ${eligible}
    AND (${priority}) = ${n} AND next_attempt_at <= ?1 ORDER BY ${order} LIMIT ?2)`,
  )
  .join(" UNION ALL ")}) ORDER BY dispatch_priority, ${order} LIMIT ?2`

export const GLOBAL_PENDING_FINALIZATION_SQL = `SELECT unfinished_count AS remaining,
  (${[0, 1, 2, 3]
    .map(
      (n) => `EXISTS(SELECT 1 FROM icono_sync_finalization_jobs
    INDEXED BY idx_icono_finalization_due WHERE ${eligible}
    AND (${priority}) = ${n} AND next_attempt_at <= ?1 LIMIT 1)`,
    )
    .join(" OR ")}) AS has_runnable,
  (SELECT MIN(next_attempt_at) FROM (${[0, 1, 2, 3]
    .map(
      (n) =>
        `SELECT * FROM (SELECT next_attempt_at FROM icono_sync_finalization_jobs
      INDEXED BY idx_icono_finalization_due WHERE ${eligible}
      AND (${priority}) = ${n} AND next_attempt_at > ?1 ORDER BY ${order} LIMIT 1)`,
    )
    .join(" UNION ALL ")})) AS next_attempt_at
  FROM icono_sync_finalization_summary WHERE singleton = 1`
