-- B-764: forward-only repair for the compact-discovery activation gate.
-- Production applied 0106 before this table was appended to that historical
-- migration. IF NOT EXISTS keeps environments that saw the later 0106 shape
-- compatible; the admitted adapter rejects any incompatible existing shape.

CREATE TABLE IF NOT EXISTS icono_discovery_compact_activation_v2 (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  status TEXT NOT NULL CHECK(status IN ('pending', 'complete')),
  cursor_user_id TEXT NOT NULL DEFAULT '',
  cursor_gene_symbol TEXT NOT NULL DEFAULT '',
  lease_token TEXT NOT NULL DEFAULT '',
  lease_until TEXT NOT NULL DEFAULT '',
  total_legacy_rows INTEGER NOT NULL DEFAULT 0 CHECK(total_legacy_rows >= 0),
  migrated_rows INTEGER NOT NULL DEFAULT 0 CHECK(migrated_rows >= 0),
  migrated_users INTEGER NOT NULL DEFAULT 0 CHECK(migrated_users >= 0),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO icono_discovery_compact_activation_v2 (
  singleton, status, cursor_user_id, cursor_gene_symbol, migrated_users, total_legacy_rows
) VALUES (1, 'pending', '', '', 0, 0);
