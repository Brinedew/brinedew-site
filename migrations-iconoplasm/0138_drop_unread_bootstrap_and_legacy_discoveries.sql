-- Two tables nothing reads any more (B-1148, 2026-10-22).
--
-- icono_admin_read_model_bootstrap: the state row of the read-model bootstrap.
-- The bootstrap finished on 2026-08-02 and its route was deleted in #715; the
-- Styles scorecard stopped reading the row in the same change.
--
-- icono_gene_discoveries: the first-generation discovery table. Every one of
-- its 38 accounts was imported into the compact state (each has at least as
-- many compact members as legacy genes, 2026-10-20 nightly copy), its import
-- was deleted in #618, and only account erasure still touched it. Its 5,541
-- rows are exported to artifacts/b1148-drop-legacy-discoveries/ and remain in
-- the nightly dumps.
--
-- No foreign key or trigger references either table, so each drop is
-- page-level and writes no rows.
DROP TABLE IF EXISTS icono_admin_read_model_bootstrap;
DROP TABLE IF EXISTS icono_gene_discoveries;
