-- Store synced manifestation leakage metrics on the public essence table so
-- uniqueness sorting can use the same precomputed score the local workstation
-- already maintains.

ALTER TABLE icono_gene_essence ADD COLUMN leakage_percent REAL;
ALTER TABLE icono_gene_essence ADD COLUMN leakage_hits INTEGER;
ALTER TABLE icono_gene_essence ADD COLUMN leakage_total INTEGER;

CREATE INDEX IF NOT EXISTS idx_icono_gene_essence_leakage
  ON icono_gene_essence (leakage_percent, gene_symbol);

CREATE INDEX IF NOT EXISTS idx_icono_gene_essence_weight_kg
  ON icono_gene_essence (weight_kg, gene_symbol);

CREATE INDEX IF NOT EXISTS idx_icono_gene_essence_age_years
  ON icono_gene_essence (age_years, gene_symbol);
