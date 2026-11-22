-- B-1283: mark visions present in icono_portrait_assets (approved or draft)
-- that are missing from icono_admin_vision_rollup or
-- icono_generation_request_vision_option_rollup so the existing
-- rebuildDirtyVisionRollups cron drains them under admitBatchWork.
--
-- Measured on the 2026-11-21 nightly copy (69,422 assets, 22,008 rollup rows):
-- 295 distinct anima-v1-* visions created on 2026-10-09 15:09-19:32 UTC exist
-- in icono_portrait_assets and icono_style_cards but were absent from both
-- vision rollups and had 0 dirty marks.
--
-- Online: safe before and after the Worker deploy; writes only to existing
-- icono_vision_rollup_dirty (~590 rows written, ~114k covering-index reads).

INSERT OR IGNORE INTO icono_vision_rollup_dirty (vision_id, marked_at)
SELECT pa.vision_id, CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT vision_id
  FROM icono_portrait_assets
  WHERE status IN ('approved', 'draft')
    AND vision_id IS NOT NULL
    AND TRIM(vision_id) <> ''
) pa
LEFT JOIN icono_admin_vision_rollup avr
  ON avr.vision_id = pa.vision_id
LEFT JOIN icono_generation_request_vision_option_rollup vor
  ON vor.vision_id = pa.vision_id
WHERE avr.vision_id IS NULL
   OR vor.vision_id IS NULL;
