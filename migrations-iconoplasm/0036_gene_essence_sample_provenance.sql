-- Store the latest per-gene manifestation sample provenance on the synced
-- essence row. Direct candidate generation uses this gene-level source of
-- truth, not the currently published portrait asset, because old portraits may
-- predate the sample-ID system.

ALTER TABLE icono_gene_essence ADD COLUMN sample_label TEXT;
ALTER TABLE icono_gene_essence ADD COLUMN sample_number INTEGER;
ALTER TABLE icono_gene_essence ADD COLUMN sample_text_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_icono_gene_essence_sample_label
  ON icono_gene_essence (sample_label);
