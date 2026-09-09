-- Kept separate from 0099 so a bounded maintenance release never has to reserve
-- both full-table index builds at once. IF NOT EXISTS makes this compatible with
-- installations that received the original combined 0099 migration.
CREATE INDEX IF NOT EXISTS idx_icono_finalization_running
ON icono_sync_finalization_jobs(
  COALESCE(NULLIF(last_attempt_at, ''), NULLIF(requested_at, '')), gene_symbol
)
WHERE status = 'running' AND phase <> 'completed_pending_finalize';
