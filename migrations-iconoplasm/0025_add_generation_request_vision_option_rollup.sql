-- Precomputed request-picker lanes for the public gene page.
--
-- The old picker hydrated preview thumbnails straight from portrait assets on
-- live user requests. That was the wrong architecture for a hot page because a
-- "show me six example thumbs" interaction could fan out into large portrait
-- scans and turn a small feature into a billing incident.

CREATE TABLE IF NOT EXISTS icono_generation_request_vision_option_rollup (
  vision_id TEXT PRIMARY KEY,
  emulsion_id TEXT,
  workflow_id TEXT,
  workflow_label TEXT,
  prompt_version TEXT,
  variant_slot TEXT,
  artist_tag TEXT,
  artist_name TEXT,
  image_count INTEGER NOT NULL DEFAULT 0,
  live_count INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  preview_assets_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_generation_request_vision_option_rollup_priority
  ON icono_generation_request_vision_option_rollup (live_count DESC, image_count DESC, score DESC, vision_id ASC);

WITH ranked_previews AS (
  SELECT
    pa.vision_id,
    upper(pa.gene_symbol) AS gene_symbol,
    lower(pa.asset_sha256) AS asset_sha256,
    COALESCE(pa.r2_key_medium, '') AS r2_key_medium,
    COALESCE(pa.r2_key_thumb, '') AS r2_key_thumb,
    COALESCE(pa.r2_key_full, '') AS r2_key_full,
    CASE
      WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
      ELSE 0
    END AS is_current,
    ROW_NUMBER() OVER (
      PARTITION BY pa.vision_id
      ORDER BY
        CASE
          WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
          ELSE 0
        END DESC,
        COALESCE(pa.created_at, '') DESC,
        lower(pa.asset_sha256) ASC
    ) AS preview_rank
  FROM icono_portrait_assets pa
  LEFT JOIN icono_publish_state ps
    ON ps.gene_symbol = pa.gene_symbol
  WHERE COALESCE(pa.vision_id, '') <> ''
    AND COALESCE(pa.r2_key_medium, pa.r2_key_thumb, pa.r2_key_full, '') <> ''
),
preview_json AS (
  SELECT
    vision_id,
    json_group_array(
      json_object(
        'gene_symbol', gene_symbol,
        'asset_sha256', asset_sha256,
        'r2_key_medium', r2_key_medium,
        'r2_key_thumb', r2_key_thumb,
        'r2_key_full', r2_key_full,
        'is_current', is_current,
        'preview_rank', preview_rank
      )
    ) AS preview_assets_json
  FROM (
    SELECT
      vision_id,
      gene_symbol,
      asset_sha256,
      r2_key_medium,
      r2_key_thumb,
      r2_key_full,
      is_current,
      preview_rank
    FROM ranked_previews
    WHERE preview_rank <= 6
    ORDER BY vision_id ASC, preview_rank ASC
  )
  GROUP BY vision_id
)
INSERT INTO icono_generation_request_vision_option_rollup (
  vision_id,
  emulsion_id,
  workflow_id,
  workflow_label,
  prompt_version,
  variant_slot,
  artist_tag,
  artist_name,
  image_count,
  live_count,
  score,
  preview_assets_json,
  updated_at
)
SELECT
  avr.vision_id,
  COALESCE(avr.emulsion_id, ''),
  COALESCE(avr.workflow_id, ''),
  COALESCE(avr.workflow_label, ''),
  COALESCE(avr.prompt_version, ''),
  COALESCE(avr.variant_slot, ''),
  COALESCE(avr.artist_tag, ''),
  COALESCE(avr.artist_name, ''),
  COALESCE(avr.image_count, 0),
  COALESCE(avr.live_count, 0),
  COALESCE(avr.score, 0),
  COALESCE(preview_json.preview_assets_json, '[]'),
  CURRENT_TIMESTAMP
FROM icono_admin_vision_rollup avr
LEFT JOIN preview_json
  ON preview_json.vision_id = avr.vision_id
WHERE COALESCE(avr.vision_id, '') <> ''
ON CONFLICT(vision_id) DO UPDATE SET
  emulsion_id = excluded.emulsion_id,
  workflow_id = excluded.workflow_id,
  workflow_label = excluded.workflow_label,
  prompt_version = excluded.prompt_version,
  variant_slot = excluded.variant_slot,
  artist_tag = excluded.artist_tag,
  artist_name = excluded.artist_name,
  image_count = excluded.image_count,
  live_count = excluded.live_count,
  score = excluded.score,
  preview_assets_json = excluded.preview_assets_json,
  updated_at = CURRENT_TIMESTAMP;
