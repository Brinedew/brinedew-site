-- Migration: 0008 - Add ESM2 structural embeddings
-- ESM2-3B produces 2560-dimensional embeddings that capture protein structure/sequence similarity.
-- These complement the existing HiG2Vec embeddings which capture functional/GO similarity.
-- Storage: float16 blobs to save space (~98 MB for 19K genes vs ~195 MB for float32).

ALTER TABLE protein_embeddings ADD COLUMN esm2_dim INTEGER;
ALTER TABLE protein_embeddings ADD COLUMN esm2_vector BLOB;

-- Index for checking which genes have ESM2 data
CREATE INDEX IF NOT EXISTS idx_embeddings_has_esm2 ON protein_embeddings(esm2_dim) WHERE esm2_dim IS NOT NULL;
