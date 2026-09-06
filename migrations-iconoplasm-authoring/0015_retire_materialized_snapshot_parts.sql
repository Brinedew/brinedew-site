-- IPD-012: v2 streams immutable baselines/checkpoints/events; v1 transport
-- copies are no longer a source of truth or a reader dependency. Migration
-- 0012 expired old leases. Retain all source rows, rowids and lease audit rows.
-- The admitted adapter caps lease/schema inspection before this atomic batch.
SELECT CASE WHEN EXISTS (
  SELECT 1 FROM icono_manifestation_snapshot_leases
  WHERE stream_version = 1 AND status IN ('building', 'open')
) THEN json('COST_LEGACY_SNAPSHOT_STILL_ACTIVE') ELSE 1 END AS admitted;

DROP TABLE icono_manifestation_snapshot_parts;
