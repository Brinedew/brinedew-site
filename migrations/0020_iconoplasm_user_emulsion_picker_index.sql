ALTER TABLE users ADD COLUMN iconoplasm_emulsion_public_id TEXT NOT NULL DEFAULT '';

UPDATE users
SET iconoplasm_emulsion_public_id =
  upper(replace(replace(trim(username), '_', '-'), '.', '-')) || '-' || iconoplasm_emulsion_revision
WHERE iconoplasm_emulsion_revision > 0
  AND COALESCE(iconoplasm_emulsion_text, '') <> ''
  AND COALESCE(iconoplasm_emulsion_public_id, '') = ''
  AND COALESCE(username, '') <> '';

CREATE INDEX IF NOT EXISTS idx_users_iconoplasm_emulsion_public_id
ON users (iconoplasm_emulsion_public_id);

CREATE INDEX IF NOT EXISTS idx_users_iconoplasm_emulsion_recent
ON users (iconoplasm_emulsion_revision, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_username
ON users (username);
