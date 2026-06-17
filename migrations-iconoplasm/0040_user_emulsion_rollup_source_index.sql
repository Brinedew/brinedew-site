-- User-emulsion request-picker examples are a derived read model.
-- Source of truth: icono_portrait_assets.emulsion_id plus publish_state currentness.
-- Do not make the picker API scan icono_portrait_assets on demand; that would put a
-- public authenticated UI path back on the large portrait table. This migration is
-- the one-time repair: add the targeted source index, then rebuild every existing
-- emulsion rollup from source rows so old imported/generated assets get examples.
CREATE INDEX IF NOT EXISTS idx_icono_portrait_assets_emulsion_status_created
ON icono_portrait_assets (emulsion_id, status, created_at DESC, gene_symbol, asset_sha256);

DELETE FROM icono_user_emulsion_option_rollup;

INSERT INTO icono_user_emulsion_option_rollup (
  emulsion_id,
  image_count,
  live_count,
  preview_assets_json,
  updated_at
)
WITH source_assets AS (
  SELECT
    pa.emulsion_id,
    pa.gene_symbol,
    pa.asset_sha256,
    pa.created_at,
    lower(COALESCE(pa.status, '')) AS status,
    CASE
      WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
      ELSE 0
    END AS is_current
  FROM icono_portrait_assets pa
  LEFT JOIN icono_publish_state ps
    ON ps.gene_symbol = pa.gene_symbol
  WHERE COALESCE(pa.emulsion_id, '') <> ''
    AND COALESCE(pa.asset_sha256, '') <> ''
    AND lower(COALESCE(pa.status, '')) <> 'rejected'
),
summary AS (
  SELECT
    emulsion_id,
    COUNT(*) AS image_count,
    COALESCE(SUM(is_current), 0) AS live_count
  FROM source_assets
  GROUP BY emulsion_id
),
ranked_previews AS (
  SELECT
    emulsion_id,
    gene_symbol,
    asset_sha256,
    is_current,
    ROW_NUMBER() OVER (
      PARTITION BY emulsion_id
      ORDER BY
        is_current DESC,
        CASE WHEN status = 'approved' THEN 1 ELSE 0 END DESC,
        COALESCE(created_at, '') DESC,
        asset_sha256 ASC
    ) AS preview_rank
  FROM source_assets
),
preview_assets AS (
  SELECT
    emulsion_id,
    json_group_array(
      json_object(
        'gene_symbol', gene_symbol,
        'asset_sha256', asset_sha256,
        'is_current', is_current,
        'preview_rank', preview_rank
      )
    ) AS preview_assets_json
  FROM (
    SELECT *
    FROM ranked_previews
    WHERE preview_rank <= 5
    ORDER BY emulsion_id ASC, preview_rank ASC
  )
  GROUP BY emulsion_id
)
SELECT
  summary.emulsion_id,
  summary.image_count,
  summary.live_count,
  COALESCE(preview_assets.preview_assets_json, '[]'),
  CURRENT_TIMESTAMP
FROM summary
LEFT JOIN preview_assets
  ON preview_assets.emulsion_id = summary.emulsion_id;
