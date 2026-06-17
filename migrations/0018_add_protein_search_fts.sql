-- Migration: 0018 - Add an FTS-backed protein search index.
-- This keeps autocomplete/search off full-table LIKE scans.

CREATE VIRTUAL TABLE IF NOT EXISTS protein_search USING fts5(
    protein_id UNINDEXED,
    uniprot,
    gene,
    full_name,
    synonyms,
    tokenize = 'unicode61 remove_diacritics 2'
);

DELETE FROM protein_search;

INSERT INTO protein_search (rowid, protein_id, uniprot, gene, full_name, synonyms)
SELECT
    p.id,
    p.id,
    COALESCE(p.uniprot, ''),
    COALESCE(p.gene, ''),
    COALESCE(p.full_name, ''),
    COALESCE((
        SELECT group_concat(ps.synonym, ' ')
        FROM protein_synonyms ps
        WHERE ps.protein_id = p.id
    ), '')
FROM proteins p;

DROP TRIGGER IF EXISTS protein_search_proteins_ai;
CREATE TRIGGER protein_search_proteins_ai
AFTER INSERT ON proteins
BEGIN
    INSERT INTO protein_search (rowid, protein_id, uniprot, gene, full_name, synonyms)
    VALUES (
        NEW.id,
        NEW.id,
        COALESCE(NEW.uniprot, ''),
        COALESCE(NEW.gene, ''),
        COALESCE(NEW.full_name, ''),
        COALESCE((
            SELECT group_concat(ps.synonym, ' ')
            FROM protein_synonyms ps
            WHERE ps.protein_id = NEW.id
        ), '')
    );
END;

DROP TRIGGER IF EXISTS protein_search_proteins_au;
CREATE TRIGGER protein_search_proteins_au
AFTER UPDATE ON proteins
BEGIN
    DELETE FROM protein_search WHERE rowid = OLD.id;
    INSERT INTO protein_search (rowid, protein_id, uniprot, gene, full_name, synonyms)
    VALUES (
        NEW.id,
        NEW.id,
        COALESCE(NEW.uniprot, ''),
        COALESCE(NEW.gene, ''),
        COALESCE(NEW.full_name, ''),
        COALESCE((
            SELECT group_concat(ps.synonym, ' ')
            FROM protein_synonyms ps
            WHERE ps.protein_id = NEW.id
        ), '')
    );
END;

DROP TRIGGER IF EXISTS protein_search_proteins_ad;
CREATE TRIGGER protein_search_proteins_ad
AFTER DELETE ON proteins
BEGIN
    DELETE FROM protein_search WHERE rowid = OLD.id;
END;

DROP TRIGGER IF EXISTS protein_search_synonyms_ai;
CREATE TRIGGER protein_search_synonyms_ai
AFTER INSERT ON protein_synonyms
BEGIN
    DELETE FROM protein_search WHERE rowid = NEW.protein_id;
    INSERT INTO protein_search (rowid, protein_id, uniprot, gene, full_name, synonyms)
    SELECT
        p.id,
        p.id,
        COALESCE(p.uniprot, ''),
        COALESCE(p.gene, ''),
        COALESCE(p.full_name, ''),
        COALESCE((
            SELECT group_concat(ps.synonym, ' ')
            FROM protein_synonyms ps
            WHERE ps.protein_id = NEW.protein_id
        ), '')
    FROM proteins p
    WHERE p.id = NEW.protein_id;
END;

DROP TRIGGER IF EXISTS protein_search_synonyms_au;
CREATE TRIGGER protein_search_synonyms_au
AFTER UPDATE ON protein_synonyms
BEGIN
    DELETE FROM protein_search WHERE rowid = NEW.protein_id;
    INSERT INTO protein_search (rowid, protein_id, uniprot, gene, full_name, synonyms)
    SELECT
        p.id,
        p.id,
        COALESCE(p.uniprot, ''),
        COALESCE(p.gene, ''),
        COALESCE(p.full_name, ''),
        COALESCE((
            SELECT group_concat(ps.synonym, ' ')
            FROM protein_synonyms ps
            WHERE ps.protein_id = NEW.protein_id
        ), '')
    FROM proteins p
    WHERE p.id = NEW.protein_id;
END;

DROP TRIGGER IF EXISTS protein_search_synonyms_ad;
CREATE TRIGGER protein_search_synonyms_ad
AFTER DELETE ON protein_synonyms
BEGIN
    DELETE FROM protein_search WHERE rowid = OLD.protein_id;
    INSERT INTO protein_search (rowid, protein_id, uniprot, gene, full_name, synonyms)
    SELECT
        p.id,
        p.id,
        COALESCE(p.uniprot, ''),
        COALESCE(p.gene, ''),
        COALESCE(p.full_name, ''),
        COALESCE((
            SELECT group_concat(ps.synonym, ' ')
            FROM protein_synonyms ps
            WHERE ps.protein_id = OLD.protein_id
        ), '')
    FROM proteins p
    WHERE p.id = OLD.protein_id;
END;
