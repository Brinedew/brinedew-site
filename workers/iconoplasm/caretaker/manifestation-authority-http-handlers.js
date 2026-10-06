import { prepareManifestationProse } from "../../lib/iconoplasm-manifestation-prose.js"
import { sha256Hex } from "../../lib/iconoplasm-sha256.js"
import {
  createManifestationBodyObjectKey,
  putManifestationBodyObject,
} from "../../lib/iconoplasm-manifestation-body-storage.js"
import {
  CARETAKER_ENTITLEMENT_POLICY_VERSION,
  claimCaretakerAssignment,
  transitionCaretakerAssignment,
} from "./caretaker-assignment-commands.js"
import { readActiveCaretakerTerms } from "./caretaker-terms-registry.js"
import { readCandidateSources } from "./manifestation-candidate-sources.js"
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
  admitManifestationUploadIntent,
  requireAdoptedManifestationUpload,
} from "./manifestation-upload-intents.js"
import { plainStorageDescriptor } from "./manifestation-storage-contract.js"
import { selectManifestationRevision } from "./manifestation-selection-commands.js"
import {
  restoreOwnManifestation,
  withdrawOwnManifestation,
} from "./manifestation-lifecycle-commands.js"
import { endCaretakerAssignment } from "./caretaker-assignment-end-command.js"
import {
  saveManifestationRevision,
  saveManifestationWithTags,
} from "./manifestation-write-commands.js"
import { setManifestationPageVisibility } from "./manifestation-visibility-commands.js"
import {
  selectTagsDerivativeHead,
  submitTagsDerivative,
} from "./manifestation-derivative-commands.js"
import {
  canonicalManifestationFieldsJson,
  prepareManifestationTagsPayload,
} from "./manifestation-tags-payload.js"
import { deliverAcceptedAuthorityEvent } from "./manifestation-authority-projection-delivery.js"
import {
  TAGGERIZER_MESSAGES,
  TaggerizerError,
  admitTaggerizerCall,
  readTaggerizerInput,
  runTaggerizer,
  taggerizerDisabled,
} from "./taggerizer.js"

function segment(raw) {
  try {
    return decodeURIComponent(raw)
  } catch {
    throw authorityError("INVALID_ROUTE_PARAMETER", "Route parameter is invalid")
  }
}

// B-860: a caretaker's text stays with the gene when they leave. Authors get no
// withdraw-on-leave veto; only the admin route can still choose "withdraw".
const CARETAKER_LEAVE_POLICY = "retain"
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

async function requireRouteEntity(db, geneLocator, table, idColumn, entityId) {
  const gene = await resolveGene(db, geneLocator)
  const row = await first(
    db,
    `SELECT entity.${idColumn} AS entity_id, entity.gene_id, entity.author_account_id,
            entity.manifestation_head_revision_id, entity.row_version, entity.status
       FROM ${table} entity WHERE entity.${idColumn} = ?`,
    entityId,
  )
  // B-860: any lineage on the gene; the command layer checks the caretaker role.
  if (!row || row.gene_id !== gene.gene_id) {
    throw authorityError("MANIFESTATION_NOT_FOUND", "Manifestation was not found", 404)
  }
  return { gene, row }
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

// B-1021: an account takes a new gene (a switch, or ending one role and claiming
// another) at most once per cooldown, counted from when it took its latest gene.
// The admin sets the length; switchPolicy answers { seconds, exempt } for the
// session, and the admin account is exempt. Only an account that has held a gene
// pays for the policy read.
async function readCaretakerSwitchCooldown(db, switchPolicy, browserSession, accountId, timestamp) {
  if (typeof switchPolicy !== "function") return null
  const latest = await first(
    db,
    `SELECT MAX(started_at) AS started_at FROM icono_caretaker_assignments
      WHERE account_id = ? AND started_at IS NOT NULL`,
    accountId,
  )
  const startedMs = Date.parse(latest?.started_at || "")
  if (!Number.isFinite(startedMs)) return null
  const policy = (await switchPolicy(browserSession)) || {}
  const seconds = Number(policy.seconds)
  if (policy.exempt === true || !Number.isFinite(seconds) || seconds <= 0) return null
  const availableMs = startedMs + seconds * 1000
  const nowMs = Date.parse(timestamp)
  if (!(availableMs > nowMs)) return null
  return {
    available_at: new Date(availableMs).toISOString(),
    retry_after_seconds: Math.ceil((availableMs - nowMs) / 1000),
    cooldown_seconds: seconds,
  }
}

async function readCaretakerClaimAvailability(
  db,
  geneLocator,
  accountId,
  currentTimestamp,
  { switchPolicy, browserSession } = {},
) {
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
    `SELECT assignment.caretaker_assignment_id, assignment.gene_id, assignment.status,
            assignment.assignment_version, gene.canonical_symbol, head.gene_revision
       FROM icono_caretaker_assignments assignment
       JOIN icono_gene_identities gene ON gene.gene_id = assignment.gene_id
       JOIN icono_manifestation_heads head ON head.gene_id = assignment.gene_id
      WHERE assignment.account_id = ?
        AND assignment.status IN ('pending_acceptance', 'active', 'suspended')
      LIMIT 1`,
    account.account_id,
  )
  const switchFrom =
    accountAssignment?.status === "active" && accountAssignment.gene_id !== gene.gene_id
      ? {
          caretaker_assignment_id: accountAssignment.caretaker_assignment_id,
          canonical_symbol: accountAssignment.canonical_symbol,
          assignment_version: Number(accountAssignment.assignment_version),
          gene_revision: Number(accountAssignment.gene_revision),
        }
      : null
  const terms = await readActiveCaretakerTerms(db, currentTimestamp)
  let reason = null
  if (!head.canonical_manifestation_id || !head.canonical_revision_id) {
    reason = "gene_not_ready"
  } else if (geneAssignment) {
    reason = geneAssignment.account_id === account.account_id ? "already_caretaking" : "gene_taken"
  } else if (accountAssignment && !switchFrom) {
    reason = "account_already_caretaking"
  } else if (!terms) {
    reason = "terms_unavailable"
  }
  const cooldown =
    reason == null
      ? await readCaretakerSwitchCooldown(
          db,
          switchPolicy,
          browserSession,
          account.account_id,
          currentTimestamp,
        )
      : null
  if (cooldown) reason = "switch_cooldown"
  return {
    enabled: true,
    gene: { gene_id: gene.gene_id, canonical_symbol: gene.canonical_symbol },
    claim: {
      available: reason == null,
      reason,
      mode: switchFrom && reason == null ? "switch" : "claim",
      switch_from: switchFrom,
      // B-1027: the page shows the cooldown on the button itself, with its timer and
      // how much of the wait has passed, instead of hiding the button.
      ...(cooldown
        ? { available_at: cooldown.available_at, cooldown_seconds: cooldown.cooldown_seconds }
        : {}),
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
  primaryDb,
  resolveSession,
  cursorSecret = env?.ICONOPLASM_AUTHORING_CURSOR_SECRET,
  onAuthorityEvent,
  onAssignmentEvent,
  onIntegrityFailure,
  idFactory = defaultIdFactory,
  now = () => new Date().toISOString(),
  caretakerSwitchPolicy,
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
            await readCaretakerClaimAvailability(db, segment(claim[1]), session.accountId, now(), {
              switchPolicy: caretakerSwitchPolicy,
              browserSession: session.session,
            }),
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
            // B-724: caretaker-only; one gene's candidate pool, null when unreadable.
            const candidateSources = await readCandidateSources(primaryDb, value?.gene?.symbol)
            const withTaggerizer = { ...value, taggerizer_enabled: !taggerizerDisabled(env) }
            return jsonResponse(
              candidateSources
                ? { ...withTaggerizer, candidate_sources: candidateSources }
                : withTaggerizer,
            )
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
      // B-859 step 3: the editor's autosave in one command (revision, Tags, Tags head,
      // canonical selection) instead of four.
      const saveAll = path.match(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/saves$/)
      const saveTags = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/revisions\/([^/]+)\/tags-derivatives$/,
      )
      const selectTags = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/revisions\/([^/]+)\/tags-derivative-head$/,
      )
      const taggerize = path.match(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/taggerize$/)
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
            saveAll ||
            saveTags ||
            taggerize ||
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
      // The verified Tags payload allows 32 KiB; its JSON command envelope is larger.
      const parsed = await readBoundedJson(
        request,
        saveTags ? 72 * 1024 : saveAll || taggerize ? 96 * 1024 : undefined,
      )
      const body = parsed.value
      const command = await commandEnvelope(request, parsed.raw, body, "account", session.accountId)
      let result

      if (taggerize) {
        // B-995: a suggestion only. Same caretaker check as the save route; then the
        // kill switch, the input, the caretaker's daily count (one D1 upsert) and one AI call.
        const { assignment } = await requireRouteCurrentAssignment(
          db,
          segment(taggerize[1]),
          session.accountId,
        )
        if (assignment.status !== "active") {
          throw authorityError("ASSIGNMENT_NOT_ACTIVE", "Caretaker assignment is not active", 409)
        }
        try {
          if (taggerizerDisabled(env)) {
            throw new TaggerizerError("TAGGERIZER_DISABLED", TAGGERIZER_MESSAGES.disabled, 503)
          }
          const input = readTaggerizerInput(body)
          const stamp = now()
          await admitTaggerizerCall(primaryDb, session.accountId, stamp)
          return jsonResponse({
            ok: true,
            suggestion: await runTaggerizer(env, input, Date.parse(stamp)),
          })
        } catch (error) {
          if (!(error instanceof TaggerizerError)) throw error
          const retry = error.extra?.retryAfterSeconds
          return jsonResponse(
            {
              ok: false,
              error: { code: error.code, message: error.message },
              ...(retry ? { retry_after_seconds: retry } : {}),
            },
            error.status,
            retry ? { "Retry-After": String(retry) } : {},
          )
        }
      }

      if (claim) {
        if (body.terms_accepted !== true) {
          throw authorityError(
            "TERMS_ACCEPTANCE_REQUIRED",
            "Confirm the displayed caretaker terms before becoming a caretaker",
            400,
          )
        }
        const replay = await resolveCommandReplay(db, command, command)
        if (replay) return mutationResponse(db, { onAuthorityEvent, onAssignmentEvent }, replay)
        // One clock for the cooldown check and the started_at it measures from.
        const claimedAt = now()
        const availability = await readCaretakerClaimAvailability(
          db,
          segment(claim[1]),
          session.accountId,
          claimedAt,
          { switchPolicy: caretakerSwitchPolicy, browserSession: session.session },
        )
        if (availability.claim.reason === "switch_cooldown") {
          const refusal = authorityError(
            "CARETAKER_SWITCH_COOLDOWN",
            "This account took a gene too recently to take another",
            429,
          )
          refusal.retryAfterSeconds = Math.max(
            1,
            Math.ceil((Date.parse(availability.claim.available_at) - Date.parse(claimedAt)) / 1000),
          )
          throw refusal
        }
        if (!availability.claim.available) {
          throw authorityError(
            "CARETAKER_CLAIM_UNAVAILABLE",
            "Caretaking is no longer available for this gene or account",
            409,
          )
        }
        if (
          (body.previous_assignment_id || null) !==
          (availability.claim.switch_from?.caretaker_assignment_id || null)
        ) {
          throw authorityError(
            "CARETAKER_CLAIM_UNAVAILABLE",
            "The current caretaker role changed; refresh the gene page",
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
          relinquishPolicy: CARETAKER_LEAVE_POLICY,
          entitlementPolicyVersion: body.entitlement_policy_version,
          expectedGeneRevision: body.expected_gene_revision,
          previousAssignmentId: body.previous_assignment_id,
          expectedPreviousAssignmentVersion: body.expected_previous_assignment_version,
          expectedPreviousGeneRevision: body.expected_previous_gene_revision,
          ...auditIds(body),
          idFactory,
          now: claimedAt,
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
                relinquishPolicy: CARETAKER_LEAVE_POLICY,
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
                relinquishPolicy: CARETAKER_LEAVE_POLICY,
                ...auditIds(body),
                idFactory,
                ...command,
              })
        return mutationResponse(db, { onAuthorityEvent, onAssignmentEvent }, result)
      }

      if (save) {
        const { assignment } = await requireRouteCurrentAssignment(
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
        const prose = await prepareManifestationProse(body.prose)
        const objectKey = await createManifestationBodyObjectKey()
        await admitManifestationUploadIntent(db, env, {
          entityKind: "revision",
          entityId: revisionId,
          assignmentId,
          objectKey,
          ciphertextSha256: prose.body_sha256,
          bodyBytes: prose.body_bytes,
          actorKind: "account",
          actorAccountId: session.accountId,
          idFactory,
        })
        const upload = await putManifestationBodyObject(env, objectKey, prose.bytes, {
          expectedSha256: prose.body_sha256,
        })
        result = await saveManifestationRevision(db, {
          assignmentId,
          expectedAssignmentVersion: body.expected_assignment_version,
          expectedManifestationVersion: body.expected_manifestation_version,
          sourceRevisionId: body.based_on_revision_id,
          revisionId,
          eventUuid: body.event_id,
          storage: plainStorageDescriptor(prose, objectKey, upload),
          idFactory,
          ...command,
        })
        await requireAdoptedManifestationUpload(db, "revision", revisionId)
        return mutationResponse(db, { onAuthorityEvent, onAssignmentEvent }, result)
      }

      if (saveAll) {
        const { assignment } = await requireRouteCurrentAssignment(
          db,
          segment(saveAll[1]),
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
        const tagsText = String(body.tags_text || "")
        if (!tagsText.trim()) {
          throw authorityError("TAGS_REQUIRED", "A save with Tags needs at least one tag", 400)
        }
        const fieldsJson = body.fields_json ?? {}
        const encoder = new TextEncoder()
        const prose = await prepareManifestationProse(body.prose)
        const output = await prepareManifestationTagsPayload({
          tagsText,
          tagsSha256: await sha256Hex(
            encoder.encode(tagsText.normalize("NFC").replace(/\r\n?/g, "\n")),
          ),
          fieldsJson,
          fieldsSha256: await sha256Hex(
            encoder.encode(canonicalManifestationFieldsJson(fieldsJson)),
          ),
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
            assignmentId,
            objectKey,
            ciphertextSha256: sha256,
            bodyBytes: bytes,
            actorKind: "account",
            actorAccountId: session.accountId,
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
        result = await saveManifestationWithTags(db, {
          assignmentId,
          expectedAssignmentVersion: body.expected_assignment_version,
          expectedManifestationVersion: body.expected_manifestation_version,
          expectedHeadVersion: body.expected_head_version,
          expectedCanonicalRevisionId: body.expected_canonical_revision_id,
          sourceRevisionId: body.based_on_revision_id,
          revisionId,
          eventUuid: body.event_id,
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
            recipeId: "caretaker-manual-tags",
            recipeVersion: "1",
            providerId: "caretaker",
            modelId: "manual",
            taggerConfigSha256: await sha256Hex("iconoplasm.caretaker.manual-tags.v1"),
          },
          idFactory,
          ...command,
        })
        await requireAdoptedManifestationUpload(db, "revision", revisionId)
        await requireAdoptedManifestationUpload(db, "derivative", derivativeId)
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
        if (!revision || revision.gene_id !== gene.gene_id) {
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
        const fieldsJson = body.fields_json ?? {}
        const encoder = new TextEncoder()
        const output = await prepareManifestationTagsPayload({
          tagsText,
          tagsSha256: await sha256Hex(
            encoder.encode(tagsText.normalize("NFC").replace(/\r\n?/g, "\n")),
          ),
          fieldsJson,
          fieldsSha256: await sha256Hex(
            encoder.encode(canonicalManifestationFieldsJson(fieldsJson)),
          ),
        })
        const replay = await resolveCommandReplay(db, command, command)
        if (replay) return jsonResponse(replay)
        const derivativeId = idFactory("derivative")
        const objectKey = await createManifestationBodyObjectKey()
        await admitManifestationUploadIntent(db, env, {
          entityKind: "derivative",
          entityId: derivativeId,
          assignmentId: assignment.caretaker_assignment_id,
          objectKey,
          ciphertextSha256: output.output_plain_sha256,
          bodyBytes: output.output_plain_bytes,
          actorKind: "account",
          actorAccountId: session.accountId,
          idFactory,
        })
        const upload = await putManifestationBodyObject(env, objectKey, output.output_bytes, {
          expectedSha256: output.output_plain_sha256,
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
          storage: plainStorageDescriptor(
            { body_sha256: output.output_plain_sha256, body_bytes: output.output_plain_bytes },
            objectKey,
            upload,
          ),
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
