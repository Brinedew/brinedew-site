-- ARCHITECTURE FENCE [IPD-012]: status polling must not rescan completed history.
-- Keep exact counts transactionally alongside the existing resumable job authority.
-- A one-time migration scans history; every subsequent status read touches one row.
CREATE TABLE icono_sync_finalization_summary (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  queued_count INTEGER NOT NULL CHECK (queued_count >= 0),
  running_count INTEGER NOT NULL CHECK (running_count >= 0),
  retrying_count INTEGER NOT NULL CHECK (retrying_count >= 0),
  pending_finalize_count INTEGER NOT NULL CHECK (pending_finalize_count >= 0),
  unfinished_count INTEGER NOT NULL CHECK (unfinished_count >= 0),
  completed_count INTEGER NOT NULL CHECK (completed_count >= 0)
);
INSERT INTO icono_sync_finalization_summary
SELECT 1, COALESCE(SUM(status = 'queued'), 0), COALESCE(SUM(status = 'running'), 0), COALESCE(SUM(status = 'retrying'), 0), COALESCE(SUM(phase = 'completed_pending_finalize' AND status <> 'completed'), 0), COALESCE(SUM(status <> 'completed'), 0), COALESCE(SUM(status = 'completed'), 0)
FROM icono_sync_finalization_jobs;

CREATE TRIGGER trg_icono_finalization_summary_insert
AFTER INSERT ON icono_sync_finalization_jobs
BEGIN
  UPDATE icono_sync_finalization_summary SET
    queued_count = queued_count + (NEW.status = 'queued'),
    running_count = running_count + (NEW.status = 'running'),
    retrying_count = retrying_count + (NEW.status = 'retrying'),
    pending_finalize_count = pending_finalize_count + (NEW.phase = 'completed_pending_finalize' AND NEW.status <> 'completed'),
    unfinished_count = unfinished_count + (NEW.status <> 'completed'),
    completed_count = completed_count + (NEW.status = 'completed')
  WHERE singleton = 1;
END;

CREATE TRIGGER trg_icono_finalization_summary_delete
AFTER DELETE ON icono_sync_finalization_jobs
BEGIN
  UPDATE icono_sync_finalization_summary SET
    queued_count = queued_count - (OLD.status = 'queued'),
    running_count = running_count - (OLD.status = 'running'),
    retrying_count = retrying_count - (OLD.status = 'retrying'),
    pending_finalize_count = pending_finalize_count - (OLD.phase = 'completed_pending_finalize' AND OLD.status <> 'completed'),
    unfinished_count = unfinished_count - (OLD.status <> 'completed'),
    completed_count = completed_count - (OLD.status = 'completed')
  WHERE singleton = 1;
END;

CREATE TRIGGER trg_icono_finalization_summary_update
AFTER UPDATE OF status, phase ON icono_sync_finalization_jobs
BEGIN
  UPDATE icono_sync_finalization_summary SET
    queued_count = queued_count - (OLD.status = 'queued') + (NEW.status = 'queued'),
    running_count = running_count - (OLD.status = 'running') + (NEW.status = 'running'),
    retrying_count = retrying_count - (OLD.status = 'retrying') + (NEW.status = 'retrying'),
    pending_finalize_count = pending_finalize_count - (OLD.phase = 'completed_pending_finalize' AND OLD.status <> 'completed') + (NEW.phase = 'completed_pending_finalize' AND NEW.status <> 'completed'),
    unfinished_count = unfinished_count - (OLD.status <> 'completed') + (NEW.status <> 'completed'),
    completed_count = completed_count - (OLD.status = 'completed') + (NEW.status = 'completed')
  WHERE singleton = 1;
END;

CREATE INDEX idx_icono_finalization_completed_at
ON icono_sync_finalization_jobs(status, completed_at);

-- Pending lists and drains retain their existing phase ordering and exact
-- unfinished semantics, but must never visit completed history to find work.
CREATE INDEX idx_icono_finalization_unfinished
ON icono_sync_finalization_jobs(phase, next_attempt_at, requested_at, gene_symbol)
WHERE status <> 'completed';
