// ARCHITECTURE FENCE [IPD-012]: public manifestation text is decrypted from the
// exact authoring authority object selected by the compact primary head. This
// module never reads legacy plaintext and never exposes object locators or keys.
import { sha256Hex } from "../../lib/iconoplasm-manifestation-body-crypto.js"
import { decryptManifestationProse } from "../../lib/iconoplasm-manifestation-body-crypto.js"
import { readEncryptedManifestationBody } from "../../lib/iconoplasm-manifestation-body-storage.js"
import { decryptManifestationTags } from "../../lib/iconoplasm-manifestation-tags-crypto.js"
import { all, first, requireDatabase } from "./manifestation-authority-repository.js"
import { readCanonicalProjectionRecord } from "./manifestation-authority-projection-read.js"
import { splitManifestationTagsPayload } from "./manifestation-tags-payload.js"

const PUBLIC_SCHEMA_VERSION = 1
const PROOF_NAMESPACE = "iconoplasm.public-canonical-material-proof.v1"
const READABLE_AUTHORITY_MODES = new Set(["authoritative", "recovery_read_only"])

export class PublicCanonicalMaterialError extends Error {
  constructor(code, message, { status = 503, cause } = {}) {
    super(message, cause ? { cause } : undefined)
    this.name = "PublicCanonicalMaterialError"
    this.code = code
    this.status = status
  }
}

function publicError(code, message, status = 503, cause) {
  return new PublicCanonicalMaterialError(code, message, { status, cause })
}

function text(raw) {
  return String(raw ?? "").trim()
}

function opaqueId(raw, label) {
  const value = text(raw)
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(value)) {
    throw publicError("PUBLIC_CANONICAL_INVALID_ID", `${label} is invalid`, 500)
  }
  return value
}

function symbol(raw) {
  const value = text(raw).toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9.-]{0,63}$/.test(value)) {
    throw publicError("PUBLIC_CANONICAL_INVALID_SYMBOL", "canonical_symbol is invalid", 500)
  }
  return value
}

function positiveInteger(raw, label) {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw publicError("PUBLIC_CANONICAL_INVALID_VERSION", `${label} is invalid`, 500)
  }
  return value
}

function nonNegativeInteger(raw, label) {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw publicError("PUBLIC_CANONICAL_INVALID_VERSION", `${label} is invalid`, 500)
  }
  return value
}

function nullableText(raw) {
  const value = text(raw)
  return value || null
}

function nullableNumber(raw) {
  return raw == null ? null : Number(raw)
}

function exact(left, right) {
  return (left ?? null) === (right ?? null)
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

async function projectionAuthority(primaryDb, allowShadowFrozen) {
  const authority = await first(
    primaryDb,
    `SELECT authority_epoch, mode, source_snapshot_sha256, expected_gene_count,
            plaintext_retired_at
       FROM icono_manifestation_projection_authority WHERE singleton = 1`,
  )
  if (!authority) {
    throw publicError(
      "PUBLIC_CANONICAL_AUTHORITY_MISSING",
      "Manifestation projection authority is unavailable",
    )
  }
  const allowed =
    READABLE_AUTHORITY_MODES.has(authority.mode) ||
    (allowShadowFrozen === true && authority.mode === "shadow_frozen")
  if (!allowed) {
    throw publicError(
      "PUBLIC_CANONICAL_AUTHORITY_NOT_READABLE",
      "Canonical manifestation authority is not readable in the current mode",
      409,
    )
  }
  return Object.freeze({
    authority_epoch: positiveInteger(authority.authority_epoch, "authority_epoch"),
    mode: authority.mode,
    source_snapshot_sha256: nullableText(authority.source_snapshot_sha256),
    expected_gene_count: nullableNumber(authority.expected_gene_count),
    plaintext_retired_at: nullableText(authority.plaintext_retired_at),
  })
}

async function projectionRow(primaryDb, { geneId, canonicalSymbol }) {
  if (geneId) {
    return first(
      primaryDb,
      "SELECT * FROM icono_manifestation_canonical_projection WHERE gene_id = ?",
      opaqueId(geneId, "gene_id"),
    )
  }
  if (canonicalSymbol) {
    return first(
      primaryDb,
      `SELECT * FROM icono_manifestation_canonical_projection
        WHERE canonical_symbol = ? COLLATE NOCASE`,
      symbol(canonicalSymbol),
    )
  }
  throw publicError(
    "PUBLIC_CANONICAL_IDENTITY_REQUIRED",
    "gene_id or canonical_symbol is required",
    400,
  )
}

function assertProjectionMatchesAuthority(projection, exactRecord, authority) {
  const numericFields = new Set([
    "canonical_body_bytes",
    "accepted_tags_derivative_head_version",
    "accepted_tags_body_bytes",
    "accepted_tags_text_bytes",
    "accepted_tags_fields_bytes",
    "head_version",
    "gene_revision",
    "authority_event_sequence",
    "authority_epoch",
  ])
  const expected = {
    gene_id: exactRecord.gene_id,
    canonical_symbol: exactRecord.canonical_symbol,
    canonical_manifestation_id: exactRecord.canonical?.manifestation_id || null,
    canonical_revision_id: exactRecord.canonical?.manifestation_revision_id || null,
    canonical_selection_id: exactRecord.canonical?.canonical_selection_id || null,
    canonical_body_sha256: exactRecord.canonical?.body_sha256 || null,
    canonical_body_bytes: exactRecord.canonical?.body_bytes || null,
    canonical_revision_lifecycle: exactRecord.canonical?.lifecycle || null,
    accepted_tags_derivative_id:
      exactRecord.accepted_tags_derivative?.manifestation_derivative_id || null,
    accepted_tags_derivative_head_version:
      exactRecord.accepted_tags_derivative?.derivative_head_version || null,
    accepted_tags_status: exactRecord.accepted_tags_derivative?.status || null,
    accepted_tags_source_body_sha256:
      exactRecord.accepted_tags_derivative?.source_body_sha256 || null,
    accepted_tags_body_sha256: exactRecord.accepted_tags_derivative?.body_sha256 || null,
    accepted_tags_body_bytes: exactRecord.accepted_tags_derivative?.body_bytes || null,
    accepted_tags_text_sha256: exactRecord.accepted_tags_derivative?.tags_sha256 || null,
    accepted_tags_text_bytes: exactRecord.accepted_tags_derivative?.tags_bytes || null,
    accepted_tags_fields_sha256: exactRecord.accepted_tags_derivative?.fields_sha256 || null,
    accepted_tags_fields_bytes: exactRecord.accepted_tags_derivative?.fields_bytes || null,
    accepted_tags_recipe_id: exactRecord.accepted_tags_derivative?.recipe_id || null,
    accepted_tags_recipe_version: exactRecord.accepted_tags_derivative?.recipe_version || null,
    accepted_tags_provider_id: exactRecord.accepted_tags_derivative?.provider_id || null,
    accepted_tags_model_id: exactRecord.accepted_tags_derivative?.model_id || null,
    accepted_tags_config_sha256: exactRecord.accepted_tags_derivative?.tagger_config_sha256 || null,
    accepted_tags_provenance_status:
      exactRecord.accepted_tags_derivative?.provenance_status || null,
    head_version: exactRecord.head_version,
    gene_revision: exactRecord.gene_revision,
    authority_event_id: exactRecord.last_event_id,
    authority_event_sequence: exactRecord.last_event_sequence,
    authority_epoch: authority.authority_epoch,
  }
  for (const [key, value] of Object.entries(expected)) {
    const actual = numericFields.has(key) ? nullableNumber(projection[key]) : projection[key]
    if (!exact(actual, value)) {
      throw publicError(
        "PUBLIC_CANONICAL_PROJECTION_DRIFT",
        `Canonical projection field ${key} differs from authoring authority`,
        503,
      )
    }
  }
  if (expected.canonical_revision_id && expected.canonical_revision_lifecycle !== "active") {
    throw publicError(
      "PUBLIC_CANONICAL_REVISION_INACTIVE",
      "The projected canonical revision is not active",
      410,
    )
  }
}

async function notifyIntegrityFailure(callback, descriptor) {
  if (typeof callback !== "function") return
  await callback(descriptor).catch(() => undefined)
}

async function revisionMaterial(authoringDb, env, record, onIntegrityFailure) {
  const revision = record.canonical
  const secret = await first(
    authoringDb,
    `SELECT object_key, ciphertext_sha256, ciphertext_bytes, body_iv_base64,
            wrapped_dek_base64, wrap_iv_base64, key_version, aad_version
       FROM icono_manifestation_revision_storage_secrets
      WHERE manifestation_revision_id = ?`,
    revision.manifestation_revision_id,
  )
  try {
    if (!secret) throw new Error("revision_storage_missing")
    const encrypted = await readEncryptedManifestationBody(env, secret.object_key)
    if (!encrypted) throw new Error("revision_ciphertext_missing")
    return await decryptManifestationProse(env, {
      revisionId: revision.manifestation_revision_id,
      geneId: record.gene_id,
      ciphertext: encrypted.bytes,
      ciphertextSha256: secret.ciphertext_sha256,
      ciphertextBytes: Number(secret.ciphertext_bytes),
      bodySha256: revision.body_sha256,
      bodyBytes: Number(revision.body_bytes),
      bodyIvBase64: secret.body_iv_base64,
      wrappedDekBase64: secret.wrapped_dek_base64,
      wrapIvBase64: secret.wrap_iv_base64,
      keyVersion: Number(secret.key_version),
      aadVersion: Number(secret.aad_version),
    })
  } catch (error) {
    await notifyIntegrityFailure(onIntegrityFailure, {
      entity_kind: "revision",
      entity_id: revision.manifestation_revision_id,
      gene_id: record.gene_id,
      reason: text(error?.message || "revision_body_corrupt").slice(0, 120),
    })
    throw publicError(
      "PUBLIC_CANONICAL_REVISION_BODY_UNAVAILABLE",
      "Canonical manifestation body failed integrity verification",
      503,
      error,
    )
  }
}

async function derivativeMaterial(authoringDb, env, record, onIntegrityFailure) {
  const derivative = record.accepted_tags_derivative
  const secret = await first(
    authoringDb,
    `SELECT object_key, ciphertext_sha256, ciphertext_bytes, body_iv_base64,
            wrapped_dek_base64, wrap_iv_base64, key_version, aad_version
       FROM icono_manifestation_derivative_storage_secrets
      WHERE manifestation_derivative_id = ?`,
    derivative.manifestation_derivative_id,
  )
  try {
    if (derivative.status !== "complete") throw new Error("derivative_not_complete")
    if (!secret) throw new Error("derivative_storage_missing")
    const encrypted = await readEncryptedManifestationBody(env, secret.object_key)
    if (!encrypted) throw new Error("derivative_ciphertext_missing")
    const outputPlain = await decryptManifestationTags(env, {
      derivativeId: derivative.manifestation_derivative_id,
      revisionId: record.canonical.manifestation_revision_id,
      sourceBodySha256: derivative.source_body_sha256,
      ciphertext: encrypted.bytes,
      ciphertextSha256: secret.ciphertext_sha256,
      ciphertextBytes: Number(secret.ciphertext_bytes),
      bodySha256: derivative.body_sha256,
      bodyBytes: Number(derivative.body_bytes),
      bodyIvBase64: secret.body_iv_base64,
      wrappedDekBase64: secret.wrapped_dek_base64,
      wrapIvBase64: secret.wrap_iv_base64,
      keyVersion: Number(secret.key_version),
      aadVersion: Number(secret.aad_version),
    })
    return await splitManifestationTagsPayload(outputPlain, {
      tagsBytes: derivative.tags_bytes,
      tagsSha256: derivative.tags_sha256,
      fieldsBytes: derivative.fields_bytes,
      fieldsSha256: derivative.fields_sha256,
    })
  } catch (error) {
    await notifyIntegrityFailure(onIntegrityFailure, {
      entity_kind: "derivative",
      entity_id: derivative.manifestation_derivative_id,
      gene_id: record.gene_id,
      reason: text(error?.message || "derivative_body_corrupt").slice(0, 120),
    })
    throw publicError(
      "PUBLIC_CANONICAL_TAGS_BODY_UNAVAILABLE",
      "Canonical Tags body failed integrity verification",
      503,
      error,
    )
  }
}

function publicDerivative(record, material) {
  const derivative = record.accepted_tags_derivative
  if (!derivative) return null
  return Object.freeze({
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
    tags_text: material.tags_text,
    fields_json: material.fields_json,
  })
}

export async function readPublicCanonicalMaterial({
  primaryDb,
  authoringDb,
  env,
  geneId,
  canonicalSymbol,
  allowShadowFrozen = false,
  onIntegrityFailure,
} = {}) {
  requireDatabase(primaryDb)
  requireDatabase(authoringDb)
  const authority = await projectionAuthority(primaryDb, allowShadowFrozen)
  const projection = await projectionRow(primaryDb, { geneId, canonicalSymbol })
  if (!projection) {
    throw publicError(
      "PUBLIC_CANONICAL_PROJECTION_NOT_FOUND",
      "Canonical manifestation projection was not found",
      404,
    )
  }
  let record
  try {
    record = await readCanonicalProjectionRecord(authoringDb, projection.gene_id)
  } catch (error) {
    throw publicError(
      "PUBLIC_CANONICAL_AUTHORITY_READ_FAILED",
      "Canonical manifestation authority could not be read",
      503,
      error,
    )
  }
  assertProjectionMatchesAuthority(projection, record, authority)
  const canonical = record.canonical
  if (!canonical) {
    return Object.freeze({
      schema_version: PUBLIC_SCHEMA_VERSION,
      gene_id: record.gene_id,
      canonical_symbol: record.canonical_symbol,
      head_version: nonNegativeInteger(record.head_version, "head_version"),
      gene_revision: Number(record.gene_revision),
      authority_event_id: record.last_event_id,
      authority_event_sequence: Number(record.last_event_sequence),
      canonical: null,
      accepted_tags_derivative: null,
    })
  }
  const prose = await revisionMaterial(authoringDb, env, record, onIntegrityFailure)
  const tagsMaterial = record.accepted_tags_derivative
    ? await derivativeMaterial(authoringDb, env, record, onIntegrityFailure)
    : null
  return Object.freeze({
    schema_version: PUBLIC_SCHEMA_VERSION,
    gene_id: record.gene_id,
    canonical_symbol: record.canonical_symbol,
    head_version: nonNegativeInteger(record.head_version, "head_version"),
    gene_revision: Number(record.gene_revision),
    authority_event_id: record.last_event_id,
    authority_event_sequence: Number(record.last_event_sequence),
    canonical: Object.freeze({
      manifestation_id: canonical.manifestation_id,
      manifestation_revision_id: canonical.manifestation_revision_id,
      canonical_selection_id: canonical.canonical_selection_id,
      body_sha256: canonical.body_sha256,
      body_bytes: Number(canonical.body_bytes),
      prose,
    }),
    accepted_tags_derivative: tagsMaterial ? publicDerivative(record, tagsMaterial) : null,
  })
}

function proofPayload(cutoverRunId, item, material) {
  return {
    cutover_run_id: opaqueId(cutoverRunId, "cutover_run_id"),
    gene_id: item.gene_id,
    canonical_symbol: item.canonical_symbol,
    source_kind: item.source_kind,
    authority_event_sequence: material.authority_event_sequence,
    head_version: material.head_version,
    gene_revision: material.gene_revision,
    canonical: material.canonical
      ? {
          manifestation_id: material.canonical.manifestation_id,
          manifestation_revision_id: material.canonical.manifestation_revision_id,
          canonical_selection_id: material.canonical.canonical_selection_id,
          body_sha256: material.canonical.body_sha256,
          body_bytes: material.canonical.body_bytes,
        }
      : null,
    accepted_tags_derivative: material.accepted_tags_derivative
      ? {
          manifestation_derivative_id:
            material.accepted_tags_derivative.manifestation_derivative_id,
          body_sha256: material.accepted_tags_derivative.body_sha256,
          body_bytes: material.accepted_tags_derivative.body_bytes,
          tags_sha256: material.accepted_tags_derivative.tags_sha256,
          tags_bytes: material.accepted_tags_derivative.tags_bytes,
          fields_sha256: material.accepted_tags_derivative.fields_sha256,
          fields_bytes: material.accepted_tags_derivative.fields_bytes,
        }
      : null,
  }
}

function assertCutoverPlan(item, material) {
  if (
    symbol(item.canonical_symbol) !== material.canonical_symbol ||
    item.gene_id !== material.gene_id
  ) {
    throw publicError(
      "PUBLIC_CANONICAL_CUTOVER_GENE_MISMATCH",
      "Public canonical material differs from the cutover gene identity",
    )
  }
  if (item.source_kind === "no_manifestation") {
    if (material.canonical || material.accepted_tags_derivative) {
      throw publicError(
        "PUBLIC_CANONICAL_CUTOVER_EMPTY_HEAD_MISMATCH",
        "A no-manifestation cutover item projected public material",
      )
    }
    return
  }
  const canonical = material.canonical
  if (
    !canonical ||
    canonical.manifestation_id !== item.seed_manifestation_id ||
    canonical.manifestation_revision_id !== item.seed_revision_id ||
    canonical.canonical_selection_id !== item.seed_selection_id ||
    canonical.body_sha256 !== item.source_body_sha256 ||
    Number(canonical.body_bytes) !== Number(item.source_body_bytes)
  ) {
    throw publicError(
      "PUBLIC_CANONICAL_CUTOVER_BODY_MISMATCH",
      "Public canonical body differs from the immutable cutover plan",
    )
  }
  const expectedDerivativeId = nullableText(item.seed_tags_derivative_id)
  const derivative = material.accepted_tags_derivative
  if (!expectedDerivativeId && derivative) {
    throw publicError(
      "PUBLIC_CANONICAL_CUTOVER_TAGS_MISMATCH",
      "Public canonical Tags differ from the immutable cutover plan",
    )
  }
  if (!expectedDerivativeId) return
  if (
    !derivative ||
    derivative.manifestation_derivative_id !== expectedDerivativeId ||
    derivative.tags_sha256 !== item.source_tags_sha256 ||
    Number(derivative.tags_bytes) !== Number(item.source_tags_bytes) ||
    derivative.fields_sha256 !== item.source_fields_sha256 ||
    Number(derivative.fields_bytes) !== Number(item.source_fields_bytes)
  ) {
    throw publicError(
      "PUBLIC_CANONICAL_CUTOVER_TAGS_MISMATCH",
      "Public canonical Tags differ from the immutable cutover plan",
    )
  }
}

export async function verifyPublicCanonicalMaterialItem({
  primaryDb,
  authoringDb,
  env,
  run,
  item,
  onIntegrityFailure,
} = {}) {
  const runId = opaqueId(run?.cutover_run_id || run, "cutover_run_id")
  if (!item?.gene_id) {
    throw publicError("PUBLIC_CANONICAL_CUTOVER_ITEM_REQUIRED", "Cutover item is required", 400)
  }
  const material = await readPublicCanonicalMaterial({
    primaryDb,
    authoringDb,
    env,
    geneId: item.gene_id,
    allowShadowFrozen: true,
    onIntegrityFailure,
  })
  assertCutoverPlan(item, material)
  const payload = proofPayload(runId, item, material)
  return Object.freeze({
    gene_id: material.gene_id,
    authority_event_sequence: material.authority_event_sequence,
    public_material_proof_sha256: await sha256Hex(
      `${PROOF_NAMESPACE}\n${JSON.stringify(canonicalize(payload))}`,
    ),
  })
}

export async function verifyPublicCanonicalMaterial({ primaryDb, authoringDb, run } = {}) {
  requireDatabase(primaryDb)
  requireDatabase(authoringDb)
  const runId = opaqueId(run?.cutover_run_id || run, "cutover_run_id")
  const storedRun = await first(
    authoringDb,
    `SELECT cutover_run_id, source_gene_count, verified_items, status
       FROM icono_manifestation_cutover_runs WHERE cutover_run_id = ?`,
    runId,
  )
  if (!storedRun) {
    throw publicError("PUBLIC_CANONICAL_CUTOVER_RUN_NOT_FOUND", "Cutover run was not found", 404)
  }
  const items = await all(
    authoringDb,
    `SELECT source_kind, status, authority_event_sequence,
            public_material_proof_sha256, public_material_event_sequence,
            public_material_verified_at
       FROM icono_manifestation_cutover_items WHERE cutover_run_id = ?`,
    runId,
  )
  const complete = items.every(
    (item) =>
      item.status === "verified" &&
      /^[a-f0-9]{64}$/.test(text(item.public_material_proof_sha256)) &&
      Number.isSafeInteger(Number(item.public_material_event_sequence)) &&
      Number(item.public_material_event_sequence) >= 1 &&
      Boolean(text(item.public_material_verified_at)),
  )
  if (
    !complete ||
    items.length !== Number(storedRun.source_gene_count) ||
    items.length !== Number(storedRun.verified_items)
  ) {
    throw publicError(
      "PUBLIC_CANONICAL_CUTOVER_PROOF_INCOMPLETE",
      "Every cutover item must have an exact public material proof",
      409,
    )
  }
  const authority = await projectionAuthority(primaryDb, true)
  if (authority.expected_gene_count !== items.length) {
    throw publicError(
      "PUBLIC_CANONICAL_CUTOVER_COUNT_MISMATCH",
      "Primary and authoring cutover gene counts differ",
      409,
    )
  }
  const snapshotEventSequence = items.reduce(
    (maximum, item) => Math.max(maximum, Number(item.public_material_event_sequence)),
    0,
  )
  return Object.freeze({
    ok: true,
    run_id: runId,
    verified_gene_count: items.length,
    snapshot_event_sequence: snapshotEventSequence,
  })
}

// ARCHITECTURE FENCE [IPD-012]
