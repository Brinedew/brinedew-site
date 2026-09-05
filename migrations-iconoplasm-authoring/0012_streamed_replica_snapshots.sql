-- ARCHITECTURE FENCE [IPD-012]: snapshot v2 reads immutable source pages.
-- Retire unfinished materialized snapshots; retain their source and audit rows.
ALTER TABLE icono_manifestation_snapshot_leases ADD COLUMN stream_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE icono_manifestation_snapshot_leases ADD COLUMN source_baseline_rowid INTEGER NOT NULL DEFAULT 0;
UPDATE icono_manifestation_snapshot_leases SET status = 'expired'
 WHERE status IN ('building', 'open');

-- Source rows and rowids remain fixed for the life of every transport lease.
-- VACUUM and table rebuilds require all leases to be expired before maintenance.
CREATE TRIGGER icono_baseline_immutable_update
BEFORE UPDATE ON icono_gene_identity_baselines
BEGIN
  SELECT RAISE(ABORT, 'gene_baseline_is_immutable');
END;
CREATE TRIGGER icono_baseline_immutable_delete
BEFORE DELETE ON icono_gene_identity_baselines
BEGIN
  SELECT RAISE(ABORT, 'gene_baseline_is_immutable');
END;

-- Close both sides of the snapshot/compaction race inside SQLite's transaction.
CREATE TRIGGER icono_stream_snapshot_source_guard
BEFORE INSERT ON icono_manifestation_snapshot_leases
WHEN NEW.stream_version = 2
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM icono_authority_state state WHERE state.singleton = 1
      AND state.authority_epoch = NEW.authority_epoch
      AND state.event_retention_floor = NEW.source_checkpoint_watermark_sequence
      AND (state.event_retention_floor = 0 OR EXISTS (
        SELECT 1 FROM icono_manifestation_event_checkpoints checkpoint
         WHERE checkpoint.checkpoint_id = NEW.source_checkpoint_id
           AND checkpoint.status = 'active'
           AND checkpoint.target_watermark_event_sequence = state.event_retention_floor
      ))
  ) THEN RAISE(ABORT, 'snapshot_source_changed') END;
END;

CREATE TRIGGER icono_checkpoint_open_stream_guard
BEFORE UPDATE OF status ON icono_manifestation_event_checkpoints
WHEN NEW.status = 'active' AND OLD.status <> 'active'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM icono_authority_state state WHERE state.singleton = 1
      AND state.authority_epoch = NEW.authority_epoch
      AND state.event_retention_floor = NEW.base_watermark_event_sequence
  ) THEN RAISE(ABORT, 'checkpoint_source_changed') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM icono_manifestation_snapshot_leases lease
     WHERE lease.status IN ('building', 'open')
       AND lease.expires_at > NEW.activated_at
       AND lease.source_checkpoint_watermark_sequence < NEW.target_watermark_event_sequence
  ) THEN RAISE(ABORT, 'checkpoint_snapshot_open') END;
END;
