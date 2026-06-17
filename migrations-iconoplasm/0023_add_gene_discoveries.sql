CREATE TABLE IF NOT EXISTS icono_gene_discoveries (
  user_id TEXT NOT NULL,
  gene_symbol TEXT NOT NULL,
  first_discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_encountered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  encounter_count INTEGER NOT NULL DEFAULT 1,
  first_source TEXT NOT NULL DEFAULT '',
  last_source TEXT NOT NULL DEFAULT '',
  first_trigger TEXT NOT NULL DEFAULT '',
  last_trigger TEXT NOT NULL DEFAULT '',
  first_dwell_ms INTEGER,
  last_dwell_ms INTEGER,
  PRIMARY KEY (user_id, gene_symbol)
);

CREATE INDEX IF NOT EXISTS idx_icono_gene_discoveries_gene_symbol
  ON icono_gene_discoveries(gene_symbol, last_encountered_at DESC);

CREATE INDEX IF NOT EXISTS idx_icono_gene_discoveries_last_encountered
  ON icono_gene_discoveries(user_id, last_encountered_at DESC);