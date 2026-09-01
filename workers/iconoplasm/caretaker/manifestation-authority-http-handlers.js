import {
  decryptManifestationProse,
  encryptManifestationProse,
} from "../../lib/iconoplasm-manifestation-body-crypto.js"
import { sha256Hex } from "../../lib/iconoplasm-envelope-crypto.js"
import {
  decryptManifestationTags,
  encryptManifestationTags,
} from "../../lib/iconoplasm-manifestation-tags-crypto.js"
import {
  createManifestationBodyObjectKey,
  putEncryptedManifestationBody,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import {
  CARETAKER_ENTITLEMENT_POLICY_VERSION,
  claimCaretakerAssignment,
  transitionCaretakerAssignment,
} from "./caretaker-assignment-commands.js"
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
import {
  first,
  readHead,
  requireActiveAccount,
  resolveCommandReplay,
} from "./manifestation-authority-repository.js"
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
import { setManifestationPageVisibility } from "./manifestation-visibility-commands.js"
import {
  selectTagsDerivativeHead,
  submitTagsDerivative,
} from "./manifestation-derivative-commands.js"
import { prepareManifestationTagsPayload } from "./manifestation-tags-payload.js"
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

async function readCaretakerClaimAvailability(db, geneLocator, accountId) {
  const account = await requireActiveAccount(db, accountId)
  const gene = await resolveGene(db, geneLocator)
  const head = await readHead(db, gene.gene_id)
  const geneAssignment = await first(
    db,
    `SELECT caretaker_assignment_id, account_id, status
       FROM icono_caretaker_assignments
      WHERE gene_id = ? AND status IN ('pending_acceptance', 'active', 'suspended')
      LIMIT 1`,
    gene.gene_id,
  )
  const accountAssignment = await first(
    db,
    `SELECT caretaker_assignment_id, gene_id, status
       FROM icono_caretaker_assignments
      WHERE account_id = ? AND status IN ('pending_acceptance', 'active', 'suspended')
      LIMIT 1`,
    account.account_id,
  )
  const terms = await first(
    db,
    `SELECT terms_version_id, terms_sha256, document_url, display_label, effective_at
       FROM icono_caretaker_terms_versions
      WHERE retired_at IS NULL AND effective_at <= CURRENT_TIMESTAMP
      ORDER BY effective_at DESC, terms_version_id DESC
      LIMIT 1`,
  )
  let reason = null
  if (!head.canonical_manifestation_id || !head.canonical_revision_id) {
    reason = "gene_not_ready"
  } else if (geneAssignment) {
    reason = geneAssignment.account_id === account.account_id ? "already_caretaking" : "gene_taken"
  } else if (accountAssignment) {
    reason = "account_already_caretaking"
  } else if (!terms) {
    reason = "terms_unavailable"
  }
  return {
    enabled: true,
    gene: { gene_id: gene.gene_id, canonical_symbol: gene.canonical_symbol },
    claim: {
      available: reason == null,
      reason,
      gene_revision: Number(head.gene_revision || 0),
      entitlement_policy_version: CARETAKER_ENTITLEMENT_POLICY_VERSION,
      terms: terms
        ? {
            terms_version_id: terms.terms_version_id,
            terms_sha256: terms.terms_sha256,
            document_url: terms.document_url,
            display_label: terms.display_label,
            effective_at: terms.effective_at,
          }
        : null,
    },
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
      const claim = path.match(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/claim$/)
      const revisionBody = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/revisions\/([^/]+)\/body$/,
      )
      const derivativeBody = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/derivatives\/([^/]+)\/body$/,
      )
      if (request.method === "GET" && (dossier || claim || revisionBody || derivativeBody)) {
        if ((await authorityMode(db)) !== "authoritative") {
          return jsonResponse({ enabled: false }, 200)
        }
        const session = await requireBrowserSession(request, env, resolveSession)
        if (claim) {
          return jsonResponse(
            await readCaretakerClaimAvailability(db, segment(claim[1]), session.accountId),
          )
        }
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
      const saveTags = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/revisions\/([^/]+)\/tags-derivatives$/,
      )
      const selectTags = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/revisions\/([^/]+)\/tags-derivative-head$/,
      )
      const select = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/canonical-selections$/,
      )
      const withdraw = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/manifestations\/([^/]+)$/,
      )
      const restore = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/manifestations\/([^/]+)\/restore$/,
      )
      const visibility = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/manifestations\/([^/]+)\/page-visibility$/,
      )
      const assignmentAction = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/assignments\/([^/]+)\/(accept|decline|end)$/,
      )
      const methodMatches =
        (request.method === "POST" &&
          (claim ||
            save ||
            saveTags ||
            selectTags ||
            select ||
            restore ||
            visibility ||
            assignmentAction)) ||
        (request.method === "DELETE" && withdraw)
      if (!methodMatches) return null

      requireStrictSameOriginMutation(request)
      await requireAuthoritativeMode(db)
      const session = await requireBrowserSession(request, env, resolveSession)
      const parsed = await readBoundedJson(request)
      const body = parsed.value
      const command = await commandEnvelope(request, parsed.raw, body, "account", session.accountId)
      let result

      if (claim) {
        if (body.terms_accepted !== true) {
          throw authorityError(
            "TERMS_ACCEPTANCE_REQUIRED",
            "Confirm the displayed caretaker terms before becoming a caretaker",
            400,
          )
        }
        const availability = await readCaretakerClaimAvailability(
          db,
          segment(claim[1]),
          session.accountId,
        )
        if (!availability.claim.available) {
          throw authorityError(
            "CARETAKER_CLAIM_UNAVAILABLE",
            "Caretaking is no longer available for this gene or account",
            409,
          )
        }
        if (body.entitlement_policy_version !== availability.claim.entitlement_policy_version) {
          throw authorityError(
            "ENTITLEMENT_POLICY_VERSION_MISMATCH",
            "Caretaker eligibility changed; refresh the gene page",
            409,
          )
        }
        result = await claimCaretakerAssignment(db, {
          geneId: availability.gene.gene_id,
          accountId: session.accountId,
          termsVersionId: body.terms_version_id,
          relinquishPolicy: body.default_leave_policy,
          entitlementPolicyVersion: body.entitlement_policy_version,
          expectedGeneRevision: body.expected_gene_revision,
          ...auditIds(body),
          idFactory,
          ...command,
        })
        return mutationResponse(db, { onAuthorityEvent, onAssignmentEvent }, result)
      }

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

      if (saveTags || selectTags) {
        const match = saveTags || selectTags
        const revisionId = segment(match[2])
        const { gene, assignment } = await requireRouteCurrentAssignment(
          db,
          segment(match[1]),
          session.accountId,
        )
        if (assignment.status !== "active") {
          throw authorityError("ASSIGNMENT_NOT_ACTIVE", "Caretaker assignment is not active", 409)
        }
        const revision = await first(
          db,
          `SELECT revision.manifestation_revision_id, revision.body_sha256,
                  revision.caretaker_assignment_id, manifestation.author_account_id,
                  manifestation.gene_id
             FROM icono_manifestation_revisions revision
             JOIN icono_manifestations manifestation
               ON manifestation.manifestation_id = revision.manifestation_id
            WHERE revision.manifestation_revision_id = ?`,
          revisionId,
        )
        if (
          !revision ||
          revision.gene_id !== gene.gene_id ||
          revision.author_account_id !== session.accountId ||
          revision.caretaker_assignment_id !== assignment.caretaker_assignment_id
        ) {
          throw authorityError("REVISION_NOT_FOUND", "Manifestation revision was not found", 404)
        }
        if (selectTags) {
          result = await selectTagsDerivativeHead(db, {
            derivativeId: body.manifestation_derivative_id,
            expectedDerivativeHeadVersion: body.expected_derivative_head_version,
            expectedGeneRevision: body.expected_gene_revision,
            idFactory,
            ...auditIds(body),
            ...command,
          })
          return mutationResponse(db, { onAuthorityEvent, onAssignmentEvent }, result)
        }
        const tagsText = String(body.tags_text || "")
        const fieldsJson = {}
        const encoder = new TextEncoder()
        const output = await prepareManifestationTagsPayload({
          tagsText,
          tagsSha256: await sha256Hex(
            encoder.encode(tagsText.normalize("NFC").replace(/\r\n?/g, "\n")),
          ),
          fieldsJson,
          fieldsSha256: await sha256Hex(encoder.encode("{}")),
        })
        const replay = await resolveCommandReplay(db, command, command)
        if (replay) return jsonResponse(replay)
        const derivativeId = idFactory("derivative")
        const encrypted = await encryptManifestationTags(env, {
          derivativeId,
          revisionId,
          sourceBodySha256: revision.body_sha256,
          tags: output.output_plain,
        })
        const objectKey = await createManifestationBodyObjectKey()
        await createManifestationUploadIntent(db, {
          entityKind: "derivative",
          entityId: derivativeId,
          assignmentId: assignment.caretaker_assignment_id,
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
            decryptManifestationTags(env, {
              derivativeId,
              revisionId,
              sourceBodySha256: revision.body_sha256,
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
        result = await submitTagsDerivative(db, {
          revisionId,
          derivativeId,
          status: "complete",
          sourceBodySha256: revision.body_sha256,
          tagsSha256: output.tags_sha256,
          tagsBytes: output.tags_bytes,
          fieldsSha256: output.fields_sha256,
          fieldsBytes: output.fields_bytes,
          storage: storageDescriptor(encrypted, objectKey, upload),
          recipeId: "caretaker-manual-tags",
          recipeVersion: "1",
          providerId: "caretaker",
          modelId: "manual",
          taggerConfigSha256: await sha256Hex("iconoplasm.caretaker.manual-tags.v1"),
          expectedGeneRevision: body.expected_gene_revision,
          idFactory,
          ...auditIds(body),
          ...command,
        })
        await requireAdoptedManifestationUpload(db, "derivative", derivativeId)
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

      if (visibility) {
        const manifestationId = segment(visibility[2])
        rejectMismatchedBodyId(body, "manifestation_id", manifestationId)
        const current = await requireRouteCurrentAssignment(
          db,
          segment(visibility[1]),
          session.accountId,
        )
        result = await setManifestationPageVisibility(db, {
          assignmentId: current.assignment.caretaker_assignment_id,
          manifestationId,
          visible: body.visible,
          expectedAssignmentVersion: body.expected_assignment_version,
          expectedManifestationVersion: body.expected_manifestation_version,
          expectedGeneRevision: body.expected_gene_revision,
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
