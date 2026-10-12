-- B-1065 B2b: the caretaker's signed 10x vote becomes three columns of their
-- role. It counts while the role is active or suspended and stops counting when
-- the role ends, with nothing to clear. `supervote_version` counts changes, so
-- a page acting on an old copy is refused; `supervote_command_id` is the last
-- command that changed it, so a retried command replays instead of moving it
-- twice.
--
-- Online: the code before this change never reads these columns.
ALTER TABLE icono_caretaker_assignments
  ADD COLUMN supervote_asset_sha256 TEXT
  CHECK (supervote_asset_sha256 IS NULL OR length(supervote_asset_sha256) = 64);
ALTER TABLE icono_caretaker_assignments
  ADD COLUMN supervote_direction INTEGER
  CHECK (supervote_direction IS NULL OR supervote_direction IN (-1, 1));
ALTER TABLE icono_caretaker_assignments
  ADD COLUMN supervote_version INTEGER NOT NULL DEFAULT 0 CHECK (supervote_version >= 0);
ALTER TABLE icono_caretaker_assignments
  ADD COLUMN supervote_command_id TEXT;

-- Each open role takes its supervote from the old per-gene head, version
-- included, so a page loaded before the switch still matches. The admin copy
-- runs the same statement once more right after the switch
-- (workers/iconoplasm/caretaking-copy.js).
UPDATE icono_caretaker_assignments
   SET supervote_asset_sha256 = (
         SELECT CASE WHEN s.active = 1 THEN s.asset_sha256 END
           FROM icono_caretaker_supervote_projection s
          WHERE s.caretaker_assignment_id = icono_caretaker_assignments.caretaker_assignment_id),
       supervote_direction = (
         SELECT CASE WHEN s.active = 1 THEN s.direction END
           FROM icono_caretaker_supervote_projection s
          WHERE s.caretaker_assignment_id = icono_caretaker_assignments.caretaker_assignment_id),
       supervote_version = (
         SELECT s.supervote_version
           FROM icono_caretaker_supervote_projection s
          WHERE s.caretaker_assignment_id = icono_caretaker_assignments.caretaker_assignment_id)
 WHERE status IN ('active', 'suspended')
   AND supervote_version < COALESCE((
         SELECT s.supervote_version
           FROM icono_caretaker_supervote_projection s
          WHERE s.caretaker_assignment_id = icono_caretaker_assignments.caretaker_assignment_id), 0);

-- The publication that replaces a caretaker's +1 pick tells them (B-898). The
-- trigger now reads the role itself.
DROP TRIGGER IF EXISTS icono_caretaker_positive_supervote_lost_canon;
CREATE TRIGGER icono_caretaker_positive_supervote_lost_canon
AFTER INSERT ON icono_publish_events
WHEN NEW.action = 'publish'
 AND NEW.from_asset_sha256 IS NOT NULL
 AND NEW.to_asset_sha256 IS NOT NULL
 AND NEW.from_asset_sha256 IS NOT NEW.to_asset_sha256
BEGIN
  INSERT INTO icono_caretaker_supervote_notifications (
    notification_key, caretaker_assignment_id, caretaker_account_id,
    gene_symbol, preferred_asset_sha256, canonical_asset_sha256,
    supervote_version
  )
  SELECT 'supervote-canon-lost:' || upper(NEW.gene_symbol) || ':' || NEW.id,
         role.caretaker_assignment_id, role.account_id,
         role.gene_symbol, NEW.from_asset_sha256, NEW.to_asset_sha256,
         role.supervote_version
    FROM icono_caretaker_assignments role
   WHERE role.gene_symbol = upper(NEW.gene_symbol)
     AND role.status IN ('pending_acceptance', 'active', 'suspended')
     AND role.status <> 'pending_acceptance'
     AND role.supervote_direction = 1
     AND role.supervote_asset_sha256 = NEW.from_asset_sha256;
END;
