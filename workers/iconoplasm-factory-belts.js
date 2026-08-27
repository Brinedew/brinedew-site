export const FACTORY_BELT_SIZE = 6
export const MAX_FACTORY_RECIPES = 512

// B-715: one indexed top-N seek per registered recipe, never a corpus-wide
// ROW_NUMBER ranking. Keep the predicate identical to migration 0080.
export const FACTORY_BELT_OUTPUTS_SQL = `
  SELECT value AS factory_code, (
    SELECT json_group_array(json_object(
      'gene_symbol', gene_symbol, 'asset_sha256', asset_sha256,
      'emulsion_id', emulsion_id, 'width', width, 'height', height,
      'created_at', created_at, 'status', status
    )) FROM (
      SELECT gene_symbol, asset_sha256, emulsion_id, width, height, created_at, status
      FROM icono_portrait_assets
      WHERE substr(emulsion_id, 1, instr(emulsion_id, '-') - 1) = recipes.value
        AND emulsion_id GLOB '[A-Z][1-9]*-[1-9]*'
        AND substr(emulsion_id, instr(emulsion_id, '-') + 1) NOT GLOB '*[^0-9]*'
      ORDER BY created_at DESC, gene_symbol, asset_sha256
      LIMIT ?
    )
  ) AS outputs_json
  FROM json_each(?) AS recipes`

export async function readFactoryBelts({ db, pipelines, visions, active, portraitUrl }) {
  const recipes = []
  const revisions = [...new Set(visions.map((v) => Number(v.revision)))].filter(
    (v) => Number.isInteger(v) && v > 0,
  )
  for (const pipeline of pipelines) {
    for (const revision of revisions) {
      recipes.push({
        code: pipeline.code + revision,
        pipeline: pipeline.code,
        vision: revision,
        label: pipeline.label,
        status: pipeline.status,
        recommended: revision === Number(pipeline.recommended_vision),
        active: pipeline.code === active.pipeline && revision === active.vision,
      })
    }
  }
  if (recipes.length > MAX_FACTORY_RECIPES)
    throw new Error("Factory recipe capacity exceeded; add recipe pagination before expanding.")
  const [outputs, requests] = await Promise.all([
    db
      .prepare(FACTORY_BELT_OUTPUTS_SQL)
      .bind(FACTORY_BELT_SIZE, JSON.stringify(recipes.map((r) => r.code)))
      .all(),
    db
      .prepare(
        `SELECT factory_pipeline_code || factory_vision_revision AS factory_code,
                       COUNT(*) AS open_count
                  FROM icono_generation_requests
                 WHERE status = 'open'
                 GROUP BY factory_pipeline_code, factory_vision_revision`,
      )
      .all(),
  ])
  const assetsByRecipe = new Map(
    outputs.results.map((row) => [row.factory_code, JSON.parse(row.outputs_json || "[]")]),
  )
  const openByRecipe = new Map(
    requests.results.map((row) => [row.factory_code, Number(row.open_count)]),
  )
  const belts = recipes
    .map((recipe) => ({
      ...recipe,
      open_count: openByRecipe.get(recipe.code) || 0,
      outputs: (assetsByRecipe.get(recipe.code) || []).map((asset) => ({
        ...asset,
        full_url: portraitUrl(asset.asset_sha256, "full"),
        thumb_url: portraitUrl(asset.asset_sha256, "medium"),
      })),
    }))
    .filter((belt) => belt.outputs.length || belt.open_count || belt.active || belt.recommended)
  return { ok: true, per_belt: FACTORY_BELT_SIZE, belts }
}
