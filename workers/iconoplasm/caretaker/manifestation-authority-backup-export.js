import {
  decryptManifestationProse,
  sha256Hex,
} from "../../lib/iconoplasm-manifestation-body-crypto.js"
import { decryptManifestationTags } from "../../lib/iconoplasm-manifestation-tags-crypto.js"
import { readEncryptedManifestationBody } from "../../lib/iconoplasm-manifestation-body-storage.js"
import {
  authorityError,
  normalizeActorKind,
  normalizeId,
  normalizeOptionalId,
  normalizeTimestamp,
} from "./manifestation-authority-contract.js"
import {
  first,
  prepared,
  requireActiveAccount,
  requireDatabase,
} from "./manifestation-authority-repository.js"
import { splitManifestationTagsPayload } from "./manifestation-tags-payload.js"

async function backupActor(db, { actorKind, actorAccountId }) {
  const kind = normalizeActorKind(actorKind || "service")
  if (!["administrator", "service"].includes(kind)) {
    throw authorityError("BACKUP_AUTHORITY_REQUIRED", "Backup authority is required", 403)
  }
  const accountId = normalizeOptionalId(actorAccountId, "actor_account_id")
  if (accountId) await requireActiveAccount(db, accountId)
  return { actorKind: kind, actorAccountId: accountId }
}

async function readBackupEntity(db, entityKind, entityId) {
  if (entityKind === "revision") {
    return first(
      db,
      `SELECT 'revision' AS entity_kind, revision.manifestation_revision_id AS entity_id,
              revision.manifestation_revision_id, revision.manifestation_id,
              manifestation.gene_id, manifestation.status AS manifestation_status,
              lifecycle.status AS lifecycle_status, revision.body_sha256,
              revision.body_bytes, storage.object_key, storage.ciphertext_sha256,
              storage.ciphertext_bytes, storage.body_iv_base64,
              storage.wrapped_dek_base64, storage.wrap_iv_base64,
              storage.key_version, storage.aad_version
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
    `SELECT 'derivative' AS entity_kind, derivative.manifestation_derivative_id AS entity_id,
            derivative.manifestation_derivative_id, derivative.manifestation_revision_id,
            derivative.source_body_sha256, manifestation.gene_id,
            manifestation.status AS manifestation_status,
            lifecycle.status AS lifecycle_status, derivative.status AS derivative_status,
            derivative.body_sha256, derivative.body_bytes,
            derivative.tags_sha256, derivative.tags_bytes,
            derivative.fields_sha256, derivative.fields_bytes, storage.object_key,
            storage.ciphertext_sha256, storage.ciphertext_bytes,
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

function entityAvailable(entity) {
  return Boolean(
    entity &&
    entity.manifestation_status !== "purged" &&
    entity.lifecycle_status !== "purged" &&
    entity.derivative_status !== "purged",
  )
}

function randomCapability() {
  return `backup_${crypto.randomUUID().replaceAll("-", "")}`
}

export async function issueManifestationBackupCapability(db, input = {}) {
  requireDatabase(db)
  const actor = await backupActor(db, input)
  const kind = String(input.entityKind || "")
    .trim()
    .toLowerCase()
  if (!["revision", "derivative"].includes(kind)) {
    throw authorityError("INVALID_BACKUP_ENTITY", "Backup entity kind is invalid")
  }
  const id = normalizeId(input.entityId, "entity_id")
  const entity = await readBackupEntity(db, kind, id)
  if (!entityAvailable(entity)) {
    throw authorityError("BACKUP_ENTITY_NOT_AVAILABLE", "Backup entity is not available", 404)
  }
  const capability = randomCapability()
  const capabilitySha256 = await sha256Hex(capability)
  const timestamp = normalizeTimestamp(input.now)
  const ttl = Math.max(30, Math.min(300, Number(input.ttlSeconds) || 300))
  const expiresAt = new Date(new Date(timestamp).getTime() + ttl * 1000).toISOString()
  await prepared(
    db,
    `INSERT INTO icono_manifestation_backup_capabilities (
       capability_sha256, entity_kind, entity_id, actor_kind, actor_account_id,
       expires_at, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    capabilitySha256,
    kind,
    id,
    actor.actorKind,
    actor.actorAccountId,
    expiresAt,
    timestamp,
  ).run()
  return Object.freeze({
    capability,
    entity_kind: kind,
    entity_id: id,
    plaintext_sha256: entity.body_sha256,
    expires_at: expiresAt,
  })
}

async function leaseCapability(db, capabilitySha256, actor, timestamp) {
  const leaseId = `lease_${crypto.randomUUID().replaceAll("-", "")}`
  const leasedUntil = new Date(new Date(timestamp).getTime() + 30_000).toISOString()
  const row = await prepared(
    db,
    `UPDATE icono_manifestation_backup_capabilities
        SET lease_id = ?, leased_until = ?
      WHERE capability_sha256 = ? AND used_at IS NULL AND expires_at > ?
        AND actor_kind = ? AND actor_account_id IS ?
        AND (lease_id IS NULL OR leased_until <= ?)
      RETURNING entity_kind, entity_id`,
    leaseId,
    leasedUntil,
    capabilitySha256,
    timestamp,
    actor.actorKind,
    actor.actorAccountId,
    timestamp,
  ).first()
  return row ? { ...row, leaseId } : null
}

async function releaseCapabilityLease(db, capabilitySha256, leaseId) {
  await prepared(
    db,
    `UPDATE icono_manifestation_backup_capabilities SET lease_id = NULL, leased_until = NULL
      WHERE capability_sha256 = ? AND lease_id = ? AND used_at IS NULL`,
    capabilitySha256,
    leaseId,
  ).run()
}

export async function consumeManifestationBackupCapability(db, env, input = {}) {
  requireDatabase(db)
  const actor = await backupActor(db, input)
  const capabilitySha256 = await sha256Hex(String(input.capability || ""))
  const timestamp = normalizeTimestamp(input.now)
  const lease = await leaseCapability(db, capabilitySha256, actor, timestamp)
  if (!lease) {
    throw authorityError("BACKUP_CAPABILITY_INVALID", "Backup capability is invalid or busy", 410)
  }
  try {
    const entity = await readBackupEntity(db, lease.entity_kind, lease.entity_id)
    if (!entityAvailable(entity)) {
      throw authorityError("BACKUP_ENTITY_NOT_AVAILABLE", "Backup entity is unavailable", 404)
    }
    const encrypted = await readEncryptedManifestationBody(env, entity.object_key)
    if (
      !encrypted ||
      encrypted.bytes.byteLength !== Number(entity.ciphertext_bytes) ||
      (await sha256Hex(encrypted.bytes)) !== entity.ciphertext_sha256
    ) {
      throw authorityError(
        "BACKUP_CIPHERTEXT_CORRUPT",
        "Backup ciphertext failed verification",
        503,
      )
    }
    const used = await prepared(
      db,
      `UPDATE icono_manifestation_backup_capabilities
          SET used_at = ?, lease_id = NULL, leased_until = NULL
        WHERE capability_sha256 = ? AND lease_id = ? AND used_at IS NULL
        RETURNING entity_id`,
      timestamp,
      capabilitySha256,
      lease.leaseId,
    ).first()
    if (!used) throw authorityError("BACKUP_CAPABILITY_INVALID", "Backup lease expired", 410)
    return Object.freeze({
      entity_kind: lease.entity_kind,
      entity_id: lease.entity_id,
      plaintext_sha256: entity.body_sha256,
      plaintext_bytes: Number(entity.body_bytes),
      ciphertext: encrypted.bytes,
      ciphertext_sha256: entity.ciphertext_sha256,
      ciphertext_bytes: Number(entity.ciphertext_bytes),
      body_iv_base64: entity.body_iv_base64,
      wrapped_dek_base64: entity.wrapped_dek_base64,
      wrap_iv_base64: entity.wrap_iv_base64,
      key_version: Number(entity.key_version),
      aad_version: Number(entity.aad_version),
    })
  } catch (error) {
    await releaseCapabilityLease(db, capabilitySha256, lease.leaseId)
    throw error
  }
}

export async function verifyManifestationBackupEntity(db, env, input = {}) {
  requireDatabase(db)
  await backupActor(db, input)
  const kind = String(input.entityKind || "")
    .trim()
    .toLowerCase()
  if (!["revision", "derivative"].includes(kind)) {
    throw authorityError("INVALID_BACKUP_ENTITY", "Backup entity kind is invalid")
  }
  const id = normalizeId(input.entityId, "entity_id")
  const entity = await readBackupEntity(db, kind, id)
  if (!entityAvailable(entity)) {
    throw authorityError("BACKUP_ENTITY_NOT_AVAILABLE", "Backup entity is not available", 404)
  }
  const encrypted = await readEncryptedManifestationBody(env, entity.object_key)
  if (
    !encrypted ||
    encrypted.bytes.byteLength !== Number(entity.ciphertext_bytes) ||
    (await sha256Hex(encrypted.bytes)) !== entity.ciphertext_sha256
  ) {
    throw authorityError("BACKUP_CIPHERTEXT_CORRUPT", "Backup ciphertext failed verification", 503)
  }
  const common = {
    ciphertext: encrypted.bytes,
    ciphertextSha256: entity.ciphertext_sha256,
    ciphertextBytes: Number(entity.ciphertext_bytes),
    bodySha256: entity.body_sha256,
    bodyBytes: Number(entity.body_bytes),
    bodyIvBase64: entity.body_iv_base64,
    wrappedDekBase64: entity.wrapped_dek_base64,
    wrapIvBase64: entity.wrap_iv_base64,
    keyVersion: Number(entity.key_version),
    aadVersion: Number(entity.aad_version),
  }
  if (kind === "revision") {
    await decryptManifestationProse(env, {
      ...common,
      revisionId: entity.manifestation_revision_id,
      geneId: entity.gene_id,
    })
  } else {
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
  }
  return Object.freeze({
    ok: true,
    entity_kind: kind,
    entity_id: id,
    plaintext_sha256: entity.body_sha256,
    plaintext_bytes: Number(entity.body_bytes),
    ciphertext_sha256: entity.ciphertext_sha256,
    ciphertext_bytes: Number(entity.ciphertext_bytes),
    verified: true,
  })
}

// Capability rows are the minimal access audit. Keep them for one day after
// use/expiry, then remove them in bounded batches so the one-shot token ledger
// cannot grow without limit.
export async function sweepManifestationBackupCapabilities(
  db,
  { now, retentionSeconds = 24 * 60 * 60, limit = 100 } = {},
) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(now)
  const retention = Math.max(
    60 * 60,
    Math.min(7 * 24 * 60 * 60, Math.trunc(Number(retentionSeconds)) || 86_400),
  )
  const cutoff = new Date(new Date(timestamp).getTime() - retention * 1000).toISOString()
  const boundedLimit = Math.max(1, Math.min(250, Math.trunc(Number(limit)) || 100))
  const deleted = await prepared(
    db,
    `DELETE FROM icono_manifestation_backup_capabilities
      WHERE capability_sha256 IN (
        SELECT capability_sha256 FROM icono_manifestation_backup_capabilities
         WHERE COALESCE(used_at, expires_at) <= ?
           AND (lease_id IS NULL OR leased_until <= ?)
         ORDER BY COALESCE(used_at, expires_at), capability_sha256
         LIMIT ?
      )
      RETURNING capability_sha256`,
    cutoff,
    timestamp,
    boundedLimit,
  ).all()
  return Object.freeze({ purged: Array.isArray(deleted?.results) ? deleted.results.length : 0 })
}

export { backupActor, readBackupEntity }
