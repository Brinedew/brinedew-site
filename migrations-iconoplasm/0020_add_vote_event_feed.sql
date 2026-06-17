CREATE TABLE IF NOT EXISTS icono_vote_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gene_symbol TEXT NOT NULL,
  asset_sha256 TEXT NOT NULL,
  vision_id TEXT NOT NULL DEFAULT '',
  candidate_ref TEXT NOT NULL,
  candidate_image_id INTEGER,
  user_id TEXT NOT NULL,
  vote_value INTEGER NOT NULL CHECK (vote_value IN (-1, 0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_vote_events_created
  ON icono_vote_events (id);

CREATE INDEX IF NOT EXISTS idx_icono_vote_events_asset
  ON icono_vote_events (gene_symbol, asset_sha256, id DESC);

CREATE INDEX IF NOT EXISTS idx_icono_vote_events_user
  ON icono_vote_events (user_id, id DESC);
