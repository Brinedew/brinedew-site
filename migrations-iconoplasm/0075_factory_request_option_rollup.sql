-- Exact factory recipe examples for the public New candidate picker.
--
-- `emulsion_id` predates factory pipelines and cannot prove a pipeline/vision
-- pair. `public_emulsion_code` is written from the immutable request snapshot
-- and is therefore the only source allowed to put previews behind a label such
-- as C9-1003. Keep this as a read model: the picker must never scan portrait
-- assets while a user types.

CREATE TABLE IF NOT EXISTS icono_generation_request_factory_option_rollup (
  public_emulsion_code TEXT PRIMARY KEY,
  emulsion_slot INTEGER NOT NULL CHECK (emulsion_slot > 0),
  image_count INTEGER NOT NULL DEFAULT 0,
  live_count INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  vote_h_index INTEGER NOT NULL DEFAULT 0,
  preview_assets_json TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_generation_request_factory_option_slot
  ON icono_generation_request_factory_option_rollup (
    emulsion_slot,
    live_count DESC,
    image_count DESC,
    score DESC,
    public_emulsion_code ASC
  );

CREATE TABLE IF NOT EXISTS icono_generation_request_factory_option_sources (
  public_emulsion_code TEXT NOT NULL,
  vision_id TEXT NOT NULL,
  PRIMARY KEY (public_emulsion_code, vision_id)
);

CREATE INDEX IF NOT EXISTS idx_icono_generation_request_factory_option_sources_vision
  ON icono_generation_request_factory_option_sources (vision_id, public_emulsion_code);

CREATE INDEX IF NOT EXISTS idx_icono_portrait_assets_public_emulsion_code
  ON icono_portrait_assets (public_emulsion_code COLLATE NOCASE, vision_id);

INSERT OR IGNORE INTO icono_generation_request_factory_option_sources (
  public_emulsion_code,
  vision_id
)
SELECT DISTINCT
  upper(trim(public_emulsion_code)),
  vision_id
FROM icono_portrait_assets
WHERE COALESCE(trim(public_emulsion_code), '') <> ''
  AND COALESCE(vision_id, '') <> '';

WITH source_assets AS (
  SELECT
    upper(trim(pa.public_emulsion_code)) AS public_emulsion_code,
    CAST(substr(pa.public_emulsion_code, instr(pa.public_emulsion_code, '-') + 1) AS INTEGER) AS emulsion_slot,
    upper(pa.gene_symbol) AS gene_symbol,
    lower(pa.asset_sha256) AS asset_sha256,
    CASE
      WHEN COALESCE(ps.current_asset_sha256, '') = pa.asset_sha256 THEN 1
      ELSE 0
    END AS is_current,
    COALESCE(vs.upvotes, 0) AS upvotes,
    COALESCE(vs.score, 0) AS score,
    COALESCE(pa.created_at, '') AS created_at
  FROM icono_portrait_assets pa
  LEFT JOIN icono_publish_state ps
    ON ps.gene_symbol = pa.gene_symbol
  LEFT JOIN icono_vote_asset_summary vs
    ON vs.gene_symbol = pa.gene_symbol
   AND vs.asset_sha256 = pa.asset_sha256
  WHERE COALESCE(trim(pa.public_emulsion_code), '') <> ''
    AND instr(pa.public_emulsion_code, '-') > 2
    AND CAST(substr(pa.public_emulsion_code, instr(pa.public_emulsion_code, '-') + 1) AS INTEGER) > 0
    AND COALESCE(pa.asset_sha256, '') <> ''
),
summary AS (
  SELECT
    public_emulsion_code,
    MAX(emulsion_slot) AS emulsion_slot,
    COUNT(*) AS image_count,
    SUM(is_current) AS live_count,
    SUM(score) AS score
  FROM source_assets
  GROUP BY public_emulsion_code
),
ranked_previews AS (
  SELECT
    public_emulsion_code,
    gene_symbol,
    asset_sha256,
    is_current,
    ROW_NUMBER() OVER (
      PARTITION BY public_emulsion_code
      ORDER BY is_current DESC, upvotes DESC, score DESC, created_at DESC, asset_sha256 ASC
    ) AS preview_rank
  FROM source_assets
),
preview_json AS (
  SELECT
    public_emulsion_code,
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
    ORDER BY public_emulsion_code ASC, preview_rank ASC
  )
  GROUP BY public_emulsion_code
),
ranked_votes AS (
  SELECT
    public_emulsion_code,
    upvotes,
    ROW_NUMBER() OVER (
      PARTITION BY public_emulsion_code
      ORDER BY upvotes DESC, asset_sha256 ASC
    ) AS approval_rank
  FROM source_assets
),
h_index AS (
  SELECT
    public_emulsion_code,
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
SELECT
  summary.public_emulsion_code,
  summary.emulsion_slot,
  summary.image_count,
  summary.live_count,
  summary.score,
  COALESCE(h_index.vote_h_index, 0),
  COALESCE(preview_json.preview_assets_json, '[]'),
  CURRENT_TIMESTAMP
FROM summary
LEFT JOIN preview_json USING (public_emulsion_code)
LEFT JOIN h_index USING (public_emulsion_code)
ON CONFLICT(public_emulsion_code) DO UPDATE SET
  emulsion_slot = excluded.emulsion_slot,
  image_count = excluded.image_count,
  live_count = excluded.live_count,
  score = excluded.score,
  vote_h_index = excluded.vote_h_index,
  preview_assets_json = excluded.preview_assets_json,
  updated_at = CURRENT_TIMESTAMP;
