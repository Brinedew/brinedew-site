import {
  readManifestationProse,
  readManifestationTags,
} from "../../lib/iconoplasm-manifestation-body-reader.js"
import {
  createManifestationBodyObjectKey,
  putManifestationBodyObject,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import { defaultIdFactory, authorityError } from "./manifestation-authority-contract.js"
import {
  commandEnvelope,
  jsonResponse,
  readBoundedJson,
  requireAuthorityBearer,
  safeErrorResponse,
} from "./manifestation-authority-http-security.js"
import { deliverAcceptedAuthorityEvent } from "./manifestation-authority-projection-delivery.js"
import { first, resolveCommandReplay } from "./manifestation-authority-repository.js"
import {
  selectTagsDerivativeHead,
  submitTagsDerivative,
} from "./manifestation-derivative-commands.js"
import {
  admitManifestationUploadIntent,
  requireAdoptedManifestationUpload,
} from "./manifestation-upload-intents.js"
import { plainStorageDescriptor } from "./manifestation-storage-contract.js"
import { prepareManifestationProse } from "../../lib/iconoplasm-manifestation-prose.js"
import { appendSystemRevisionWithTags } from "./manifestation-write-commands.js"
import { registerGeneIdentity } from "./caretaker-assignment-commands.js"
import { sha256Hex } from "../../lib/iconoplasm-sha256.js"
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
    const prose = await readManifestationProse(env, secret, {
      revisionId: row.manifestation_revision_id,
      geneId: row.gene_id,
      bodySha256: row.body_sha256,
      bodyBytes: Number(row.body_bytes),
    })
    if (prose === null) throw new Error("revision_body_missing")
    return prose
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
    const outputPlain = await readManifestationTags(env, secret, {
      derivativeId: row.manifestation_derivative_id,
      revisionId: row.manifestation_revision_id,
      sourceBodySha256: row.source_body_sha256,
      bodySha256: row.body_sha256,
      bodyBytes: Number(row.body_bytes),
    })
    if (outputPlain === null) throw new Error("derivative_body_missing")
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

async function mutationResponse(db, callback, result) {
  const projection = await deliverAcceptedAuthorityEvent(db, { onAuthorityEvent: callback }, result)
  return jsonResponse(
    projection.pending ? { ...result, projection_pending: true } : result,
    projection.pending ? 202 : 200,
  )
}

export function createManifestationAuthorityServiceHandler({
  db,
  env,
  authorizeReplicaBearer,
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
      // B-1011: the workstation's regenerated system text with its Tags.
      const systemRevision = url.pathname.match(
        /^\/api\/iconoplasm\/authority\/genes\/([^/]+)\/system-revisions$/,
      )
      const matched = revisionBody || derivativeBody || submit || select || systemRevision
      if (!matched) return null
      const actor = await requireAuthorityBearer(request, env, authorizeReplicaBearer)
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
      if (request.method !== "POST") return null
      requireJson(request)
      // Prose (16 KiB at most) and Tags (32 KiB) travel together on a system revision.
      const parsed = await readBoundedJson(request, systemRevision ? 96 * 1024 : 48 * 1024)
      const body = parsed.value

      if (systemRevision) {
        const geneId = routeId(systemRevision[1])
        if (body.gene_id != null && body.gene_id !== geneId) {
          throw authorityError("ROUTE_ENTITY_MISMATCH", "Body entity does not match route", 400)
        }
        const command = await commandEnvelope(
          request,
          parsed.raw,
          body,
          actor.actorKind,
          actor.actorAccountId,
        )
        const replay = await resolveCommandReplay(db, command, actor)
        if (replay) return mutationResponse(db, onAuthorityEvent, replay)
        if (body.canonical_symbol != null) {
          await registerNewCatalogueGene(db, geneId, body.canonical_symbol)
        }
        const prose = await prepareManifestationProse(body.prose)
        const output = await prepareManifestationTagsPayload({
          tagsText: body.tags_text,
          tagsSha256: body.tags_sha256,
          fieldsJson: body.fields_json,
          fieldsSha256: body.fields_sha256,
        })
        const revisionId = idFactory("revision")
        const derivativeId = idFactory("derivative")
        const proseKey = await createManifestationBodyObjectKey()
        const tagsKey = await createManifestationBodyObjectKey()
        for (const [entityKind, entityId, objectKey, sha256, bytes] of [
          ["revision", revisionId, proseKey, prose.body_sha256, prose.body_bytes],
          [
            "derivative",
            derivativeId,
            tagsKey,
            output.output_plain_sha256,
            output.output_plain_bytes,
          ],
        ]) {
          await admitManifestationUploadIntent(db, env, {
            entityKind,
            entityId,
            assignmentId: null,
            objectKey,
            ciphertextSha256: sha256,
            bodyBytes: bytes,
            actorKind: actor.actorKind,
            actorAccountId: actor.actorAccountId,
            idFactory,
          })
        }
        const [proseUpload, tagsUpload] = await Promise.all([
          putManifestationBodyObject(env, proseKey, prose.bytes, {
            expectedSha256: prose.body_sha256,
          }),
          putManifestationBodyObject(env, tagsKey, output.output_bytes, {
            expectedSha256: output.output_plain_sha256,
          }),
        ])
        const value = await appendSystemRevisionWithTags(db, {
          geneId,
          revisionId,
          storage: plainStorageDescriptor(prose, proseKey, proseUpload),
          tags: {
            derivativeId,
            tagsSha256: output.tags_sha256,
            tagsBytes: output.tags_bytes,
            fieldsSha256: output.fields_sha256,
            fieldsBytes: output.fields_bytes,
            storage: plainStorageDescriptor(
              { body_sha256: output.output_plain_sha256, body_bytes: output.output_plain_bytes },
              tagsKey,
              tagsUpload,
            ),
            recipeId: body.recipe_id,
            recipeVersion: body.recipe_version,
            providerId: body.provider_id,
            modelId: body.model_id,
            taggerConfigSha256: body.tagger_config_sha256,
          },
          expectedHeadVersion: body.expected_head_version,
          expectedCanonicalRevisionId: body.expected_canonical_revision_id,
          expectedSystemRevisionId: body.expected_system_revision_id,
          eventUuid: body.event_id,
          idFactory,
          actorKind: actor.actorKind,
          actorAccountId: actor.actorAccountId,
          ...command,
        })
        await requireAdoptedManifestationUpload(db, "revision", revisionId)
        await requireAdoptedManifestationUpload(db, "derivative", derivativeId)
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
        const objectKey = await createManifestationBodyObjectKey()
        await admitManifestationUploadIntent(db, env, {
          entityKind: "derivative",
          entityId: derivativeId,
          assignmentId: revision.caretaker_assignment_id || null,
          objectKey,
          ciphertextSha256: output.output_plain_sha256,
          bodyBytes: output.output_plain_bytes,
          actorKind: actor.actorKind,
          actorAccountId: actor.actorAccountId,
          idFactory,
        })
        const upload = await putManifestationBodyObject(env, objectKey, output.output_bytes, {
          expectedSha256: output.output_plain_sha256,
        })
        descriptor = plainStorageDescriptor(
          { body_sha256: output.output_plain_sha256, body_bytes: output.output_plain_bytes },
          objectKey,
          upload,
        )
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

// B-1031: a gene new to the catalogue has no identity here until its first system
// text arrives. Its ID is derived from its symbol, so the workstation and the site
// agree on it without a round trip, and no caller can register an arbitrary ID.
export async function catalogueGeneId(symbol) {
  const normalized = String(symbol || "")
    .trim()
    .toUpperCase()
  return `gene_${(await sha256Hex(`iconoplasm-gene:${normalized}`)).slice(0, 48)}`
}

async function registerNewCatalogueGene(db, geneId, canonicalSymbol) {
  const symbol = String(canonicalSymbol || "")
    .trim()
    .toUpperCase()
  if (!symbol) throw authorityError("INVALID_CANONICAL_SYMBOL", "canonical_symbol is empty", 400)
  const existing = await first(
    db,
    "SELECT gene_id FROM icono_gene_identities WHERE gene_id = ?",
    geneId,
  )
  if (existing) return
  if (geneId !== (await catalogueGeneId(symbol))) {
    throw authorityError(
      "ROUTE_ENTITY_MISMATCH",
      "A new gene's ID must be derived from its canonical symbol",
      400,
    )
  }
  await registerGeneIdentity(db, { geneId, canonicalSymbol: symbol })
}
