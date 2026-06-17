CREATE TABLE IF NOT EXISTS iconoplasm_user_emulsion_versions (
  user_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  public_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  emulsion_text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, revision)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_iconoplasm_user_emulsion_versions_public_id
ON iconoplasm_user_emulsion_versions (public_id);

CREATE INDEX IF NOT EXISTS idx_iconoplasm_user_emulsion_versions_recent
ON iconoplasm_user_emulsion_versions (revision DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_iconoplasm_user_emulsion_versions_username
ON iconoplasm_user_emulsion_versions (username);

INSERT OR IGNORE INTO iconoplasm_user_emulsion_versions (
  user_id,
  username,
  public_id,
  revision,
  emulsion_text,
  created_at
)
SELECT
  discord_id,
  COALESCE(username, ''),
  iconoplasm_emulsion_public_id,
  iconoplasm_emulsion_revision,
  iconoplasm_emulsion_text,
  COALESCE(updated_at, created_at, unixepoch() * 1000)
FROM users
WHERE iconoplasm_emulsion_revision > 0
  AND COALESCE(iconoplasm_emulsion_text, '') <> ''
  AND COALESCE(iconoplasm_emulsion_public_id, '') <> '';
