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

function retryAt(now, attempts) {
  const delaySeconds = Math.min(24 * 60 * 60, 30 * 2 ** Math.min(10, attempts))
  return new Date(new Date(now).getTime() + delaySeconds * 1000).toISOString()
}

function errorCode(error) {
  return String(error?.code || error?.name || "storage_delete_failed")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .slice(0, 128)
}

async function auditedActor(db, { actorKind = "service", actorAccountId = null } = {}) {
  const kind = normalizeActorKind(actorKind)
  const accountId = normalizeOptionalId(actorAccountId, "actor_account_id")
  if (accountId) await requireActiveAccount(db, accountId)
  return { actorKind: kind, actorAccountId: accountId }
}

export async function enqueueManifestationOrphanObject(
  db,
  {
    entityKind,
    entityId,
    objectKey,
    ciphertextSha256,
    actorKind = "service",
    actorAccountId = null,
    orphanId,
    idFactory = defaultIdFactory,
    now,
  } = {},
) {
  requireDatabase(db)
  const actor = await auditedActor(db, { actorKind, actorAccountId })
  const kind = String(entityKind || "")
    .trim()
    .toLowerCase()
  if (!["revision", "derivative"].includes(kind)) {
    throw authorityError("INVALID_ORPHAN_ENTITY", "Orphan entity kind is invalid")
  }
  const entityIdNorm = normalizeId(entityId, "entity_id")
  const key = String(objectKey || "").trim()
  if (!/^private\/manifestations\/v1\/[a-f0-9]{2}\/[A-Za-z0-9_-]{32,128}\.bin$/.test(key)) {
    throw authorityError("INVALID_OBJECT_KEY", "Manifestation object key is invalid")
  }
  const hash = normalizeSha256(ciphertextSha256, "ciphertext_sha256")
  const timestamp = normalizeTimestamp(now)
  const orphanIdNorm = createId(orphanId, "orphan_id", "orphan", idFactory)
  await prepared(
    db,
    `INSERT INTO icono_manifestation_orphan_objects (
       orphan_id, entity_kind, entity_id, object_key, ciphertext_sha256,
       requested_by_actor_kind, requested_by_account_id, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(object_key) DO NOTHING`,
    orphanIdNorm,
    kind,
    entityIdNorm,
    key,
    hash,
    actor.actorKind,
    actor.actorAccountId,
    timestamp,
  ).run()
  const stored = await first(
    db,
    `SELECT orphan_id, entity_kind, entity_id, ciphertext_sha256, status
       FROM icono_manifestation_orphan_objects WHERE object_key = ?`,
    key,
  )
  if (
    !stored ||
    stored.entity_kind !== kind ||
    stored.entity_id !== entityIdNorm ||
    stored.ciphertext_sha256 !== hash
  ) {
    throw authorityError(
      "OBJECT_LOCATOR_COLLISION",
      "Object locator is already bound to another encrypted entity",
      409,
    )
  }
  return Object.freeze({ ok: true, orphan_id: stored.orphan_id, status: stored.status })
}

export async function reconcileManifestationUpload(
  db,
  env,
  {
    entityKind,
    entityId,
    objectKey,
    ciphertextSha256,
    actorKind = "service",
    actorAccountId = null,
    now,
  } = {},
) {
  requireDatabase(db)
  const kind = String(entityKind || "")
    .trim()
    .toLowerCase()
  if (!["revision", "derivative"].includes(kind)) {
    throw authorityError("INVALID_ORPHAN_ENTITY", "Orphan entity kind is invalid")
  }
  const entityIdNorm = normalizeId(entityId, "entity_id")
  const hash = normalizeSha256(ciphertextSha256, "ciphertext_sha256")
  const key = String(objectKey || "").trim()
  const storageTable =
    kind === "revision"
      ? "icono_manifestation_revision_storage_secrets"
      : "icono_manifestation_derivative_storage_secrets"
  const storageIdColumn =
    kind === "revision" ? "manifestation_revision_id" : "manifestation_derivative_id"
  const adopted = await first(
    db,
    `SELECT 1 AS adopted FROM ${storageTable}
      WHERE ${storageIdColumn} = ? AND object_key = ? AND ciphertext_sha256 = ?`,
    entityIdNorm,
    key,
    hash,
  )
  if (adopted) {
    await prepared(
      db,
      `UPDATE icono_manifestation_orphan_objects
          SET status = 'adopted', resolved_at = ?, next_attempt_at = NULL,
              last_error_code = NULL
        WHERE object_key = ? AND entity_kind = ? AND entity_id = ?
          AND ciphertext_sha256 = ? AND status IN ('pending', 'failed')`,
      normalizeTimestamp(now),
      key,
      kind,
      entityIdNorm,
      hash,
    ).run()
    return Object.freeze({ ok: true, status: "adopted" })
  }
  await enqueueManifestationOrphanObject(db, {
    entityKind: kind,
    entityId: entityIdNorm,
    objectKey: key,
    ciphertextSha256: hash,
    actorKind,
    actorAccountId,
    now,
  })
  try {
    await deleteEncryptedManifestationBody(env, key)
    await prepared(
      db,
      `UPDATE icono_manifestation_orphan_objects
          SET status = 'deleted', attempts = attempts + 1, resolved_at = ?,
              next_attempt_at = NULL, last_error_code = NULL
        WHERE object_key = ? AND status IN ('pending', 'failed')`,
      normalizeTimestamp(now),
      key,
    ).run()
    return Object.freeze({ ok: true, status: "deleted" })
  } catch (error) {
    const timestamp = normalizeTimestamp(now)
    const current = await first(
      db,
      "SELECT attempts FROM icono_manifestation_orphan_objects WHERE object_key = ?",
      key,
    )
    const attempts = Number(current?.attempts || 0) + 1
    await prepared(
      db,
      `UPDATE icono_manifestation_orphan_objects
          SET status = 'failed', attempts = ?, next_attempt_at = ?, last_error_code = ?
        WHERE object_key = ?`,
      attempts,
      retryAt(timestamp, attempts),
      errorCode(error),
      key,
    ).run()
    throw authorityError(
      "ORPHAN_RECONCILIATION_FAILED",
      "Uploaded object cleanup failed",
      503,
      error,
    )
  }
}

async function finishPurgeRow(db, row, timestamp) {
  const statements = []
  if (row.entity_kind === "derivative") {
    statements.push(
      prepared(
        db,
        `UPDATE icono_manifestation_derivatives SET status = 'purged'
          WHERE manifestation_derivative_id = ? AND EXISTS (
            SELECT 1 FROM icono_manifestation_revision_lifecycle lifecycle
             WHERE lifecycle.manifestation_revision_id =
               icono_manifestation_derivatives.manifestation_revision_id
               AND lifecycle.status = 'purged'
          )`,
        row.entity_id,
      ),
    )
  }
  statements.push(
    prepared(
      db,
      `UPDATE icono_manifestation_object_purge_queue
          SET status = 'deleted', attempts = attempts + 1, deleted_at = ?, next_attempt_at = NULL
        WHERE purge_id = ? AND status = 'processing'`,
      timestamp,
      row.purge_id,
    ),
  )
  await db.batch(statements)
}

async function purgeRowIsEligible(db, row) {
  if (row.entity_kind === "orphan") {
    const referenced = await first(
      db,
      `SELECT 1 AS referenced
         FROM icono_manifestation_revision_storage_secrets WHERE object_key = ?
       UNION ALL
       SELECT 1 AS referenced
         FROM icono_manifestation_derivative_storage_secrets WHERE object_key = ?
       LIMIT 1`,
      row.object_key,
      row.object_key,
    )
    return !referenced
  }
  if (row.entity_kind === "revision") {
    return Boolean(
      await first(
        db,
        `SELECT 1 AS eligible
           FROM icono_manifestation_revisions revision
           JOIN icono_manifestations manifestation
             ON manifestation.manifestation_id = revision.manifestation_id
           JOIN icono_manifestation_revision_lifecycle lifecycle
             ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
          WHERE revision.manifestation_revision_id = ? AND lifecycle.status = 'purged'
            AND manifestation.status = 'purged'
            AND NOT EXISTS (
              SELECT 1 FROM icono_manifestation_heads head
               WHERE head.canonical_revision_id = revision.manifestation_revision_id
            )
            AND NOT EXISTS (
              SELECT 1 FROM icono_manifestation_legal_holds hold
               WHERE hold.manifestation_id = manifestation.manifestation_id
                 AND hold.released_at IS NULL
            )`,
        row.entity_id,
      ),
    )
  }
  return Boolean(
    await first(
      db,
      `SELECT 1 AS eligible
         FROM icono_manifestation_derivatives derivative
         JOIN icono_manifestation_revisions revision
           ON revision.manifestation_revision_id = derivative.manifestation_revision_id
         JOIN icono_manifestations manifestation
           ON manifestation.manifestation_id = revision.manifestation_id
         JOIN icono_manifestation_revision_lifecycle lifecycle
           ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
        WHERE derivative.manifestation_derivative_id = ? AND lifecycle.status = 'purged'
          AND manifestation.status = 'purged'
          AND NOT EXISTS (
            SELECT 1 FROM icono_manifestation_legal_holds hold
             WHERE hold.manifestation_id = manifestation.manifestation_id
               AND hold.released_at IS NULL
          )`,
      row.entity_id,
    ),
  )
}

async function claimPurgeRow(db, row) {
  return first(
    db,
    `UPDATE icono_manifestation_object_purge_queue AS queue
        SET status = 'processing'
      WHERE purge_id = ? AND status IN ('pending', 'failed')
        AND NOT EXISTS (
          SELECT 1 FROM icono_manifestation_legal_holds hold
           WHERE hold.released_at IS NULL AND hold.manifestation_id IN (
             SELECT revision.manifestation_id
               FROM icono_manifestation_revisions revision
              WHERE revision.manifestation_revision_id = queue.entity_id
             UNION
             SELECT revision.manifestation_id
               FROM icono_manifestation_derivatives derivative
               JOIN icono_manifestation_revisions revision
                 ON revision.manifestation_revision_id = derivative.manifestation_revision_id
              WHERE derivative.manifestation_derivative_id = queue.entity_id
           )
        )
      RETURNING purge_id`,
    row.purge_id,
  )
}

export async function sweepManifestationPurgeQueue(db, env, { limit = 25, now } = {}) {
  requireDatabase(db)
  const boundedLimit = Math.max(1, Math.min(20, Math.trunc(Number(limit)) || 20))
  const timestamp = normalizeTimestamp(now)
  const queue = await all(
    db,
    `SELECT purge_id, entity_kind, entity_id, object_key, ciphertext_sha256, attempts
       FROM icono_manifestation_object_purge_queue
      WHERE status IN ('pending', 'failed')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at, purge_id
      LIMIT ?`,
    timestamp,
    boundedLimit,
  )
  const results = []
  for (const item of queue) {
    try {
      if (!(await purgeRowIsEligible(db, item))) {
        await prepared(
          db,
          `UPDATE icono_manifestation_object_purge_queue
              SET status = 'held', next_attempt_at = NULL
            WHERE purge_id = ? AND status IN ('pending', 'failed')`,
          item.purge_id,
        ).run()
        results.push({ purge_id: item.purge_id, status: "held" })
        continue
      }
      if (!(await claimPurgeRow(db, item))) {
        results.push({ purge_id: item.purge_id, status: "held" })
        continue
      }
      await deleteEncryptedManifestationBody(env, item.object_key)
      await finishPurgeRow(db, item, timestamp)
      results.push({ purge_id: item.purge_id, status: "deleted" })
    } catch (error) {
      const attempts = Number(item.attempts || 0) + 1
      await prepared(
        db,
        `UPDATE icono_manifestation_object_purge_queue
            SET status = 'failed', attempts = ?, next_attempt_at = ?
          WHERE purge_id = ? AND status = 'processing'`,
        attempts,
        retryAt(timestamp, attempts),
        item.purge_id,
      ).run()
      results.push({ purge_id: item.purge_id, status: "failed", error_code: errorCode(error) })
    }
  }
  return Object.freeze({ processed: results.length, results })
}

export async function sweepManifestationOrphans(db, env, { limit = 25, now } = {}) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(now)
  const rows = await all(
    db,
    `SELECT entity_kind, entity_id, object_key, ciphertext_sha256,
            requested_by_actor_kind, requested_by_account_id
       FROM icono_manifestation_orphan_objects
      WHERE status IN ('pending', 'failed')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at, orphan_id
      LIMIT ?`,
    timestamp,
    Math.max(1, Math.min(20, Math.trunc(Number(limit)) || 20)),
  )
  const results = []
  for (const item of rows) {
    try {
      results.push(
        await reconcileManifestationUpload(db, env, {
          entityKind: item.entity_kind,
          entityId: item.entity_id,
          objectKey: item.object_key,
          ciphertextSha256: item.ciphertext_sha256,
          actorKind: "service",
          actorAccountId: null,
          now: timestamp,
        }),
      )
    } catch {
      results.push({ status: "failed" })
    }
  }
  return Object.freeze({ processed: results.length, results })
}

// ARCHITECTURE FENCE [IPD-012]
