import { deleteEncryptedManifestationBody } from "../../lib/iconoplasm-manifestation-body-storage.js"
import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeActorKind,
  normalizeId,
  normalizeOptionalId,
  normalizeSha256,
  normalizeTimestamp,
} from "./manifestation-authority-contract.js"
import {
  all,
  first,
  prepared,
  requireActiveAccount,
  requireDatabase,
} from "./manifestation-authority-repository.js"

const MAX_LEASE_MS = 10 * 60 * 1000
const DEFAULT_LEASE_MS = 2 * 60 * 1000

function entityKind(raw) {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (!new Set(["revision", "derivative"]).has(value)) {
    throw authorityError("INVALID_UPLOAD_ENTITY_KIND", "Upload entity kind is invalid")
  }
  return value
}

function objectKey(raw) {
  const value = String(raw || "").trim()
  if (!/^private\/manifestations\/v1\/[a-f0-9]{2}\/[A-Za-z0-9_-]{8,128}\.bin$/.test(value)) {
    throw authorityError("INVALID_OBJECT_KEY", "Encrypted object locator is invalid")
  }
  return value
}

function futureLease(timestamp, leaseMs = DEFAULT_LEASE_MS) {
  const duration = Math.max(
    30_000,
    Math.min(MAX_LEASE_MS, Math.trunc(Number(leaseMs)) || DEFAULT_LEASE_MS),
  )
  return new Date(Date.parse(timestamp) + duration).toISOString()
}

function mapAdmissionError(error) {
  const message = String(error?.message || error || "")
  if (/authoring_body_quota_exceeded/i.test(message)) {
    return authorityError(
      "AUTHORITY_BODY_QUOTA_EXCEEDED",
      "Authoring body capacity is temporarily exhausted",
      429,
      error,
    )
  }
  if (/caretaker_lineage_body_quota_exceeded/i.test(message)) {
    return authorityError(
      "LINEAGE_BODY_QUOTA_EXCEEDED",
      "This caretaker lineage reached its 2 MiB body limit",
      429,
      error,
    )
  }
  if (/caretaker_lineage_revision_limit_exceeded/i.test(message)) {
    return authorityError(
      "LINEAGE_REVISION_LIMIT_EXCEEDED",
      "This caretaker lineage reached its 256 revision limit",
      429,
      error,
    )
  }
  if (/caretaker_lineage_derivative_limit_exceeded/i.test(message)) {
    return authorityError(
      "LINEAGE_DERIVATIVE_LIMIT_EXCEEDED",
      "This caretaker lineage reached its 512 derivative limit",
      429,
      error,
    )
  }
  return error
}

export async function createManifestationUploadIntent(db, input = {}) {
  requireDatabase(db)
  const kind = entityKind(input.entityKind)
  const operation = String(input.operation || "create")
    .trim()
    .toLowerCase()
  if (!["create", "restore"].includes(operation)) {
    throw authorityError("INVALID_UPLOAD_OPERATION", "Upload operation is invalid")
  }
  const entityId = normalizeId(input.entityId, `${kind}_id`)
  const assignmentId = normalizeOptionalId(input.assignmentId, "caretaker_assignment_id")
  const actorKind = normalizeActorKind(input.actorKind)
  const actorAccountId = normalizeOptionalId(input.actorAccountId, "actor_account_id")
  if (actorKind === "account") {
    await requireActiveAccount(db, actorAccountId)
    if (!assignmentId) {
      throw authorityError(
        "UPLOAD_ASSIGNMENT_REQUIRED",
        "Caretaker uploads require an active assignment",
      )
    }
  }
  const bodyBytes = Number(input.bodyBytes)
  const maximum = kind === "revision" ? 16 * 1024 : 32 * 1024
  if (!Number.isSafeInteger(bodyBytes) || bodyBytes < 1 || bodyBytes > maximum) {
    throw authorityError("INVALID_BODY_BYTES", `Encrypted ${kind} body size is invalid`)
  }
  const timestamp = normalizeTimestamp(input.now)
  const idFactory = input.idFactory || defaultIdFactory
  const uploadIntentId = createId(
    input.uploadIntentId,
    "upload_intent_id",
    "upload_intent",
    idFactory,
  )
  const leaseToken = createId(input.leaseToken, "lease_token", "upload_lease", idFactory)
  const locator = objectKey(input.objectKey)
  const ciphertextSha256 = normalizeSha256(input.ciphertextSha256)
  try {
    await prepared(
      db,
      `INSERT INTO icono_manifestation_upload_intents (
         upload_intent_id, entity_kind, entity_id, operation, caretaker_assignment_id,
         object_key, ciphertext_sha256, planned_body_bytes, status,
         lease_token, lease_expires_at, actor_kind, actor_account_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?, ?)`,
      uploadIntentId,
      kind,
      entityId,
      operation,
      assignmentId,
      locator,
      ciphertextSha256,
      bodyBytes,
      leaseToken,
      futureLease(timestamp, input.leaseMs),
      actorKind,
      actorAccountId,
      timestamp,
    ).run()
  } catch (error) {
    const existing = await first(
      db,
      `SELECT upload_intent_id, entity_kind, entity_id, operation, caretaker_assignment_id,
              object_key, ciphertext_sha256, planned_body_bytes, status,
              lease_token, lease_expires_at, actor_kind, actor_account_id
         FROM icono_manifestation_upload_intents
        WHERE upload_intent_id = ? OR (
          entity_kind = ? AND entity_id = ? AND status IN ('uploading', 'deleting')
        )
        ORDER BY CASE WHEN upload_intent_id = ? THEN 0 ELSE 1 END LIMIT 1`,
      uploadIntentId,
      kind,
      entityId,
      uploadIntentId,
    )
    if (
      existing &&
      existing.operation === operation &&
      existing.object_key === locator &&
      existing.ciphertext_sha256 === ciphertextSha256 &&
      Number(existing.planned_body_bytes) === bodyBytes &&
      (existing.actor_account_id || actorAccountId) === actorAccountId
    )
      return Object.freeze({ ...existing, replayed: true })
    throw mapAdmissionError(error)
  }
  return Object.freeze({
    upload_intent_id: uploadIntentId,
    entity_kind: kind,
    entity_id: entityId,
    operation,
    object_key: locator,
    ciphertext_sha256: ciphertextSha256,
    planned_body_bytes: bodyBytes,
    status: "uploading",
    lease_token: leaseToken,
    lease_expires_at: futureLease(timestamp, input.leaseMs),
    replayed: false,
  })
}

export async function requireAdoptedManifestationUpload(db, entityKindInput, entityIdInput) {
  const kind = entityKind(entityKindInput)
  const entityId = normalizeId(entityIdInput, `${kind}_id`)
  const row = await first(
    db,
    `SELECT upload_intent_id, status, resolved_at
       FROM icono_manifestation_upload_intents
      WHERE entity_kind = ? AND entity_id = ?`,
    kind,
    entityId,
  )
  if (!row || row.status !== "adopted") {
    throw authorityError("UPLOAD_NOT_ADOPTED", "Verified upload was not atomically adopted", 500)
  }
  return row
}

async function claimExpiredIntent(db, row, now, leaseToken) {
  const leaseExpiresAt = futureLease(now, 60_000)
  const result = await prepared(
    db,
    `UPDATE icono_manifestation_upload_intents
        SET status = 'deleting', lease_token = ?, lease_expires_at = ?, attempts = attempts + 1
      WHERE upload_intent_id = ?
        AND status IN ('uploading', 'deleting') AND lease_expires_at <= ?`,
    leaseToken,
    leaseExpiresAt,
    row.upload_intent_id,
    now,
  ).run()
  return Number(result?.meta?.changes || 0) === 1
}

export async function sweepExpiredManifestationUploadIntents(
  db,
  env,
  { limit = 10, now, idFactory = defaultIdFactory } = {},
) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(now)
  const boundedLimit = Math.max(1, Math.min(20, Math.trunc(Number(limit)) || 10))
  const due = await all(
    db,
    `SELECT upload_intent_id, object_key
       FROM icono_manifestation_upload_intents
      WHERE status IN ('uploading', 'deleting') AND lease_expires_at <= ?
      ORDER BY lease_expires_at, upload_intent_id LIMIT ?`,
    timestamp,
    boundedLimit,
  )
  const results = []
  for (const row of due) {
    const leaseToken = createId(null, "lease_token", "upload_sweep", idFactory)
    if (!(await claimExpiredIntent(db, row, timestamp, leaseToken))) continue
    try {
      await deleteEncryptedManifestationBody(env, row.object_key)
      await prepared(
        db,
        `UPDATE icono_manifestation_upload_intents
            SET status = 'deleted', resolved_at = ?, last_error_code = NULL
          WHERE upload_intent_id = ? AND status = 'deleting' AND lease_token = ?`,
        timestamp,
        row.upload_intent_id,
        leaseToken,
      ).run()
      results.push({ upload_intent_id: row.upload_intent_id, status: "deleted" })
    } catch (error) {
      await prepared(
        db,
        `UPDATE icono_manifestation_upload_intents
            SET status = 'uploading', lease_expires_at = ?, last_error_code = ?
          WHERE upload_intent_id = ? AND status = 'deleting' AND lease_token = ?`,
        futureLease(timestamp, 60_000),
        String(error?.name || "storage_delete_failed").slice(0, 80),
        row.upload_intent_id,
        leaseToken,
      ).run()
      results.push({ upload_intent_id: row.upload_intent_id, status: "retry" })
    }
  }
  return Object.freeze({ processed: results.length, results })
}
