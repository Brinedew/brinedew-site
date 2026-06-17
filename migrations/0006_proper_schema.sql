-- Migration: 0006 - Completely flat schema
-- Every field the game uses is its own column. JSON arrays for lists.
--
-- WARNING: DO NOT drop or modify `protein_embeddings` here!
-- Embeddings are static reference data (19K gene vectors from HiG2Vec).
-- They are uploaded separately and should survive protein table rebuilds.

DROP TABLE IF EXISTS protein_synonyms;
DROP TABLE IF EXISTS proteins;

CREATE TABLE proteins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    
    -- Identity
    uniprot TEXT NOT NULL UNIQUE,
    gene TEXT,
    full_name TEXT,
    
    -- Physical
    length INTEGER,
    mass REAL,
    tmh INTEGER NOT NULL DEFAULT 0,
    secreted INTEGER NOT NULL DEFAULT 0,
    
    -- Tissue
    tissue_label TEXT,
    
    -- Structure source
    has_structure INTEGER NOT NULL DEFAULT 0,
    structure_source TEXT,
    
    -- PDB
    pdb_id TEXT,
    pdb_coverage REAL,
    pdb_resolution REAL,
    pdb_method TEXT,
    
    -- SWISS-MODEL
    swissmodel_coverage REAL,
    swissmodel_qmean REAL,
    swissmodel_template TEXT,
    swissmodel_url TEXT,
    
    -- AlphaFold
    alphafold_plddt REAL,
    alphafold_url TEXT,
    
    -- Gene summary
    gene_summary TEXT,
    
    -- JSON array columns - each is independent
    synonyms TEXT,       -- ["TP53", "P53"]
    domains TEXT,        -- ["Kinase domain", "SH2 domain"] (names only)
    clans TEXT,          -- ["CL0001"]
    go_bp TEXT,          -- ["apoptotic process", "cell death"]
    go_mf TEXT,          -- ["ATP binding"]
    go_cc TEXT,          -- ["cytoplasm", "nucleus"]
    pathways TEXT,       -- ["Apoptosis", "Cell cycle"] (names only)
    locations TEXT,      -- ["Cytoplasm", "Nucleus"]
    
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_proteins_gene ON proteins(gene);
CREATE INDEX idx_proteins_structure ON proteins(structure_source);

-- Synonyms table for autocomplete search
CREATE TABLE protein_synonyms (
    protein_id INTEGER NOT NULL REFERENCES proteins(id) ON DELETE CASCADE,
    synonym TEXT NOT NULL,
    normalized TEXT NOT NULL,
    PRIMARY KEY (protein_id, normalized)
);
CREATE INDEX idx_synonyms_normalized ON protein_synonyms(normalized);
