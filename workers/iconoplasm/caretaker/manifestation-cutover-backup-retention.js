import { sha256Hex } from "../../lib/iconoplasm-manifestation-body-crypto.js"
import { deleteEncryptedManifestationBody } from "../../lib/iconoplasm-manifestation-body-storage.js"
import { normalizeId, normalizeTimestamp } from "./manifestation-authority-contract.js"
import { all, first, prepared, requireDatabase } from "./manifestation-authority-repository.js"
import { advanceManifestationSnapshotChain } from "./manifestation-snapshot-hash.js"
import {
  cutoverBackupStorageEnvironment,
  safeArtifact,
} from "./manifestation-cutover-backup-artifact.js"
import { ManifestationAuthorityCutoverError } from "./manifestation-authority-cutover.js"

export const CUTOVER_BACKUP_RETENTION_DAYS = 30
const ZERO_SHA256 = "0".repeat(64)

function error(code, message, status = 409, cause) {
  return new ManifestationAuthorityCutoverError(code, message, status, cause)
}

function boundedLimit(raw, fallback = 8, max = 12) {
  return Math.max(1, Math.min(max, Math.trunc(Number(raw)) || fallback))
}

function retentionExpiry(verifiedAt) {
  const verified = new Date(normalizeTimestamp(verifiedAt))
  return new Date(verified.getTime() + CUTOVER_BACKUP_RETENTION_DAYS * 86_400_000).toISOString()
}

async function readArtifact(db, artifactId) {
  return first(
    db,
    "SELECT * FROM icono_manifestation_cutover_backup_artifacts WHERE backup_artifact_id = ?",
    artifactId,
  )
}

async function hasActiveArtifactLegalHold(db, artifactId) {
  return first(
    db,
    `SELECT hold.legal_hold_id
       FROM icono_manifestation_legal_holds hold
      WHERE hold.released_at IS NULL AND (
        EXISTS (
          SELECT 1
            FROM icono_manifestation_cutover_backup_entries entry
            JOIN icono_manifestation_revisions revision
              ON revision.manifestation_revision_id = entry.entity_id
            WHERE entry.backup_artifact_id = ? AND entry.entity_kind = 'revision'
              AND revision.manifestation_id = hold.manifestation_id
        ) OR EXISTS (
          SELECT 1
            FROM icono_manifestation_cutover_backup_entries entry
            JOIN icono_manifestation_derivatives derivative
              ON derivative.manifestation_derivative_id = entry.entity_id
            JOIN icono_manifestation_revisions revision
              ON revision.manifestation_revision_id = derivative.manifestation_revision_id
            WHERE entry.backup_artifact_id = ? AND entry.entity_kind = 'derivative'
              AND revision.manifestation_id = hold.manifestation_id
        )
      ) LIMIT 1`,
    artifactId,
    artifactId,
  )
}

export async function scheduleManifestationCutoverBackupRetention(db, input = {}) {
  requireDatabase(db)
  const artifactId = normalizeId(input.backupArtifactId, "backup_artifact_id")
  const runId = normalizeId(input.cutoverRunId, "cutover_run_id")
  const expiry = retentionExpiry(input.plaintextRetirementVerifiedAt)
  const timestamp = normalizeTimestamp(input.now)
  const artifact = await readArtifact(db, artifactId)
  if (!artifact || artifact.cutover_run_id !== runId) {
    throw error("CUTOVER_BACKUP_NOT_FOUND", "Cutover backup artifact was not found", 404)
  }
  if (artifact.status === "verified") {
    await prepared(
      db,
      `UPDATE icono_manifestation_cutover_backup_artifacts
          SET status = 'retention_pending', retention_expires_at = ?, updated_at = ?
        WHERE backup_artifact_id = ? AND status = 'verified'`,
      expiry,
      timestamp,
      artifactId,
    ).run()
  }
  const scheduled = await readArtifact(db, artifactId)
  if (
    !new Set(["retention_pending", "deleting", "delete_failed", "held", "deleted"]).has(
      scheduled.status,
    ) ||
    scheduled.retention_expires_at !== expiry
  ) {
    throw error(
      "CUTOVER_BACKUP_RETENTION_CONFLICT",
      "Cutover backup retention is already bound to a different retirement",
    )
  }
  return Object.freeze({
    ...safeArtifact(scheduled),
    retention_expires_at: scheduled.retention_expires_at,
    deleted_at: scheduled.deleted_at || null,
  })
}

async function queueDeletionPage(db, artifact, limit, timestamp) {
  const objects = await all(
    db,
    `WITH artifact_objects(object_kind, object_identity, object_key, expected_sha256) AS (
       SELECT 'package', entity_kind || ':' || entity_id, package_object_key, package_sha256
         FROM icono_manifestation_cutover_backup_entries
        WHERE backup_artifact_id = ? AND status = 'verified'
       UNION ALL
       SELECT 'inventory_part', CAST(part_number AS TEXT), part_object_key, part_sha256
         FROM icono_manifestation_cutover_backup_parts
        WHERE backup_artifact_id = ? AND status = 'verified'
       UNION ALL
       SELECT 'root', 'root', root_object_key, root_sha256
         FROM icono_manifestation_cutover_backup_artifacts
        WHERE backup_artifact_id = ? AND root_object_key IS NOT NULL
     )
     SELECT object_kind, object_identity, object_key, expected_sha256
       FROM artifact_objects object
      WHERE NOT EXISTS (
        SELECT 1 FROM icono_manifestation_cutover_backup_deletions deletion
         WHERE deletion.backup_artifact_id = ?
           AND deletion.object_kind = object.object_kind
           AND deletion.object_identity = object.object_identity
      )
      ORDER BY object_kind, object_identity LIMIT ?`,
    artifact.backup_artifact_id,
    artifact.backup_artifact_id,
    artifact.backup_artifact_id,
    artifact.backup_artifact_id,
    limit,
  )
  if (!objects.length) return 0
  const statements = objects.map((object) =>
    prepared(
      db,
      `INSERT INTO icono_manifestation_cutover_backup_deletions (
       backup_artifact_id, object_kind, object_identity, object_key,
       expected_sha256, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
      artifact.backup_artifact_id,
      object.object_kind,
      object.object_identity,
      object.object_key,
      object.expected_sha256,
      timestamp,
    ),
  )
  statements.push(
    prepared(
      db,
      `UPDATE icono_manifestation_cutover_backup_artifacts
        SET status = 'deleting', deletion_started_at = COALESCE(deletion_started_at, ?),
            deletion_next_attempt_at = NULL, deletion_last_error_code = NULL, updated_at = ?
      WHERE backup_artifact_id = ?
        AND status IN ('retention_pending', 'delete_failed', 'held', 'deleting')`,
      timestamp,
      timestamp,
      artifact.backup_artifact_id,
    ),
  )
  await db.batch(statements)
  return objects.length
}

async function deletionReceipt(db, artifactId) {
  const rows = await all(
    db,
    `SELECT object_kind, object_identity, expected_sha256
       FROM icono_manifestation_cutover_backup_deletions
      WHERE backup_artifact_id = ? AND status = 'deleted'
      ORDER BY object_kind, object_identity`,
    artifactId,
  )
  let chain = ZERO_SHA256
  let ordinal = 1
  for (const row of rows) {
    const payload = await sha256Hex(
      new TextEncoder().encode(
        `${row.object_kind}\n${row.object_identity}\n${row.expected_sha256}`,
      ),
    )
    chain = await advanceManifestationSnapshotChain(chain, ordinal, payload)
    ordinal += 1
  }
  return { count: rows.length, sha256: chain }
}

async function finalizeDeletedArtifact(db, artifact, timestamp) {
  const unqueued = await queueDeletionPage(db, artifact, 1, timestamp)
  if (unqueued) return false
  const pending = await first(
    db,
    `SELECT count(*) AS total FROM icono_manifestation_cutover_backup_deletions
      WHERE backup_artifact_id = ? AND status <> 'deleted'`,
    artifact.backup_artifact_id,
  )
  if (Number(pending?.total || 0)) return false
  const receipt = await deletionReceipt(db, artifact.backup_artifact_id)
  if (!receipt.count)
    throw error("CUTOVER_BACKUP_DELETE_EMPTY", "Cutover backup deletion inventory is empty", 500)
  await db.batch([
    prepared(
      db,
      "DELETE FROM icono_manifestation_cutover_backup_parts WHERE backup_artifact_id = ?",
      artifact.backup_artifact_id,
    ),
    prepared(
      db,
      "DELETE FROM icono_manifestation_cutover_backup_entries WHERE backup_artifact_id = ?",
      artifact.backup_artifact_id,
    ),
    prepared(
      db,
      `UPDATE icono_manifestation_cutover_backup_artifacts
          SET status = 'deleted', root_object_key = NULL,
              deleted_object_count = ?, deletion_receipt_sha256 = ?,
              deleted_at = ?, updated_at = ?, deletion_next_attempt_at = NULL,
              deletion_last_error_code = NULL
        WHERE backup_artifact_id = ? AND status = 'deleting'`,
      receipt.count,
      receipt.sha256,
      timestamp,
      timestamp,
      artifact.backup_artifact_id,
    ),
  ])
  return true
}

function retryAt(timestamp, attempts) {
  const seconds = Math.min(3_600, 30 * 2 ** Math.min(6, attempts))
  return new Date(new Date(timestamp).getTime() + seconds * 1000).toISOString()
}

export async function sweepManifestationCutoverBackupRetention(db, env, input = {}) {
  requireDatabase(db)
  const backupEnv = cutoverBackupStorageEnvironment(env)
  const timestamp = normalizeTimestamp(input.now)
  const limit = boundedLimit(input.limit)
  const artifact = await first(
    db,
    `SELECT * FROM icono_manifestation_cutover_backup_artifacts
      WHERE status IN ('retention_pending', 'deleting', 'delete_failed', 'held')
        AND retention_expires_at <= ?
        AND (deletion_next_attempt_at IS NULL OR deletion_next_attempt_at <= ?)
      ORDER BY retention_expires_at, backup_artifact_id LIMIT 1`,
    timestamp,
    timestamp,
  )
  if (!artifact) return Object.freeze({ schema_version: 1, processed: 0, deleted: false })
  if (await hasActiveArtifactLegalHold(db, artifact.backup_artifact_id)) {
    await db.batch([
      prepared(
        db,
        `UPDATE icono_manifestation_cutover_backup_artifacts
            SET status = 'held', updated_at = ?
          WHERE backup_artifact_id = ? AND status <> 'deleted'`,
        timestamp,
        artifact.backup_artifact_id,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_cutover_backup_deletions
            SET status = 'held'
          WHERE backup_artifact_id = ? AND status IN ('pending', 'failed')`,
        artifact.backup_artifact_id,
      ),
    ])
    return Object.freeze({
      schema_version: 1,
      backup_artifact_id: artifact.backup_artifact_id,
      processed: 0,
      held: true,
      deleted: false,
    })
  }
  if (artifact.status === "held") {
    await db.batch([
      prepared(
        db,
        `UPDATE icono_manifestation_cutover_backup_artifacts SET status = 'deleting', updated_at = ?
          WHERE backup_artifact_id = ? AND status = 'held'`,
        timestamp,
        artifact.backup_artifact_id,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_cutover_backup_deletions SET status = 'pending'
          WHERE backup_artifact_id = ? AND status = 'held'`,
        artifact.backup_artifact_id,
      ),
    ])
  } else if (artifact.status === "retention_pending" || artifact.status === "delete_failed") {
    await prepared(
      db,
      `UPDATE icono_manifestation_cutover_backup_artifacts
          SET status = 'deleting', deletion_started_at = COALESCE(deletion_started_at, ?),
              deletion_next_attempt_at = NULL, deletion_last_error_code = NULL, updated_at = ?
        WHERE backup_artifact_id = ? AND status IN ('retention_pending', 'delete_failed')`,
      timestamp,
      timestamp,
      artifact.backup_artifact_id,
    ).run()
  }
  await queueDeletionPage(db, artifact, limit, timestamp)
  const due = await all(
    db,
    `SELECT object_kind, object_identity, object_key, attempts
       FROM icono_manifestation_cutover_backup_deletions
      WHERE backup_artifact_id = ? AND status IN ('pending', 'failed')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY object_kind, object_identity LIMIT ?`,
    artifact.backup_artifact_id,
    timestamp,
    limit,
  )
  let processed = 0
  for (const object of due) {
    if (await hasActiveArtifactLegalHold(db, artifact.backup_artifact_id)) {
      await prepared(
        db,
        `UPDATE icono_manifestation_cutover_backup_artifacts SET status = 'held', updated_at = ?
          WHERE backup_artifact_id = ? AND status <> 'deleted'`,
        timestamp,
        artifact.backup_artifact_id,
      ).run()
      break
    }
    try {
      await deleteEncryptedManifestationBody(backupEnv, object.object_key)
      await prepared(
        db,
        `UPDATE icono_manifestation_cutover_backup_deletions
            SET status = 'deleted', attempts = attempts + 1, next_attempt_at = NULL,
                last_error_code = NULL, deleted_at = ?
          WHERE backup_artifact_id = ? AND object_kind = ? AND object_identity = ?
            AND status IN ('pending', 'failed')`,
        timestamp,
        artifact.backup_artifact_id,
        object.object_kind,
        object.object_identity,
      ).run()
      processed += 1
    } catch (cause) {
      const code = String(cause?.message || "backup_delete_failed").slice(0, 120)
      const attempts = Number(object.attempts || 0) + 1
      await db.batch([
        prepared(
          db,
          `UPDATE icono_manifestation_cutover_backup_deletions
              SET status = 'failed', attempts = ?, next_attempt_at = ?, last_error_code = ?
            WHERE backup_artifact_id = ? AND object_kind = ? AND object_identity = ?
              AND status IN ('pending', 'failed')`,
          attempts,
          retryAt(timestamp, attempts),
          code,
          artifact.backup_artifact_id,
          object.object_kind,
          object.object_identity,
        ),
        prepared(
          db,
          `UPDATE icono_manifestation_cutover_backup_artifacts
              SET status = 'delete_failed', deletion_attempts = deletion_attempts + 1,
                  deletion_next_attempt_at = ?, deletion_last_error_code = ?, updated_at = ?
            WHERE backup_artifact_id = ? AND status <> 'deleted'`,
          retryAt(timestamp, attempts),
          code,
          timestamp,
          artifact.backup_artifact_id,
        ),
      ])
      return Object.freeze({
        schema_version: 1,
        backup_artifact_id: artifact.backup_artifact_id,
        processed,
        failed: true,
        deleted: false,
      })
    }
  }
  const refreshed = await readArtifact(db, artifact.backup_artifact_id)
  const deleted = await finalizeDeletedArtifact(db, refreshed, timestamp)
  return Object.freeze({
    schema_version: 1,
    backup_artifact_id: artifact.backup_artifact_id,
    processed,
    held: false,
    deleted,
  })
}

export async function sweepDeletedCutoverBackupAudit(db, input = {}) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(input.now)
  const auditSeconds = Math.max(
    86_400,
    Math.min(30 * 86_400, Math.trunc(Number(input.auditSeconds)) || 7 * 86_400),
  )
  const cutoff = new Date(new Date(timestamp).getTime() - auditSeconds * 1000).toISOString()
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(input.limit)) || 50))
  const rows = await all(
    db,
    `SELECT deletion.backup_artifact_id, deletion.object_kind, deletion.object_identity
       FROM icono_manifestation_cutover_backup_deletions deletion
       JOIN icono_manifestation_cutover_backup_artifacts artifact
         ON artifact.backup_artifact_id = deletion.backup_artifact_id
      WHERE artifact.status = 'deleted' AND artifact.deleted_at <= ?
      ORDER BY deletion.backup_artifact_id, deletion.object_kind, deletion.object_identity
      LIMIT ?`,
    cutoff,
    limit,
  )
  if (rows.length) {
    await db.batch(
      rows.map((row) =>
        prepared(
          db,
          `DELETE FROM icono_manifestation_cutover_backup_deletions
        WHERE backup_artifact_id = ? AND object_kind = ? AND object_identity = ?
          AND status = 'deleted'`,
          row.backup_artifact_id,
          row.object_kind,
          row.object_identity,
        ),
      ),
    )
  }
  return Object.freeze({ schema_version: 1, purged: rows.length })
}
