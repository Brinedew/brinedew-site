-- One verified, immutable event archive can serve old replica pages while this
-- database remains the only command writer. The archive is activated only after
-- its remote rows have been compared with the source export (B-799).
ALTER TABLE icono_authority_state ADD COLUMN event_archive_through INTEGER NOT NULL DEFAULT 0
  CHECK (event_archive_through >= 0);
ALTER TABLE icono_authority_state ADD COLUMN event_archive_sha256 TEXT
  CHECK (event_archive_sha256 IS NULL OR length(event_archive_sha256) = 64);

CREATE TRIGGER icono_event_archive_boundary_no_rewind
BEFORE UPDATE OF event_archive_through, event_archive_sha256 ON icono_authority_state
WHEN NEW.event_archive_through < OLD.event_archive_through
  OR (NEW.event_archive_through = OLD.event_archive_through
    AND NEW.event_archive_sha256 IS NOT OLD.event_archive_sha256)
BEGIN
  SELECT RAISE(ABORT, 'event_archive_boundary_cannot_rewind');
END;

DROP TRIGGER icono_events_immutable_delete;
CREATE TRIGGER icono_events_immutable_delete
BEFORE DELETE ON icono_manifestation_events
WHEN NOT EXISTS (
  SELECT 1
    FROM icono_manifestation_event_compaction_delete_guards guard
    JOIN icono_manifestation_event_checkpoints checkpoint
      ON checkpoint.checkpoint_id = guard.checkpoint_id
    JOIN icono_authority_state state ON state.singleton = 1
    JOIN icono_authoring_command_receipts receipt
      ON receipt.command_id = OLD.command_id
   WHERE guard.event_sequence = OLD.event_sequence
     AND guard.event_uuid = OLD.event_uuid
     AND checkpoint.status = 'active'
     AND checkpoint.authority_epoch = state.authority_epoch
     AND checkpoint.target_watermark_event_sequence = state.event_retention_floor
     AND OLD.event_sequence <= checkpoint.target_watermark_event_sequence
     AND receipt.accepted_event_sequence = OLD.event_sequence
     AND receipt.accepted_event_uuid = OLD.event_uuid
) AND NOT EXISTS (
  SELECT 1 FROM icono_authority_state state
    JOIN icono_authoring_command_receipts receipt
      ON receipt.command_id = OLD.command_id
   WHERE state.singleton = 1
     AND OLD.event_sequence <= state.event_archive_through
     AND state.event_archive_sha256 IS NOT NULL
     AND OLD.projection_status IN ('published', 'not_required')
     AND receipt.accepted_event_sequence = OLD.event_sequence
     AND receipt.accepted_event_uuid = OLD.event_uuid
     AND NOT EXISTS (
       SELECT 1 FROM icono_manifestation_heads head
        WHERE head.gene_id = OLD.gene_id
          AND head.last_event_sequence = OLD.event_sequence
     )
     AND NOT EXISTS (
       SELECT 1 FROM icono_manifestation_cutover_items item
        WHERE item.gene_id = OLD.gene_id
          AND (item.authority_event_sequence = OLD.event_sequence
            OR item.public_material_event_sequence = OLD.event_sequence)
     )
)
BEGIN
  SELECT RAISE(ABORT, 'manifestation_events_are_immutable');
END;
