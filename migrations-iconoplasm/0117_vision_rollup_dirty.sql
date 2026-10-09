-- B-1057: sync finalization rebuilt every vision a gene touched, once per gene,
-- one Queue message each. A 45-portrait publication on 2026-10-09 rebuilt
-- about 370 visions (about 180,000 rows read). Finalization now marks the
-- visions here, and the request-picker job rebuilds each marked vision once.
CREATE TABLE IF NOT EXISTS icono_vision_rollup_dirty (
  vision_id TEXT PRIMARY KEY NOT NULL,
  marked_at TEXT NOT NULL
);
