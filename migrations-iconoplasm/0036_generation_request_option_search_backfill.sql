-- Make the new-candidate picker searchable by the public emulsion identity.
--
-- Production had many valid A1-2/A1-3 style emulsions in
-- icono_admin_vision_rollup, but the request picker rollup only contained the
-- older top slice. The modal now performs query-aware search against
-- icono_generation_request_vision_option_rollup, so this migration backfills
-- missing rollup rows once and adds prefix indexes for those authenticated
-- searches. Runtime request traffic must never fall back to admin or portrait
-- scans to paper over a missing picker row.

CREATE INDEX IF NOT EXISTS idx_icono_generation_request_vision_option_rollup_emulsion
  ON icono_generation_request_vision_option_rollup (
    emulsion_id,
    vote_h_index DESC,
    live_count DESC,
    score DESC,
    image_count DESC,
    vision_id ASC
  );

CREATE INDEX IF NOT EXISTS idx_icono_generation_request_vision_option_rollup_artist
  ON icono_generation_request_vision_option_rollup (
    artist_tag,
    vote_h_index DESC,
    live_count DESC,
    score DESC,
    image_count DESC,
    vision_id ASC
  );

WITH missing_visions AS (
  SELECT
    avr.vision_id,
    COALESCE(avr.emulsion_id, '') AS emulsion_id,
    COALESCE(avr.workflow_id, '') AS workflow_id,
    COALESCE(avr.workflow_label, '') AS workflow_label,
    COALESCE(avr.prompt_version, '') AS prompt_version,
    COALESCE(avr.variant_slot, '') AS variant_slot,
    COALESCE(avr.artist_tag, '') AS artist_tag,
    COALESCE(avr.artist_name, '') AS artist_name,
    COALESCE(avr.image_count, 0) AS image_count,
    COALESCE(avr.live_count, 0) AS live_count,
    COALESCE(avr.score, 0) AS score
  FROM icono_admin_vision_rollup avr
  LEFT JOIN icono_generation_request_vision_option_rollup opt
    ON opt.vision_id = avr.vision_id
  WHERE COALESCE(avr.vision_id, '') <> ''
    AND opt.vision_id IS NULL
),
ranked_previews AS (
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
  INNER JOIN missing_visions mv
    ON mv.vision_id = pa.vision_id
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
),
vote_counts AS (
  SELECT
    pa.vision_id,
    COALESCE(vs.upvotes, 0) AS upvotes
  FROM icono_portrait_assets pa
  INNER JOIN missing_visions mv
    ON mv.vision_id = pa.vision_id
  LEFT JOIN icono_vote_asset_summary vs
    ON vs.gene_symbol = upper(pa.gene_symbol)
   AND vs.asset_sha256 = lower(pa.asset_sha256)
  WHERE COALESCE(pa.vision_id, '') <> ''
),
ranked_votes AS (
  SELECT
    vision_id,
    upvotes,
    ROW_NUMBER() OVER (
      PARTITION BY vision_id
      ORDER BY upvotes DESC, vision_id ASC
    ) AS approval_rank
  FROM vote_counts
),
h_index AS (
  SELECT
    vision_id,
    MAX(CASE WHEN upvotes >= approval_rank THEN approval_rank ELSE 0 END) AS vote_h_index
  FROM ranked_votes
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
  vote_h_index,
  preview_assets_json,
  updated_at
)
SELECT
  mv.vision_id,
  mv.emulsion_id,
  mv.workflow_id,
  mv.workflow_label,
  mv.prompt_version,
  mv.variant_slot,
  mv.artist_tag,
  mv.artist_name,
  mv.image_count,
  mv.live_count,
  mv.score,
  COALESCE(h_index.vote_h_index, 0),
  COALESCE(preview_json.preview_assets_json, '[]'),
  CURRENT_TIMESTAMP
FROM missing_visions mv
LEFT JOIN preview_json
  ON preview_json.vision_id = mv.vision_id
LEFT JOIN h_index
  ON h_index.vision_id = mv.vision_id
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
  vote_h_index = excluded.vote_h_index,
  preview_assets_json = excluded.preview_assets_json,
  updated_at = CURRENT_TIMESTAMP;
