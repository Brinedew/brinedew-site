import {
  decryptManifestationProse,
  rewrapManifestationDek,
  sha256Hex,
} from "../../lib/iconoplasm-manifestation-body-crypto.js"
import {
  decryptManifestationTags,
  rewrapManifestationTagsDek,
} from "../../lib/iconoplasm-manifestation-tags-crypto.js"
import {
  createManifestationBodyObjectKey,
  putEncryptedManifestationBody,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeId,
  normalizeSha256,
  normalizeTimestamp,
  normalizeVersion,
} from "./manifestation-authority-contract.js"
import {
  commandInputs,
  eventPayload,
  eventStatement,
  first,
  prepared,
  readGene,
  readGeneAliases,
  readHead,
  readManifestation,
  requireDatabase,
  resolveCommandReplay,
  runCommand,
} from "./manifestation-authority-repository.js"
import { backupActor } from "./manifestation-authority-backup-export.js"
import {
  createManifestationUploadIntent,
  requireAdoptedManifestationUpload,
} from "./manifestation-upload-intents.js"
import { splitManifestationTagsPayload } from "./manifestation-tags-payload.js"

function ciphertextInput(input, plaintextBytes) {
  const bytes =
    input.ciphertext instanceof Uint8Array
      ? input.ciphertext
      : new Uint8Array(input.ciphertext || [])
  const ciphertextBytes = Number(input.ciphertextBytes)
  const ciphertextSha256 = normalizeSha256(input.ciphertextSha256, "ciphertext_sha256")
  if (
    !Number.isSafeInteger(ciphertextBytes) ||
    ciphertextBytes !== Number(plaintextBytes) + 16 ||
    bytes.byteLength !== ciphertextBytes
  ) {
    throw authorityError("BACKUP_CIPHERTEXT_MISMATCH", "Backup ciphertext size is invalid", 409)
  }
  const keyVersion = Number(input.keyVersion)
  const aadVersion = Number(input.aadVersion ?? 1)
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1 || aadVersion !== 1) {
    throw authorityError("BACKUP_ENVELOPE_INVALID", "Backup envelope version is invalid", 409)
  }
  return {
    bytes,
    ciphertextBytes,
    ciphertextSha256,
    bodyIvBase64: String(input.bodyIvBase64 || ""),
    wrappedDekBase64: String(input.wrappedDekBase64 || ""),
    wrapIvBase64: String(input.wrapIvBase64 || ""),
    keyVersion,
    aadVersion,
  }
}

async function readRestoreEntity(db, kind, entityId) {
  if (kind === "revision") {
    return first(
      db,
      `SELECT revision.manifestation_revision_id AS entity_id,
              revision.manifestation_revision_id, revision.manifestation_id,
              revision.caretaker_assignment_id, revision.body_sha256,
              revision.body_bytes, revision.revision_number, revision.parent_revision_id,
              revision.source_revision_id, revision.sample_label, revision.sample_number,
              revision.sample_text_sha256, revision.author_account_id, revision.created_at,
              manifestation.gene_id, manifestation.status AS manifestation_status,
              lifecycle.status AS lifecycle_status, lifecycle.lifecycle_version
         FROM icono_manifestation_revisions revision
         JOIN icono_manifestations manifestation
           ON manifestation.manifestation_id = revision.manifestation_id
         JOIN icono_manifestation_revision_lifecycle lifecycle
           ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
        WHERE revision.manifestation_revision_id = ?`,
      entityId,
    )
  }
  return first(
    db,
    `SELECT derivative.manifestation_derivative_id AS entity_id,
            derivative.manifestation_derivative_id,
            derivative.manifestation_revision_id, derivative.derivative_kind,
            derivative.status AS derivative_status, derivative.source_body_sha256,
            derivative.body_sha256, derivative.body_bytes,
            derivative.tags_sha256, derivative.tags_bytes,
            derivative.fields_sha256, derivative.fields_bytes, derivative.recipe_id,
            derivative.recipe_version, derivative.provider_id, derivative.model_id,
            derivative.tagger_config_sha256, derivative.provenance_status,
            derivative.failure_code, derivative.created_at, derivative.completed_at,
            revision.manifestation_id, revision.caretaker_assignment_id,
            manifestation.gene_id, manifestation.status AS manifestation_status,
            lifecycle.status AS lifecycle_status
       FROM icono_manifestation_derivatives derivative
       JOIN icono_manifestation_revisions revision
         ON revision.manifestation_revision_id = derivative.manifestation_revision_id
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
      WHERE derivative.manifestation_derivative_id = ?`,
    entityId,
  )
}

function entitySnapshot(kind, entity) {
  if (kind === "revision") return entity
  return {
    manifestation_derivative_id: entity.manifestation_derivative_id,
    manifestation_revision_id: entity.manifestation_revision_id,
    derivative_kind: entity.derivative_kind,
    status: entity.derivative_status,
    source_body_sha256: entity.source_body_sha256,
    body_sha256: entity.body_sha256,
    body_bytes: Number(entity.body_bytes),
    tags_sha256: entity.tags_sha256,
    tags_bytes: Number(entity.tags_bytes),
    fields_sha256: entity.fields_sha256,
    fields_bytes: Number(entity.fields_bytes),
    recipe_id: entity.recipe_id || null,
    recipe_version: entity.recipe_version || null,
    provider_id: entity.provider_id || null,
    model_id: entity.model_id || null,
    tagger_config_sha256: entity.tagger_config_sha256 || null,
    provenance_status: entity.provenance_status,
    failure_code: entity.failure_code || null,
    created_at: entity.created_at,
    completed_at: entity.completed_at || null,
  }
}

async function verifyPlaintext(env, kind, entity, envelope, bytes) {
  const common = {
    ciphertext: bytes,
    ciphertextSha256: envelope.ciphertextSha256,
    ciphertextBytes: envelope.ciphertextBytes,
    bodySha256: entity.body_sha256,
    bodyBytes: Number(entity.body_bytes),
    bodyIvBase64: envelope.bodyIvBase64,
    wrappedDekBase64: envelope.wrappedDekBase64,
    wrapIvBase64: envelope.wrapIvBase64,
    keyVersion: envelope.keyVersion,
    aadVersion: envelope.aadVersion,
  }
  if (kind === "revision") {
    return decryptManifestationProse(env, {
      ...common,
      revisionId: entity.manifestation_revision_id,
      geneId: entity.gene_id,
    })
  }
  const outputPlain = await decryptManifestationTags(env, {
    ...common,
    derivativeId: entity.manifestation_derivative_id,
    revisionId: entity.manifestation_revision_id,
    sourceBodySha256: entity.source_body_sha256,
  })
  await splitManifestationTagsPayload(outputPlain, {
    tagsBytes: entity.tags_bytes,
    tagsSha256: entity.tags_sha256,
    fieldsBytes: entity.fields_bytes,
    fieldsSha256: entity.fields_sha256,
  })
  return outputPlain
}

async function restoreManifestationEntityBackup(db, env, kind, input) {
  requireDatabase(db)
  const actor = await backupActor(db, input)
  const replay = await resolveCommandReplay(db, input, actor)
  if (replay) return replay
  const field = kind === "revision" ? "manifestation_revision_id" : "manifestation_derivative_id"
  const entityId = normalizeId(kind === "revision" ? input.revisionId : input.derivativeId, field)
  const entity = await readRestoreEntity(db, kind, entityId)
  if (!entity) throw authorityError("BACKUP_ENTITY_NOT_FOUND", "Backup entity was not found", 404)
  if (
    entity.manifestation_status === "purged" ||
    entity.lifecycle_status === "purged" ||
    entity.derivative_status === "purged"
  ) {
    throw authorityError("PURGED_ENTITY_RESTORE_FORBIDDEN", "Purged entity cannot be restored", 409)
  }
  if (kind === "derivative" && entity.derivative_status !== "complete") {
    throw authorityError(
      "DERIVATIVE_RESTORE_FORBIDDEN",
      "Only a complete derivative has a body",
      409,
    )
  }
  const envelope = ciphertextInput(input, entity.body_bytes)
  if ((await sha256Hex(envelope.bytes)) !== envelope.ciphertextSha256) {
    throw authorityError("BACKUP_CIPHERTEXT_MISMATCH", "Backup ciphertext hash is invalid", 409)
  }
  await verifyPlaintext(env, kind, entity, envelope, envelope.bytes)
  const currentKeyVersion = Number.parseInt(
    String(env?.ICONOPLASM_AUTHORING_BODY_KEY_VERSION || "1"),
    10,
  )
  if (!Number.isSafeInteger(currentKeyVersion) || currentKeyVersion < 1) {
    throw authorityError("BACKUP_ENVELOPE_INVALID", "Current envelope key version is invalid", 500)
  }
  let storedEnvelope = envelope
  if (envelope.keyVersion !== currentKeyVersion) {
    const rewrapped =
      kind === "revision"
        ? await rewrapManifestationDek(env, {
            revisionId: entity.manifestation_revision_id,
            geneId: entity.gene_id,
            wrappedDekBase64: envelope.wrappedDekBase64,
            wrapIvBase64: envelope.wrapIvBase64,
            fromKeyVersion: envelope.keyVersion,
            toKeyVersion: currentKeyVersion,
          })
        : await rewrapManifestationTagsDek(env, {
            derivativeId: entity.manifestation_derivative_id,
            revisionId: entity.manifestation_revision_id,
            sourceBodySha256: entity.source_body_sha256,
            wrappedDekBase64: envelope.wrappedDekBase64,
            wrapIvBase64: envelope.wrapIvBase64,
            fromKeyVersion: envelope.keyVersion,
            toKeyVersion: currentKeyVersion,
          })
    storedEnvelope = {
      ...envelope,
      wrappedDekBase64: rewrapped.wrapped_dek_base64,
      wrapIvBase64: rewrapped.wrap_iv_base64,
      keyVersion: rewrapped.key_version,
    }
    await verifyPlaintext(env, kind, entity, storedEnvelope, envelope.bytes)
  }

  const storageTable =
    kind === "revision"
      ? "icono_manifestation_revision_storage_secrets"
      : "icono_manifestation_derivative_storage_secrets"
  const storageIdColumn =
    kind === "revision" ? "manifestation_revision_id" : "manifestation_derivative_id"
  const existing = await first(
    db,
    `SELECT object_key, ciphertext_sha256 FROM ${storageTable} WHERE ${storageIdColumn} = ?`,
    entityId,
  )
  const expectedExistingHash =
    input.expectedStorageCiphertextSha256 == null
      ? null
      : normalizeSha256(input.expectedStorageCiphertextSha256, "expected_storage_ciphertext_sha256")
  if ((existing?.ciphertext_sha256 || null) !== expectedExistingHash) {
    throw authorityError("STALE_AUTHORITY_STATE", "Entity storage changed before restore", 409)
  }

  const objectKey = await createManifestationBodyObjectKey()
  await createManifestationUploadIntent(db, {
    entityKind: kind,
    entityId,
    operation: "restore",
    assignmentId: entity.caretaker_assignment_id || null,
    objectKey,
    ciphertextSha256: envelope.ciphertextSha256,
    bodyBytes: Number(entity.body_bytes),
    actorKind: actor.actorKind,
    actorAccountId: actor.actorAccountId,
    idFactory: input.idFactory || defaultIdFactory,
    now: input.now,
  })
  const verified = await putEncryptedManifestationBody(env, objectKey, envelope.bytes, {
    expectedSha256: envelope.ciphertextSha256,
    verifyPlaintext: (stored) => verifyPlaintext(env, kind, entity, envelope, stored),
  })
  const gene = await readGene(db, entity.gene_id)
  if (!gene) throw authorityError("GENE_NOT_FOUND", "Gene identity was not found", 404)
  gene.aliases = await readGeneAliases(db, gene.gene_id)
  const head = await readHead(db, gene.gene_id)
  const manifestation = await readManifestation(db, entity.manifestation_id)
  const derivativeHead =
    kind === "derivative"
      ? await first(
          db,
          `SELECT manifestation_revision_id, accepted_derivative_id, derivative_head_version
           FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?`,
          entity.manifestation_revision_id,
        )
      : null
  const legalHold = await first(
    db,
    `SELECT legal_hold_id FROM icono_manifestation_legal_holds
      WHERE manifestation_id = ? AND released_at IS NULL`,
    entity.manifestation_id,
  )
  const expectedGeneRevision = normalizeVersion(
    input.expectedGeneRevision,
    "expected_gene_revision",
  )
  const timestamp = normalizeTimestamp(input.now)
  const cmd = commandInputs({
    ...input,
    actorKind: actor.actorKind,
    actorAccountId: actor.actorAccountId,
  })
  const nextHead = { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const restoredRevision =
    kind === "revision" && entity.lifecycle_status === "quarantined"
      ? {
          ...entity,
          lifecycle_status: "active",
          lifecycle_version: Number(entity.lifecycle_version) + 1,
        }
      : entity
  const statements = [
    prepared(
      db,
      `INSERT INTO icono_manifestation_storage_mutation_guards (
         command_id, entity_kind, entity_id, operation
       ) VALUES (?, ?, ?, 'restore')`,
      cmd.commandId,
      kind,
      entityId,
    ),
  ]
  if (existing) {
    statements.push(
      prepared(
        db,
        `INSERT INTO icono_manifestation_object_purge_queue (
           purge_id, entity_kind, entity_id, object_key, ciphertext_sha256, status,
           requested_by_actor_kind, requested_by_account_id, reason_code, created_at
         ) VALUES (?, 'orphan', ?, ?, ?, ?, ?, ?, 'backup_restore_replaced', ?)`,
        createId(null, "purge_id", "purge", input.idFactory || defaultIdFactory),
        entityId,
        existing.object_key,
        existing.ciphertext_sha256,
        legalHold ? "held" : "pending",
        actor.actorKind,
        actor.actorAccountId,
        timestamp,
      ),
    )
  }
  statements.push(
    prepared(
      db,
      `INSERT INTO ${storageTable} (
         ${storageIdColumn}, object_key, ciphertext_sha256, ciphertext_bytes,
         body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version,
         aad_version, object_etag, verified_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(${storageIdColumn}) DO UPDATE SET
         object_key = excluded.object_key,
         ciphertext_sha256 = excluded.ciphertext_sha256,
         ciphertext_bytes = excluded.ciphertext_bytes,
         body_iv_base64 = excluded.body_iv_base64,
         wrapped_dek_base64 = excluded.wrapped_dek_base64,
         wrap_iv_base64 = excluded.wrap_iv_base64,
         key_version = excluded.key_version,
         aad_version = excluded.aad_version,
         object_etag = excluded.object_etag,
         verified_at = excluded.verified_at,
         created_at = excluded.created_at`,
      entityId,
      objectKey,
      envelope.ciphertextSha256,
      envelope.ciphertextBytes,
      envelope.bodyIvBase64,
      storedEnvelope.wrappedDekBase64,
      storedEnvelope.wrapIvBase64,
      storedEnvelope.keyVersion,
      envelope.aadVersion,
      verified.etag,
      timestamp,
      timestamp,
    ),
    ...(kind === "revision" && entity.lifecycle_status === "quarantined"
      ? [
          prepared(
            db,
            `UPDATE icono_manifestation_revision_lifecycle
                SET status = 'active', lifecycle_version = lifecycle_version + 1,
                    changed_by_account_id = ?, change_reason = 'integrity_restore',
                    changed_at = ?
              WHERE manifestation_revision_id = ? AND status = 'quarantined'
                AND lifecycle_version = ?`,
            actor.actorAccountId,
            timestamp,
            entityId,
            Number(entity.lifecycle_version),
          ),
        ]
      : []),
    prepared(
      db,
      `UPDATE icono_manifestation_heads SET gene_revision = gene_revision + 1, updated_at = ?
        WHERE gene_id = ? AND gene_revision = ?`,
      timestamp,
      gene.gene_id,
      expectedGeneRevision,
    ),
    eventStatement(db, {
      eventUuid: createId(
        input.eventUuid,
        "event_uuid",
        "event",
        input.idFactory || defaultIdFactory,
      ),
      commandId: cmd.commandId,
      geneId: gene.gene_id,
      geneRevision: nextHead.gene_revision,
      manifestationId: manifestation.manifestation_id,
      revisionId: entity.manifestation_revision_id,
      assignmentId: entity.caretaker_assignment_id,
      payloadJson: eventPayload({
        cause:
          kind === "revision"
            ? "manifestation.revision_storage_restored"
            : "manifestation.derivative_storage_restored",
        gene,
        head: nextHead,
        manifestation,
        revision: kind === "revision" ? restoredRevision : null,
        changedDerivative: kind === "derivative" ? entitySnapshot(kind, entity) : null,
        derivativeHead: derivativeHead && {
          manifestation_revision_id: derivativeHead.manifestation_revision_id,
          accepted_derivative_id: derivativeHead.accepted_derivative_id || null,
          derivative_head_version: Number(derivativeHead.derivative_head_version),
        },
      }),
    }),
    prepared(
      db,
      `DELETE FROM icono_manifestation_storage_mutation_guards
        WHERE command_id = ? AND entity_kind = ? AND entity_id = ? AND operation = 'restore'`,
      cmd.commandId,
      kind,
      entityId,
    ),
  )

  try {
    const result = await runCommand({
      db,
      ...cmd,
      commandType:
        kind === "revision"
          ? "manifestation.backup_restore"
          : "manifestation.derivative_backup_restore",
      geneId: gene.gene_id,
      response: {
        ok: true,
        entity_kind: kind,
        entity_id: entityId,
        storage_status: "restored",
        gene_revision: nextHead.gene_revision,
      },
      guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
        SELECT ?, CASE WHEN EXISTS (
          SELECT 1 FROM icono_manifestation_heads head
          WHERE head.gene_id = ? AND head.gene_revision = ?
            AND (SELECT ciphertext_sha256 FROM ${storageTable}
                  WHERE ${storageIdColumn} = ?) IS ?
        ) THEN 1 ELSE 0 END`,
      guardParams: [
        cmd.commandId,
        gene.gene_id,
        expectedGeneRevision,
        entityId,
        expectedExistingHash,
      ],
      statements,
    })
    await requireAdoptedManifestationUpload(db, kind, entityId)
    return result
  } catch (error) {
    if (error && (typeof error === "object" || typeof error === "function")) {
      Object.defineProperty(error, "storageReconciliation", {
        configurable: true,
        enumerable: false,
        value: Object.freeze({
          action: "delete_if_unreferenced",
          entity_kind: kind,
          entity_id: entityId,
          object_key: objectKey,
          ciphertext_sha256: envelope.ciphertextSha256,
        }),
      })
    }
    throw error
  }
}

export function restoreManifestationRevisionBackup(db, env, input = {}) {
  return restoreManifestationEntityBackup(db, env, "revision", input)
}

export function restoreManifestationDerivativeBackup(db, env, input = {}) {
  return restoreManifestationEntityBackup(db, env, "derivative", input)
}
