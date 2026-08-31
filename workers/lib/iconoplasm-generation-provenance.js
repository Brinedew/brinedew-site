import { decryptManifestationProse, sha256Hex } from "./iconoplasm-manifestation-body-crypto.js"
import { readEncryptedManifestationBody } from "./iconoplasm-manifestation-body-storage.js"
import { decryptManifestationTags } from "./iconoplasm-manifestation-tags-crypto.js"
import { splitManifestationTagsPayload } from "../iconoplasm/caretaker/manifestation-tags-payload.js"

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

function validateAuthorityRow(row, { promptBodyMode, requireStorageSecrets }) {
  if (!row) {
    throw sourceError(
      "CANONICAL_GENERATION_SOURCE_NOT_FOUND",
      "This gene has no canonical manifestation available for generation.",
      404,
    )
  }
  if (stringValue(row.gene_status) !== "active") {
    throw sourceError(
      "GENERATION_SOURCE_GENE_INACTIVE",
      "This gene is not active in the manifestation authority.",
    )
  }
  if (stringValue(row.manifestation_status) !== "active") {
    throw sourceError(
      "GENERATION_SOURCE_MANIFESTATION_INACTIVE",
      "The selected manifestation is no longer active.",
    )
  }
  if (stringValue(row.revision_status) !== "active") {
    throw sourceError(
      "GENERATION_SOURCE_REVISION_INACTIVE",
      "The selected manifestation revision is no longer active.",
    )
  }
  if (requireStorageSecrets && !stringValue(row.revision_object_key)) {
    throw sourceError(
      "GENERATION_SOURCE_BODY_UNAVAILABLE",
      "The selected manifestation body is unavailable.",
      503,
    )
  }
  if (!stringValue(row.revision_verified_at)) {
    throw sourceError(
      "GENERATION_SOURCE_BODY_UNVERIFIED",
      "The selected manifestation body has not passed storage verification.",
      503,
    )
  }

  const mode = normalizePromptBodyMode(promptBodyMode)
  if (mode === "taggerizer_prompt") {
    if (stringValue(row.derivative_status) !== "complete") {
      throw sourceError(
        "GENERATION_SOURCE_DERIVATIVE_UNAVAILABLE",
        "The selected manifestation revision has no accepted Tags derivative.",
      )
    }
    if (
      stringValue(row.derivative_source_body_sha256).toLowerCase() !==
      stringValue(row.body_sha256).toLowerCase()
    ) {
      throw sourceError(
        "GENERATION_SOURCE_DERIVATIVE_STALE",
        "The accepted Tags derivative does not belong to the selected manifestation body.",
      )
    }
    if (requireStorageSecrets && !stringValue(row.derivative_object_key)) {
      throw sourceError(
        "GENERATION_SOURCE_DERIVATIVE_UNAVAILABLE",
        "The accepted Tags derivative body is unavailable.",
        503,
      )
    }
    if (!stringValue(row.derivative_verified_at)) {
      throw sourceError(
        "GENERATION_SOURCE_DERIVATIVE_UNVERIFIED",
        "The accepted Tags derivative has not passed storage verification.",
        503,
      )
    }
    if (
      stringValue(row.derivative_provenance_status) !== "generated" ||
      !stringValue(row.derivative_recipe_id) ||
      !stringValue(row.derivative_recipe_version) ||
      !stringValue(row.derivative_provider_id) ||
      !stringValue(row.derivative_model_id) ||
      !SHA256.test(stringValue(row.derivative_tagger_config_sha256).toLowerCase())
    ) {
      throw sourceError(
        "GENERATION_SOURCE_DERIVATIVE_PROVENANCE_INCOMPLETE",
        "The accepted Tags derivative has no exact recipe, provider, model, or tagger configuration identity.",
      )
    }
    const derivativeBodyBytes = positiveInteger(row.derivative_body_bytes, "derivative_body_bytes")
    const derivativeTagsBytes = positiveInteger(row.derivative_tags_bytes, "derivative_tags_bytes")
    const derivativeFieldsBytes = positiveInteger(
      row.derivative_fields_bytes,
      "derivative_fields_bytes",
    )
    sha256(row.derivative_body_sha256, "derivative_body_sha256")
    sha256(row.derivative_tags_sha256, "derivative_tags_sha256")
    sha256(row.derivative_fields_sha256, "derivative_fields_sha256")
    if (derivativeBodyBytes !== derivativeTagsBytes + 1 + derivativeFieldsBytes) {
      throw sourceError(
        "GENERATION_SOURCE_DERIVATIVE_FRAMING_INVALID",
        "The accepted Tags derivative component lengths do not match its compound body.",
      )
    }
  }
  return mode
}

async function provenanceFromAuthorityRow(row, promptBodyMode) {
  const mode = validateAuthorityRow(row, { promptBodyMode, requireStorageSecrets: false })
  const manifestationId = opaqueId(row.manifestation_id, "source_manifestation_id")
  const revisionId = opaqueId(row.manifestation_revision_id, "source_manifestation_revision_id")
  const selectedManifestationId = opaqueId(
    row.selected_manifestation_id,
    "selected_manifestation_id",
  )
  const selectedRevisionId = opaqueId(row.selected_revision_id, "selected_revision_id")
  if (manifestationId !== selectedManifestationId || revisionId !== selectedRevisionId) {
    throw sourceError(
      "GENERATION_SOURCE_SELECTION_MISMATCH",
      "The canonical selection does not identify the selected manifestation revision.",
    )
  }
  const source = {
    generation_provenance_status: "bound",
    source_gene_id: opaqueId(row.gene_id, "source_gene_id"),
    source_manifestation_id: manifestationId,
    source_manifestation_revision_id: revisionId,
    source_manifestation_body_sha256: sha256(row.body_sha256, "source_manifestation_body_sha256"),
    source_manifestation_derivative_id:
      mode === "taggerizer_prompt"
        ? opaqueId(row.manifestation_derivative_id, "source_manifestation_derivative_id")
        : "",
    source_manifestation_derivative_sha256:
      mode === "taggerizer_prompt"
        ? sha256(row.derivative_body_sha256, "source_manifestation_derivative_sha256")
        : "",
    source_manifestation_derivative_tags_sha256:
      mode === "taggerizer_prompt"
        ? sha256(row.derivative_tags_sha256, "source_manifestation_derivative_tags_sha256")
        : "",
    source_manifestation_derivative_tags_bytes:
      mode === "taggerizer_prompt"
        ? positiveInteger(row.derivative_tags_bytes, "source_manifestation_derivative_tags_bytes")
        : 0,
    source_manifestation_derivative_fields_sha256:
      mode === "taggerizer_prompt"
        ? sha256(row.derivative_fields_sha256, "source_manifestation_derivative_fields_sha256")
        : "",
    source_manifestation_derivative_fields_bytes:
      mode === "taggerizer_prompt"
        ? positiveInteger(
            row.derivative_fields_bytes,
            "source_manifestation_derivative_fields_bytes",
          )
        : 0,
    source_manifestation_derivative_recipe_id:
      mode === "taggerizer_prompt" ? stringValue(row.derivative_recipe_id) : "",
    source_manifestation_derivative_recipe_version:
      mode === "taggerizer_prompt" ? stringValue(row.derivative_recipe_version) : "",
    source_manifestation_derivative_provider_id:
      mode === "taggerizer_prompt" ? stringValue(row.derivative_provider_id) : "",
    source_manifestation_derivative_model_id:
      mode === "taggerizer_prompt" ? stringValue(row.derivative_model_id) : "",
    source_manifestation_derivative_tagger_config_sha256:
      mode === "taggerizer_prompt"
        ? sha256(
            row.derivative_tagger_config_sha256,
            "source_manifestation_derivative_tagger_config_sha256",
          )
        : "",
    source_canonical_selection_id: opaqueId(
      row.canonical_selection_id,
      "source_canonical_selection_id",
    ),
    source_canonical_head_version: positiveInteger(
      row.selection_head_version,
      "source_canonical_head_version",
    ),
    source_gene_revision: positiveInteger(row.selection_gene_revision, "source_gene_revision"),
    source_sample_label: stringValue(row.sample_label),
    source_sample_number: optionalNonNegativeInteger(row.sample_number, "source_sample_number"),
    source_sample_text_sha256: sha256(row.sample_text_sha256, "source_sample_text_sha256", {
      required: false,
    }),
    prompt_body_mode: mode,
  }
  source.source_snapshot_sha256 = await iconoplasmGenerationFingerprint(
    "iconoplasm.generation-source.v1",
    source,
  )
  return Object.freeze(source)
}

function authoringDatabase(env) {
  if (!env?.ICONOPLASM_AUTHORING_DB) {
    throw sourceError(
      "AUTHORING_DATABASE_UNAVAILABLE",
      "The manifestation authoring authority is unavailable.",
      503,
    )
  }
  return env.ICONOPLASM_AUTHORING_DB
}

const SOURCE_ROW_SELECT = `SELECT
  g.gene_id,
  g.status AS gene_status,
  m.manifestation_id,
  m.status AS manifestation_status,
  r.manifestation_revision_id,
  r.body_sha256,
  r.body_bytes,
  r.sample_label,
  r.sample_number,
  r.sample_text_sha256,
  lifecycle.status AS revision_status,
  revision_storage.object_key AS revision_object_key,
  revision_storage.ciphertext_sha256 AS revision_ciphertext_sha256,
  revision_storage.ciphertext_bytes AS revision_ciphertext_bytes,
  revision_storage.body_iv_base64 AS revision_body_iv_base64,
  revision_storage.wrapped_dek_base64 AS revision_wrapped_dek_base64,
  revision_storage.wrap_iv_base64 AS revision_wrap_iv_base64,
  revision_storage.key_version AS revision_key_version,
  revision_storage.aad_version AS revision_aad_version,
  revision_storage.verified_at AS revision_verified_at,
  selection.canonical_selection_id,
  selection.selected_manifestation_id,
  selection.selected_revision_id,
  selection.head_version AS selection_head_version,
  selection.gene_revision AS selection_gene_revision,
  derivative.manifestation_derivative_id,
  derivative.status AS derivative_status,
  derivative.source_body_sha256 AS derivative_source_body_sha256,
  derivative.body_sha256 AS derivative_body_sha256,
  derivative.body_bytes AS derivative_body_bytes,
  derivative.tags_sha256 AS derivative_tags_sha256,
  derivative.tags_bytes AS derivative_tags_bytes,
  derivative.fields_sha256 AS derivative_fields_sha256,
  derivative.fields_bytes AS derivative_fields_bytes,
  derivative.recipe_id AS derivative_recipe_id,
  derivative.recipe_version AS derivative_recipe_version,
  derivative.provider_id AS derivative_provider_id,
  derivative.model_id AS derivative_model_id,
  derivative.tagger_config_sha256 AS derivative_tagger_config_sha256,
  derivative.provenance_status AS derivative_provenance_status,
  derivative_storage.object_key AS derivative_object_key,
  derivative_storage.ciphertext_sha256 AS derivative_ciphertext_sha256,
  derivative_storage.ciphertext_bytes AS derivative_ciphertext_bytes,
  derivative_storage.body_iv_base64 AS derivative_body_iv_base64,
  derivative_storage.wrapped_dek_base64 AS derivative_wrapped_dek_base64,
  derivative_storage.wrap_iv_base64 AS derivative_wrap_iv_base64,
  derivative_storage.key_version AS derivative_key_version,
  derivative_storage.aad_version AS derivative_aad_version,
  derivative_storage.verified_at AS derivative_verified_at`

export async function resolveCanonicalGenerationSource(
  env,
  { geneSymbol, promptBodyMode = "taggerizer_prompt" } = {},
) {
  const symbol = stringValue(geneSymbol).toUpperCase()
  if (!symbol) {
    throw sourceError("GENERATION_SOURCE_GENE_INVALID", "A gene symbol is required.", 400)
  }
  const row = await authoringDatabase(env)
    .prepare(
      `${SOURCE_ROW_SELECT}
       FROM icono_gene_identities g
       JOIN icono_manifestation_heads head
         ON head.gene_id = g.gene_id
       JOIN icono_manifestations m
         ON m.manifestation_id = head.canonical_manifestation_id
        AND m.gene_id = g.gene_id
       JOIN icono_manifestation_revisions r
         ON r.manifestation_revision_id = head.canonical_revision_id
        AND r.manifestation_id = m.manifestation_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = r.manifestation_revision_id
       JOIN icono_manifestation_revision_storage_secrets revision_storage
         ON revision_storage.manifestation_revision_id = r.manifestation_revision_id
       JOIN icono_manifestation_canonical_selections selection
         ON selection.canonical_selection_id = head.canonical_selection_id
        AND selection.gene_id = g.gene_id
       LEFT JOIN icono_manifestation_derivative_heads derivative_head
         ON derivative_head.manifestation_revision_id = r.manifestation_revision_id
       LEFT JOIN icono_manifestation_derivatives derivative
         ON derivative.manifestation_derivative_id = derivative_head.accepted_derivative_id
        AND derivative.manifestation_revision_id = r.manifestation_revision_id
       LEFT JOIN icono_manifestation_derivative_storage_secrets derivative_storage
         ON derivative_storage.manifestation_derivative_id = derivative.manifestation_derivative_id
       WHERE g.canonical_symbol = ? COLLATE NOCASE
       LIMIT 1`,
    )
    .bind(symbol)
    .first()
  return provenanceFromAuthorityRow(row, promptBodyMode)
}

export function requireExactGenerationProvenance(raw, { promptBodyMode } = {}) {
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
  const snapshotHash = sha256(raw?.source_snapshot_sha256, "source_snapshot_sha256")
  return { ...source, source_snapshot_sha256: snapshotHash }
}

export function exactGenerationProvenanceValidationKey(raw, options) {
  return JSON.stringify(requireExactGenerationProvenance(raw, options))
}

async function verifiedCiphertext(env, { objectKey, ciphertextSha256, ciphertextBytes }) {
  const stored = await readEncryptedManifestationBody(env, objectKey)
  if (!stored) {
    throw sourceError(
      "GENERATION_SOURCE_BODY_MISSING",
      "The exact manifestation source body is missing from private storage.",
      503,
    )
  }
  if (
    stored.bytes.byteLength !== ciphertextBytes ||
    (await sha256Hex(stored.bytes)) !== ciphertextSha256
  ) {
    throw sourceError(
      "GENERATION_SOURCE_CIPHERTEXT_MISMATCH",
      "The exact manifestation source body failed ciphertext verification.",
      503,
    )
  }
  return stored.bytes
}

async function verifiedProse(env, row, input) {
  const ciphertext = await verifiedCiphertext(env, input)
  return decryptManifestationProse(env, {
    revisionId: input.entityId,
    geneId: row.gene_id,
    ciphertext,
    ciphertextSha256: input.ciphertextSha256,
    ciphertextBytes: input.ciphertextBytes,
    bodySha256: input.bodySha256,
    bodyBytes: input.bodyBytes,
    bodyIvBase64: input.bodyIvBase64,
    wrappedDekBase64: input.wrappedDekBase64,
    wrapIvBase64: input.wrapIvBase64,
    keyVersion: input.keyVersion,
    aadVersion: input.aadVersion,
  })
}

async function verifiedTags(env, input) {
  const ciphertext = await verifiedCiphertext(env, input)
  return decryptManifestationTags(env, {
    derivativeId: input.entityId,
    revisionId: input.revisionId,
    sourceBodySha256: input.sourceBodySha256,
    ciphertext,
    ciphertextSha256: input.ciphertextSha256,
    ciphertextBytes: input.ciphertextBytes,
    bodySha256: input.bodySha256,
    bodyBytes: input.bodyBytes,
    bodyIvBase64: input.bodyIvBase64,
    wrappedDekBase64: input.wrappedDekBase64,
    wrapIvBase64: input.wrapIvBase64,
    keyVersion: input.keyVersion,
    aadVersion: input.aadVersion,
  })
}

async function readExactAuthorityRow(env, provenance) {
  return authoringDatabase(env)
    .prepare(
      `${SOURCE_ROW_SELECT}
       FROM icono_gene_identities g
       JOIN icono_manifestations m
         ON m.gene_id = g.gene_id
        AND m.manifestation_id = ?
       JOIN icono_manifestation_revisions r
         ON r.manifestation_id = m.manifestation_id
        AND r.manifestation_revision_id = ?
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = r.manifestation_revision_id
       LEFT JOIN icono_manifestation_revision_storage_secrets revision_storage
         ON revision_storage.manifestation_revision_id = r.manifestation_revision_id
       JOIN icono_manifestation_canonical_selections selection
         ON selection.gene_id = g.gene_id
        AND selection.canonical_selection_id = ?
        AND selection.selected_manifestation_id = m.manifestation_id
        AND selection.selected_revision_id = r.manifestation_revision_id
       LEFT JOIN icono_manifestation_derivatives derivative
         ON derivative.manifestation_revision_id = r.manifestation_revision_id
        AND derivative.manifestation_derivative_id = ?
       LEFT JOIN icono_manifestation_derivative_storage_secrets derivative_storage
         ON derivative_storage.manifestation_derivative_id = derivative.manifestation_derivative_id
       WHERE g.gene_id = ?
       LIMIT 1`,
    )
    .bind(
      provenance.source_manifestation_id,
      provenance.source_manifestation_revision_id,
      provenance.source_canonical_selection_id,
      provenance.source_manifestation_derivative_id,
      provenance.source_gene_id,
    )
    .first()
}

export async function validateExactGenerationSource(env, rawProvenance) {
  const provenance = requireExactGenerationProvenance(rawProvenance)
  const row = await readExactAuthorityRow(env, provenance)
  validateAuthorityRow(row, {
    promptBodyMode: provenance.prompt_body_mode,
    requireStorageSecrets: true,
  })
  const exact = await provenanceFromAuthorityRow(row, provenance.prompt_body_mode)
  if (exact.source_snapshot_sha256 !== provenance.source_snapshot_sha256) {
    throw sourceError(
      "GENERATION_SOURCE_SNAPSHOT_MISMATCH",
      "The stored generation source no longer matches its immutable authority record.",
    )
  }
  return exact
}

export async function readExactGenerationSource(env, rawProvenance) {
  const provenance = requireExactGenerationProvenance(rawProvenance)
  const row = await readExactAuthorityRow(env, provenance)

  validateAuthorityRow(row, {
    promptBodyMode: provenance.prompt_body_mode,
    requireStorageSecrets: true,
  })
  const exact = await provenanceFromAuthorityRow(row, provenance.prompt_body_mode)
  if (exact.source_snapshot_sha256 !== provenance.source_snapshot_sha256) {
    throw sourceError(
      "GENERATION_SOURCE_SNAPSHOT_MISMATCH",
      "The stored generation source no longer matches its immutable authority record.",
    )
  }

  const prose = await verifiedProse(env, row, {
    entityId: provenance.source_manifestation_revision_id,
    objectKey: row.revision_object_key,
    ciphertextSha256: sha256(row.revision_ciphertext_sha256, "revision_ciphertext_sha256"),
    ciphertextBytes: positiveInteger(row.revision_ciphertext_bytes, "revision_ciphertext_bytes"),
    bodySha256: provenance.source_manifestation_body_sha256,
    bodyBytes: positiveInteger(row.body_bytes, "body_bytes"),
    bodyIvBase64: row.revision_body_iv_base64,
    wrappedDekBase64: row.revision_wrapped_dek_base64,
    wrapIvBase64: row.revision_wrap_iv_base64,
    keyVersion: positiveInteger(row.revision_key_version, "revision_key_version"),
    aadVersion: positiveInteger(row.revision_aad_version, "revision_aad_version"),
  })
  let tags = ""
  let tagsFieldsJson = null
  if (provenance.prompt_body_mode === "taggerizer_prompt") {
    const compoundTags = await verifiedTags(env, {
      entityId: provenance.source_manifestation_derivative_id,
      revisionId: provenance.source_manifestation_revision_id,
      sourceBodySha256: provenance.source_manifestation_body_sha256,
      objectKey: row.derivative_object_key,
      ciphertextSha256: sha256(row.derivative_ciphertext_sha256, "derivative_ciphertext_sha256"),
      ciphertextBytes: positiveInteger(
        row.derivative_ciphertext_bytes,
        "derivative_ciphertext_bytes",
      ),
      bodySha256: provenance.source_manifestation_derivative_sha256,
      bodyBytes: positiveInteger(row.derivative_body_bytes, "derivative_body_bytes"),
      bodyIvBase64: row.derivative_body_iv_base64,
      wrappedDekBase64: row.derivative_wrapped_dek_base64,
      wrapIvBase64: row.derivative_wrap_iv_base64,
      keyVersion: positiveInteger(row.derivative_key_version, "derivative_key_version"),
      aadVersion: positiveInteger(row.derivative_aad_version, "derivative_aad_version"),
    })
    const split = await splitManifestationTagsPayload(compoundTags, {
      tagsSha256: provenance.source_manifestation_derivative_tags_sha256,
      tagsBytes: provenance.source_manifestation_derivative_tags_bytes,
      fieldsSha256: provenance.source_manifestation_derivative_fields_sha256,
      fieldsBytes: provenance.source_manifestation_derivative_fields_bytes,
    })
    tags = split.tags_text
    tagsFieldsJson = split.fields_json
  }
  return Object.freeze({ ...provenance, prose, tags, tags_fields_json: tagsFieldsJson })
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
