-- Repair and version the specific-emulsion request picker projection.
--
-- The production finalization path updates vision rollups in batches. Until
-- v2, that batched path did not refresh this dependent picker projection, so
-- rows could remain frozen for months even though finalization reported
-- success. Rebuild once from canonical portrait/publish truth during deploy;
-- subsequent mutations are maintained incrementally by the Worker.

ALTER TABLE icono_generation_request_vision_option_rollup
  ADD COLUMN builder_version INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS idx_icono_generation_request_vision_option_rollup_priority;
DROP INDEX IF EXISTS idx_icono_generation_request_vision_option_rollup_emulsion;
DROP INDEX IF EXISTS idx_icono_generation_request_vision_option_rollup_artist;

CREATE INDEX idx_icono_generation_request_vision_option_rollup_priority
  ON icono_generation_request_vision_option_rollup (
    builder_version,
    vote_h_index DESC,
    live_count DESC,
    score DESC,
    image_count DESC,
    vision_id ASC
  );

CREATE INDEX idx_icono_generation_request_vision_option_rollup_emulsion
  ON icono_generation_request_vision_option_rollup (
    builder_version,
    emulsion_id,
    vote_h_index DESC,
    live_count DESC,
    score DESC,
    image_count DESC,
    vision_id ASC
  );

CREATE INDEX idx_icono_generation_request_vision_option_rollup_artist
  ON icono_generation_request_vision_option_rollup (
    builder_version,
    artist_tag,
    vote_h_index DESC,
    live_count DESC,
    score DESC,
    image_count DESC,
    vision_id ASC
  );

WITH source_summary AS (
  SELECT
    pa.vision_id,
    COALESCE(MAX(NULLIF(pa.emulsion_id, '')), '') AS emulsion_id,
    COALESCE(MAX(NULLIF(pa.workflow_id, '')), '') AS workflow_id,
    COALESCE(MAX(NULLIF(pa.workflow_label, '')), '') AS workflow_label,
    COALESCE(MAX(NULLIF(pa.prompt_version, '')), '') AS prompt_version,
    COALESCE(MAX(NULLIF(pa.variant_slot, '')), '') AS variant_slot,
    COALESCE(MAX(NULLIF(pa.artist_tag, '')), '') AS artist_tag,
    COALESCE(MAX(NULLIF(pa.artist_name, '')), '') AS artist_name,
    COUNT(*) AS image_count,
    COALESCE(SUM(
      CASE
        WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
        ELSE 0
      END
    ), 0) AS live_count,
    COALESCE(SUM(COALESCE(vs.score, 0)), 0) AS score
  FROM icono_portrait_assets pa
  LEFT JOIN icono_publish_state ps
    ON ps.gene_symbol = pa.gene_symbol
  LEFT JOIN icono_vote_asset_summary vs
    ON vs.gene_symbol = pa.gene_symbol
   AND vs.asset_sha256 = pa.asset_sha256
  WHERE COALESCE(pa.vision_id, '') <> ''
    AND lower(COALESCE(pa.vision_id, '')) NOT LIKE 'artist-random-%'
  GROUP BY pa.vision_id
),
ranked_previews AS (
  SELECT
    pa.vision_id,
    upper(pa.gene_symbol) AS gene_symbol,
    lower(pa.asset_sha256) AS asset_sha256,
    CASE
      WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
      ELSE 0
    END AS is_current,
    ROW_NUMBER() OVER (
      PARTITION BY pa.vision_id
      ORDER BY
        CASE
          WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
          ELSE 0
        END DESC,
        COALESCE(vs.upvotes, 0) DESC,
        COALESCE(vs.score, 0) DESC,
        COALESCE(pa.created_at, '') DESC,
        pa.asset_sha256 ASC
    ) AS preview_rank
  FROM icono_portrait_assets pa
  INNER JOIN source_summary source
    ON source.vision_id = pa.vision_id
  LEFT JOIN icono_publish_state ps
    ON ps.gene_symbol = pa.gene_symbol
  LEFT JOIN icono_vote_asset_summary vs
    ON vs.gene_symbol = pa.gene_symbol
   AND vs.asset_sha256 = pa.asset_sha256
  WHERE COALESCE(pa.asset_sha256, '') <> ''
),
preview_json AS (
  SELECT
    vision_id,
    json_group_array(
      json_object(
        'vision_id', vision_id,
        'gene_symbol', gene_symbol,
        'asset_sha256', asset_sha256,
        'is_current', is_current,
        'preview_rank', preview_rank
      )
    ) AS preview_assets_json
  FROM (
    SELECT
      vision_id,
      gene_symbol,
      asset_sha256,
      is_current,
      preview_rank
    FROM ranked_previews
    WHERE preview_rank <= 5
    ORDER BY vision_id ASC, preview_rank ASC
  ) ordered_previews
  GROUP BY vision_id
),
ranked_votes AS (
  SELECT
    pa.vision_id,
    COALESCE(vs.upvotes, 0) AS upvotes,
    ROW_NUMBER() OVER (
      PARTITION BY pa.vision_id
      ORDER BY COALESCE(vs.upvotes, 0) DESC, pa.asset_sha256 ASC
    ) AS approval_rank
  FROM icono_portrait_assets pa
  INNER JOIN source_summary source
    ON source.vision_id = pa.vision_id
  LEFT JOIN icono_vote_asset_summary vs
    ON vs.gene_symbol = pa.gene_symbol
   AND vs.asset_sha256 = pa.asset_sha256
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
  builder_version,
  updated_at
)
SELECT
  source.vision_id,
  source.emulsion_id,
  source.workflow_id,
  source.workflow_label,
  source.prompt_version,
  source.variant_slot,
  source.artist_tag,
  source.artist_name,
  source.image_count,
  source.live_count,
  source.score,
  COALESCE(h_index.vote_h_index, 0),
  COALESCE(preview_json.preview_assets_json, '[]'),
  2,
  CURRENT_TIMESTAMP
FROM source_summary source
LEFT JOIN preview_json
  ON preview_json.vision_id = source.vision_id
LEFT JOIN h_index
  ON h_index.vision_id = source.vision_id
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
  builder_version = excluded.builder_version,
  updated_at = CURRENT_TIMESTAMP;

-- Remove projection rows whose source vision no longer exists. This is a
-- bounded one-time cleanup; the fixed mutation path handles future deletes.
DELETE FROM icono_generation_request_vision_option_rollup
WHERE NOT EXISTS (
  SELECT 1
  FROM icono_portrait_assets pa
  WHERE pa.vision_id = icono_generation_request_vision_option_rollup.vision_id
    AND lower(COALESCE(pa.vision_id, '')) NOT LIKE 'artist-random-%'
);
