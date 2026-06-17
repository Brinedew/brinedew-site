-- Add gene_surname column for balanced random protein selection
-- Gene surname is the prefix before the first digit (e.g., OR10G4 -> OR)
-- This prevents over-representation of large gene families like ZNF, OR, etc.

ALTER TABLE proteins ADD COLUMN gene_surname TEXT;

-- Create index for efficient surname-based queries
CREATE INDEX IF NOT EXISTS idx_proteins_gene_surname ON proteins(gene_surname);
