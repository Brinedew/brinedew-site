ALTER TABLE icono_portrait_assets
  ADD COLUMN is_stale INTEGER NOT NULL DEFAULT 0;

ALTER TABLE icono_portrait_assets
  ADD COLUMN is_legacy INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_icono_portrait_assets_legacy
  ON icono_portrait_assets (is_legacy, is_stale, created_at DESC);
