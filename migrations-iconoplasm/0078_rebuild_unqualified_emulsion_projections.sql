UPDATE icono_generation_request_vision_option_rollup
SET emulsion_id =
      '0-' || CAST(substr(emulsion_id, instr(emulsion_id, '-') + 1) AS INTEGER) ||
      CASE WHEN lower(emulsion_id) GLOB '*-e' THEN '-e' ELSE '' END,
    emulsion_family_id =
      '0-' || CAST(substr(emulsion_id, instr(emulsion_id, '-') + 1) AS INTEGER)
WHERE emulsion_id GLOB '[A-Za-z][0-9]*-[0-9]*'
  AND CAST(substr(emulsion_id, instr(emulsion_id, '-') + 1) AS INTEGER) > 0;

UPDATE icono_admin_vision_rollup
SET emulsion_id =
      '0-' || CAST(substr(emulsion_id, instr(emulsion_id, '-') + 1) AS INTEGER) ||
      CASE WHEN lower(emulsion_id) GLOB '*-e' THEN '-e' ELSE '' END
WHERE emulsion_id GLOB '[A-Za-z][0-9]*-[0-9]*'
  AND CAST(substr(emulsion_id, instr(emulsion_id, '-') + 1) AS INTEGER) > 0;

UPDATE icono_admin_gene_rollup AS rollup
SET live_emulsion_id = (
  SELECT asset.emulsion_id
  FROM icono_portrait_assets AS asset
  WHERE asset.gene_symbol = rollup.gene_symbol
    AND asset.asset_sha256 = rollup.current_asset_sha256
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM icono_portrait_assets AS asset
  WHERE asset.gene_symbol = rollup.gene_symbol
    AND asset.asset_sha256 = rollup.current_asset_sha256
);

UPDATE icono_admin_gene_rollup AS rollup
SET leader_emulsion_id = (
  SELECT asset.emulsion_id
  FROM icono_portrait_assets AS asset
  WHERE asset.gene_symbol = rollup.gene_symbol
    AND asset.asset_sha256 = rollup.leader_asset_sha256
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1
  FROM icono_portrait_assets AS asset
  WHERE asset.gene_symbol = rollup.gene_symbol
    AND asset.asset_sha256 = rollup.leader_asset_sha256
);

INSERT OR IGNORE INTO icono_user_emulsion_favorites (user_id, emulsion_family_id, created_at)
SELECT
  user_id,
  '0-' || CAST(substr(emulsion_family_id, instr(emulsion_family_id, '-') + 1) AS INTEGER),
  created_at
FROM icono_user_emulsion_favorites
WHERE emulsion_family_id GLOB '[A-Za-z][0-9]*-[0-9]*'
  AND CAST(substr(emulsion_family_id, instr(emulsion_family_id, '-') + 1) AS INTEGER) > 0;

DELETE FROM icono_user_emulsion_favorites
WHERE emulsion_family_id GLOB '[A-Za-z][0-9]*-[0-9]*'
  AND CAST(substr(emulsion_family_id, instr(emulsion_family_id, '-') + 1) AS INTEGER) > 0;
