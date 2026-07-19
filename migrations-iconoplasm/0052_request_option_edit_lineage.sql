-- Materialize edit ancestry only for request previews that are edited assets.
-- Ordinary assets implicitly root to themselves, so they need no stored
-- lineage fields. The runtime uses the same sparse representation.

WITH RECURSIVE
edited_targets AS (
  SELECT
    event.gene_symbol,
    event.to_asset_sha256 AS asset_sha256
  FROM icono_publish_events event
  WHERE event.action = 'edit_candidate'
    AND COALESCE(event.from_asset_sha256, '') <> ''
    AND COALESCE(event.to_asset_sha256, '') <> ''
    AND event.id = (
      SELECT MAX(chosen.id)
      FROM icono_publish_events chosen
      WHERE chosen.gene_symbol = event.gene_symbol
        AND chosen.to_asset_sha256 = event.to_asset_sha256
        AND chosen.action = 'edit_candidate'
    )
),
lineage_walk AS (
  SELECT
    target.gene_symbol,
    target.asset_sha256,
    target.asset_sha256 AS ancestor_asset_sha256,
    0 AS lineage_depth,
    json_array(target.asset_sha256) AS lineage_leaf_first_json,
    '|' || target.asset_sha256 || '|' AS seen_asset_sha256s
  FROM edited_targets target

  UNION ALL

  SELECT
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
      PARTITION BY lineage.gene_symbol, lineage.asset_sha256
      ORDER BY lineage.lineage_depth DESC, lineage.ancestor_asset_sha256 ASC
    ) AS lineage_choice_rank
  FROM lineage_walk lineage
),
lineage_metadata AS (
  SELECT
    upper(gene_symbol) AS gene_symbol,
    lower(asset_sha256) AS asset_sha256,
    lower(ancestor_asset_sha256) AS lineage_root_asset_sha256,
    lineage_depth,
    json_remove(lineage_leaf_first_json, '$[0]') AS edit_ancestor_asset_sha256s
  FROM lineage_choices
  WHERE lineage_choice_rank = 1
    AND lineage_depth > 0
),
affected_visions AS (
  SELECT DISTINCT rollup.vision_id
  FROM icono_generation_request_vision_option_rollup rollup
  JOIN json_each(rollup.preview_assets_json) preview
  JOIN lineage_metadata lineage
    ON lineage.gene_symbol = upper(json_extract(preview.value, '$.gene_symbol'))
   AND lineage.asset_sha256 = lower(json_extract(preview.value, '$.asset_sha256'))
),
ordered_preview_objects AS (
  SELECT
    rollup.vision_id,
    CAST(preview.key AS INTEGER) AS preview_index,
    CASE
      WHEN lineage.asset_sha256 IS NOT NULL THEN json_patch(
        preview.value,
        json_object(
          'lineage_root_asset_sha256', lineage.lineage_root_asset_sha256,
          'lineage_depth', lineage.lineage_depth,
          'edit_ancestor_asset_sha256s', json(lineage.edit_ancestor_asset_sha256s)
        )
      )
      ELSE preview.value
    END AS preview_object
  FROM icono_generation_request_vision_option_rollup rollup
  JOIN affected_visions affected
    ON affected.vision_id = rollup.vision_id
  JOIN json_each(rollup.preview_assets_json) preview
  LEFT JOIN lineage_metadata lineage
    ON lineage.gene_symbol = upper(json_extract(preview.value, '$.gene_symbol'))
   AND lineage.asset_sha256 = lower(json_extract(preview.value, '$.asset_sha256'))
  ORDER BY rollup.vision_id ASC, CAST(preview.key AS INTEGER) ASC
),
rebuilt_previews AS (
  SELECT
    vision_id,
    json_group_array(json(preview_object)) AS preview_assets_json
  FROM ordered_preview_objects
  GROUP BY vision_id
)
UPDATE icono_generation_request_vision_option_rollup
SET
  preview_assets_json = (
    SELECT rebuilt.preview_assets_json
    FROM rebuilt_previews rebuilt
    WHERE rebuilt.vision_id = icono_generation_request_vision_option_rollup.vision_id
  ),
  builder_version = 3,
  updated_at = CURRENT_TIMESTAMP
WHERE vision_id IN (SELECT vision_id FROM rebuilt_previews);

UPDATE icono_generation_request_vision_option_rollup
SET builder_version = 3
WHERE builder_version <> 3;
