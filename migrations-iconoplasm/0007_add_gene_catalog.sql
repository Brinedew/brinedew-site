-- Canonical published Iconoplasm catalog.
--
-- This is the single published source of truth for symbol identity and
-- lightweight extension metadata. The extension artifact in KV is derived from
-- this table; it is no longer an independent publication path.

CREATE TABLE IF NOT EXISTS icono_gene_catalog (
  gene_symbol TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  uniprot TEXT,
  color_hex TEXT,
  tmh INTEGER NOT NULL DEFAULT 0,
  source TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_gene_catalog_uniprot
  ON icono_gene_catalog (uniprot);

CREATE INDEX IF NOT EXISTS idx_icono_gene_catalog_updated
  ON icono_gene_catalog (updated_at DESC);
