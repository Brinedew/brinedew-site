-- B-1147: four tables that nothing reads, about 60 MiB of the database's
-- 500 MB, and the triggers that kept one pair of them growing.
--
-- - icono_caretaker_candidate_eligibility_events and _projection fed the
--   per-gene VoteCoordinator's supervote check (migration 0088). Votes moved
--   into D1 alone on 2026-10-03 (B-898 Stage 2) and the coordinator went with
--   them, but the three triggers on icono_portrait_assets kept appending an
--   event and upserting the projection on every portrait insert, status change
--   and delete: 67,808 events by 2026-10-20, written on each portrait action
--   and read by nobody.
-- - icono_manifestation_canonical_projection and _publication_wakes were the
--   old text authority's read copy (migration 0084). Gene texts live in
--   icono_gene_texts since 2026-10-12 (B-1065, migration 0125).
--
-- icono_manifestation_projection_authority stays: account erasure and the
-- legacy essence guards still read it.
--
-- Dropping is page-level in SQLite: a local D1 dropping a 100,000-row table
-- with its index and trigger reported 0 rows written and 5 read.
DROP TRIGGER IF EXISTS icono_portrait_asset_caretaker_eligibility_insert;
DROP TRIGGER IF EXISTS icono_portrait_asset_caretaker_eligibility_update;
DROP TRIGGER IF EXISTS icono_portrait_asset_caretaker_eligibility_delete;
DROP TRIGGER IF EXISTS icono_projection_epoch_guard_insert;
DROP TRIGGER IF EXISTS icono_projection_epoch_guard_update;
DROP TABLE IF EXISTS icono_caretaker_candidate_eligibility_events;
DROP TABLE IF EXISTS icono_caretaker_candidate_eligibility_projection;
DROP TABLE IF EXISTS icono_manifestation_canonical_projection;
DROP TABLE IF EXISTS icono_manifestation_publication_wakes;
