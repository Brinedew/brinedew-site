-- A portrait has one canonical emulsion identity. Exact factory lineage comes
-- only from the immutable request snapshot; historical factory-shaped labels
-- without that provenance are explicitly unqualified as 0-<slot>.

UPDATE icono_portrait_assets AS asset
SET emulsion_id = (
  SELECT
    upper(trim(request.factory_pipeline_code)) ||
    CAST(request.factory_vision_revision AS TEXT) || '-' ||
    CAST(request.requested_emulsion_slot AS TEXT)
  FROM icono_generation_requests AS request
  JOIN icono_diagnostic_matrix_cells AS cell
    ON cell.generation_request_id = request.id
  WHERE request.gene_symbol = asset.gene_symbol
    AND request.fulfilled_asset_sha256 = asset.asset_sha256
    AND length(trim(request.factory_pipeline_code)) = 1
    AND upper(trim(request.factory_pipeline_code)) GLOB '[A-Z]'
    AND request.factory_vision_revision > 0
    AND request.requested_emulsion_slot > 0
  ORDER BY request.id DESC
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM icono_generation_requests AS request
  JOIN icono_diagnostic_matrix_cells AS cell
    ON cell.generation_request_id = request.id
  WHERE request.gene_symbol = asset.gene_symbol
    AND request.fulfilled_asset_sha256 = asset.asset_sha256
    AND length(trim(request.factory_pipeline_code)) = 1
    AND upper(trim(request.factory_pipeline_code)) GLOB '[A-Z]'
    AND request.factory_vision_revision > 0
    AND request.requested_emulsion_slot > 0
);

UPDATE icono_portrait_assets
SET emulsion_id =
  '0-' ||
  CAST(substr(emulsion_id, instr(emulsion_id, '-') + 1) AS INTEGER) ||
  CASE WHEN lower(emulsion_id) GLOB '*-e' THEN '-e' ELSE '' END
WHERE emulsion_id GLOB '[A-Za-z][0-9]*-[0-9]*'
  AND CAST(substr(emulsion_id, instr(emulsion_id, '-') + 1) AS INTEGER) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM icono_generation_requests AS request
    JOIN icono_diagnostic_matrix_cells AS cell
      ON cell.generation_request_id = request.id
    WHERE request.gene_symbol = icono_portrait_assets.gene_symbol
      AND request.fulfilled_asset_sha256 = icono_portrait_assets.asset_sha256
      AND length(trim(request.factory_pipeline_code)) = 1
      AND upper(trim(request.factory_pipeline_code)) GLOB '[A-Z]'
      AND request.factory_vision_revision > 0
      AND request.requested_emulsion_slot > 0
  );

DELETE FROM icono_generation_request_factory_option_sources;

INSERT INTO icono_generation_request_factory_option_sources (public_emulsion_code, vision_id)
SELECT DISTINCT upper(trim(pa.emulsion_id)), pa.vision_id
FROM icono_portrait_assets AS pa
WHERE COALESCE(pa.vision_id, '') <> ''
  AND substr(upper(trim(pa.emulsion_id)), 1, 1) GLOB '[A-Z]'
  AND instr(pa.emulsion_id, '-') >= 3
  AND substr(pa.emulsion_id, 2, instr(pa.emulsion_id, '-') - 2) <> ''
  AND substr(pa.emulsion_id, 2, instr(pa.emulsion_id, '-') - 2) NOT GLOB '*[^0-9]*'
  AND substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) <> ''
  AND substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) NOT GLOB '*[^0-9]*';

DELETE FROM icono_generation_request_factory_option_rollup;

WITH source_assets AS (
  SELECT
    upper(trim(pa.emulsion_id)) AS public_emulsion_code,
    CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) AS emulsion_slot,
    upper(pa.gene_symbol) AS gene_symbol,
    lower(pa.asset_sha256) AS asset_sha256,
    CASE WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1 ELSE 0 END AS is_current,
    COALESCE(vs.upvotes, 0) AS upvotes,
    COALESCE(vs.score, 0) AS score,
    COALESCE(pa.created_at, '') AS created_at
  FROM icono_portrait_assets AS pa
  LEFT JOIN icono_publish_state AS ps ON ps.gene_symbol = pa.gene_symbol
  LEFT JOIN icono_vote_asset_summary AS vs
    ON vs.gene_symbol = pa.gene_symbol
   AND vs.asset_sha256 = pa.asset_sha256
  WHERE substr(upper(trim(pa.emulsion_id)), 1, 1) GLOB '[A-Z]'
    AND instr(pa.emulsion_id, '-') >= 3
    AND substr(pa.emulsion_id, 2, instr(pa.emulsion_id, '-') - 2) <> ''
    AND substr(pa.emulsion_id, 2, instr(pa.emulsion_id, '-') - 2) NOT GLOB '*[^0-9]*'
    AND substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) <> ''
    AND substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) NOT GLOB '*[^0-9]*'
    AND CAST(substr(pa.emulsion_id, instr(pa.emulsion_id, '-') + 1) AS INTEGER) > 0
    AND COALESCE(pa.asset_sha256, '') <> ''
),
summary AS (
  SELECT public_emulsion_code, MAX(emulsion_slot) AS emulsion_slot, COUNT(*) AS image_count,
         SUM(is_current) AS live_count, SUM(score) AS score
  FROM source_assets
  GROUP BY public_emulsion_code
),
ranked_previews AS (
  SELECT public_emulsion_code, gene_symbol, asset_sha256, is_current,
         ROW_NUMBER() OVER (
           PARTITION BY public_emulsion_code
           ORDER BY is_current DESC, upvotes DESC, score DESC, created_at DESC, asset_sha256 ASC
         ) AS preview_rank
  FROM source_assets
),
preview_json AS (
  SELECT public_emulsion_code,
         json_group_array(json_object(
           'gene_symbol', gene_symbol,
           'asset_sha256', asset_sha256,
           'is_current', is_current,
           'preview_rank', preview_rank
         )) AS preview_assets_json
  FROM (
    SELECT * FROM ranked_previews
    WHERE preview_rank <= 5
    ORDER BY public_emulsion_code ASC, preview_rank ASC
  )
  GROUP BY public_emulsion_code
),
ranked_votes AS (
  SELECT public_emulsion_code, upvotes,
         ROW_NUMBER() OVER (
           PARTITION BY public_emulsion_code
           ORDER BY upvotes DESC, asset_sha256 ASC
         ) AS approval_rank
  FROM source_assets
),
h_index AS (
  SELECT public_emulsion_code,
         MAX(CASE WHEN upvotes >= approval_rank THEN approval_rank ELSE 0 END) AS vote_h_index
  FROM ranked_votes
  GROUP BY public_emulsion_code
)
INSERT INTO icono_generation_request_factory_option_rollup (
  public_emulsion_code,
  emulsion_slot,
  image_count,
  live_count,
  score,
  vote_h_index,
  preview_assets_json,
  updated_at
)
SELECT summary.public_emulsion_code, summary.emulsion_slot, summary.image_count,
       summary.live_count, summary.score, COALESCE(h_index.vote_h_index, 0),
       COALESCE(preview_json.preview_assets_json, '[]'), CURRENT_TIMESTAMP
FROM summary
LEFT JOIN preview_json USING (public_emulsion_code)
LEFT JOIN h_index USING (public_emulsion_code);
