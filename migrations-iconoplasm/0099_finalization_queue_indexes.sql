-- Keep the durable job ledger and phase priority. Within each phase, dispatch
-- the earliest due work first; this permits a bounded range seek even when
-- arbitrarily many newer jobs are waiting on a future retry date.
CREATE INDEX idx_icono_finalization_due
ON icono_sync_finalization_jobs(
  CASE phase WHEN 'vision_rollups' THEN 0 WHEN 'gene_rollups' THEN 1 WHEN 'vote_summaries' THEN 2 ELSE 3 END,
  next_attempt_at, requested_at, gene_symbol
)
WHERE status IN ('queued', 'retrying') AND phase <> 'completed_pending_finalize';

CREATE INDEX idx_icono_finalization_running
ON icono_sync_finalization_jobs(
  COALESCE(NULLIF(last_attempt_at, ''), NULLIF(requested_at, '')), gene_symbol
)
WHERE status = 'running' AND phase <> 'completed_pending_finalize';
