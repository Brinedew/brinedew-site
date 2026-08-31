import { decryptManifestationProse } from "../../lib/iconoplasm-manifestation-body-crypto.js"
import {
  decryptManifestationTags,
  encryptManifestationTags,
} from "../../lib/iconoplasm-manifestation-tags-crypto.js"
import {
  createManifestationBodyObjectKey,
  putEncryptedManifestationBody,
  readEncryptedManifestationBody,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import { defaultIdFactory, authorityError } from "./manifestation-authority-contract.js"
import {
  commandEnvelope,
  jsonResponse,
  readBoundedJson,
  requireAuthorityBearer,
  safeErrorResponse,
} from "./manifestation-authority-http-security.js"
import {
  consumeManifestationBackupCapability,
  issueManifestationBackupCapability,
  restoreManifestationDerivativeBackup,
  restoreManifestationRevisionBackup,
  verifyManifestationBackupEntity,
} from "./manifestation-authority-backup.js"
import { deliverAcceptedAuthorityEvent } from "./manifestation-authority-projection-delivery.js"
import { first, resolveCommandReplay } from "./manifestation-authority-repository.js"
import {
  selectTagsDerivativeHead,
  submitTagsDerivative,
} from "./manifestation-derivative-commands.js"
import { sweepManifestationPurgeQueue } from "./manifestation-authority-purge.js"
import { sweepWithdrawnManifestationRetention } from "./manifestation-withdrawal-retention.js"
import {
  matchManifestationEventCompactionRoute,
  runManifestationEventCompactionRoute,
} from "./manifestation-authority-compaction-handler.js"
import {
  compactManifestationCommandReceipts,
  sweepManifestationCommandTombstones,
} from "./manifestation-command-retention.js"
import {
  createManifestationUploadIntent,
  requireAdoptedManifestationUpload,
} from "./manifestation-upload-intents.js"
import {
  prepareManifestationTagsPayload,
  splitManifestationTagsPayload,
} from "./manifestation-tags-payload.js"

function routeId(raw) {
  try {
    return decodeURIComponent(raw)
  } catch {
    throw authorityError("INVALID_ROUTE_PARAMETER", "Route parameter is invalid")
  }
}

function requireJson(request) {
  const type = String(request.headers.get("content-type") || "")
    .split(";", 1)[0]
    .trim()
    .toLowerCase()
  if (type !== "application/json") {
    throw authorityError("JSON_CONTENT_TYPE_REQUIRED", "JSON request body required", 415)
  }
}

function bytesToBase64Url(bytes) {
  let binary = ""
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function base64UrlToBytes(raw) {
  const value = String(raw || "")
  if (!value || value.length > 96_000 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw authorityError("BACKUP_CIPHERTEXT_INVALID", "Backup ciphertext encoding is invalid")
  }
  try {
    const standard = value.replace(/-/g, "+").replace(/_/g, "/")
    const binary = atob(standard.padEnd(Math.ceil(standard.length / 4) * 4, "="))
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
  } catch {
    throw authorityError("BACKUP_CIPHERTEXT_INVALID", "Backup ciphertext encoding is invalid")
  }
}

function storageDescriptor(encrypted, objectKey, upload) {
  return {
    body_sha256: encrypted.body_sha256,
    body_bytes: encrypted.body_bytes,
    object_key: objectKey,
    ciphertext_sha256: encrypted.ciphertext_sha256,
    ciphertext_bytes: encrypted.ciphertext_bytes,
    body_iv_base64: encrypted.body_iv_base64,
    wrapped_dek_base64: encrypted.wrapped_dek_base64,
    wrap_iv_base64: encrypted.wrap_iv_base64,
    key_version: encrypted.key_version,
    aad_version: encrypted.aad_version,
    object_etag: upload.etag,
    verified_at: new Date().toISOString(),
  }
}

async function exactRevision(db, revisionId) {
  return first(
    db,
    `SELECT revision.manifestation_revision_id, revision.manifestation_id,
            manifestation.gene_id, revision.revision_number,
            revision.parent_revision_id, revision.source_revision_id,
            revision.body_sha256, revision.body_bytes,
            revision.sample_label, revision.sample_number, revision.sample_text_sha256,
            revision.caretaker_assignment_id, revision.created_at,
            lifecycle.status AS lifecycle, lifecycle.lifecycle_version,
            CASE WHEN storage.manifestation_revision_id IS NULL THEN 0 ELSE 1 END AS body_available,
            head.gene_revision
       FROM icono_manifestation_revisions revision
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       LEFT JOIN icono_manifestation_revision_storage_secrets storage
         ON storage.manifestation_revision_id = revision.manifestation_revision_id
       JOIN icono_manifestation_heads head ON head.gene_id = manifestation.gene_id
      WHERE revision.manifestation_revision_id = ?`,
    revisionId,
  )
}

async function exactDerivative(db, derivativeId) {
  return first(
    db,
    `SELECT derivative.manifestation_derivative_id,
            derivative.manifestation_revision_id, manifestation.gene_id,
            derivative.status, derivative.source_body_sha256,
            derivative.body_sha256, derivative.body_bytes,
            derivative.tags_sha256, derivative.tags_bytes,
            derivative.fields_sha256, derivative.fields_bytes,
            derivative.recipe_id, derivative.recipe_version,
            derivative.provider_id, derivative.model_id,
            derivative.tagger_config_sha256, derivative.provenance_status,
            derivative.failure_code, derivative.created_at, derivative.completed_at,
            derivative_head.accepted_derivative_id,
            derivative_head.derivative_head_version,
            CASE WHEN storage.manifestation_derivative_id IS NULL THEN 0 ELSE 1 END AS body_available,
            lifecycle.status AS revision_lifecycle, head.gene_revision
       FROM icono_manifestation_derivatives derivative
       JOIN icono_manifestation_revisions revision
         ON revision.manifestation_revision_id = derivative.manifestation_revision_id
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       JOIN icono_manifestation_derivative_heads derivative_head
         ON derivative_head.manifestation_revision_id = revision.manifestation_revision_id
       LEFT JOIN icono_manifestation_derivative_storage_secrets storage
         ON storage.manifestation_derivative_id = derivative.manifestation_derivative_id
       JOIN icono_manifestation_heads head ON head.gene_id = manifestation.gene_id
      WHERE derivative.manifestation_derivative_id = ?`,
    derivativeId,
  )
}

async function exactRevisionMaterial(db, env, row, onIntegrityFailure) {
  if (new Set(["purged", "quarantined"]).has(row.lifecycle)) {
    throw authorityError("REVISION_BODY_UNAVAILABLE", "Revision body is unavailable", 410)
  }
  const secret = await first(
    db,
    `SELECT object_key, ciphertext_sha256, ciphertext_bytes, body_iv_base64,
            wrapped_dek_base64, wrap_iv_base64, key_version, aad_version
       FROM icono_manifestation_revision_storage_secrets
      WHERE manifestation_revision_id = ?`,
    row.manifestation_revision_id,
  )
  try {
    if (!secret) throw new Error("revision_storage_missing")
    const encrypted = await readEncryptedManifestationBody(env, secret.object_key)
    if (!encrypted) throw new Error("revision_ciphertext_missing")
    return decryptManifestationProse(env, {
      revisionId: row.manifestation_revision_id,
      geneId: row.gene_id,
      ciphertext: encrypted.bytes,
      ciphertextSha256: secret.ciphertext_sha256,
      ciphertextBytes: Number(secret.ciphertext_bytes),
      bodySha256: row.body_sha256,
      bodyBytes: Number(row.body_bytes),
      bodyIvBase64: secret.body_iv_base64,
      wrappedDekBase64: secret.wrapped_dek_base64,
      wrapIvBase64: secret.wrap_iv_base64,
      keyVersion: Number(secret.key_version),
      aadVersion: Number(secret.aad_version),
    })
  } catch (error) {
    if (typeof onIntegrityFailure === "function") {
      await onIntegrityFailure({
        entity_kind: "revision",
        entity_id: row.manifestation_revision_id,
        gene_id: row.gene_id,
        reason: String(error?.message || "revision_body_corrupt").slice(0, 120),
      }).catch(() => undefined)
    }
    throw authorityError(
      "REVISION_BODY_UNAVAILABLE",
      "Revision body failed integrity verification",
      503,
      error,
    )
  }
}

async function exactDerivativeMaterial(db, env, row, onIntegrityFailure) {
  if (row.status !== "complete" || new Set(["purged", "quarantined"]).has(row.revision_lifecycle)) {
    throw authorityError("DERIVATIVE_BODY_UNAVAILABLE", "Tags body is unavailable", 410)
  }
  const secret = await first(
    db,
    `SELECT object_key, ciphertext_sha256, ciphertext_bytes, body_iv_base64,
            wrapped_dek_base64, wrap_iv_base64, key_version, aad_version
       FROM icono_manifestation_derivative_storage_secrets
      WHERE manifestation_derivative_id = ?`,
    row.manifestation_derivative_id,
  )
  try {
    if (!secret) throw new Error("derivative_storage_missing")
    const encrypted = await readEncryptedManifestationBody(env, secret.object_key)
    if (!encrypted) throw new Error("derivative_ciphertext_missing")
    const outputPlain = await decryptManifestationTags(env, {
      derivativeId: row.manifestation_derivative_id,
      revisionId: row.manifestation_revision_id,
      sourceBodySha256: row.source_body_sha256,
      ciphertext: encrypted.bytes,
      ciphertextSha256: secret.ciphertext_sha256,
      ciphertextBytes: Number(secret.ciphertext_bytes),
      bodySha256: row.body_sha256,
      bodyBytes: Number(row.body_bytes),
      bodyIvBase64: secret.body_iv_base64,
      wrappedDekBase64: secret.wrapped_dek_base64,
      wrapIvBase64: secret.wrap_iv_base64,
      keyVersion: Number(secret.key_version),
      aadVersion: Number(secret.aad_version),
    })
    return splitManifestationTagsPayload(outputPlain, {
      tagsBytes: row.tags_bytes,
      tagsSha256: row.tags_sha256,
      fieldsBytes: row.fields_bytes,
      fieldsSha256: row.fields_sha256,
    })
  } catch (error) {
    if (typeof onIntegrityFailure === "function") {
      await onIntegrityFailure({
        entity_kind: "derivative",
        entity_id: row.manifestation_derivative_id,
        gene_id: row.gene_id,
        reason: String(error?.message || "derivative_body_corrupt").slice(0, 120),
      }).catch(() => undefined)
    }
    throw authorityError(
      "DERIVATIVE_BODY_UNAVAILABLE",
      "Tags body failed integrity verification",
      503,
      error,
    )
  }
}

function publicRevision(row) {
  if (!row) throw authorityError("REVISION_NOT_FOUND", "Revision was not found", 404)
  return {
    schema_version: 1,
    entity_kind: "revision",
    entity_id: row.manifestation_revision_id,
    gene_id: row.gene_id,
    manifestation_id: row.manifestation_id,
    revision_number: Number(row.revision_number),
    parent_revision_id: row.parent_revision_id || null,
    source_revision_id: row.source_revision_id || null,
    body_sha256: row.body_sha256,
    body_bytes: Number(row.body_bytes),
    sample_label: row.sample_label || null,
    sample_number: row.sample_number == null ? null : Number(row.sample_number),
    sample_text_sha256: row.sample_text_sha256 || null,
    lifecycle: row.lifecycle,
    lifecycle_version: Number(row.lifecycle_version),
    body_available:
      Boolean(row.body_available) && !new Set(["purged", "quarantined"]).has(row.lifecycle),
    gene_revision: Number(row.gene_revision),
    created_at: row.created_at,
  }
}

function publicDerivative(row) {
  if (!row) throw authorityError("DERIVATIVE_NOT_FOUND", "Tags derivative was not found", 404)
  return {
    schema_version: 1,
    entity_kind: "derivative",
    entity_id: row.manifestation_derivative_id,
    manifestation_revision_id: row.manifestation_revision_id,
    gene_id: row.gene_id,
    status: row.status,
    source_body_sha256: row.source_body_sha256,
    body_sha256: row.body_sha256 || null,
    body_bytes: row.body_bytes == null ? null : Number(row.body_bytes),
    tags_sha256: row.tags_sha256 || null,
    tags_bytes: row.tags_bytes == null ? null : Number(row.tags_bytes),
    fields_sha256: row.fields_sha256 || null,
    fields_bytes: row.fields_bytes == null ? null : Number(row.fields_bytes),
    recipe_id: row.recipe_id || null,
    recipe_version: row.recipe_version || null,
    provider_id: row.provider_id || null,
    model_id: row.model_id || null,
    tagger_config_sha256: row.tagger_config_sha256 || null,
    provenance_status: row.provenance_status,
    failure_code: row.failure_code || null,
    accepted: row.accepted_derivative_id === row.manifestation_derivative_id,
    derivative_head_version: Number(row.derivative_head_version),
    body_available:
      Boolean(row.body_available) &&
      row.status === "complete" &&
      row.revision_lifecycle !== "purged",
    gene_revision: Number(row.gene_revision),
    created_at: row.created_at,
    completed_at: row.completed_at || null,
  }
}

async function mutationResponse(db, callback, result) {
  const projection = await deliverAcceptedAuthorityEvent(db, { onAuthorityEvent: callback }, result)
  return jsonResponse(
    projection.pending ? { ...result, projection_pending: true } : result,
    projection.pending ? 202 : 200,
  )
}

function restoreInput(body, actor, command, kind) {
  const entityId = String(body.entity_id || "")
  return {
    ...(kind === "revision" ? { revisionId: entityId } : { derivativeId: entityId }),
    expectedGeneRevision: body.expected_gene_revision,
    expectedStorageCiphertextSha256: body.expected_storage_ciphertext_sha256 ?? null,
    ciphertext: base64UrlToBytes(body.ciphertext_base64url),
    ciphertextSha256: body.ciphertext_sha256,
    ciphertextBytes: body.ciphertext_bytes,
    bodyIvBase64: body.body_iv_base64,
    wrappedDekBase64: body.wrapped_dek_base64,
    wrapIvBase64: body.wrap_iv_base64,
    keyVersion: body.key_version,
    aadVersion: body.aad_version,
    eventUuid: body.event_id,
    actorKind: actor.actorKind,
    actorAccountId: actor.actorAccountId,
    ...command,
  }
}

export function createManifestationAuthorityServiceHandler({
  db,
  env,
  authorizeReplicaBearer,
  authorizeMaintenanceBearer,
  authorizeBackupBearer,
  onAuthorityEvent,
  onIntegrityFailure,
  idFactory = defaultIdFactory,
} = {}) {
  if (!db || !env) throw new TypeError("Authority service handler requires db and env")
  return async function handleManifestationAuthorityService(request) {
    try {
      const url = new URL(request.url)
      const revisionBody = url.pathname.match(
        /^\/api\/iconoplasm\/authority\/revisions\/([^/]+)\/body$/,
      )
      const derivativeBody = url.pathname.match(
        /^\/api\/iconoplasm\/authority\/derivatives\/([^/]+)\/body$/,
      )
      const submit = url.pathname.match(
        /^\/api\/iconoplasm\/authority\/revisions\/([^/]+)\/tags-derivatives$/,
      )
      const select = url.pathname.match(
        /^\/api\/iconoplasm\/authority\/revisions\/([^/]+)\/tags-derivative-head$/,
      )
      const backupPath = url.pathname.match(
        /^\/api\/iconoplasm\/authority\/backups\/(capabilities|export|restores|verifications)$/,
      )
      const maintenance = url.pathname.match(
        /^\/api\/iconoplasm\/authority\/maintenance\/(withdrawal-retention|purge-queue|command-receipts|command-tombstones)\/(sweep|compact)$/,
      )
      const compaction = matchManifestationEventCompactionRoute(url.pathname)
      const matched =
        revisionBody ||
        derivativeBody ||
        submit ||
        select ||
        backupPath ||
        maintenance ||
        compaction
      if (!matched) return null
      const authorizeBearer = backupPath
        ? authorizeBackupBearer
        : maintenance || compaction
          ? authorizeMaintenanceBearer
          : authorizeReplicaBearer
      const actor = await requireAuthorityBearer(request, env, authorizeBearer)
      if (request.method === "GET" && revisionBody) {
        const row = await exactRevision(db, routeId(revisionBody[1]))
        if (!row) throw authorityError("REVISION_NOT_FOUND", "Revision was not found", 404)
        const bodyPlain = await exactRevisionMaterial(db, env, row, onIntegrityFailure)
        return jsonResponse({
          schema_version: 1,
          entity_kind: "revision_body",
          manifestation_revision_id: row.manifestation_revision_id,
          body_plain: bodyPlain,
          body_plain_sha256: row.body_sha256,
          body_byte_length: Number(row.body_bytes),
        })
      }
      if (request.method === "GET" && derivativeBody) {
        const row = await exactDerivative(db, routeId(derivativeBody[1]))
        if (!row) throw authorityError("DERIVATIVE_NOT_FOUND", "Tags derivative was not found", 404)
        const material = await exactDerivativeMaterial(db, env, row, onIntegrityFailure)
        return jsonResponse({
          schema_version: 1,
          entity_kind: "tags_derivative_body",
          manifestation_derivative_id: row.manifestation_derivative_id,
          manifestation_revision_id: row.manifestation_revision_id,
          output_plain_sha256: row.body_sha256,
          output_plain_bytes: Number(row.body_bytes),
          tags_text: material.tags_text,
          tags_sha256: material.tags_sha256,
          fields_json: material.fields_json,
          fields_sha256: material.fields_sha256,
        })
      }
      if (request.method === "GET" && compaction?.action === "status") {
        return jsonResponse(await runManifestationEventCompactionRoute(db, compaction))
      }
      if (request.method !== "POST") return null
      requireJson(request)
      const parsed = await readBoundedJson(
        request,
        backupPath?.[1] === "restores" ? 128 * 1024 : 48 * 1024,
      )
      const body = parsed.value

      if (compaction) {
        if (compaction.action === "status") return null
        return jsonResponse(await runManifestationEventCompactionRoute(db, compaction, body))
      }

      if (maintenance) {
        const options = { limit: body.limit, now: body.now }
        if (maintenance[1] === "withdrawal-retention" && maintenance[2] === "sweep") {
          return jsonResponse(await sweepWithdrawnManifestationRetention(db, options))
        }
        if (maintenance[1] === "purge-queue" && maintenance[2] === "sweep") {
          return jsonResponse(await sweepManifestationPurgeQueue(db, env, options))
        }
        if (maintenance[1] === "command-receipts" && maintenance[2] === "compact") {
          return jsonResponse(await compactManifestationCommandReceipts(db, options))
        }
        if (maintenance[1] === "command-tombstones" && maintenance[2] === "sweep") {
          return jsonResponse(await sweepManifestationCommandTombstones(db, options))
        }
        throw authorityError("INVALID_MAINTENANCE_ACTION", "Maintenance action is invalid", 404)
      }

      if (backupPath) {
        if (backupPath[1] === "capabilities") {
          return jsonResponse(
            await issueManifestationBackupCapability(db, {
              entityKind: body.entity_kind,
              entityId: body.entity_id,
              ttlSeconds: body.ttl_seconds,
              actorKind: actor.actorKind,
              actorAccountId: actor.actorAccountId,
            }),
          )
        }
        if (backupPath[1] === "export") {
          const value = await consumeManifestationBackupCapability(db, env, {
            capability: body.capability,
            actorKind: actor.actorKind,
            actorAccountId: actor.actorAccountId,
          })
          return jsonResponse({
            schema_version: 1,
            ...value,
            ciphertext: undefined,
            ciphertext_base64url: bytesToBase64Url(value.ciphertext),
          })
        }
        if (backupPath[1] === "verifications") {
          return jsonResponse(
            await verifyManifestationBackupEntity(db, env, {
              entityKind: body.entity_kind,
              entityId: body.entity_id,
              actorKind: actor.actorKind,
              actorAccountId: actor.actorAccountId,
            }),
          )
        }
        const kind = String(body.entity_kind || "")
          .trim()
          .toLowerCase()
        if (!["revision", "derivative"].includes(kind)) {
          throw authorityError("INVALID_BACKUP_ENTITY", "Backup entity kind is invalid")
        }
        const command = await commandEnvelope(
          request,
          parsed.raw,
          body,
          actor.actorKind,
          actor.actorAccountId,
        )
        const value =
          kind === "revision"
            ? await restoreManifestationRevisionBackup(
                db,
                env,
                restoreInput(body, actor, command, kind),
              )
            : await restoreManifestationDerivativeBackup(
                db,
                env,
                restoreInput(body, actor, command, kind),
              )
        return mutationResponse(db, onAuthorityEvent, value)
      }

      const revisionId = routeId((submit || select)[1])
      const revision = await exactRevision(db, revisionId)
      if (!revision) throw authorityError("REVISION_NOT_FOUND", "Revision was not found", 404)
      if (body.manifestation_revision_id != null && body.manifestation_revision_id !== revisionId) {
        throw authorityError("ROUTE_ENTITY_MISMATCH", "Body entity does not match route", 400)
      }
      const command = await commandEnvelope(
        request,
        parsed.raw,
        body,
        actor.actorKind,
        actor.actorAccountId,
      )
      if (select) {
        const derivative = await exactDerivative(db, String(body.manifestation_derivative_id || ""))
        if (!derivative || derivative.manifestation_revision_id !== revisionId) {
          throw authorityError("DERIVATIVE_NOT_FOUND", "Tags derivative was not found", 404)
        }
        const value = await selectTagsDerivativeHead(db, {
          derivativeId: derivative.manifestation_derivative_id,
          expectedDerivativeHeadVersion: body.expected_derivative_head_version,
          expectedGeneRevision: body.expected_gene_revision,
          eventUuid: body.event_id,
          idFactory,
          actorKind: actor.actorKind,
          actorAccountId: actor.actorAccountId,
          ...command,
        })
        return mutationResponse(db, onAuthorityEvent, value)
      }

      const replay = await resolveCommandReplay(db, command, actor)
      if (replay) return mutationResponse(db, onAuthorityEvent, replay)
      const status = String(body.status || "")
        .trim()
        .toLowerCase()
      const derivativeId = idFactory("derivative")
      let descriptor = null
      let output = null
      if (status === "complete") {
        output = await prepareManifestationTagsPayload({
          tagsText: body.tags_text,
          tagsSha256: body.tags_sha256,
          fieldsJson: body.fields_json,
          fieldsSha256: body.fields_sha256,
        })
        const encrypted = await encryptManifestationTags(env, {
          derivativeId,
          revisionId,
          sourceBodySha256: body.source_body_sha256,
          tags: output.output_plain,
        })
        if (
          encrypted.body_sha256 !== output.output_plain_sha256 ||
          encrypted.body_bytes !== output.output_plain_bytes
        ) {
          throw authorityError(
            "TAGS_OUTPUT_INVALID",
            "Encrypted Tags output changed during normalization",
            500,
          )
        }
        const objectKey = await createManifestationBodyObjectKey()
        await createManifestationUploadIntent(db, {
          entityKind: "derivative",
          entityId: derivativeId,
          assignmentId: revision.caretaker_assignment_id || null,
          objectKey,
          ciphertextSha256: encrypted.ciphertext_sha256,
          bodyBytes: encrypted.body_bytes,
          actorKind: actor.actorKind,
          actorAccountId: actor.actorAccountId,
          idFactory,
        })
        const upload = await putEncryptedManifestationBody(env, objectKey, encrypted.ciphertext, {
          expectedSha256: encrypted.ciphertext_sha256,
          verifyPlaintext: (stored) =>
            decryptManifestationTags(env, {
              derivativeId,
              revisionId,
              sourceBodySha256: body.source_body_sha256,
              ciphertext: stored,
              ciphertextSha256: encrypted.ciphertext_sha256,
              ciphertextBytes: encrypted.ciphertext_bytes,
              bodySha256: encrypted.body_sha256,
              bodyBytes: encrypted.body_bytes,
              bodyIvBase64: encrypted.body_iv_base64,
              wrappedDekBase64: encrypted.wrapped_dek_base64,
              wrapIvBase64: encrypted.wrap_iv_base64,
              keyVersion: encrypted.key_version,
              aadVersion: encrypted.aad_version,
            }),
        })
        descriptor = storageDescriptor(encrypted, objectKey, upload)
      }
      const value = await submitTagsDerivative(db, {
        revisionId,
        derivativeId,
        status,
        sourceBodySha256: body.source_body_sha256,
        tagsSha256: output?.tags_sha256 || null,
        tagsBytes: output?.tags_bytes || null,
        fieldsSha256: output?.fields_sha256 || null,
        fieldsBytes: output?.fields_bytes || null,
        storage: descriptor,
        recipeId: body.recipe_id,
        recipeVersion: body.recipe_version,
        providerId: body.provider_id,
        modelId: body.model_id,
        taggerConfigSha256: body.tagger_config_sha256,
        failureCode: body.failure_code,
        expectedGeneRevision: body.expected_gene_revision,
        eventUuid: body.event_id,
        idFactory,
        actorKind: actor.actorKind,
        actorAccountId: actor.actorAccountId,
        ...command,
      })
      if (descriptor) await requireAdoptedManifestationUpload(db, "derivative", derivativeId)
      return mutationResponse(db, onAuthorityEvent, value)
    } catch (error) {
      return safeErrorResponse(error)
    }
  }
}
