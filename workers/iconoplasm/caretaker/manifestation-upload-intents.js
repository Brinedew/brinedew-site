import { deleteManifestationBodyObject } from "../../lib/iconoplasm-manifestation-body-storage.js"
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
import { storageFields } from "./manifestation-storage-contract.js"

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
    throw authorityError("INVALID_OBJECT_KEY", "Body object locator is invalid")
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
    throw authorityError("INVALID_BODY_BYTES", `Upload ${kind} body size is invalid`)
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
  // The object's SHA-256: for a plain body, the text's own hash. The column and
  // this field keep the name they had when every body was an envelope.
  const ciphertextSha256 = normalizeSha256(input.ciphertextSha256)
  const resumableStorage = input.storageDescriptor ? storageFields(input.storageDescriptor) : null
  if (
    resumableStorage &&
    (resumableStorage.object_key !== locator ||
      resumableStorage.ciphertext_sha256 !== ciphertextSha256 ||
      resumableStorage.body_bytes !== bodyBytes)
  ) {
    throw authorityError(
      "UPLOAD_ENVELOPE_MISMATCH",
      "Resumable upload metadata does not match the reservation",
    )
  }
  try {
    await prepared(
      db,
      `INSERT INTO icono_manifestation_upload_intents (
         upload_intent_id, entity_kind, entity_id, operation, caretaker_assignment_id,
         object_key, ciphertext_sha256, planned_body_bytes, status,
         lease_token, lease_expires_at, actor_kind, actor_account_id, created_at,
         body_sha256, ciphertext_bytes, body_iv_base64, wrapped_dek_base64,
         wrap_iv_base64, key_version, aad_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      resumableStorage?.body_sha256 || null,
      resumableStorage?.ciphertext_bytes || null,
      resumableStorage?.body_iv_base64 || null,
      resumableStorage?.wrapped_dek_base64 || null,
      resumableStorage?.wrap_iv_base64 || null,
      resumableStorage?.key_version || null,
      resumableStorage?.aad_version || null,
    ).run()
  } catch (error) {
    const existing = await first(
      db,
      `SELECT upload_intent_id, entity_kind, entity_id, operation, caretaker_assignment_id,
              object_key, ciphertext_sha256, planned_body_bytes, status,
              lease_token, lease_expires_at, actor_kind, actor_account_id,
              body_sha256, ciphertext_bytes, body_iv_base64, wrapped_dek_base64,
              wrap_iv_base64, key_version, aad_version
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
    ...(resumableStorage || {}),
    replayed: false,
  })
}

export async function renewResumableManifestationUploadIntent(
  db,
  entityKindInput,
  entityIdInput,
  { now, leaseMs = MAX_LEASE_MS } = {},
) {
  requireDatabase(db)
  const kind = entityKind(entityKindInput)
  const entityId = normalizeId(entityIdInput, `${kind}_id`)
  const timestamp = normalizeTimestamp(now)
  await prepared(
    db,
    `UPDATE icono_manifestation_upload_intents
        SET lease_expires_at = ?
      WHERE entity_kind = ? AND entity_id = ? AND status = 'uploading'
        AND lease_expires_at > ? AND body_sha256 IS NOT NULL`,
    futureLease(timestamp, leaseMs),
    kind,
    entityId,
    timestamp,
  ).run()
  return first(
    db,
    `SELECT * FROM icono_manifestation_upload_intents
      WHERE entity_kind = ? AND entity_id = ? AND status = 'uploading'
        AND lease_expires_at > ? AND body_sha256 IS NOT NULL`,
    kind,
    entityId,
    timestamp,
  )
}

export async function recycleUnverifiedManifestationUploadIntent(
  db,
  env,
  pending,
  { now, idFactory = defaultIdFactory } = {},
) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(now)
  const uploadIntentId = normalizeId(pending?.upload_intent_id, "upload_intent_id")
  const currentLeaseToken = normalizeId(pending?.lease_token, "lease_token")
  const locator = objectKey(pending?.object_key)
  const recycleLeaseToken = createId(null, "lease_token", "upload_recycle", idFactory)
  const claim = await prepared(
    db,
    `UPDATE icono_manifestation_upload_intents
        SET status = 'deleting', lease_token = ?, lease_expires_at = ?,
            attempts = attempts + 1
      WHERE upload_intent_id = ? AND status = 'uploading' AND lease_token = ?`,
    recycleLeaseToken,
    futureLease(timestamp, MAX_LEASE_MS),
    uploadIntentId,
    currentLeaseToken,
  ).run()
  if (Number(claim?.meta?.changes || 0) !== 1) return false
  try {
    // The intent was never adopted, but a late-visible object may still exist.
    // Delete and prove absence before allowing a new random object for the same
    // immutable entity.
    await deleteManifestationBodyObject(env, locator)
    await prepared(
      db,
      `UPDATE icono_manifestation_upload_intents
          SET status = 'deleted', resolved_at = ?, last_error_code = NULL
        WHERE upload_intent_id = ? AND status = 'deleting' AND lease_token = ?`,
      timestamp,
      uploadIntentId,
      recycleLeaseToken,
    ).run()
    return true
  } catch (error) {
    await prepared(
      db,
      `UPDATE icono_manifestation_upload_intents
          SET status = 'uploading', lease_expires_at = ?, last_error_code = ?
        WHERE upload_intent_id = ? AND status = 'deleting' AND lease_token = ?`,
      futureLease(timestamp, 60_000),
      String(error?.name || "storage_recycle_failed").slice(0, 80),
      uploadIntentId,
      recycleLeaseToken,
    ).run()
    throw error
  }
}

export async function requireAdoptedManifestationUpload(db, entityKindInput, entityIdInput) {
  const kind = entityKind(entityKindInput)
  const entityId = normalizeId(entityIdInput, `${kind}_id`)
  // Verify the currently installed object by two unique keys. A historical
  // adopted intent neither proves this upload nor justifies sorting all past
  // uploads for the entity. `kind` is the validated revision/derivative enum.
  const row = await first(
    db,
    `SELECT intent.upload_intent_id, intent.status, intent.resolved_at
       FROM icono_manifestation_${kind}_storage_secrets storage
       JOIN icono_manifestation_upload_intents intent ON intent.object_key = storage.object_key
      WHERE storage.manifestation_${kind}_id = ?
        AND intent.entity_kind = ? AND intent.entity_id = ? AND intent.status = 'adopted'`,
    entityId,
    kind,
    entityId,
  )
  if (!row) {
    throw authorityError("UPLOAD_NOT_ADOPTED", "Verified upload was not atomically adopted", 500)
  }
  return row
}

async function claimExpiredIntent(db, row, now, leaseToken) {
  // Bunny delete visibility follows the same bounded eventual-consistency
  // window as writes. Hold the claim for the complete idempotent delete proof
  // so another sweeper cannot reclaim the same object mid-verification.
  const leaseExpiresAt = futureLease(now, MAX_LEASE_MS)
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
  { limit = 10, now, idFactory = defaultIdFactory, assignmentId = null } = {},
) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(now)
  const boundedLimit = Math.max(1, Math.min(20, Math.trunc(Number(limit)) || 10))
  const scopedAssignmentId = normalizeOptionalId(assignmentId, "caretaker_assignment_id")
  // B-875: scoped to one caretaker, the read uses the partial quota index, which
  // holds only that caretaker's live intents (usually 0 to 2 rows).
  const due = scopedAssignmentId
    ? await all(
        db,
        `SELECT upload_intent_id, object_key
           FROM icono_manifestation_upload_intents
           INDEXED BY idx_icono_upload_intents_caretaker_quota
          WHERE caretaker_assignment_id = ? AND status IN ('uploading', 'deleting')
            AND lease_expires_at <= ?
          ORDER BY lease_expires_at, upload_intent_id LIMIT ?`,
        scopedAssignmentId,
        timestamp,
        boundedLimit,
      )
    : // B-985: every caretaker at once. The ORDER BY is the due index's own order
      // (idx_icono_upload_intents_due: status, lease_expires_at, created_at), so
      // SQLite stops after `limit` rows however many strays exist. Sorting by
      // lease and id instead needs a temp b-tree that reads every expired row.
      await all(
        db,
        `SELECT upload_intent_id, object_key
           FROM icono_manifestation_upload_intents
          WHERE status IN ('uploading', 'deleting') AND lease_expires_at <= ?
          ORDER BY status, lease_expires_at, created_at LIMIT ?`,
        timestamp,
        boundedLimit,
      )
  const results = []
  for (const row of due) {
    const leaseToken = createId(null, "lease_token", "upload_sweep", idFactory)
    if (!(await claimExpiredIntent(db, row, timestamp, leaseToken))) continue
    try {
      await deleteManifestationBodyObject(env, row.object_key)
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

// B-875: upload admission counts every intent still 'uploading' or 'deleting',
// expired or not, against the global reserve and the caretaker's lineage caps
// (256 revisions, 512 derivatives, 2 MiB). An abandoned upload (a phone losing
// signal mid-autosave) used to hold its share forever. Before reserving, release
// up to three of this caretaker's own expired strays. The cost falls only on
// uploads, and it heals exactly the caretaker who would otherwise be blocked. A
// storage failure here never blocks the upload: the stray is retried next time.
const ADMISSION_SWEEP_LIMIT = 3

// B-985: the per-caretaker release above only helps a caretaker who uploads
// again. One who abandons an upload and never returns would hold the reservation
// and the stored body for good. The `manifestations` background tick (5 runs an
// hour, same database) calls the unscoped sweep with a small limit. Cost: one
// indexed read per run that finds nothing (about 120 a day) and, per stray
// released, one storage delete and about fifteen rows written (index entries
// count). A failed delete puts the intent back for the next run; `ok: false`
// makes the cron log it as pending.
const SCHEDULED_SWEEP_LIMIT = 3

export async function releaseAbandonedManifestationUploads(env, { now } = {}) {
  try {
    const swept = await sweepExpiredManifestationUploadIntents(env?.ICONOPLASM_AUTHORING_DB, env, {
      limit: SCHEDULED_SWEEP_LIMIT,
      now,
    })
    return Object.freeze({
      ok: swept.results.every((result) => result.status === "deleted"),
      ...swept,
    })
  } catch (error) {
    return Object.freeze({
      ok: false,
      processed: 0,
      results: Object.freeze([]),
      code: String(error?.code || error?.name || "sweep_failed").slice(0, 80),
    })
  }
}

export async function admitManifestationUploadIntent(db, env, input = {}) {
  if (input.assignmentId) {
    try {
      await sweepExpiredManifestationUploadIntents(db, env, {
        assignmentId: input.assignmentId,
        limit: ADMISSION_SWEEP_LIMIT,
        now: input.now,
        idFactory: input.idFactory,
      })
    } catch (error) {
      console.warn("[manifestation-upload] stray release deferred", {
        code: String(error?.code || error?.name || "sweep_failed").slice(0, 80),
        message: String(error?.message || "").slice(0, 160),
      })
    }
  }
  return createManifestationUploadIntent(db, input)
}
