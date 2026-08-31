import { readPublicCanonicalMaterial } from "./iconoplasm/caretaker/manifestation-public-canonical-material.js"

export const PUBLIC_CANONICAL_MATERIALIZATION_BATCH_LIMIT = 7
const MATERIAL_READ_CONCURRENCY = 4

export class IconoplasmPublicCanonicalRuntimeError extends Error {
  constructor(code, message, status = 503) {
    super(message)
    this.name = "IconoplasmPublicCanonicalRuntimeError"
    this.code = code
    this.status = status
  }
}

async function authorityMode(primaryDb) {
  if (!primaryDb?.prepare) {
    throw new IconoplasmPublicCanonicalRuntimeError(
      "PUBLIC_CANONICAL_PRIMARY_DB_REQUIRED",
      "ICONOPLASM_DB binding is required",
    )
  }
  const row = await primaryDb
    .prepare(
      `SELECT mode FROM icono_manifestation_projection_authority
        WHERE singleton = 1`,
    )
    .first()
  if (!row) {
    throw new IconoplasmPublicCanonicalRuntimeError(
      "PUBLIC_CANONICAL_AUTHORITY_STATE_MISSING",
      "Manifestation projection authority state is missing",
    )
  }
  return String(row.mode || "").trim()
}

function publicProjection(material) {
  if (!material.canonical) return null
  const derivative = material.accepted_tags_derivative
  return Object.freeze({
    schema_version: Number(material.schema_version),
    gene_id: material.gene_id,
    manifestation_id: material.canonical.manifestation_id,
    manifestation_revision_id: material.canonical.manifestation_revision_id,
    canonical_selection_id: material.canonical.canonical_selection_id,
    head_version: Number(material.head_version),
    gene_revision: Number(material.gene_revision),
    authority_event_id: material.authority_event_id,
    authority_event_sequence: Number(material.authority_event_sequence),
    body_sha256: material.canonical.body_sha256,
    body_bytes: Number(material.canonical.body_bytes),
    prose: material.canonical.prose,
    accepted_tags_derivative: derivative
      ? Object.freeze({
          manifestation_derivative_id: derivative.manifestation_derivative_id,
          derivative_head_version: Number(derivative.derivative_head_version),
          body_sha256: derivative.body_sha256,
          body_bytes: Number(derivative.body_bytes),
          tags_sha256: derivative.tags_sha256,
          tags_bytes: Number(derivative.tags_bytes),
          fields_sha256: derivative.fields_sha256,
          fields_bytes: Number(derivative.fields_bytes),
          recipe_id: derivative.recipe_id,
          recipe_version: derivative.recipe_version,
          provider_id: derivative.provider_id,
          model_id: derivative.model_id,
          tagger_config_sha256: derivative.tagger_config_sha256,
          provenance_status: derivative.provenance_status,
          tags_text: derivative.tags_text,
          fields_json: derivative.fields_json,
        })
      : null,
  })
}

async function hydrateOne(env, record, readMaterial) {
  const canonicalSymbol = String(record?.canonical_symbol || record?.symbol || "")
    .trim()
    .toUpperCase()
  if (!canonicalSymbol) {
    throw new IconoplasmPublicCanonicalRuntimeError(
      "PUBLIC_CANONICAL_SYMBOL_REQUIRED",
      "A canonical gene symbol is required for public material hydration",
      500,
    )
  }
  const material = await readMaterial({
    primaryDb: env.ICONOPLASM_DB,
    authoringDb: env.ICONOPLASM_AUTHORING_DB,
    env,
    canonicalSymbol,
    onIntegrityFailure: env.onPublicCanonicalIntegrityFailure,
  })
  return Object.freeze({
    ...record,
    canonical_manifestation: publicProjection(material),
  })
}

export async function hydratePublicCanonicalGeneRecords(
  env,
  records,
  { readMaterial = readPublicCanonicalMaterial } = {},
) {
  const input = Array.isArray(records) ? records : []
  const mode = await authorityMode(env?.ICONOPLASM_DB)
  if (mode === "legacy_write") return input
  if (input.length > PUBLIC_CANONICAL_MATERIALIZATION_BATCH_LIMIT) {
    throw new IconoplasmPublicCanonicalRuntimeError(
      "PUBLIC_CANONICAL_BATCH_TOO_LARGE",
      `Public canonical hydration is limited to ${PUBLIC_CANONICAL_MATERIALIZATION_BATCH_LIMIT} genes per durable step`,
      400,
    )
  }
  if (mode === "shadow_frozen") {
    throw new IconoplasmPublicCanonicalRuntimeError(
      "PUBLIC_CANONICAL_CUTOVER_NOT_ACTIVE",
      "Public card publication is paused while manifestation authority is shadow-frozen",
      409,
    )
  }
  if (!new Set(["authoritative", "recovery_read_only"]).has(mode)) {
    throw new IconoplasmPublicCanonicalRuntimeError(
      "PUBLIC_CANONICAL_AUTHORITY_MODE_INVALID",
      "Manifestation projection authority mode is invalid",
    )
  }
  if (!env?.ICONOPLASM_AUTHORING_DB) {
    throw new IconoplasmPublicCanonicalRuntimeError(
      "PUBLIC_CANONICAL_AUTHORING_DB_REQUIRED",
      "ICONOPLASM_AUTHORING_DB binding is required after authority cutover",
    )
  }
  const output = new Array(input.length)
  let nextIndex = 0
  const workers = Array.from(
    { length: Math.min(MATERIAL_READ_CONCURRENCY, input.length) },
    async () => {
      while (nextIndex < input.length) {
        const index = nextIndex
        nextIndex += 1
        output[index] = await hydrateOne(env, input[index], readMaterial)
      }
    },
  )
  await Promise.all(workers)
  return output
}

export async function hydratePublicCanonicalGeneRecord(env, record, dependencies) {
  if (!record) return record
  const [hydrated] = await hydratePublicCanonicalGeneRecords(env, [record], dependencies)
  return hydrated
}
