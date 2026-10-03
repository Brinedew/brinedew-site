// ARCHITECTURE FENCE [IPD-012]: public manifestation text is read from the
// exact authoring authority object selected by the compact primary head. This
// module never reads the primary database's old essence text and never exposes
// object locators. It also never reads or returns the gene's Tags (the generated
// image tags): the caretaker panel promises they stay private, so the one public
// object is built from the prose alone. Tags travel only through the
// authenticated caretaker and replica routes.
import { readManifestationProse } from "../../lib/iconoplasm-manifestation-body-reader.js"
import { first, requireDatabase } from "./manifestation-authority-repository.js"
import { readCanonicalProjectionRecord } from "./manifestation-authority-projection-read.js"

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
    "canonical_public_page_visible",
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
    canonical_public_page_visible: exactRecord.canonical?.public_page_visible ? 1 : 0,
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
    const prose = await readManifestationProse(env, secret, {
      revisionId: revision.manifestation_revision_id,
      geneId: record.gene_id,
      bodySha256: revision.body_sha256,
      bodyBytes: Number(revision.body_bytes),
    })
    if (prose === null) throw new Error("revision_body_missing")
    return prose
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
    })
  }
  const prose = await revisionMaterial(authoringDb, env, record, onIntegrityFailure)
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
      public_page_visible: canonical.public_page_visible === true,
      prose,
    }),
  })
}

// ARCHITECTURE FENCE [IPD-012]
