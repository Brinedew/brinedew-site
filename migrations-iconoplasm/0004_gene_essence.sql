-- Phase 5: Synced per-gene essence for Iconoplasm website rendering.
--
-- Source of truth: NiceGUI sync pipeline writes the current local essence snapshot.
-- Consumer: /api/public/v1/genes/:symbol reads this table for essence fields shown on gene pages/cards.

CREATE TABLE IF NOT EXISTS icono_gene_essence (
  gene_symbol TEXT PRIMARY KEY,
  full_name TEXT,
  weight_kg REAL,
  height_cm INTEGER,
  sex TEXT,
  age TEXT,
  age_years INTEGER,
  faction TEXT,
  skin_hex TEXT,
  skin_name TEXT,
  aesthetics_json TEXT,
  family_surname TEXT,
  family_members INTEGER,
  family_feature TEXT,
  source TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_gene_essence_updated
  ON icono_gene_essence (updated_at DESC);

