import {
  CARETAKER_ENTITLEMENT_POLICY_VERSION,
  claimCaretakerAssignment,
  transitionCaretakerAssignment,
} from "./caretaker-assignment-commands.js"
import { readActiveCaretakerTerms } from "./caretaker-terms-registry.js"
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
import { resolveGene } from "./manifestation-authority-read-model.js"
import {
  first,
  readHead,
  requireActiveAccount,
  resolveCommandReplay,
} from "./manifestation-authority-repository.js"
import { endCaretakerAssignment } from "./caretaker-assignment-end-command.js"
import { deliverAcceptedAuthorityEvent } from "./manifestation-authority-projection-delivery.js"
import {
  TAGGERIZER_MESSAGES,
  TaggerizerError,
  admitTaggerizerCall,
  readTaggerizerInput,
  runTaggerizer,
  taggerizerDisabled,
} from "./taggerizer.js"

// B-1065 B2a: the panel's text routes (dossier, Tags, saves, withdraw, restore,
// readers-see) moved to workers/iconoplasm/caretaker-texts.js on the plain text
// tables. What stays here until B2b moves assignments: claiming, accepting,
// declining and ending a caretaker role, and the Make Tags helper.

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
  onAuthorityEvent,
  onAssignmentEvent,
  idFactory = defaultIdFactory,
  now = () => new Date().toISOString(),
  caretakerSwitchPolicy,
} = {}) {
  if (!db || !env) throw new TypeError("Caretaker HTTP handler requires db and env")

  return async function handleCaretakerManifestationRequest(request) {
    try {
      const url = new URL(request.url)
      const path = url.pathname
      const claim = path.match(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/claim$/)
      if (request.method === "GET" && claim) {
        if ((await authorityMode(db)) !== "authoritative") {
          return jsonResponse({ enabled: false }, 200)
        }
        const session = await requireBrowserSession(request, env, resolveSession)
        return jsonResponse(
          await readCaretakerClaimAvailability(db, segment(claim[1]), session.accountId, now(), {
            switchPolicy: caretakerSwitchPolicy,
            browserSession: session.session,
          }),
        )
      }

      const taggerize = path.match(/^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/taggerize$/)
      const assignmentAction = path.match(
        /^\/api\/iconoplasm\/caretaker\/genes\/([^/]+)\/assignments\/([^/]+)\/(accept|decline|end)$/,
      )
      if (request.method !== "POST" || !(claim || taggerize || assignmentAction)) return null

      requireStrictSameOriginMutation(request)
      await requireAuthoritativeMode(db)
      const session = await requireBrowserSession(request, env, resolveSession)
      const parsed = await readBoundedJson(request, taggerize ? 96 * 1024 : undefined)
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
        const { gene } = await requireRouteAssignment(
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
        // B-1065 B2a: caretaker texts moved to the plain tables, so the old head
        // no longer follows them and the browser's head values would never match
        // it. "End" checks the head as the server reads it now; B2b deletes heads.
        const head = action === "end" ? await readHead(db, gene.gene_id) : null
        result =
          action === "end"
            ? await endCaretakerAssignment(db, {
                assignmentId: routeAssignmentId,
                expectedAssignmentVersion: body.expected_assignment_version,
                expectedHeadVersion: Number(head.head_version),
                expectedCanonicalRevisionId: head.canonical_revision_id || null,
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
    } catch (error) {
      return safeErrorResponse(error)
    }
  }
}

export { createCaretakerManifestationHttpHandler }
