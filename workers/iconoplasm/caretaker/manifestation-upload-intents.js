import { deleteManifestationBodyObject } from "../../lib/iconoplasm-manifestation-body-storage.js"
import {
  createId,
  defaultIdFactory,
  normalizeOptionalId,
  normalizeTimestamp,
} from "./manifestation-authority-contract.js"
import { all, prepared, requireDatabase } from "./manifestation-authority-repository.js"

// Upload reservations are retired (B-859, migration 0023): a save uploads its
// bodies, commits, and deletes them itself if nothing adopted them
// (manifestation-uploaded-bodies.js). What is left here releases the
// reservations written before that change: a stray that a crashed or abandoned
// save left 'uploading' still holds its share of the byte reserve and its
// stored body. Once none is left, a later migration drops the table, its
// triggers and this file.

const MAX_LEASE_MS = 10 * 60 * 1000

function futureLease(timestamp, leaseMs) {
  return new Date(Date.parse(timestamp) + Math.min(MAX_LEASE_MS, leaseMs)).toISOString()
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

// B-985: the `manifestations` background tick (5 runs an hour, same database)
// calls the unscoped sweep with a small limit. Cost: one indexed read per run
// that finds nothing (about 120 a day) and, per stray released, one storage
// delete and about fifteen rows written. A failed delete puts the intent back
// for the next run; `ok: false` makes the cron log it as pending.
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
