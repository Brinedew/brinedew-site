// Manifestation prose/tags belong exclusively to the authoring authority.
// Bulk essence publication writes character metadata, never that private source.
const FIELDS = [
  "gene_symbol",
  "full_name",
  "weight_kg",
  "molecular_weight_kda",
  "height_cm",
  "sex",
  "age",
  "age_years",
  "first_publication_year",
  "faction",
  "skin_hex",
  "skin_name",
  "tissue_tau",
  "primary_tissue",
  "loeuf",
  "constraint_percentile",
  "leakage_percent",
  "leakage_hits",
  "leakage_total",
  "aesthetics_json",
  "aesthetics_origin_json",
  "politics_origin_json",
  "family_surname",
  "family_members",
  "family_feature",
  "sample_label",
  "sample_number",
  "sample_text_hash",
]

const SQL = `INSERT INTO icono_gene_essence (
  ${FIELDS.join(", ")}, source, updated_by, updated_at
) VALUES (${FIELDS.map(() => "?").join(", ")}, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(gene_symbol) DO UPDATE SET
  ${FIELDS.slice(1)
    .map((field) => `${field}=excluded.${field}`)
    .join(", ")},
  source=excluded.source, updated_by=excluded.updated_by, updated_at=CURRENT_TIMESTAMP`

export function prepareGeneEssenceUpsertStatement(
  env,
  essence,
  updatedBy,
  source = "nicegui_sync",
) {
  if (!env.ICONOPLASM_DB || !essence?.gene_symbol) return null
  return env.ICONOPLASM_DB.prepare(SQL).bind(
    ...FIELDS.map((field) => essence[field] ?? null),
    String(source || "nicegui_sync").slice(0, 64),
    (String(updatedBy || "nicegui_sync").trim() || "local").slice(0, 255),
  )
}
