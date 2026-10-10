-- B-1072: a new portrait wrote about 25 rows in the portrait table alone, one
-- for each of its ten indexes plus the triggers'. Audited with EXPLAIN QUERY
-- PLAN on the real schema (nightly copy of 2026-10-06) over all 73 statements
-- on main that touch icono_portrait_assets, the five dynamic ones read by hand,
-- and every trigger body that queries the table (all look portraits up by
-- gene_symbol, the primary key's leading column). No plan uses these four:
--
--   (status, created_at)
--   (is_legacy, is_stale, created_at)         readers filter COALESCE(is_legacy, 0),
--                                             which no index serves
--   (artist_tag, status, created_at)
--   (source_manifestation_revision_id, gene_symbol, created_at)  partial
--
-- Each costs a row on every insert and a rewrite whenever a status, legacy or
-- artist change touches its columns. Kept: the primary key and the vision,
-- emulsion (both), candidate image and factory-recent indexes, which plans use.
DROP INDEX IF EXISTS idx_icono_portrait_assets_status;
DROP INDEX IF EXISTS idx_icono_portrait_assets_legacy;
DROP INDEX IF EXISTS idx_icono_portrait_assets_artist_tag;
DROP INDEX IF EXISTS idx_icono_portrait_assets_source_revision;
