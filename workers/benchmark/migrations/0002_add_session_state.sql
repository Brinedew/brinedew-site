-- Migration: 0002 - Historical no-op for benchmark session state
--
-- Architectural choice:
--   Fresh/local databases now get benchmark_sessions.state from
--   0001_benchmark_init.sql so this lane remains replayable.
--
-- Mistake to avoid:
--   Do not reintroduce ALTER TABLE here. Some existing databases already have
--   the column without a recorded 0002 entry, and replaying the duplicate step
--   makes local/remote migration state diverge again.

SELECT 1;
