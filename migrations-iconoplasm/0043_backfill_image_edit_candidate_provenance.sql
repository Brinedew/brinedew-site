-- Backfill provenance for image-edit candidate assets published before edits
-- inherited their source sample and emulsion lineage.
--
-- Cost fence:
-- This is a one-time admin migration over publish events and portrait assets.
-- Do not move this join into public gene-page or gallery reads; those hot paths
-- must keep reading the already-materialized portrait asset provenance columns.

WITH source_provenance AS (
  SELECT
    event.gene_symbol,
    event.to_asset_sha256 AS edited_asset_sha256,
    NULLIF(source.sample_label, '') AS sample_label,
    source.sample_number AS sample_number,
    NULLIF(source.sample_text_hash, '') AS sample_text_hash,
    CASE
      WHEN NULLIF(source.emulsion_id, '') IS NOT NULL THEN source.emulsion_id
      WHEN NULLIF(source.workflow_id, '') IS NOT NULL
        AND NULLIF(CAST(source.prompt_version AS TEXT), '') IS NOT NULL
        AND NULLIF(CAST(source.variant_slot AS TEXT), '') IS NOT NULL
        THEN source.workflow_id || source.prompt_version || '-' || source.variant_slot
      ELSE NULL
    END AS source_emulsion_id
  FROM icono_publish_events event
  JOIN icono_portrait_assets source
    ON source.gene_symbol = event.gene_symbol
   AND source.asset_sha256 = event.from_asset_sha256
  WHERE event.action = 'edit_candidate'
    AND NULLIF(event.from_asset_sha256, '') IS NOT NULL
    AND NULLIF(event.to_asset_sha256, '') IS NOT NULL
)
UPDATE icono_portrait_assets
SET
  emulsion_id = COALESCE(
    (
      SELECT substr(source_emulsion_id, 1, 62) || '-e'
      FROM source_provenance provenance
      WHERE provenance.gene_symbol = icono_portrait_assets.gene_symbol
        AND provenance.edited_asset_sha256 = icono_portrait_assets.asset_sha256
        AND NULLIF(provenance.source_emulsion_id, '') IS NOT NULL
      LIMIT 1
    ),
    emulsion_id
  ),
  sample_label = COALESCE(
    (
      SELECT sample_label
      FROM source_provenance provenance
      WHERE provenance.gene_symbol = icono_portrait_assets.gene_symbol
        AND provenance.edited_asset_sha256 = icono_portrait_assets.asset_sha256
        AND provenance.sample_label IS NOT NULL
      LIMIT 1
    ),
    sample_label
  ),
  sample_number = COALESCE(
    (
      SELECT sample_number
      FROM source_provenance provenance
      WHERE provenance.gene_symbol = icono_portrait_assets.gene_symbol
        AND provenance.edited_asset_sha256 = icono_portrait_assets.asset_sha256
        AND provenance.sample_number IS NOT NULL
      LIMIT 1
    ),
    sample_number
  ),
  sample_text_hash = COALESCE(
    (
      SELECT sample_text_hash
      FROM source_provenance provenance
      WHERE provenance.gene_symbol = icono_portrait_assets.gene_symbol
        AND provenance.edited_asset_sha256 = icono_portrait_assets.asset_sha256
        AND provenance.sample_text_hash IS NOT NULL
      LIMIT 1
    ),
    sample_text_hash
  )
WHERE COALESCE(workflow_id, '') = 'image-edit'
  AND EXISTS (
    SELECT 1
    FROM source_provenance provenance
    WHERE provenance.gene_symbol = icono_portrait_assets.gene_symbol
      AND provenance.edited_asset_sha256 = icono_portrait_assets.asset_sha256
  );
