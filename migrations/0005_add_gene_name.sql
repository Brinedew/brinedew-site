-- Migration number: 0005 	 2025-11-27
-- Add gene_name column for direct gene symbol lookups

ALTER TABLE proteins ADD COLUMN gene_name TEXT;

CREATE INDEX IF NOT EXISTS idx_proteins_gene_name ON proteins(gene_name);
