-- Job-to-publisher handoff state, not another publication authority. The existing
-- CardPublication coordinator still owns the only committed head and watermark.
CREATE TABLE icono_sync_finalization_publication (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  terminal_phase_count INTEGER NOT NULL CHECK(terminal_phase_count >= 0),
  enqueued_version INTEGER NOT NULL,
  notified_version INTEGER NOT NULL,
  lease_token TEXT NOT NULL DEFAULT '',
  next_attempt_at TEXT NOT NULL DEFAULT ''
);
INSERT INTO icono_sync_finalization_publication
SELECT 1,
  (SELECT COUNT(*) FROM icono_sync_finalization_jobs INDEXED BY idx_icono_finalization_unfinished
    WHERE status <> 'completed' AND phase = 'completed'),
  CASE WHEN unfinished_count > 0 THEN 1 ELSE 0 END, 0, '', ''
FROM icono_sync_finalization_summary WHERE singleton = 1;

CREATE TRIGGER trg_icono_finalization_publication_insert
AFTER INSERT ON icono_sync_finalization_jobs
BEGIN
  UPDATE icono_sync_finalization_publication SET
    terminal_phase_count = terminal_phase_count + (NEW.status <> 'completed' AND NEW.phase = 'completed'),
    enqueued_version = enqueued_version + (NEW.status <> 'completed')
  WHERE singleton = 1;
END;

CREATE TRIGGER trg_icono_finalization_publication_update
AFTER UPDATE OF status, phase, requested_at, keep_assets_json, legacy_assets_json, vision_ids_json
ON icono_sync_finalization_jobs
WHEN (OLD.status <> 'completed' AND OLD.phase = 'completed') <> (NEW.status <> 'completed' AND NEW.phase = 'completed')
  OR NEW.requested_at IS NOT OLD.requested_at
  OR NEW.keep_assets_json IS NOT OLD.keep_assets_json
  OR NEW.legacy_assets_json IS NOT OLD.legacy_assets_json
  OR NEW.vision_ids_json IS NOT OLD.vision_ids_json
  OR (OLD.status = 'completed' AND NEW.status <> 'completed')
BEGIN
  UPDATE icono_sync_finalization_publication SET
    terminal_phase_count = terminal_phase_count
      - (OLD.status <> 'completed' AND OLD.phase = 'completed')
      + (NEW.status <> 'completed' AND NEW.phase = 'completed'),
    enqueued_version = enqueued_version + (
      NEW.requested_at IS NOT OLD.requested_at
      OR NEW.keep_assets_json IS NOT OLD.keep_assets_json
      OR NEW.legacy_assets_json IS NOT OLD.legacy_assets_json
      OR NEW.vision_ids_json IS NOT OLD.vision_ids_json
      OR (OLD.status = 'completed' AND NEW.status <> 'completed'))
  WHERE singleton = 1;
END;

CREATE TRIGGER trg_icono_finalization_publication_delete
AFTER DELETE ON icono_sync_finalization_jobs
WHEN OLD.status <> 'completed'
BEGIN
  UPDATE icono_sync_finalization_publication SET
    terminal_phase_count = terminal_phase_count - (OLD.phase = 'completed'),
    enqueued_version = enqueued_version + 1
  WHERE singleton = 1;
END;
