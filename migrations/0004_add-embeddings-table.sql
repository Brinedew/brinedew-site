-- Migration number: 0004 	 2025-11-16T12:26:19.458Z

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS protein_embeddings (
    protein_id INTEGER PRIMARY KEY REFERENCES proteins(id) ON DELETE CASCADE,
    dim INTEGER NOT NULL DEFAULT 200,
    vector BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_embeddings_dim ON protein_embeddings(dim);
