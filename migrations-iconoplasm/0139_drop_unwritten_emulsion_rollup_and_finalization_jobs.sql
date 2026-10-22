-- Two tables whose writers are already gone, left behind holding about 19 MiB
-- of the database's 500 MB (2026-10-20 nightly copy). Room in the database is
-- the first readiness item for a viral post (B-1156).
--
-- - icono_user_emulsion_option_rollup (23,121 rows, 11.4 MiB with indexes):
--   per-emulsion picker counts. PR #578 (B-1064, 2026-10-10) stopped writing it
--   because nothing read it; its last row is from 2026-10-09. The picker reads
--   icono_generation_request_vision_option_rollup.
-- - icono_sync_finalization_jobs (19,857 rows, 7.5 MiB with indexes): the old
--   workstation finalization handoff. Its last writer went with the budget
--   referee in PR #618 (B-1067, 2026-10-12), and its summary table and triggers
--   went in 0137. Last row 2026-10-09.
--
-- No foreign key points at either table and no trigger reads them, so each drop
-- is page-level: 0 rows written.
DROP TABLE IF EXISTS icono_user_emulsion_option_rollup;
DROP TABLE IF EXISTS icono_sync_finalization_jobs;
