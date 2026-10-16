-- B-724: "Made from version N" reads one gene's generation receipts.
--
-- The Drain's portraits record which saved text made them only in
-- icono_portrait_generation_provenance (one row per fulfilled request); their
-- icono_portrait_assets rows stay legacy_unbound because the factory's
-- register route carries no provenance (2026-10-14 copy: 848 receipts, 0 bound
-- assets). The caretaker dossier reads the receipts by gene, and neither
-- existing index starts with the gene, so without this one every dossier open
-- would scan the whole table.
CREATE INDEX IF NOT EXISTS idx_icono_portrait_generation_provenance_gene
  ON icono_portrait_generation_provenance (gene_symbol, asset_sha256);
