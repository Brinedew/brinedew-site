CREATE TABLE IF NOT EXISTS icono_user_emulsion_option_rollup (
  emulsion_id TEXT PRIMARY KEY,
  image_count INTEGER NOT NULL DEFAULT 0,
  live_count INTEGER NOT NULL DEFAULT 0,
  preview_assets_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_user_emulsion_option_rollup_updated
ON icono_user_emulsion_option_rollup (updated_at DESC, emulsion_id);
