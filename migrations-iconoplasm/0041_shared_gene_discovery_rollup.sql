CREATE TABLE IF NOT EXISTS icono_shared_gene_discoveries (
  gene_symbol TEXT PRIMARY KEY,
  first_non_admin_discovered_at TEXT NOT NULL,
  latest_non_admin_encountered_at TEXT NOT NULL,
  non_admin_discoverer_count INTEGER NOT NULL DEFAULT 0,
  non_admin_encounter_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_shared_gene_discoveries_first
  ON icono_shared_gene_discoveries(first_non_admin_discovered_at DESC, gene_symbol ASC);
