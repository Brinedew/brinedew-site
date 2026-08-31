import {
  IconoplasmGenerationSourceError,
  requireExactGenerationProvenance,
} from "./lib/iconoplasm-generation-provenance.js"

const SHA256 = /^[a-f0-9]{64}$/
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,179}$/

export class IconoplasmGenerationLeaseError extends Error {
  constructor(code, message, status = 409) {
    super(message)
    this.name = "IconoplasmGenerationLeaseError"
    this.code = code
    this.status = status
  }
}

function leaseError(code, message, status = 409) {
  throw new IconoplasmGenerationLeaseError(code, message, status)
}

function text(value) {
  return String(value || "").trim()
}

function requiredId(value, field) {
  const normalized = text(value)
  if (!OPAQUE_ID.test(normalized)) {
    leaseError("GENERATION_LEASE_INVALID", `${field} is missing or invalid`)
  }
  return normalized
}

function requiredSha256(value, field) {
  const normalized = text(value).toLowerCase()
  if (!SHA256.test(normalized)) {
    leaseError("GENERATION_LEASE_INVALID", `${field} is missing or invalid`)
  }
  return normalized
}

function positiveInteger(value, field) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    leaseError("GENERATION_LEASE_INVALID", `${field} is missing or invalid`)
  }
  return normalized
}

function optionalInteger(value, field) {
  if (value === null || value === undefined || value === "") return null
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    leaseError("GENERATION_LEASE_INVALID", `${field} is invalid`)
  }
  return normalized
}

function materialPaths(source) {
  const revisionPath = `/api/iconoplasm/authority/revisions/${encodeURIComponent(
    source.source_manifestation_revision_id,
  )}/body`
  const derivativePath = source.source_manifestation_derivative_id
    ? `/api/iconoplasm/authority/derivatives/${encodeURIComponent(
        source.source_manifestation_derivative_id,
      )}/body`
    : null
  return Object.freeze({
    manifestation_revision_body_path: revisionPath,
    manifestation_derivative_body_path: derivativePath,
  })
}

function requireDatabase(db) {
  if (!db?.prepare)
    leaseError("GENERATION_LEASE_DATABASE_REQUIRED", "ICONOPLASM_DB is unavailable", 503)
  return db
}

function clock(raw) {
  const value = raw instanceof Date ? raw : new Date(raw || Date.now())
  if (!Number.isFinite(value.getTime()))
    leaseError("GENERATION_LEASE_INVALID", "Lease time is invalid", 400)
  return value
}

function leaseDurationSeconds(raw) {
  const value = Math.trunc(Number(raw) || 900)
  return Math.max(60, Math.min(3600, value))
}

function defaultIdFactory(kind) {
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    leaseError(
      "CRYPTOGRAPHIC_IDENTITY_UNAVAILABLE",
      "A cryptographic generation lease identity could not be created",
      503,
    )
  }
  return `${kind}_${globalThis.crypto.randomUUID()}`
}

async function readLease(db, generationRequestId) {
  return db
    .prepare(
      `SELECT generation_request_id, request_row_id, generation_attempt_id,
              lease_token, lease_owner_id, lease_version, status,
              claimed_at, expires_at, completed_at, failed_at, failure_code
         FROM icono_generation_execution_leases
        WHERE generation_request_id = ?`,
    )
    .bind(generationRequestId)
    .first()
}

function activeLease(row, ownerId, now) {
  return Boolean(
    row &&
    text(row.status) === "active" &&
    text(row.lease_owner_id) === ownerId &&
    Date.parse(row.expires_at) > now.getTime(),
  )
}

function leaseEnvelope(row) {
  if (!row) return null
  return Object.freeze({
    generation_request_id: requiredId(row.generation_request_id, "generation_request_id"),
    generation_attempt_id: requiredId(row.generation_attempt_id, "generation_attempt_id"),
    generation_lease_token: requiredId(row.lease_token, "generation_lease_token"),
    generation_lease_owner_id: requiredId(row.lease_owner_id, "generation_lease_owner_id"),
    generation_lease_version: positiveInteger(row.lease_version, "generation_lease_version"),
    generation_lease_status: text(row.status),
    generation_lease_claimed_at: text(row.claimed_at),
    generation_lease_expires_at: text(row.expires_at),
  })
}

export async function claimExactGenerationLeases({
  db,
  rows = [],
  leaseOwnerId,
  limit = 10,
  leaseSeconds = 900,
  now = new Date(),
  idFactory = defaultIdFactory,
} = {}) {
  requireDatabase(db)
  const ownerId = requiredId(leaseOwnerId, "lease_owner_id")
  const startedAt = clock(now)
  const claimedAt = startedAt.toISOString()
  const expiresAt = new Date(
    startedAt.getTime() + leaseDurationSeconds(leaseSeconds) * 1000,
  ).toISOString()
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 10)))
  const leases = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (leases.length >= boundedLimit) break
    let exact
    try {
      exact = exactGenerationLeaseFromRow({
        ...row,
        generation_attempt_id: row?.generation_attempt_id || "generation_attempt_pending",
      })
    } catch {
      continue
    }
    const requestId = exact.generation_request_id
    const existing = await readLease(db, requestId)
    if (activeLease(existing, ownerId, startedAt)) {
      leases.push(
        Object.freeze({
          ...exactGenerationLeaseFromRow({
            ...row,
            generation_attempt_id: existing.generation_attempt_id,
          }),
          ...leaseEnvelope(existing),
        }),
      )
      continue
    }
    if (
      existing &&
      (text(existing.status) === "completed" ||
        (text(existing.status) === "active" &&
          Date.parse(existing.expires_at) > startedAt.getTime()))
    ) {
      continue
    }
    const attemptId = requiredId(await idFactory("generation_attempt"), "generation_attempt_id")
    const leaseToken = requiredId(await idFactory("generation_lease"), "generation_lease_token")
    const result = await db
      .prepare(
        `INSERT INTO icono_generation_execution_leases (
           generation_request_id, request_row_id, generation_attempt_id,
           lease_token, lease_owner_id, lease_version, status,
           claimed_at, expires_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)
         ON CONFLICT(generation_request_id) DO UPDATE SET
           request_row_id = excluded.request_row_id,
           generation_attempt_id = excluded.generation_attempt_id,
           lease_token = excluded.lease_token,
           lease_owner_id = excluded.lease_owner_id,
           lease_version = icono_generation_execution_leases.lease_version + 1,
           status = 'active',
           claimed_at = excluded.claimed_at,
           expires_at = excluded.expires_at,
           completed_at = NULL,
           failed_at = NULL,
           failure_code = NULL,
           updated_at = excluded.updated_at
         WHERE icono_generation_execution_leases.status = 'failed'
            OR (icono_generation_execution_leases.status = 'active'
                AND icono_generation_execution_leases.expires_at <= ?)`,
      )
      .bind(
        requestId,
        positiveInteger(row?.id, "request_id"),
        attemptId,
        leaseToken,
        ownerId,
        claimedAt,
        expiresAt,
        claimedAt,
        claimedAt,
      )
      .run()
    if (Number(result?.meta?.changes || 0) < 1) continue
    const claimed = await readLease(db, requestId)
    if (!claimed || text(claimed.lease_token) !== leaseToken) continue
    leases.push(
      Object.freeze({
        ...exactGenerationLeaseFromRow({ ...row, generation_attempt_id: attemptId }),
        ...leaseEnvelope(claimed),
      }),
    )
  }
  return Object.freeze({
    schema_version: 1,
    lease_owner_id: ownerId,
    lease_seconds: leaseDurationSeconds(leaseSeconds),
    leases: Object.freeze(leases),
  })
}

export async function renewExactGenerationLease({
  db,
  leaseToken,
  leaseOwnerId,
  expectedLeaseVersion,
  leaseSeconds = 900,
  now = new Date(),
} = {}) {
  requireDatabase(db)
  const token = requiredId(leaseToken, "generation_lease_token")
  const ownerId = requiredId(leaseOwnerId, "lease_owner_id")
  const version = positiveInteger(expectedLeaseVersion, "expected_lease_version")
  const renewedAt = clock(now)
  const expiresAt = new Date(
    renewedAt.getTime() + leaseDurationSeconds(leaseSeconds) * 1000,
  ).toISOString()
  const result = await db
    .prepare(
      `UPDATE icono_generation_execution_leases
          SET lease_version = lease_version + 1,
              expires_at = ?, updated_at = ?
        WHERE lease_token = ? AND lease_owner_id = ?
          AND lease_version = ? AND status = 'active' AND expires_at > ?`,
    )
    .bind(expiresAt, renewedAt.toISOString(), token, ownerId, version, renewedAt.toISOString())
    .run()
  if (Number(result?.meta?.changes || 0) !== 1) {
    leaseError("GENERATION_LEASE_CAS_MISMATCH", "The generation lease expired or changed", 409)
  }
  const row = await db
    .prepare("SELECT * FROM icono_generation_execution_leases WHERE lease_token = ?")
    .bind(token)
    .first()
  return leaseEnvelope(row)
}

export async function failExactGenerationLease({
  db,
  leaseToken,
  leaseOwnerId,
  expectedLeaseVersion,
  failureCode = "executor_failed",
  now = new Date(),
} = {}) {
  requireDatabase(db)
  const token = requiredId(leaseToken, "generation_lease_token")
  const ownerId = requiredId(leaseOwnerId, "lease_owner_id")
  const version = positiveInteger(expectedLeaseVersion, "expected_lease_version")
  const failedAt = clock(now).toISOString()
  const code = text(failureCode).slice(0, 96)
  if (!code) leaseError("GENERATION_LEASE_INVALID", "failure_code is required", 400)
  const result = await db
    .prepare(
      `UPDATE icono_generation_execution_leases
          SET status = 'failed', failed_at = ?, failure_code = ?, updated_at = ?
        WHERE lease_token = ? AND lease_owner_id = ?
          AND lease_version = ? AND status = 'active'`,
    )
    .bind(failedAt, code, failedAt, token, ownerId, version)
    .run()
  if (Number(result?.meta?.changes || 0) !== 1) {
    leaseError("GENERATION_LEASE_CAS_MISMATCH", "The generation lease changed", 409)
  }
  const row = await db
    .prepare("SELECT * FROM icono_generation_execution_leases WHERE lease_token = ?")
    .bind(token)
    .first()
  return Object.freeze({ ok: true, ...leaseEnvelope(row) })
}

export async function assertExactGenerationLeaseExecution({
  db,
  generationRequestId,
  generationAttemptId,
  leaseToken,
  leaseOwnerId,
  expectedLeaseVersion,
  now = new Date(),
} = {}) {
  requireDatabase(db)
  const requestId = requiredId(generationRequestId, "generation_request_id")
  const attemptId = requiredId(generationAttemptId, "generation_attempt_id")
  const token = requiredId(leaseToken, "generation_lease_token")
  const ownerId = requiredId(leaseOwnerId, "lease_owner_id")
  const version = positiveInteger(expectedLeaseVersion, "expected_lease_version")
  const checkedAt = clock(now)
  const row = await readLease(db, requestId)
  const exactIdentity =
    text(row?.generation_attempt_id) === attemptId &&
    text(row?.lease_token) === token &&
    text(row?.lease_owner_id) === ownerId &&
    Number(row?.lease_version) === version
  const status = text(row?.status)
  const executable =
    exactIdentity &&
    (status === "completed" ||
      (status === "active" && Date.parse(row?.expires_at) > checkedAt.getTime()))
  if (!executable) {
    leaseError("GENERATION_LEASE_CAS_MISMATCH", "The generation lease expired or changed", 409)
  }
  return leaseEnvelope(row)
}

export async function completeExactGenerationLease({
  db,
  generationRequestId,
  generationAttemptId,
  leaseToken,
  leaseOwnerId,
  expectedLeaseVersion,
  now = new Date(),
} = {}) {
  requireDatabase(db)
  const requestId = requiredId(generationRequestId, "generation_request_id")
  const attemptId = requiredId(generationAttemptId, "generation_attempt_id")
  const token = requiredId(leaseToken, "generation_lease_token")
  const ownerId = requiredId(leaseOwnerId, "lease_owner_id")
  const version = positiveInteger(expectedLeaseVersion, "expected_lease_version")
  const completedAt = clock(now).toISOString()
  const existing = await readLease(db, requestId)
  if (
    text(existing?.status) === "completed" &&
    text(existing?.generation_attempt_id) === attemptId &&
    text(existing?.lease_token) === token &&
    text(existing?.lease_owner_id) === ownerId &&
    Number(existing?.lease_version) === version
  ) {
    return Object.freeze({ ok: true, replayed: true, ...leaseEnvelope(existing) })
  }
  const result = await db
    .prepare(
      `UPDATE icono_generation_execution_leases
          SET status = 'completed', completed_at = ?, updated_at = ?
        WHERE generation_request_id = ? AND generation_attempt_id = ?
          AND lease_token = ? AND lease_owner_id = ? AND lease_version = ?
          AND status = 'active' AND expires_at > ?`,
    )
    .bind(completedAt, completedAt, requestId, attemptId, token, ownerId, version, completedAt)
    .run()
  if (Number(result?.meta?.changes || 0) !== 1) {
    leaseError("GENERATION_LEASE_CAS_MISMATCH", "The generation lease expired or changed", 409)
  }
  const completed = await readLease(db, requestId)
  return Object.freeze({ ok: true, replayed: false, ...leaseEnvelope(completed) })
}

function executionRequest(row) {
  return Object.freeze({
    request_id: positiveInteger(row?.id, "request_id"),
    gene_symbol: text(row?.gene_symbol).toUpperCase(),
    full_name: text(row?.full_name),
    request_kind: text(row?.request_kind),
    request_prompt: text(row?.request_prompt),
    request_mode: text(row?.request_mode),
    requested_vision_id: text(row?.requested_vision_id),
    requested_emulsion_id: text(row?.requested_emulsion_id),
    requested_emulsion_slot: Math.max(0, Number(row?.requested_emulsion_slot || 0) || 0),
    requested_workflow_id: text(row?.requested_workflow_id),
    requested_prompt_version: text(row?.requested_prompt_version),
    requested_variant_slot: text(row?.requested_variant_slot),
    factory_pipeline_code: text(row?.factory_pipeline_code),
    factory_vision_revision: Math.max(0, Number(row?.factory_vision_revision || 0) || 0),
    seed_mode: text(row?.seed_mode),
  })
}

export function exactGenerationLeaseFromRow(row) {
  if (text(row?.status).toLowerCase() !== "open") {
    leaseError("GENERATION_REQUEST_NOT_OPEN", "Only open generation requests can be leased")
  }
  const source = requireExactGenerationProvenance(row)
  const generationRequestId = requiredId(row?.generation_request_id, "generation_request_id")
  const generationAttemptId = requiredId(row?.generation_attempt_id, "generation_attempt_id")
  const generationRequestContractSha256 = requiredSha256(
    row?.generation_request_contract_sha256,
    "generation_request_contract_sha256",
  )
  const generationConfigSha256 = requiredSha256(
    row?.generation_config_sha256,
    "generation_config_sha256",
  )
  const request = executionRequest(row)
  return Object.freeze({
    schema_version: 1,
    generation_provenance_status: "bound",
    generation_request_id: generationRequestId,
    generation_attempt_id: generationAttemptId,
    request_ids: Object.freeze([request.request_id]),
    source_gene_id: source.source_gene_id,
    source_manifestation_id: source.source_manifestation_id,
    source_manifestation_revision_id: source.source_manifestation_revision_id,
    source_manifestation_body_sha256: source.source_manifestation_body_sha256,
    source_manifestation_derivative_id: source.source_manifestation_derivative_id,
    source_manifestation_derivative_sha256: source.source_manifestation_derivative_sha256,
    source_manifestation_derivative_tags_sha256: source.source_manifestation_derivative_tags_sha256,
    source_manifestation_derivative_tags_bytes: source.source_manifestation_derivative_tags_bytes,
    source_manifestation_derivative_fields_sha256:
      source.source_manifestation_derivative_fields_sha256,
    source_manifestation_derivative_fields_bytes:
      source.source_manifestation_derivative_fields_bytes,
    source_manifestation_derivative_recipe_id: source.source_manifestation_derivative_recipe_id,
    source_manifestation_derivative_recipe_version:
      source.source_manifestation_derivative_recipe_version,
    source_manifestation_derivative_provider_id: source.source_manifestation_derivative_provider_id,
    source_manifestation_derivative_model_id: source.source_manifestation_derivative_model_id,
    source_manifestation_derivative_tagger_config_sha256:
      source.source_manifestation_derivative_tagger_config_sha256,
    source_canonical_selection_id: source.source_canonical_selection_id,
    source_canonical_head_version: source.source_canonical_head_version,
    source_gene_revision: source.source_gene_revision,
    source_sample_label: source.source_sample_label,
    source_sample_number: optionalInteger(source.source_sample_number, "source_sample_number"),
    source_sample_text_sha256: source.source_sample_text_sha256,
    source_snapshot_sha256: source.source_snapshot_sha256,
    generation_request_contract_sha256: generationRequestContractSha256,
    generation_config_sha256: generationConfigSha256,
    prompt_body_mode: source.prompt_body_mode,
    source_material: materialPaths(source),
    request,
  })
}

export async function buildExactGenerationLeasePlan({ rows = [], validateSource } = {}) {
  if (typeof validateSource !== "function") {
    leaseError(
      "GENERATION_SOURCE_VALIDATOR_REQUIRED",
      "Exact generation lease creation requires the authoring source validator",
      500,
    )
  }
  const leases = []
  const blockedRows = []
  for (const row of Array.isArray(rows) ? rows : []) {
    try {
      const source = await validateSource(row)
      const lease = exactGenerationLeaseFromRow(row)
      if (source?.source_snapshot_sha256 !== lease.source_snapshot_sha256) {
        leaseError(
          "GENERATION_SOURCE_SNAPSHOT_MISMATCH",
          "The validated authoring source differs from the stored request snapshot",
        )
      }
      leases.push(lease)
    } catch (error) {
      blockedRows.push(
        Object.freeze({
          request_id: Math.max(0, Number(row?.id || 0) || 0),
          generation_request_id: text(row?.generation_request_id),
          gene_symbol: text(row?.gene_symbol).toUpperCase(),
          source_manifestation_revision_id: text(row?.source_manifestation_revision_id),
          source_snapshot_sha256: text(row?.source_snapshot_sha256).toLowerCase(),
          code:
            error instanceof IconoplasmGenerationLeaseError ||
            error instanceof IconoplasmGenerationSourceError
              ? error.code
              : "GENERATION_LEASE_FAILED",
          error: text(error?.message || error || "Generation lease failed").slice(0, 500),
        }),
      )
    }
  }
  return Object.freeze({
    leases: Object.freeze(leases),
    blocked_rows: Object.freeze(blockedRows),
  })
}
