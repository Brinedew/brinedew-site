-- ARCHITECTURE FENCE [IPD-013]
-- B-1085: what batch work was let in, by the minute, priced before it ran.
--
-- Cloudflare's usage meter shows a minute one to two minutes late, so a gate
-- that reads only the meter lets a fast batch writer run straight past it
-- (2026-10-11: 62,000 rows written in four minutes past an 85% stop that never
-- saw them). Each admitted batch request adds its price here before it runs;
-- the gate adds the minutes the meter hasn't shown yet to the meter's total.
-- Older minutes are already in the meter, so they never count twice and a wrong
-- price stops mattering a minute or two later. Readers never write here.
CREATE TABLE icono_batch_admissions (
  minute TEXT PRIMARY KEY,
  rows_written INTEGER NOT NULL DEFAULT 0 CHECK (rows_written >= 0),
  rows_read INTEGER NOT NULL DEFAULT 0 CHECK (rows_read >= 0)
) WITHOUT ROWID;
