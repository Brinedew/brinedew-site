-- B-715: index the normalized, provenance-qualified emulsion identity, not
-- legacy vision aliases or today's active recipe. No copied image read model.
-- The partial index excludes unqualified historical outputs (0-<slot>).
CREATE INDEX IF NOT EXISTS idx_icono_portrait_assets_factory_recent
ON icono_portrait_assets (
  substr(emulsion_id, 1, instr(emulsion_id, '-') - 1),
  created_at DESC, gene_symbol, asset_sha256
)
WHERE emulsion_id GLOB '[A-Z][1-9]*-[1-9]*'
  AND substr(emulsion_id, instr(emulsion_id, '-') + 1) NOT GLOB '*[^0-9]*';
