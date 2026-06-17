-- Phase 2 (consultant gate): minimal Iconoplasm publish control-plane tables
-- Symbol-first canonical key. UniProt remains optional metadata elsewhere.

CREATE TABLE IF NOT EXISTS icono_portrait_assets (
  gene_symbol TEXT NOT NULL,
  asset_sha256 TEXT NOT NULL,
  r2_key_hero TEXT NOT NULL,
  r2_key_thumb TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'image/webp',
  width INTEGER,
  height INTEGER,
  bytes INTEGER,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gene_symbol, asset_sha256)
);

CREATE INDEX IF NOT EXISTS idx_icono_portrait_assets_status
  ON icono_portrait_assets (status, created_at DESC);

CREATE TABLE IF NOT EXISTS icono_publish_state (
  gene_symbol TEXT PRIMARY KEY,
  current_asset_sha256 TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS icono_publish_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gene_symbol TEXT NOT NULL,
  from_asset_sha256 TEXT,
  to_asset_sha256 TEXT,
  action TEXT NOT NULL,
  actor TEXT,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_publish_events_gene
  ON icono_publish_events (gene_symbol, id DESC);
