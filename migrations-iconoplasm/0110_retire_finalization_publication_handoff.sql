-- B-869: retire 0101's singleton job-to-publisher handoff. The scoped per-gene
-- drain replaced the global publisher that claimed it, so nothing in production
-- reads this row, but its triggers still charged a D1 row write on finalization
-- job inserts, deletes and terminal-phase transitions. The 0094 summary triggers
-- on the same job table stay; they feed the live finalization status.
DROP TRIGGER IF EXISTS trg_icono_finalization_publication_insert;
DROP TRIGGER IF EXISTS trg_icono_finalization_publication_update;
DROP TRIGGER IF EXISTS trg_icono_finalization_publication_delete;
DROP TABLE IF EXISTS icono_sync_finalization_publication;
