import {
  decryptManifestationProse,
  rewrapManifestationDek,
  sha256Hex,
} from "../../lib/iconoplasm-manifestation-body-crypto.js"
import {
  decryptManifestationTags,
  rewrapManifestationTagsDek,
} from "../../lib/iconoplasm-manifestation-tags-crypto.js"
import { readEncryptedManifestationBody } from "../../lib/iconoplasm-manifestation-body-storage.js"
import {
  authorityError,
  normalizeActorKind,
  normalizeId,
  normalizeOptionalId,
  normalizeTimestamp,
  normalizeVersion,
} from "./manifestation-authority-contract.js"
import {
  all,
  commandInputs,
  eventPayload,
  eventStatement,
  first,
  prepared,
  readGene,
  readGeneAliases,
  readHead,
  readManifestation,
  requireActiveAccount,
  requireDatabase,
  runCommand,
} from "./manifestation-authority-repository.js"

function currentKeyVersion(env) {
  const value = Number.parseInt(String(env?.ICONOPLASM_AUTHORING_BODY_KEY_VERSION || "1"), 10)
  if (!Number.isSafeInteger(value) || value < 1) {
    throw authorityError("INVALID_KEY_VERSION", "Current envelope key version is invalid", 500)
  }
  return value
}

async function rotationActor(db, input = {}) {
  const actorKind = normalizeActorKind(input.actorKind || "service")
  if (!new Set(["administrator", "service"]).has(actorKind)) {
    throw authorityError("ADMINISTRATOR_REQUIRED", "Key rotation requires service authority", 403)
  }
  const actorAccountId = normalizeOptionalId(input.actorAccountId, "actor_account_id")
  if (actorKind === "administrator" && !actorAccountId) {
    throw authorityError("AUDIT_ACCOUNT_REQUIRED", "Administrator account is required", 403)
  }
  if (actorAccountId) await requireActiveAccount(db, actorAccountId)
  return { actorKind, actorAccountId }
}

async function readRotationEntity(db, kind, entityId) {
  if (kind === "revision") {
    return first(
      db,
      `SELECT 'revision' AS entity_kind, revision.manifestation_revision_id AS entity_id,
              revision.manifestation_revision_id, revision.manifestation_id,
              revision.revision_number, revision.parent_revision_id,
              revision.source_revision_id, revision.body_sha256, revision.body_bytes,
              revision.sample_label, revision.sample_number, revision.sample_text_sha256,
              revision.author_account_id, revision.caretaker_assignment_id,
              revision.created_at, manifestation.gene_id,
              lifecycle.status AS lifecycle_status, lifecycle.lifecycle_version,
              storage.object_key, storage.ciphertext_sha256, storage.ciphertext_bytes,
              storage.body_iv_base64, storage.wrapped_dek_base64,
              storage.wrap_iv_base64, storage.key_version, storage.aad_version
         FROM icono_manifestation_revisions revision
         JOIN icono_manifestations manifestation
           ON manifestation.manifestation_id = revision.manifestation_id
         JOIN icono_manifestation_revision_lifecycle lifecycle
           ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
         JOIN icono_manifestation_revision_storage_secrets storage
           ON storage.manifestation_revision_id = revision.manifestation_revision_id
        WHERE revision.manifestation_revision_id = ?`,
      entityId,
    )
  }
  return first(
    db,
    `SELECT 'derivative' AS entity_kind,
            derivative.manifestation_derivative_id AS entity_id,
            derivative.manifestation_derivative_id,
            derivative.manifestation_revision_id, derivative.derivative_kind,
            derivative.status AS derivative_status, derivative.source_body_sha256,
            derivative.body_sha256, derivative.body_bytes, derivative.recipe_id,
            derivative.recipe_version, derivative.provider_id, derivative.model_id,
            derivative.tagger_config_sha256, derivative.provenance_status,
            derivative.failure_code, derivative.created_at, derivative.completed_at,
            revision.manifestation_id, revision.caretaker_assignment_id,
            manifestation.gene_id, lifecycle.status AS lifecycle_status,
            storage.object_key, storage.ciphertext_sha256, storage.ciphertext_bytes,
            storage.body_iv_base64, storage.wrapped_dek_base64,
            storage.wrap_iv_base64, storage.key_version, storage.aad_version
       FROM icono_manifestation_derivatives derivative
       JOIN icono_manifestation_revisions revision
         ON revision.manifestation_revision_id = derivative.manifestation_revision_id
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       JOIN icono_manifestation_derivative_storage_secrets storage
         ON storage.manifestation_derivative_id = derivative.manifestation_derivative_id
      WHERE derivative.manifestation_derivative_id = ?`,
    entityId,
  )
}

function envelopeInput(entity, ciphertext, override = {}) {
  return {
    ciphertext,
    ciphertextSha256: entity.ciphertext_sha256,
    ciphertextBytes: Number(entity.ciphertext_bytes),
    bodySha256: entity.body_sha256,
    bodyBytes: Number(entity.body_bytes),
    bodyIvBase64: entity.body_iv_base64,
    wrappedDekBase64: override.wrapped_dek_base64 || entity.wrapped_dek_base64,
    wrapIvBase64: override.wrap_iv_base64 || entity.wrap_iv_base64,
    keyVersion: override.key_version || Number(entity.key_version),
    aadVersion: Number(entity.aad_version),
  }
}

async function decryptRotationEntity(env, entity, ciphertext, override) {
  const common = envelopeInput(entity, ciphertext, override)
  if (entity.entity_kind === "revision") {
    return decryptManifestationProse(env, {
      ...common,
      revisionId: entity.manifestation_revision_id,
      geneId: entity.gene_id,
    })
  }
  return decryptManifestationTags(env, {
    ...common,
    derivativeId: entity.manifestation_derivative_id,
    revisionId: entity.manifestation_revision_id,
    sourceBodySha256: entity.source_body_sha256,
  })
}

function derivativeSnapshot(entity) {
  return {
    manifestation_derivative_id: entity.manifestation_derivative_id,
    manifestation_revision_id: entity.manifestation_revision_id,
    derivative_kind: entity.derivative_kind,
    status: entity.derivative_status,
    source_body_sha256: entity.source_body_sha256,
    body_sha256: entity.body_sha256,
    body_bytes: Number(entity.body_bytes),
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

async function deterministicCommandIds(jobId, entity) {
  const digest = await sha256Hex(
    `${jobId}\n${entity.entity_kind}\n${entity.entity_id}\n${entity.key_version}\n${entity.wrapped_dek_base64}\n${entity.wrap_iv_base64}`,
  )
  return {
    commandId: `rotate_${digest}`,
    eventUuid: `event_${digest}`,
    requestSha256: digest,
  }
}

async function rotateEntity(db, env, job, entity, actor, timestamp) {
  const ciphertext = await readEncryptedManifestationBody(env, entity.object_key)
  if (!ciphertext) {
    throw authorityError("ROTATION_BODY_UNAVAILABLE", "Encrypted body is unavailable", 503)
  }
  await decryptRotationEntity(env, entity, ciphertext.bytes)
  const rewrapped =
    entity.entity_kind === "revision"
      ? await rewrapManifestationDek(env, {
          revisionId: entity.manifestation_revision_id,
          geneId: entity.gene_id,
          wrappedDekBase64: entity.wrapped_dek_base64,
          wrapIvBase64: entity.wrap_iv_base64,
          fromKeyVersion: Number(job.from_key_version),
          toKeyVersion: Number(job.to_key_version),
        })
      : await rewrapManifestationTagsDek(env, {
          derivativeId: entity.manifestation_derivative_id,
          revisionId: entity.manifestation_revision_id,
          sourceBodySha256: entity.source_body_sha256,
          wrappedDekBase64: entity.wrapped_dek_base64,
          wrapIvBase64: entity.wrap_iv_base64,
          fromKeyVersion: Number(job.from_key_version),
          toKeyVersion: Number(job.to_key_version),
        })
  await decryptRotationEntity(env, entity, ciphertext.bytes, rewrapped)
  const ids = await deterministicCommandIds(job.rotation_job_id, entity)
  const gene = await readGene(db, entity.gene_id)
  if (!gene) throw authorityError("GENE_NOT_FOUND", "Gene identity was not found", 404)
  gene.aliases = await readGeneAliases(db, gene.gene_id)
  const head = await readHead(db, gene.gene_id)
  const manifestation = await readManifestation(db, entity.manifestation_id)
  const derivativeHead =
    entity.entity_kind === "derivative"
      ? await first(
          db,
          `SELECT manifestation_revision_id, accepted_derivative_id, derivative_head_version
           FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?`,
          entity.manifestation_revision_id,
        )
      : null
  const cmd = commandInputs({ ...ids, ...actor })
  const nextHead = { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const storageTable =
    entity.entity_kind === "revision"
      ? "icono_manifestation_revision_storage_secrets"
      : "icono_manifestation_derivative_storage_secrets"
  const storageId =
    entity.entity_kind === "revision" ? "manifestation_revision_id" : "manifestation_derivative_id"
  return runCommand({
    db,
    ...cmd,
    commandType: "manifestation.key_rewrap",
    geneId: gene.gene_id,
    response: {
      ok: true,
      entity_kind: entity.entity_kind,
      entity_id: entity.entity_id,
      key_version: Number(job.to_key_version),
      gene_revision: nextHead.gene_revision,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM ${storageTable} storage
        JOIN icono_manifestation_heads head ON head.gene_id = ?
        WHERE storage.${storageId} = ? AND storage.key_version = ?
          AND storage.wrapped_dek_base64 = ? AND storage.wrap_iv_base64 = ?
          AND head.gene_revision = ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      gene.gene_id,
      entity.entity_id,
      Number(job.from_key_version),
      entity.wrapped_dek_base64,
      entity.wrap_iv_base64,
      Number(head.gene_revision),
    ],
    statements: [
      prepared(
        db,
        `INSERT INTO icono_manifestation_storage_mutation_guards (
           command_id, entity_kind, entity_id, operation
         ) VALUES (?, ?, ?, 'rewrap')`,
        cmd.commandId,
        entity.entity_kind,
        entity.entity_id,
      ),
      prepared(
        db,
        `UPDATE ${storageTable}
            SET wrapped_dek_base64 = ?, wrap_iv_base64 = ?, key_version = ?, verified_at = ?
          WHERE ${storageId} = ? AND key_version = ?
            AND wrapped_dek_base64 = ? AND wrap_iv_base64 = ?`,
        rewrapped.wrapped_dek_base64,
        rewrapped.wrap_iv_base64,
        rewrapped.key_version,
        timestamp,
        entity.entity_id,
        Number(job.from_key_version),
        entity.wrapped_dek_base64,
        entity.wrap_iv_base64,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_heads SET gene_revision = gene_revision + 1, updated_at = ?
          WHERE gene_id = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        Number(head.gene_revision),
      ),
      eventStatement(db, {
        eventUuid: ids.eventUuid,
        commandId: cmd.commandId,
        geneId: gene.gene_id,
        geneRevision: nextHead.gene_revision,
        manifestationId: entity.manifestation_id,
        revisionId: entity.manifestation_revision_id,
        assignmentId: entity.caretaker_assignment_id,
        payloadJson: eventPayload({
          cause:
            entity.entity_kind === "revision"
              ? "manifestation.revision_envelope_rewrapped"
              : "manifestation.derivative_envelope_rewrapped",
          gene,
          head: nextHead,
          manifestation,
          revision: entity.entity_kind === "revision" ? entity : null,
          changedDerivative:
            entity.entity_kind === "derivative" ? derivativeSnapshot(entity) : null,
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
          WHERE command_id = ? AND entity_kind = ? AND entity_id = ? AND operation = 'rewrap'`,
        cmd.commandId,
        entity.entity_kind,
        entity.entity_id,
      ),
    ],
  })
}

export async function startManifestationKeyRotation(db, env, input = {}) {
  requireDatabase(db)
  const actor = await rotationActor(db, input)
  const jobId = normalizeId(input.rotationJobId, "rotation_job_id")
  const fromVersion = normalizeVersion(input.fromKeyVersion, "from_key_version")
  const toVersion = normalizeVersion(input.toKeyVersion, "to_key_version")
  if (fromVersion < 1 || toVersion < 1 || fromVersion === toVersion) {
    throw authorityError("INVALID_KEY_ROTATION", "Key rotation versions are invalid")
  }
  if (toVersion !== currentKeyVersion(env)) {
    throw authorityError(
      "ROTATION_TARGET_NOT_CURRENT",
      "Rotation target must be the active key version",
      409,
    )
  }
  const existing = await first(
    db,
    `SELECT * FROM icono_manifestation_key_rotation_jobs WHERE rotation_job_id = ?`,
    jobId,
  )
  if (existing) {
    if (
      Number(existing.from_key_version) !== fromVersion ||
      Number(existing.to_key_version) !== toVersion
    ) {
      throw authorityError("IDEMPOTENCY_KEY_REUSED", "Rotation job ID was reused", 409)
    }
    return existing
  }
  const timestamp = normalizeTimestamp(input.now)
  await db
    .prepare(
      `INSERT INTO icono_manifestation_key_rotation_jobs (
       rotation_job_id, from_key_version, to_key_version, status,
       created_by_actor_kind, created_by_account_id, created_at, updated_at
     ) VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
    )
    .bind(
      jobId,
      fromVersion,
      toVersion,
      actor.actorKind,
      actor.actorAccountId,
      timestamp,
      timestamp,
    )
    .run()
  return first(
    db,
    `SELECT * FROM icono_manifestation_key_rotation_jobs WHERE rotation_job_id = ?`,
    jobId,
  )
}

async function nextRotationEntities(db, fromVersion, limit) {
  return all(
    db,
    `SELECT entity_kind, entity_id FROM (
       SELECT 'revision' AS entity_kind, manifestation_revision_id AS entity_id
         FROM icono_manifestation_revision_storage_secrets WHERE key_version = ?
       UNION ALL
       SELECT 'derivative' AS entity_kind, manifestation_derivative_id AS entity_id
         FROM icono_manifestation_derivative_storage_secrets WHERE key_version = ?
     ) ORDER BY entity_kind DESC, entity_id LIMIT ?`,
    fromVersion,
    fromVersion,
    limit,
  )
}

export async function rotateManifestationEnvelopePage(db, env, input = {}) {
  requireDatabase(db)
  const actor = await rotationActor(db, input)
  const jobId = normalizeId(input.rotationJobId, "rotation_job_id")
  const limit = Math.max(1, Math.min(10, Math.trunc(Number(input.limit)) || 5))
  const job = await first(
    db,
    `SELECT * FROM icono_manifestation_key_rotation_jobs WHERE rotation_job_id = ?`,
    jobId,
  )
  if (!job) throw authorityError("ROTATION_JOB_NOT_FOUND", "Key rotation job was not found", 404)
  if (!new Set(["running", "verification"]).has(job.status)) {
    throw authorityError("ROTATION_JOB_NOT_RUNNING", "Key rotation job is not running", 409)
  }
  if (Number(job.to_key_version) !== currentKeyVersion(env)) {
    throw authorityError("ROTATION_TARGET_NOT_CURRENT", "Rotation target is no longer active", 409)
  }
  const pending = await nextRotationEntities(db, Number(job.from_key_version), limit)
  const timestamp = normalizeTimestamp(input.now)
  const completed = []
  for (const candidate of pending) {
    const entity = await readRotationEntity(db, candidate.entity_kind, candidate.entity_id)
    if (!entity || Number(entity.key_version) !== Number(job.from_key_version)) continue
    await rotateEntity(db, env, job, entity, actor, timestamp)
    await db.batch([
      prepared(
        db,
        `INSERT OR IGNORE INTO icono_manifestation_key_rotation_items (
           rotation_job_id, entity_kind, entity_id, completed_at
         ) VALUES (?, ?, ?, ?)`,
        jobId,
        entity.entity_kind,
        entity.entity_id,
        timestamp,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_key_rotation_jobs
            SET after_entity_kind = ?, after_entity_id = ?,
                rotated_revisions = (
                  SELECT COUNT(*) FROM icono_manifestation_key_rotation_items
                   WHERE rotation_job_id = ? AND entity_kind = 'revision'
                ),
                rotated_derivatives = (
                  SELECT COUNT(*) FROM icono_manifestation_key_rotation_items
                   WHERE rotation_job_id = ? AND entity_kind = 'derivative'
                ), updated_at = ?, last_error_code = NULL
          WHERE rotation_job_id = ? AND status IN ('running', 'verification')`,
        entity.entity_kind,
        entity.entity_id,
        jobId,
        jobId,
        timestamp,
        jobId,
      ),
    ])
    completed.push({ entity_kind: entity.entity_kind, entity_id: entity.entity_id })
  }
  const remaining = await first(
    db,
    `SELECT
       (SELECT COUNT(*) FROM icono_manifestation_revision_storage_secrets WHERE key_version = ?) +
       (SELECT COUNT(*) FROM icono_manifestation_derivative_storage_secrets WHERE key_version = ?)
       AS count`,
    Number(job.from_key_version),
    Number(job.from_key_version),
  )
  if (Number(remaining.count) === 0) {
    await db
      .prepare(
        `UPDATE icono_manifestation_key_rotation_jobs
          SET status = 'verification', updated_at = ?
        WHERE rotation_job_id = ? AND status = 'running'`,
      )
      .bind(timestamp, jobId)
      .run()
  }
  return Object.freeze({
    rotation_job_id: jobId,
    rotated: completed,
    remaining: Number(remaining.count),
    status: Number(remaining.count) === 0 ? "verification" : "running",
  })
}

export async function completeManifestationKeyRotation(db, env, input = {}) {
  requireDatabase(db)
  await rotationActor(db, input)
  const jobId = normalizeId(input.rotationJobId, "rotation_job_id")
  const job = await first(
    db,
    `SELECT * FROM icono_manifestation_key_rotation_jobs WHERE rotation_job_id = ?`,
    jobId,
  )
  if (!job) throw authorityError("ROTATION_JOB_NOT_FOUND", "Key rotation job was not found", 404)
  if (job.status === "completed") return { ...job, old_key_retirement_allowed: true }
  if (job.status !== "verification") {
    throw authorityError(
      "ROTATION_NOT_READY_FOR_VERIFICATION",
      "Key rotation still has pending rows",
      409,
    )
  }
  const remaining = await nextRotationEntities(db, Number(job.from_key_version), 1)
  if (remaining.length) {
    throw authorityError("ROTATION_NOT_READY_FOR_VERIFICATION", "Old-key envelopes remain", 409)
  }
  const drillLimit = Math.max(1, Math.min(20, Math.trunc(Number(input.drillLimit)) || 10))
  const drill = await all(
    db,
    `SELECT entity_kind, entity_id FROM (
       SELECT 'revision' AS entity_kind, manifestation_revision_id AS entity_id
         FROM icono_manifestation_revision_storage_secrets WHERE key_version = ?
       UNION ALL
       SELECT 'derivative' AS entity_kind, manifestation_derivative_id AS entity_id
         FROM icono_manifestation_derivative_storage_secrets WHERE key_version = ?
     ) ORDER BY entity_kind, entity_id LIMIT ?`,
    Number(job.to_key_version),
    Number(job.to_key_version),
    drillLimit,
  )
  for (const candidate of drill) {
    const entity = await readRotationEntity(db, candidate.entity_kind, candidate.entity_id)
    const ciphertext = entity && (await readEncryptedManifestationBody(env, entity.object_key))
    if (!entity || !ciphertext) {
      throw authorityError(
        "ROTATION_READ_DRILL_FAILED",
        "Rotation read drill found a missing body",
        503,
      )
    }
    await decryptRotationEntity(env, entity, ciphertext.bytes)
  }
  const timestamp = normalizeTimestamp(input.now)
  const guard = prepared(
    db,
    `UPDATE icono_manifestation_key_rotation_jobs
        SET status = 'completed', completed_at = ?, updated_at = ?
      WHERE rotation_job_id = ? AND status = 'verification'
        AND NOT EXISTS (
          SELECT 1 FROM icono_manifestation_revision_storage_secrets WHERE key_version = ?
        ) AND NOT EXISTS (
          SELECT 1 FROM icono_manifestation_derivative_storage_secrets WHERE key_version = ?
        )`,
    timestamp,
    timestamp,
    jobId,
    Number(job.from_key_version),
    Number(job.from_key_version),
  )
  const result = await guard.run()
  if (Number(result?.meta?.changes || 0) !== 1) {
    throw authorityError("ROTATION_NOT_READY_FOR_VERIFICATION", "Old-key envelopes reappeared", 409)
  }
  return Object.freeze({
    rotation_job_id: jobId,
    status: "completed",
    drilled_entities: drill.length,
    old_key_retirement_allowed: true,
  })
}

// ARCHITECTURE FENCE [IPD-012]
