-- Resume the one cutover backup by the existing indexed cutover-item order.
-- Store progress in the owning artifact row, so a normal batch never counts
-- the growing package ledger merely to report its own progress.
ALTER TABLE icono_manifestation_cutover_backup_artifacts ADD COLUMN scan_after_symbol TEXT;
ALTER TABLE icono_manifestation_cutover_backup_artifacts ADD COLUMN scan_lease_token TEXT;
ALTER TABLE icono_manifestation_cutover_backup_artifacts ADD COLUMN scan_lease_until TEXT;

UPDATE icono_manifestation_cutover_backup_artifacts
   SET verified_entries = (
         SELECT count(*) FROM icono_manifestation_cutover_backup_entries entry
          WHERE entry.backup_artifact_id = icono_manifestation_cutover_backup_artifacts.backup_artifact_id
            AND entry.status = 'verified'
       ),
       package_bytes = (
         SELECT coalesce(sum(package_bytes), 0) FROM icono_manifestation_cutover_backup_entries entry
          WHERE entry.backup_artifact_id = icono_manifestation_cutover_backup_artifacts.backup_artifact_id
            AND entry.status = 'verified'
       ),
       part_count = (
         SELECT count(*) FROM icono_manifestation_cutover_backup_parts part
          WHERE part.backup_artifact_id = icono_manifestation_cutover_backup_artifacts.backup_artifact_id
            AND part.status = 'verified'
       )
 WHERE status = 'building';

CREATE TRIGGER icono_cutover_backup_verified_progress
AFTER UPDATE OF status ON icono_manifestation_cutover_backup_entries
WHEN OLD.status <> 'verified' AND NEW.status = 'verified'
BEGIN
  UPDATE icono_manifestation_cutover_backup_artifacts
     SET verified_entries = verified_entries + 1,
         package_bytes = package_bytes + NEW.package_bytes
   WHERE backup_artifact_id = NEW.backup_artifact_id AND status = 'building';
END;

CREATE TRIGGER icono_cutover_backup_part_progress
AFTER UPDATE OF status ON icono_manifestation_cutover_backup_parts
WHEN OLD.status <> 'verified' AND NEW.status = 'verified'
BEGIN
  UPDATE icono_manifestation_cutover_backup_artifacts
     SET part_count = part_count + 1
   WHERE backup_artifact_id = NEW.backup_artifact_id AND status = 'building';
END;
