-- Five tables that no Worker, script or page references any more, and the
-- three triggers that kept one of them written. Checked 2026-10-22 against
-- origin/main (git grep over workers/, shared/, scripts/, quartz/static/) and
-- the 2026-10-20 nightly copy.
--
-- - icono_gene_card_materializations (31 rows) and icono_gene_card_render_budget
--   (6 rows), migration 0063: the server-rendered card cache. Its sibling
--   icono_gene_blot_materializations went in 0132 with the blot factory; cards
--   are drawn in the browser from the published gene object.
-- - icono_manifestation_plaintext_retirement (0 rows), migration 0084: a step of
--   the old text authority's cutover. Texts live in icono_gene_texts (0125).
-- - icono_shared_gene_discoveries (2,356 rows), migration 0041: the shared
--   discovery rollup. Discovery reads compact v2 state since B-764 (0106); the
--   tests that name this table assert it is never read.
-- - icono_sync_finalization_summary (1 row), migrations 0094 and 0101: a
--   summary of icono_sync_finalization_jobs kept by three triggers on every job
--   insert, update and delete, read by nothing.
--
-- No foreign key points at any of them (the card cache points at the catalog,
-- not the other way round), so each drop is page-level: 0 rows written.
DROP TRIGGER IF EXISTS trg_icono_finalization_summary_insert;
DROP TRIGGER IF EXISTS trg_icono_finalization_summary_update;
DROP TRIGGER IF EXISTS trg_icono_finalization_summary_delete;
DROP TABLE IF EXISTS icono_sync_finalization_summary;
DROP TABLE IF EXISTS icono_gene_card_materializations;
DROP TABLE IF EXISTS icono_gene_card_render_budget;
DROP TABLE IF EXISTS icono_manifestation_plaintext_retirement;
DROP TABLE IF EXISTS icono_shared_gene_discoveries;
