-- Every immutable user-emulsion revision receives one plain numeric public slot.
-- The owner/revision ID remains internal authority; cards can show A1-41807.

CREATE TABLE IF NOT EXISTS iconoplasm_user_emulsion_public_slots (
  slot INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  public_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, revision)
);

INSERT OR IGNORE INTO iconoplasm_user_emulsion_public_slots (
  user_id, revision, public_id, created_at
)
SELECT user_id, revision, public_id, created_at
FROM iconoplasm_user_emulsion_versions
ORDER BY created_at ASC, user_id ASC, revision ASC;
