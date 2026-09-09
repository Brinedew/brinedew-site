-- Every enqueue and state transition advances this fence. A claimant may only
-- advance the exact version it acquired, including after stale-lease recovery.
-- A constant default preserves existing rows without rewriting their payloads.
ALTER TABLE icono_sync_finalization_jobs
ADD COLUMN job_version INTEGER NOT NULL DEFAULT 1;
