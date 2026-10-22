-- B-1160: a caretaker's History keeps one entry per look, not one per autosave.
-- The editor now overwrites one working copy a day, and an order, a new day,
-- "Edit from here" or a new caretaker seals it. This folds the versions saved
-- under the old rule the same way: a version goes when a later save of the same
-- line on the same UTC day replaced it (a save without Tags never replaces one
-- with Tags), and nothing names it. Anything a portrait, an order, a job or the
-- gene's chosen text points at stays, so every "Made from version N" link and
-- every receipt keeps its exact words. Nightly copy 2026-10-20: 150 of 197
-- versions go; CTCF keeps 3 of 31, the three its 60 portraits were drawn from.
-- The owner agreed on 2026-10-22 that caretakers lose going back to a single
-- save inside a sitting. The rows are in every nightly dump up to the day this
-- applies.
--
-- Online: the installed Worker lists whatever versions exist and never needs a
-- deleted one. The unindexed lookups are uncorrelated, so each table is read
-- once (icono_portrait_assets, about 63,000 rows, is the bulk of the price; the
-- generation requests' source index is partial and can't serve this lookup).
DELETE FROM icono_caretaker_text_versions
 WHERE version_id IN (
   SELECT v.version_id FROM icono_caretaker_text_versions v
    WHERE EXISTS (SELECT 1 FROM icono_caretaker_text_versions w
                   WHERE w.line_id = v.line_id AND w.version > v.version
                     AND date(w.created_at) = date(v.created_at)
                     AND (v.tags IS NULL OR w.tags IS NOT NULL))
      AND v.version_id NOT IN (SELECT source_manifestation_revision_id FROM icono_generation_requests
                                WHERE source_manifestation_revision_id IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM icono_portrait_generation_provenance p
                       WHERE p.source_manifestation_revision_id = v.version_id)
      AND v.version_id NOT IN (SELECT source_manifestation_revision_id FROM icono_candidate_generation_jobs
                                WHERE source_manifestation_revision_id IS NOT NULL)
      AND v.version_id NOT IN (SELECT source_manifestation_revision_id FROM icono_portrait_assets
                                WHERE source_manifestation_revision_id IS NOT NULL)
      AND v.version_id NOT IN (SELECT source_manifestation_revision_id FROM icono_generation_request_quarantine
                                WHERE source_manifestation_revision_id IS NOT NULL)
      AND v.version_id NOT IN (SELECT chosen_caretaker_version_id FROM icono_gene_texts
                                WHERE chosen_caretaker_version_id IS NOT NULL));
