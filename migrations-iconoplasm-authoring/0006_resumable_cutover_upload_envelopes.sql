-- Cutover uploads can outlive one Worker request while Bunny converges. Keep
-- the encrypted envelope (never plaintext or ciphertext) beside the durable
-- upload reservation so a later invocation can verify and atomically adopt the
-- exact object instead of deleting and re-encrypting it.

ALTER TABLE icono_manifestation_upload_intents ADD COLUMN body_sha256 TEXT;
ALTER TABLE icono_manifestation_upload_intents ADD COLUMN ciphertext_bytes INTEGER;
ALTER TABLE icono_manifestation_upload_intents ADD COLUMN body_iv_base64 TEXT;
ALTER TABLE icono_manifestation_upload_intents ADD COLUMN wrapped_dek_base64 TEXT;
ALTER TABLE icono_manifestation_upload_intents ADD COLUMN wrap_iv_base64 TEXT;
ALTER TABLE icono_manifestation_upload_intents ADD COLUMN key_version INTEGER;
ALTER TABLE icono_manifestation_upload_intents ADD COLUMN aad_version INTEGER;
