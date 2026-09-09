-- Preserve ready-first status ordering without sorting the unfinished backlog.
-- The partial index excludes completed history; each global list stops at LIMIT.
CREATE INDEX idx_icono_finalization_status_list
ON icono_sync_finalization_jobs(
  CASE WHEN phase = 'completed_pending_finalize' THEN 0 ELSE 1 END,
  next_attempt_at, requested_at, gene_symbol
)
WHERE status <> 'completed';
