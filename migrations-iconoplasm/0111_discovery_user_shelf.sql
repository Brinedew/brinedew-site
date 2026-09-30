-- B-887: one per-user shelf row, so a signed-in home view stops folding the
-- user's whole chronology (0.5-1 MB for the largest shelves, 6-9 ms of CPU,
-- growing with every gene visit) on every request. shelf_json is a JSON array
-- of [symbol, first_at, last_at, encounter_count]; readers trust it only when
-- shelf_state_version equals state_version and otherwise fall back to the
-- chronology, so a stale shelf can cost speed but never correctness.
ALTER TABLE icono_discovery_user_state_v2
  ADD COLUMN shelf_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(shelf_json) AND length(shelf_json) <= 1048576);

ALTER TABLE icono_discovery_user_state_v2
  ADD COLUMN shelf_state_version INTEGER NOT NULL DEFAULT 0 CHECK(shelf_state_version >= 0);

-- Backfill: the same fold as compactShelfRowsFromChronology (upper-cased,
-- trimmed symbol; min and max of the event time; one count per event; events
-- without a symbol skipped) over the sealed chunks plus the active tail.
UPDATE icono_discovery_user_state_v2
SET
  shelf_json = (
    SELECT COALESCE(json_group_array(json_array(symbol, first_at, last_at, encounters)), '[]')
    FROM (
      SELECT symbol, MIN(at) AS first_at, MAX(at) AS last_at, COUNT(*) AS encounters
      FROM (
        SELECT
          upper(trim(COALESCE(json_extract(event.value, '$.symbol'), ''))) AS symbol,
          CASE
            WHEN typeof(json_extract(event.value, '$.at')) IN ('integer', 'real')
              AND json_extract(event.value, '$.at') >= 0
              THEN CAST(json_extract(event.value, '$.at') AS INTEGER)
            ELSE 0
          END AS at
        FROM (
          SELECT chunk.events_json AS events
          FROM icono_discovery_chronology_v2 AS chunk
          WHERE chunk.user_id = icono_discovery_user_state_v2.user_id
          UNION ALL
          SELECT icono_discovery_user_state_v2.active_events_json
        ) AS source, json_each(source.events) AS event
      )
      WHERE symbol <> ''
      GROUP BY symbol
      ORDER BY first_at, symbol
    )
  ),
  shelf_state_version = state_version;
