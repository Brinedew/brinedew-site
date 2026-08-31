import { prepared } from "./manifestation-authority-repository.js"

// The queue captures the immutable delete locator before the envelope rows are
// erased. Deleting both envelope rows in the same D1 transaction makes the
// ciphertext cryptographically unavailable before any fallible external DELETE.
export function manifestationPurgeStorageStatements(
  db,
  { manifestationId, actorKind, actorAccountId, timestamp },
) {
  return [
    prepared(
      db,
      `INSERT OR IGNORE INTO icono_manifestation_object_purge_queue (
         purge_id, entity_kind, entity_id, object_key, ciphertext_sha256,
         requested_by_actor_kind, requested_by_account_id, reason_code, created_at
       )
       SELECT 'purge_' || revision.manifestation_revision_id, 'revision',
              revision.manifestation_revision_id, storage.object_key,
              storage.ciphertext_sha256, ?, ?, 'manifestation_purge', ?
         FROM icono_manifestation_revisions revision
         JOIN icono_manifestation_revision_storage_secrets storage
           ON storage.manifestation_revision_id = revision.manifestation_revision_id
        WHERE revision.manifestation_id = ?`,
      actorKind,
      actorAccountId,
      timestamp,
      manifestationId,
    ),
    prepared(
      db,
      `INSERT OR IGNORE INTO icono_manifestation_object_purge_queue (
         purge_id, entity_kind, entity_id, object_key, ciphertext_sha256,
         requested_by_actor_kind, requested_by_account_id, reason_code, created_at
       )
       SELECT 'purge_' || derivative.manifestation_derivative_id, 'derivative',
              derivative.manifestation_derivative_id, storage.object_key,
              storage.ciphertext_sha256, ?, ?, 'manifestation_purge', ?
         FROM icono_manifestation_derivatives derivative
         JOIN icono_manifestation_revisions revision
           ON revision.manifestation_revision_id = derivative.manifestation_revision_id
         JOIN icono_manifestation_derivative_storage_secrets storage
           ON storage.manifestation_derivative_id = derivative.manifestation_derivative_id
        WHERE revision.manifestation_id = ?`,
      actorKind,
      actorAccountId,
      timestamp,
      manifestationId,
    ),
    prepared(
      db,
      `DELETE FROM icono_manifestation_derivative_storage_secrets
        WHERE manifestation_derivative_id IN (
          SELECT derivative.manifestation_derivative_id
            FROM icono_manifestation_derivatives derivative
            JOIN icono_manifestation_revisions revision
              ON revision.manifestation_revision_id = derivative.manifestation_revision_id
           WHERE revision.manifestation_id = ?
        )`,
      manifestationId,
    ),
    prepared(
      db,
      `DELETE FROM icono_manifestation_revision_storage_secrets
        WHERE manifestation_revision_id IN (
          SELECT manifestation_revision_id FROM icono_manifestation_revisions
           WHERE manifestation_id = ?
        )`,
      manifestationId,
    ),
  ]
}

// ARCHITECTURE FENCE [IPD-012]
