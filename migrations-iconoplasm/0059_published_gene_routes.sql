-- ARCHITECTURE FENCE [IPD-009]
-- Canonical gene-document membership after the public publication barrier.
--
-- This table deliberately stores identity only. The current portrait, vote
-- result, and gene-page payload remain authoritative in their existing D1
-- detail models and are versioned for HTML caching by the detail ETag.

CREATE TABLE IF NOT EXISTS icono_published_gene_routes (
  gene_symbol TEXT PRIMARY KEY NOT NULL
) WITHOUT ROWID;

-- The live catalog was already published before this read model existed.
-- Seed that established publication state once; later membership changes are
-- synchronized only after the card-catalog publication barrier succeeds.
INSERT OR IGNORE INTO icono_published_gene_routes (gene_symbol)
SELECT gene_symbol
FROM icono_gene_catalog;
