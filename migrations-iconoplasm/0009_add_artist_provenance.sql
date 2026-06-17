ALTER TABLE icono_portrait_assets ADD COLUMN vision_id TEXT;
ALTER TABLE icono_portrait_assets ADD COLUMN artist_tag TEXT;
ALTER TABLE icono_portrait_assets ADD COLUMN artist_name TEXT;

CREATE INDEX IF NOT EXISTS idx_icono_portrait_assets_artist_tag
  ON icono_portrait_assets (artist_tag, status, created_at DESC);

CREATE TABLE IF NOT EXISTS icono_artist_style_blacklist (
  artist_tag TEXT PRIMARY KEY,
  artist_name TEXT,
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
