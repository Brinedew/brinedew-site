import {
  decryptManifestationProse,
  encryptManifestationProse,
} from "../../lib/iconoplasm-manifestation-body-crypto.js"
import {
  createManifestationBodyObjectKey,
  putEncryptedManifestationBody,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import { transitionCaretakerAssignment } from "./caretaker-assignment-commands.js"
import { authorityError, defaultIdFactory } from "./manifestation-authority-contract.js"
import {
  authorityMode,
  commandEnvelope,
  jsonResponse,
  readBoundedJson,
  requireAuthoritativeMode,
  requireBrowserSession,
  requireStrictSameOriginMutation,
  safeErrorResponse,
} from "./manifestation-authority-http-security.js"
import {
  readAuthorizedManifestationDerivativeBody,
  readAuthorizedManifestationRevisionBody,
  readCaretakerGeneDossier,
  resolveGene,
} from "./manifestation-authority-read-model.js"
import { first, resolveCommandReplay } from "./manifestation-authority-repository.js"
import {
  createManifestationUploadIntent,
  requireAdoptedManifestationUpload,
} from "./manifestation-upload-intents.js"
import { selectManifestationRevision } from "./manifestation-selection-commands.js"
import {
  restoreOwnManifestation,
  withdrawOwnManifestation,
} from "./manifestation-lifecycle-commands.js"
import { endCaretakerAssignment } from "./caretaker-assignment-end-command.js"
import { saveManifestationRevision } from "./manifestation-write-commands.js"
import { deliverAcceptedAuthorityEvent } from "./manifestation-authority-projection-delivery.js"

function segment(raw) {
  try {
    return decodeURIComponent(raw)
  } catch {
    throw authorityError("INVALID_ROUTE_PARAMETER", "Route parameter is invalid")
  }
}

async function requireRouteAssignment(db, geneLocator, assignmentId, accountId) {
  const gene = await resolveGene(db, geneLocator)
  const assignment = await first(
    db,
    `SELECT caretaker_assignment_id, gene_id, account_id, status, assignment_version
       FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?`,
    assignmentId,
  )
  if (!assignment || assignment.gene_id !== gene.gene_id || assignment.account_id !== accountId) {
    throw authorityError("ASSIGNMENT_NOT_FOUND", "Caretaker assignment was not found", 404)
  }
  return { assignment, gene }
}

async function requireRouteCurrentAssignment(db, geneLocator, accountId) {
  const gene = await resolveGene(db, geneLocator)
  const assignment = await first(
    db,
    `SELECT caretaker_assignment_id, gene_id, account_id, status, assignment_version
       FROM icono_caretaker_assignments
      WHERE gene_id = ? AND account_id = ?
        AND status IN ('pending_acceptance', 'active', 'suspended')
      LIMIT 1`,
    gene.gene_id,
    accountId,
  )
  if (!assignment) {
    throw authorityError("ASSIGNMENT_NOT_FOUND", "Caretaker assignment was not found", 404)
  }
  return { assignment, gene }
}

async function requireRouteEntity(db, geneLocator, table, idColumn, entityId, accountId) {
  const gene = await resolveGene(db, geneLocator)
  const row = await first(
    db,
    `SELECT entity.${idColumn} AS entity_id, entity.gene_id, entity.author_account_id,
            entity.manifestation_head_revision_id, entity.row_version, entity.status
       FROM ${table} entity WHERE entity.${idColumn} = ?`,
    entityId,
  )
  if (!row || row.gene_id !== gene.gene_id || row.author_account_id !== accountId) {
    throw authorityError("MANIFESTATION_NOT_FOUND", "Manifestation was not found", 404)
  }
  return { gene, row }
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

async function mutationResponse(db, callbacks, result) {
  const projection = await deliverAcceptedAuthorityEvent(db, callbacks, result)
  return jsonResponse(
    projection.pending ? { ...result, projection_pending: true } : result,
    projection.pending ? 202 : 200,
  )
}

function auditIds(body) {
  return {
    eventUuid: body.event_id || undefined,
    selectionId: body.selection_id || undefined,
  }
}

function rejectMismatchedBodyId(body, key, routeValue) {
  if (body[key] != null && String(body[key]) !== routeValue) {
    throw authorityError("ROUTE_ENTITY_MISMATCH", "Body entity does not match route", 400)
  }
}

function createCaretakerManifestationHttpHandler({
  db,
  env,
  resolveSession,
  cursorSecret = env?.ICONOPLASM_AUTHORING_CURSOR_SECRET,
  onAuthorityEvent,
  onAssignmentEvent,
  onIntegrityFailure,
  idFactory = defaultIdFactory,
} = {}) {
  if (!db || !env) throw new TypeError("Caretaker HTTP handler requires db and env")

  return async function handleCaretakerManifestationRequest(request) {
    try {
      const url = new URL(request.url)
      const path = url.pathname
      const dossier = path.match(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)$/)
      const revisionBody = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/revisions\/([^/]+)\/body$/,
      )
      const derivativeBody = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/derivatives\/([^/]+)\/body$/,
      )
      if (request.method === "GET" && (dossier || revisionBody || derivativeBody)) {
        if ((await authorityMode(db)) !== "authoritative") {
          return jsonResponse({ enabled: false }, 200)
        }
        const session = await requireBrowserSession(request, env, resolveSession)
        if (dossier) {
          try {
            const value = await readCaretakerGeneDossier(db, {
              geneId: segment(dossier[1]),
              actorAccountId: session.accountId,
              audience: "browser",
              cursorSecret,
              cursor: url.searchParams.get("history_cursor"),
              limit: url.searchParams.get("limit"),
              includeBodies: true,
              storageEnv: env,
              onIntegrityFailure,
            })
            return jsonResponse(value)
          } catch (error) {
            if (error?.code === "GENE_DOSSIER_FORBIDDEN") {
              return jsonResponse({ enabled: false }, 200)
            }
            throw error
          }
        }
        if (revisionBody) {
          return jsonResponse(
            await readAuthorizedManifestationRevisionBody(db, env, {
              geneId: segment(revisionBody[1]),
              revisionId: segment(revisionBody[2]),
              actorAccountId: session.accountId,
            }),
          )
        }
        return jsonResponse(
          await readAuthorizedManifestationDerivativeBody(db, env, {
            geneId: segment(derivativeBody[1]),
            derivativeId: segment(derivativeBody[2]),
            actorAccountId: session.accountId,
          }),
        )
      }

      const save = path.match(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/revisions$/)
      const select = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/canonical-selections$/,
      )
      const withdraw = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/manifestations\/([^/]+)$/,
      )
      const restore = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/manifestations\/([^/]+)\/restore$/,
      )
      const assignmentAction = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/assignments\/([^/]+)\/(accept|decline|end)$/,
      )
      const methodMatches =
        (request.method === "POST" && (save || select || restore || assignmentAction)) ||
        (request.method === "DELETE" && withdraw)
      if (!methodMatches) return null

      requireStrictSameOriginMutation(request)
      await requireAuthoritativeMode(db)
      const session = await requireBrowserSession(request, env, resolveSession)
      const parsed = await readBoundedJson(request)
      const body = parsed.value
      const command = await commandEnvelope(request, parsed.raw, body, "account", session.accountId)
      let result

      if (assignmentAction) {
        const action = assignmentAction[3]
        const routeAssignmentId = segment(assignmentAction[2])
        rejectMismatchedBodyId(body, "caretaker_assignment_id", routeAssignmentId)
        await requireRouteAssignment(
          db,
          segment(assignmentAction[1]),
          routeAssignmentId,
          session.accountId,
        )
        if (action === "accept" && body.terms_accepted !== true) {
          throw authorityError(
            "TERMS_ACCEPTANCE_REQUIRED",
            "Confirm the displayed caretaker terms before accepting",
            400,
          )
        }
        result =
          action === "end"
            ? await endCaretakerAssignment(db, {
                assignmentId: routeAssignmentId,
                expectedAssignmentVersion: body.expected_assignment_version,
                expectedHeadVersion: body.expected_head_version,
                expectedCanonicalRevisionId: body.expected_canonical_revision_id,
                relinquishPolicy: body.leave_policy,
                reason: "caretaker_resigned",
                ...auditIds(body),
                idFactory,
                ...command,
              })
            : await transitionCaretakerAssignment(db, {
                assignmentId: routeAssignmentId,
                action,
                expectedAssignmentVersion: body.expected_assignment_version,
                termsVersionId: body.terms_version_id,
                relinquishPolicy: body.default_leave_policy,
                ...auditIds(body),
                idFactory,
                ...command,
              })
        return mutationResponse(db, { onAuthorityEvent, onAssignmentEvent }, result)
      }

      if (save) {
        const { gene, assignment } = await requireRouteCurrentAssignment(
          db,
          segment(save[1]),
          session.accountId,
        )
        if (assignment.status !== "active") {
          throw authorityError("ASSIGNMENT_NOT_ACTIVE", "Caretaker assignment is not active", 409)
        }
        const assignmentId = assignment.caretaker_assignment_id
        rejectMismatchedBodyId(body, "caretaker_assignment_id", assignmentId)
        const replay = await resolveCommandReplay(db, command, command)
        if (replay) return jsonResponse(replay)
        if (
          body.revision_id != null ||
          body.manifestation_id != null ||
          body.source_revision_id != null
        ) {
          throw authorityError(
            "UNSUPPORTED_ENTITY_ID_FIELD",
            "Entity IDs are server-derived; use based_on_revision_id only for ancestry",
            400,
          )
        }
        const revisionId = idFactory("revision")
        const encrypted = await encryptManifestationProse(env, {
          revisionId,
          geneId: gene.gene_id,
          prose: body.prose,
        })
        const objectKey = await createManifestationBodyObjectKey()
        await createManifestationUploadIntent(db, {
          entityKind: "revision",
          entityId: revisionId,
          assignmentId,
          objectKey,
          ciphertextSha256: encrypted.ciphertext_sha256,
          bodyBytes: encrypted.body_bytes,
          actorKind: "account",
          actorAccountId: session.accountId,
          idFactory,
        })
        const upload = await putEncryptedManifestationBody(env, objectKey, encrypted.ciphertext, {
          expectedSha256: encrypted.ciphertext_sha256,
          verifyPlaintext: (stored) =>
            decryptManifestationProse(env, {
              revisionId,
              geneId: gene.gene_id,
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
        result = await saveManifestationRevision(db, {
          assignmentId,
          expectedAssignmentVersion: body.expected_assignment_version,
          expectedManifestationVersion: body.expected_manifestation_version,
          sourceRevisionId: body.based_on_revision_id,
          revisionId,
          eventUuid: body.event_id,
          storage: storageDescriptor(encrypted, objectKey, upload),
          idFactory,
          ...command,
        })
        await requireAdoptedManifestationUpload(db, "revision", revisionId)
        return mutationResponse(db, { onAuthorityEvent, onAssignmentEvent }, result)
      }

      if (select) {
        const { assignment } = await requireRouteCurrentAssignment(
          db,
          segment(select[1]),
          session.accountId,
        )
        const assignmentId = assignment.caretaker_assignment_id
        rejectMismatchedBodyId(body, "caretaker_assignment_id", assignmentId)
        const revisionId = String(body.manifestation_revision_id || "")
        const revisionRoute = await first(
          db,
          `SELECT revision.manifestation_id, manifestation.gene_id
             FROM icono_manifestation_revisions revision
             JOIN icono_manifestations manifestation
               ON manifestation.manifestation_id = revision.manifestation_id
            WHERE revision.manifestation_revision_id = ?`,
          revisionId,
        )
        if (!revisionRoute || revisionRoute.gene_id !== assignment.gene_id) {
          throw authorityError("REVISION_NOT_FOUND", "Manifestation revision was not found", 404)
        }
        rejectMismatchedBodyId(body, "manifestation_id", revisionRoute.manifestation_id)
        result = await selectManifestationRevision(db, {
          assignmentId,
          revisionId,
          expectedAssignmentVersion: body.expected_assignment_version,
          expectedHeadVersion: body.expected_head_version,
          expectedCanonicalRevisionId: body.expected_canonical_revision_id,
          reason: body.reason || "select",
          ...auditIds(body),
          idFactory,
          ...command,
        })
        return mutationResponse(db, { onAuthorityEvent, onAssignmentEvent }, result)
      }

      const matched = withdraw || restore
      const manifestationId = segment(matched[2])
      rejectMismatchedBodyId(body, "manifestation_id", manifestationId)
      const routeEntity = await requireRouteEntity(
        db,
        segment(matched[1]),
        "icono_manifestations",
        "manifestation_id",
        manifestationId,
        session.accountId,
      )
      const lifecycleInput = {
        manifestationId,
        expectedManifestationVersion: body.expected_manifestation_version,
        expectedAssignmentVersion: body.expected_assignment_version,
        expectedHeadVersion: body.expected_head_version,
        expectedCanonicalRevisionId: body.expected_canonical_revision_id,
        revisionId: routeEntity.row.manifestation_head_revision_id,
        ...auditIds(body),
        idFactory,
        ...command,
      }
      rejectMismatchedBodyId(
        body,
        "manifestation_revision_id",
        routeEntity.row.manifestation_head_revision_id,
      )
      if (withdraw) {
        result = await withdrawOwnManifestation(db, lifecycleInput)
      } else {
        const current = await requireRouteCurrentAssignment(
          db,
          segment(matched[1]),
          session.accountId,
        )
        result = await restoreOwnManifestation(db, {
          ...lifecycleInput,
          assignmentId: current.assignment.caretaker_assignment_id,
        })
      }
      return mutationResponse(db, { onAuthorityEvent, onAssignmentEvent }, result)
    } catch (error) {
      return safeErrorResponse(error)
    }
  }
}

export { createCaretakerManifestationHttpHandler }
