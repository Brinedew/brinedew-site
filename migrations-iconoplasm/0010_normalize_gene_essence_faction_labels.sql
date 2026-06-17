-- Clean cutover: public Iconoplasm cards accept only the canonical faction
-- labels produced by the NiceGUI sync pipeline.
--
-- Legacy values like Development / Quiescence / Housekeeper were left in D1
-- from older syncs. Normalize them in-place so the website and extension do
-- not need semantic fallback logic in the renderer.

UPDATE icono_gene_essence
SET
  faction = CASE
    WHEN lower(trim(replace(replace(faction, '_', ' '), '-', ' '))) IN ('development', 'pro growth', 'progrowth') THEN 'pro-growth'
    WHEN lower(trim(replace(replace(faction, '_', ' '), '-', ' '))) IN ('protection', 'quiescence', 'pro control', 'procontrol') THEN 'pro-control'
    WHEN lower(trim(replace(replace(faction, '_', ' '), '-', ' '))) IN ('opportunist', 'turncoat', 'contextual') THEN 'turncoat'
    WHEN lower(trim(replace(replace(faction, '_', ' '), '-', ' '))) IN ('neutral', 'housekeeper', '') THEN NULL
    ELSE faction
  END,
  politics_origin_json = CASE
    WHEN lower(trim(replace(replace(faction, '_', ' '), '-', ' '))) IN ('neutral', 'housekeeper', '') THEN '[]'
    ELSE politics_origin_json
  END,
  updated_at = CURRENT_TIMESTAMP
WHERE faction IS NOT NULL;
