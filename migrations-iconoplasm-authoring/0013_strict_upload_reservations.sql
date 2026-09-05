-- Every supported writer reserves its exact encrypted object before PUT,
-- including cutover imports and backup restores. The historical exception
-- allowed an unreserved first write and scanned all prior entity intents.
-- Remove it without rewriting stored bodies or weakening adoption/restore.
DROP TRIGGER icono_revision_storage_upload_intent_fence;
CREATE TRIGGER icono_revision_storage_upload_intent_fence
BEFORE INSERT ON icono_manifestation_revision_storage_secrets
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestation_upload_intents intent
     WHERE intent.object_key = NEW.object_key
       AND intent.entity_kind = 'revision'
       AND intent.entity_id = NEW.manifestation_revision_id
       AND intent.ciphertext_sha256 = NEW.ciphertext_sha256
       AND intent.status = 'uploading'
       AND julianday(intent.lease_expires_at) >= julianday(CURRENT_TIMESTAMP)
  ) THEN RAISE(ABORT, 'revision_upload_intent_is_not_adoptable') END;
END;

DROP TRIGGER icono_derivative_storage_upload_intent_fence;
CREATE TRIGGER icono_derivative_storage_upload_intent_fence
BEFORE INSERT ON icono_manifestation_derivative_storage_secrets
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM icono_manifestation_upload_intents intent
     WHERE intent.object_key = NEW.object_key
       AND intent.entity_kind = 'derivative'
       AND intent.entity_id = NEW.manifestation_derivative_id
       AND intent.ciphertext_sha256 = NEW.ciphertext_sha256
       AND intent.status = 'uploading'
       AND julianday(intent.lease_expires_at) >= julianday(CURRENT_TIMESTAMP)
  ) THEN RAISE(ABORT, 'derivative_upload_intent_is_not_adoptable') END;
END;
