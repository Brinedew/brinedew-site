-- D1 production caps LIKE/GLOB pattern length more tightly than local SQLite.
-- The old dynamic suffix pattern grew with the opaque revision ID and rejected
-- every otherwise-valid storage adoption with "LIKE or GLOB pattern too
-- complex". Use exact suffix comparison instead; it preserves the predictable
-- locator fence without invoking the pattern engine.

DROP TRIGGER IF EXISTS icono_revision_storage_validate_insert;

CREATE TRIGGER icono_revision_storage_validate_insert
BEFORE INSERT ON icono_manifestation_revision_storage_secrets
BEGIN
  SELECT case WHEN substr(
    NEW.object_key,
    -(length(NEW.manifestation_revision_id) + 5)
  ) = '/' || NEW.manifestation_revision_id || '.bin'
  THEN RAISE(ABORT, 'predictable_manifestation_object_key') end;
  SELECT case WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestation_revisions r
     WHERE r.manifestation_revision_id = NEW.manifestation_revision_id
       AND NEW.ciphertext_bytes = r.body_bytes + 16
  ) THEN RAISE(ABORT, 'manifestation_ciphertext_size_mismatch') end;
end;
