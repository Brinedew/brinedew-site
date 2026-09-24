-- B-799: the archived 31 August events belong to production authority epoch 2.
-- Correct the sealed import manifest once; keep the event rows and digest fixed.
DROP TRIGGER icono_event_archive_manifest_immutable_update;
UPDATE icono_event_archive_manifest SET authority_epoch = 2
 WHERE singleton = 1 AND authority_epoch = 1 AND through_sequence = 58078
   AND event_count = 58078
   AND source_sha256 = 'e3ae0b1d33abcc5629b4fe378453d1c8b338e82256e2cf4acf020c21d01316a9';
CREATE TRIGGER icono_event_archive_manifest_immutable_update
BEFORE UPDATE ON icono_event_archive_manifest
BEGIN
  SELECT RAISE(ABORT, 'event_archive_manifest_is_immutable');
END;
