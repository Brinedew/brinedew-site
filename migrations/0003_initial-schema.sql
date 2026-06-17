-- Migration number: 0003 	 2025-11-16T11:35:55.300Z

PRAGMA foreign_keys = ON;

-- Replace legacy protein tables with the new canonical schema
DROP TABLE IF EXISTS protein_synonyms;
DROP TABLE IF EXISTS proteins;

CREATE TABLE IF NOT EXISTS proteins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uniprot TEXT NOT NULL UNIQUE,
    hgnc TEXT,
    full_name TEXT,
    length INTEGER,
    has_structure INTEGER NOT NULL DEFAULT 0,
    structure_source TEXT,
    metadata TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_proteins_hgnc ON proteins(hgnc);
CREATE INDEX IF NOT EXISTS idx_proteins_has_structure ON proteins(has_structure);

CREATE TABLE IF NOT EXISTS protein_synonyms (
    protein_id INTEGER NOT NULL REFERENCES proteins(id) ON DELETE CASCADE,
    synonym TEXT NOT NULL,
    normalized TEXT NOT NULL,
    PRIMARY KEY (protein_id, normalized)
);

CREATE INDEX IF NOT EXISTS idx_protein_synonyms_normalized
    ON protein_synonyms(normalized);
