-- Give request-option previews explicit edit ancestry. Family strips can then
-- replace an original with its edited descendant without conflating sibling
-- edits or unrelated images that happen to share a gene or emulsion.

CREATE INDEX IF NOT EXISTS idx_icono_publish_events_edit_lineage
  ON icono_publish_events (gene_symbol, to_asset_sha256, action, id DESC);

WITH RECURSIVE
source_summary AS (
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
source_assets AS (
  SELECT
    pa.vision_id,
    pa.gene_symbol,
    pa.asset_sha256,
    pa.created_at
  FROM icono_portrait_assets pa
  INNER JOIN source_summary source
    ON source.vision_id = pa.vision_id
  WHERE COALESCE(pa.asset_sha256, '') <> ''
),
lineage_walk AS (
  SELECT
    pa.vision_id,
    pa.gene_symbol,
    pa.asset_sha256,
    pa.asset_sha256 AS ancestor_asset_sha256,
    0 AS lineage_depth,
    json_array(pa.asset_sha256) AS lineage_leaf_first_json,
    '|' || pa.asset_sha256 || '|' AS seen_asset_sha256s
  FROM source_assets pa

  UNION ALL

  SELECT
    lineage.vision_id,
    lineage.gene_symbol,
    lineage.asset_sha256,
    event.from_asset_sha256,
    lineage.lineage_depth + 1,
    json_insert(lineage.lineage_leaf_first_json, '$[#]', event.from_asset_sha256),
    lineage.seen_asset_sha256s || event.from_asset_sha256 || '|'
  FROM lineage_walk lineage
  JOIN icono_publish_events event
    ON event.gene_symbol = lineage.gene_symbol
   AND event.to_asset_sha256 = lineage.ancestor_asset_sha256
   AND event.action = 'edit_candidate'
  WHERE lineage.lineage_depth < 32
    AND COALESCE(event.from_asset_sha256, '') <> ''
    AND instr(
      lineage.seen_asset_sha256s,
      '|' || event.from_asset_sha256 || '|'
    ) = 0
    AND event.id = (
      SELECT MAX(chosen.id)
      FROM icono_publish_events chosen
      WHERE chosen.gene_symbol = event.gene_symbol
        AND chosen.to_asset_sha256 = event.to_asset_sha256
        AND chosen.action = 'edit_candidate'
    )
),
lineage_choices AS (
  SELECT
    lineage.*,
    ROW_NUMBER() OVER (
      PARTITION BY lineage.vision_id, lineage.gene_symbol, lineage.asset_sha256
      ORDER BY lineage.lineage_depth DESC, lineage.ancestor_asset_sha256 ASC
    ) AS lineage_choice_rank
  FROM lineage_walk lineage
),
ranked_previews AS (
  SELECT
    pa.vision_id,
    upper(pa.gene_symbol) AS gene_symbol,
    lower(pa.asset_sha256) AS asset_sha256,
    lower(lineage.ancestor_asset_sha256) AS lineage_root_asset_sha256,
    lineage.lineage_depth,
    json_remove(lineage.lineage_leaf_first_json, '$[0]')
      AS edit_ancestor_asset_sha256s,
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
  FROM source_assets pa
  JOIN lineage_choices lineage
    ON lineage.vision_id = pa.vision_id
   AND lineage.gene_symbol = pa.gene_symbol
   AND lineage.asset_sha256 = pa.asset_sha256
   AND lineage.lineage_choice_rank = 1
  LEFT JOIN icono_publish_state ps
    ON ps.gene_symbol = pa.gene_symbol
  LEFT JOIN icono_vote_asset_summary vs
    ON vs.gene_symbol = pa.gene_symbol
   AND vs.asset_sha256 = pa.asset_sha256
),
preview_json AS (
  SELECT
    vision_id,
    json_group_array(
      json_object(
        'vision_id', vision_id,
        'gene_symbol', gene_symbol,
        'asset_sha256', asset_sha256,
        'lineage_root_asset_sha256', lineage_root_asset_sha256,
        'lineage_depth', lineage_depth,
        'edit_ancestor_asset_sha256s', json(edit_ancestor_asset_sha256s),
        'is_current', is_current,
        'preview_rank', preview_rank
      )
    ) AS preview_assets_json
  FROM (
    SELECT
      vision_id,
      gene_symbol,
      asset_sha256,
      lineage_root_asset_sha256,
      lineage_depth,
      edit_ancestor_asset_sha256s,
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
  FROM source_assets pa
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
  3,
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

DELETE FROM icono_generation_request_vision_option_rollup
WHERE NOT EXISTS (
  SELECT 1
  FROM icono_portrait_assets pa
  WHERE pa.vision_id = icono_generation_request_vision_option_rollup.vision_id
    AND lower(COALESCE(pa.vision_id, '')) NOT LIKE 'artist-random-%'
);
