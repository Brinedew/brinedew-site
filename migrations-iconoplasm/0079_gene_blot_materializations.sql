-- The canonical public gene image is a blot: the shared image-only card
-- composition (portrait artwork, protection gradient, full gene name, symbol).
-- Rendering belongs to the Iconoplasm workstation; D1 stores only the bounded
-- readiness identity needed to keep public card epochs coherent.
CREATE TABLE IF NOT EXISTS icono_gene_blot_materializations (
  gene_symbol TEXT PRIMARY KEY,
  blot_fingerprint TEXT NOT NULL,
  portrait_asset_sha256 TEXT NOT NULL,
  blot_asset_sha256 TEXT NOT NULL,
  object_key TEXT NOT NULL,
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  renderer_revision TEXT NOT NULL,
  rendered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (gene_symbol) REFERENCES icono_gene_catalog(gene_symbol) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_icono_gene_blot_materializations_fingerprint
  ON icono_gene_blot_materializations(blot_fingerprint, gene_symbol);
