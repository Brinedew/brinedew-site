-- Migration: 0007 - Embeddings keyed by gene symbol (not protein FK)
-- The HiG2Vec embeddings are static reference data indexed by gene symbol.
-- They shouldn't be tied to the proteins table via FK.

DROP TABLE IF EXISTS protein_embeddings;

CREATE TABLE protein_embeddings (
    gene_symbol TEXT PRIMARY KEY,
    dim INTEGER NOT NULL DEFAULT 200,
    vector BLOB NOT NULL
);
