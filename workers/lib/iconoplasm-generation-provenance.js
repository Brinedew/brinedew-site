// B-1065: a generation request is bound to the exact text and Tags it was made
// from. Both come from the plain text tables of main migration 0125: the
// gene's current text, and later the same text by its ID, checked against the
// hashes the request carries. One D1 read each, no Bunny.
//
// The wire format is the one the old manifestation authority produced, so
// requests made before the switch still validate: their revision ID is the
// text's ID, and the backfill kept the text and Tags byte for byte.
import { readGeneText, readGeneTextVersion, withProse } from "./iconoplasm-gene-text.js"
import { sha256Hex } from "./iconoplasm-sha256.js"

const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/
const SHA256 = /^[a-f0-9]{64}$/

export class IconoplasmGenerationSourceError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = "IconoplasmGenerationSourceError"
    this.code = code
    this.status = status
  }
}

function sourceError(code, message, status = 409) {
  return new IconoplasmGenerationSourceError(code, message, status)
}

function stringValue(raw) {
  return String(raw || "").trim()
}

function opaqueId(raw, field, { required = true } = {}) {
  const value = stringValue(raw)
  if (!value && !required) return ""
  if (!OPAQUE_ID.test(value)) {
    throw sourceError("GENERATION_SOURCE_INVALID", `${field} is missing or invalid.`)
  }
  return value
}

function sha256(raw, field, { required = true } = {}) {
  const value = stringValue(raw).toLowerCase()
  if (!value && !required) return ""
  if (!SHA256.test(value)) {
    throw sourceError("GENERATION_SOURCE_INVALID", `${field} is missing or invalid.`)
  }
  return value
}

function positiveInteger(raw, field) {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw sourceError("GENERATION_SOURCE_INVALID", `${field} is missing or invalid.`)
  }
  return value
}

function optionalNonNegativeInteger(raw, field) {
  if (raw === null || raw === undefined || raw === "") return null
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw sourceError("GENERATION_SOURCE_INVALID", `${field} is invalid.`)
  }
  return value
}

function normalizePromptBodyMode(raw) {
  return stringValue(raw).toLowerCase() === "prose_prompt" ? "prose_prompt" : "taggerizer_prompt"
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

export async function iconoplasmGenerationFingerprint(kind, fields) {
  const namespace = stringValue(kind)
  if (!namespace) throw new TypeError("Generation fingerprint kind is required")
  return sha256Hex(`${namespace}\n${JSON.stringify(canonicalize(fields || {}))}`)
}

const ENCODER = new TextEncoder()

function textDatabase(env) {
  if (!env?.ICONOPLASM_DB) {
    throw sourceError("TEXT_DATABASE_UNAVAILABLE", "The gene text database is unavailable.", 503)
  }
  return env.ICONOPLASM_DB
}

// The text's Tags as the generator reads them: the Tags line, then the
// structured fields as canonical JSON. A text saved without fields has none.
async function tagsOf(geneText) {
  if (!geneText.tags) {
    throw sourceError(
      "GENERATION_SOURCE_DERIVATIVE_UNAVAILABLE",
      "The selected manifestation revision has no accepted Tags derivative.",
    )
  }
  const tags = ENCODER.encode(geneText.tags)
  const fieldsJson = geneText.fields_json ?? "{}"
  const fields = ENCODER.encode(fieldsJson)
  return {
    fieldsJson,
    sha256: await sha256Hex(`${geneText.tags}\n${fieldsJson}`),
    tags_sha256: await sha256Hex(tags),
    tags_bytes: tags.byteLength,
    fields_sha256: await sha256Hex(fields),
    fields_bytes: fields.byteLength,
  }
}

export async function resolveCanonicalGenerationSource(
  env,
  { geneSymbol, promptBodyMode = "taggerizer_prompt" } = {},
) {
  const symbol = stringValue(geneSymbol).toUpperCase()
  if (!symbol) {
    throw sourceError("GENERATION_SOURCE_GENE_INVALID", "A gene symbol is required.", 400)
  }
  const geneText = await readGeneText(textDatabase(env), symbol)
  if (!geneText) {
    throw sourceError(
      "CANONICAL_GENERATION_SOURCE_NOT_FOUND",
      "This gene has no canonical manifestation available for generation.",
      404,
    )
  }
  const mode = normalizePromptBodyMode(promptBodyMode)
  const tags = mode === "taggerizer_prompt" ? await tagsOf(geneText) : null
  const source = normalizeGenerationSource({
    generation_provenance_status: "bound",
    source_gene_id: geneText.gene_id,
    source_manifestation_id: geneText.line_id || geneText.gene_id,
    source_manifestation_revision_id: geneText.text_id,
    source_manifestation_body_sha256: geneText.text_sha256,
    ...(tags
      ? {
          source_manifestation_derivative_id: geneText.text_id,
          source_manifestation_derivative_sha256: tags.sha256,
          source_manifestation_derivative_tags_sha256: tags.tags_sha256,
          source_manifestation_derivative_tags_bytes: tags.tags_bytes,
          source_manifestation_derivative_fields_sha256: tags.fields_sha256,
          source_manifestation_derivative_fields_bytes: tags.fields_bytes,
        }
      : {}),
    source_canonical_selection_id: geneText.text_id,
    source_canonical_head_version: geneText.version,
    source_gene_revision: geneText.version,
    prompt_body_mode: mode,
  })
  source.source_snapshot_sha256 = await iconoplasmGenerationFingerprint(
    "iconoplasm.generation-source.v1",
    source,
  )
  return Object.freeze(source)
}

function normalizeGenerationSource(raw, { promptBodyMode } = {}) {
  if (stringValue(raw?.generation_provenance_status) !== "bound") {
    throw sourceError(
      "LEGACY_GENERATION_SOURCE_UNBOUND",
      "This legacy generation record has no exact manifestation revision and cannot be replayed.",
    )
  }
  const mode = normalizePromptBodyMode(promptBodyMode || raw?.prompt_body_mode)
  const source = {
    generation_provenance_status: "bound",
    source_gene_id: opaqueId(raw?.source_gene_id, "source_gene_id"),
    source_manifestation_id: opaqueId(raw?.source_manifestation_id, "source_manifestation_id"),
    source_manifestation_revision_id: opaqueId(
      raw?.source_manifestation_revision_id,
      "source_manifestation_revision_id",
    ),
    source_manifestation_body_sha256: sha256(
      raw?.source_manifestation_body_sha256,
      "source_manifestation_body_sha256",
    ),
    source_manifestation_derivative_id:
      mode === "taggerizer_prompt"
        ? opaqueId(raw?.source_manifestation_derivative_id, "source_manifestation_derivative_id")
        : "",
    source_manifestation_derivative_sha256:
      mode === "taggerizer_prompt"
        ? sha256(
            raw?.source_manifestation_derivative_sha256,
            "source_manifestation_derivative_sha256",
          )
        : "",
    source_manifestation_derivative_tags_sha256:
      mode === "taggerizer_prompt"
        ? sha256(
            raw?.source_manifestation_derivative_tags_sha256,
            "source_manifestation_derivative_tags_sha256",
          )
        : "",
    source_manifestation_derivative_tags_bytes:
      mode === "taggerizer_prompt"
        ? positiveInteger(
            raw?.source_manifestation_derivative_tags_bytes,
            "source_manifestation_derivative_tags_bytes",
          )
        : 0,
    source_manifestation_derivative_fields_sha256:
      mode === "taggerizer_prompt"
        ? sha256(
            raw?.source_manifestation_derivative_fields_sha256,
            "source_manifestation_derivative_fields_sha256",
          )
        : "",
    source_manifestation_derivative_fields_bytes:
      mode === "taggerizer_prompt"
        ? positiveInteger(
            raw?.source_manifestation_derivative_fields_bytes,
            "source_manifestation_derivative_fields_bytes",
          )
        : 0,
    source_manifestation_derivative_recipe_id:
      mode === "taggerizer_prompt"
        ? stringValue(raw?.source_manifestation_derivative_recipe_id)
        : "",
    source_manifestation_derivative_recipe_version:
      mode === "taggerizer_prompt"
        ? stringValue(raw?.source_manifestation_derivative_recipe_version)
        : "",
    source_manifestation_derivative_provider_id:
      mode === "taggerizer_prompt"
        ? stringValue(raw?.source_manifestation_derivative_provider_id)
        : "",
    source_manifestation_derivative_model_id:
      mode === "taggerizer_prompt"
        ? stringValue(raw?.source_manifestation_derivative_model_id)
        : "",
    source_manifestation_derivative_tagger_config_sha256:
      mode === "taggerizer_prompt"
        ? sha256(
            raw?.source_manifestation_derivative_tagger_config_sha256,
            "source_manifestation_derivative_tagger_config_sha256",
            { required: false },
          )
        : "",
    source_canonical_selection_id: opaqueId(
      raw?.source_canonical_selection_id,
      "source_canonical_selection_id",
    ),
    source_canonical_head_version: positiveInteger(
      raw?.source_canonical_head_version,
      "source_canonical_head_version",
    ),
    source_gene_revision: positiveInteger(raw?.source_gene_revision, "source_gene_revision"),
    source_sample_label: stringValue(raw?.source_sample_label || raw?.sample_label),
    source_sample_number: optionalNonNegativeInteger(
      raw?.source_sample_number ?? raw?.sample_number ?? null,
      "source_sample_number",
    ),
    source_sample_text_sha256: sha256(
      raw?.source_sample_text_sha256 ?? raw?.sample_text_sha256 ?? raw?.sample_text_hash,
      "source_sample_text_sha256",
      { required: false },
    ),
    prompt_body_mode: mode,
  }
  return source
}

export function requireExactGenerationProvenance(raw, options) {
  return {
    ...normalizeGenerationSource(raw, options),
    source_snapshot_sha256: sha256(raw?.source_snapshot_sha256, "source_snapshot_sha256"),
  }
}

export function exactGenerationProvenanceValidationKey(raw, options) {
  return JSON.stringify(requireExactGenerationProvenance(raw, options))
}

// The text a request names, checked against every hash the request carries.
// The request's own provenance is the answer, so the keys callers compare stay
// the ones they stored.
async function exactGeneText(env, provenance) {
  const geneText = await readGeneTextVersion(
    textDatabase(env),
    provenance.source_gene_id,
    provenance.source_manifestation_revision_id,
  )
  if (!geneText) {
    throw sourceError(
      "GENERATION_SOURCE_REVISION_INACTIVE",
      "The selected manifestation revision is no longer active.",
    )
  }
  const mismatch = () =>
    sourceError(
      "GENERATION_SOURCE_SNAPSHOT_MISMATCH",
      "The stored generation source no longer matches its immutable authority record.",
    )
  if (geneText.text_sha256 !== provenance.source_manifestation_body_sha256) throw mismatch()
  if (provenance.prompt_body_mode !== "taggerizer_prompt") return { geneText, tags: null }
  const tags = await tagsOf(geneText)
  if (
    tags.sha256 !== provenance.source_manifestation_derivative_sha256 ||
    tags.tags_sha256 !== provenance.source_manifestation_derivative_tags_sha256 ||
    tags.tags_bytes !== provenance.source_manifestation_derivative_tags_bytes ||
    tags.fields_sha256 !== provenance.source_manifestation_derivative_fields_sha256 ||
    tags.fields_bytes !== provenance.source_manifestation_derivative_fields_bytes
  ) {
    throw mismatch()
  }
  return { geneText, tags }
}

export async function validateExactGenerationSource(env, rawProvenance) {
  const provenance = requireExactGenerationProvenance(rawProvenance)
  await exactGeneText(env, provenance)
  return Object.freeze(provenance)
}

export async function readExactGenerationSource(env, rawProvenance) {
  const provenance = requireExactGenerationProvenance(rawProvenance)
  const { geneText: stored, tags } = await exactGeneText(env, provenance)
  // B-1156: a factory text's prose comes from Bunny, checked against the same hash.
  const geneText = await withProse(env, stored).catch((error) => {
    throw sourceError("GENERATION_SOURCE_PROSE_UNAVAILABLE", String(error?.message || error), 503)
  })
  return Object.freeze({
    ...provenance,
    prose: geneText.text,
    tags: tags ? geneText.tags : "",
    tags_fields_json: tags ? JSON.parse(tags.fieldsJson) : null,
  })
}

export async function generationRequestContractSha256(fields) {
  return iconoplasmGenerationFingerprint("iconoplasm.generation-request.v1", fields)
}

export async function generationConfigSha256(fields) {
  return iconoplasmGenerationFingerprint("iconoplasm.generation-config.v1", fields)
}

export async function generationPromptSha256(prompt) {
  return sha256Hex(String(prompt || ""))
}

// ARCHITECTURE FENCE [IPD-012]
