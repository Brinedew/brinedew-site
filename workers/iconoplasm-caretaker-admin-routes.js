import {
  endCaretakerAssignment,
  offerCaretakerAssignment,
  transitionCaretakerAssignment,
} from "./iconoplasm/caretaker/manifestation-authority.js"
import {
  ManifestationAuthorityError,
  authorityError,
} from "./iconoplasm/caretaker/manifestation-authority-contract.js"
import { deliverAcceptedAuthorityEvent } from "./iconoplasm/caretaker/manifestation-authority-projection-delivery.js"
import {
  commandEnvelope,
  readBoundedJson,
  requireAuthoritativeMode,
  requireStrictSameOriginMutation,
} from "./iconoplasm/caretaker/manifestation-authority-http-security.js"

const NO_STORE = Object.freeze({ "Cache-Control": "private, no-store" })
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/
const ASSIGNMENT_ACTIONS = new Set(["cancel", "suspend", "resume", "end"])
const ASSIGNMENT_STATUSES = new Set(["pending_acceptance", "active", "suspended", "ended"])
const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 100

export const CARETAKER_ENTITLEMENT_POLICY_VERSION = "caretaker_standard_v1"

function boundedLimit(raw, fallback = DEFAULT_PAGE_LIMIT) {
  const parsed = Math.trunc(Number(raw))
  if (!Number.isFinite(parsed) || parsed < 1) return fallback
  return Math.min(MAX_PAGE_LIMIT, parsed)
}

function requiredId(value, field) {
  const id = String(value || "").trim()
  if (!ACCOUNT_ID.test(id)) {
    throw authorityError("INVALID_ADMIN_CARETAKER_REQUEST", `${field} is invalid`, 400)
  }
  return id
}

function optionalSearch(value) {
  return String(value || "")
    .trim()
    .slice(0, 120)
}

function requiredReason(value, field) {
  const reason = String(value || "").trim()
  if (!reason || reason.length > 500) {
    throw authorityError(
      "ADMINISTRATOR_REASON_REQUIRED",
      `${field} must contain between 1 and 500 characters`,
      400,
    )
  }
  return reason
}

function encodeCursor(value) {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

function decodeCursor(raw) {
  if (!raw) return null
  try {
    const normalized = String(raw).replace(/-/g, "+").replace(/_/g, "/")
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")
    const value = JSON.parse(atob(padded))
    const updatedAt = String(value?.updated_at || "").trim()
    const assignmentId = String(value?.caretaker_assignment_id || "").trim()
    if (!updatedAt || !ACCOUNT_ID.test(assignmentId)) throw new TypeError("Invalid cursor")
    return { updated_at: updatedAt, caretaker_assignment_id: assignmentId }
  } catch {
    throw authorityError(
      "INVALID_CARETAKER_REGISTRY_CURSOR",
      "Caretaker registry cursor is invalid",
      400,
    )
  }
}

async function all(db, sql, ...params) {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all()
  return Array.isArray(result?.results) ? result.results : []
}

function requireAuthoringDb(env) {
  const db = env?.ICONOPLASM_AUTHORING_DB
  if (!db?.prepare || !db?.batch) {
    throw authorityError(
      "AUTHORING_DB_REQUIRED",
      "Manifestation authority database is unavailable",
      503,
    )
  }
  return db
}

export async function readCaretakerAdminRegistry(db, raw = {}) {
  const limit = boundedLimit(raw.limit)
  const query = optionalSearch(raw.query)
  const like = `%${query}%`
  const status = String(raw.status || "").trim()
  if (status && !ASSIGNMENT_STATUSES.has(status)) {
    throw authorityError("INVALID_ASSIGNMENT_STATUS", "Caretaker assignment status is invalid", 400)
  }
  const cursor = decodeCursor(raw.after)
  const rows = await all(
    db,
    `SELECT assignment.caretaker_assignment_id, assignment.gene_id,
            gene.canonical_symbol, assignment.account_id,
            account.public_credit_label AS author_label,
            account.status AS account_status, assignment.status,
            assignment.assignment_version, assignment.terms_version_id,
            assignment.entitlement_policy_version, assignment.relinquish_policy,
            assignment.created_at, assignment.started_at,
            assignment.suspended_at, assignment.ended_at, assignment.updated_at,
            head.head_version, head.gene_revision,
            head.canonical_revision_id
       FROM icono_caretaker_assignments assignment
       JOIN icono_gene_identities gene ON gene.gene_id = assignment.gene_id
       JOIN icono_authority_accounts account ON account.account_id = assignment.account_id
       JOIN icono_manifestation_heads head ON head.gene_id = assignment.gene_id
      WHERE (? = '' OR assignment.status = ?)
        AND (? = '' OR gene.canonical_symbol LIKE ? COLLATE NOCASE
          OR account.public_credit_label LIKE ? COLLATE NOCASE
          OR assignment.account_id LIKE ? COLLATE NOCASE
          OR assignment.caretaker_assignment_id LIKE ? COLLATE NOCASE)
        AND (? IS NULL OR assignment.updated_at < ?
          OR (assignment.updated_at = ? AND assignment.caretaker_assignment_id < ?))
      ORDER BY assignment.updated_at DESC, assignment.caretaker_assignment_id DESC
      LIMIT ?`,
    status,
    status,
    query,
    like,
    like,
    like,
    like,
    cursor?.updated_at || null,
    cursor?.updated_at || null,
    cursor?.updated_at || null,
    cursor?.caretaker_assignment_id || null,
    limit + 1,
  )
  const hasMore = rows.length > limit
  const page = rows.slice(0, limit).map((row) => ({
    caretaker_assignment_id: row.caretaker_assignment_id,
    gene_id: row.gene_id,
    canonical_symbol: row.canonical_symbol,
    account_id: row.account_id,
    author_label: row.author_label,
    account_status: row.account_status,
    status: row.status,
    assignment_version: Number(row.assignment_version),
    terms_version_id: row.terms_version_id || null,
    entitlement_policy_version: row.entitlement_policy_version,
    relinquish_policy: row.relinquish_policy || null,
    created_at: row.created_at,
    started_at: row.started_at || null,
    suspended_at: row.suspended_at || null,
    ended_at: row.ended_at || null,
    head_version: Number(row.head_version),
    gene_revision: Number(row.gene_revision),
    canonical_revision_id: row.canonical_revision_id || null,
  }))
  const tail = hasMore ? rows[limit - 1] : null
  return Object.freeze({
    ok: true,
    assignments: Object.freeze(page),
    next_cursor: tail
      ? encodeCursor({
          updated_at: tail.updated_at,
          caretaker_assignment_id: tail.caretaker_assignment_id,
        })
      : null,
  })
}

export async function searchCaretakerAdminAccounts(db, raw = {}) {
  const limit = boundedLimit(raw.limit, 20)
  const query = optionalSearch(raw.query)
  const like = `%${query}%`
  const rows = await all(
    db,
    `SELECT account_id, public_credit_label AS author_label, status
       FROM icono_authority_accounts
      WHERE (? = '' OR account_id LIKE ? COLLATE NOCASE
        OR public_credit_label LIKE ? COLLATE NOCASE)
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END,
               public_credit_label COLLATE NOCASE, account_id
      LIMIT ?`,
    query,
    like,
    like,
    limit,
  )
  return Object.freeze({
    ok: true,
    accounts: Object.freeze(
      rows.map((row) => ({
        account_id: row.account_id,
        author_label: row.author_label,
        status: row.status,
      })),
    ),
  })
}

export async function searchCaretakerAdminGenes(db, raw = {}) {
  const limit = boundedLimit(raw.limit, 20)
  const query = optionalSearch(raw.query)
  const like = `%${query}%`
  const rows = await all(
    db,
    `SELECT gene.gene_id, gene.canonical_symbol, gene.status,
            head.head_version, head.gene_revision, head.canonical_revision_id,
            assignment.status AS open_assignment_status
       FROM icono_gene_identities gene
       JOIN icono_manifestation_heads head ON head.gene_id = gene.gene_id
       LEFT JOIN icono_caretaker_assignments assignment
         ON assignment.gene_id = gene.gene_id
        AND assignment.status IN ('pending_acceptance', 'active', 'suspended')
      WHERE (? = '' OR gene.gene_id LIKE ? COLLATE NOCASE
        OR gene.canonical_symbol LIKE ? COLLATE NOCASE)
      ORDER BY gene.canonical_symbol COLLATE NOCASE, gene.gene_id
      LIMIT ?`,
    query,
    like,
    like,
    limit,
  )
  return Object.freeze({
    ok: true,
    genes: Object.freeze(
      rows.map((row) => ({
        gene_id: row.gene_id,
        canonical_symbol: row.canonical_symbol,
        status: row.status,
        head_version: Number(row.head_version),
        gene_revision: Number(row.gene_revision),
        canonical_revision_id: row.canonical_revision_id || null,
        open_assignment_status: row.open_assignment_status || null,
      })),
    ),
  })
}

export async function readCaretakerAdminTerms(db) {
  const terms = await all(
    db,
    `SELECT terms_version_id, terms_sha256 AS document_sha256,
            document_url, display_label, effective_at, retired_at
       FROM icono_caretaker_terms_versions
      ORDER BY effective_at DESC, terms_version_id DESC`,
  )
  return Object.freeze({
    ok: true,
    entitlement_policy_version: CARETAKER_ENTITLEMENT_POLICY_VERSION,
    terms: Object.freeze(
      terms.map((term) =>
        Object.freeze({
          terms_version_id: term.terms_version_id,
          document_sha256: term.document_sha256,
          document_url: term.document_url,
          display_label: term.display_label,
          effective_at: term.effective_at,
          retired_at: term.retired_at || null,
        }),
      ),
    ),
  })
}

function bodyRouteId(body, key, routeId) {
  if (body[key] != null && String(body[key]) !== routeId) {
    throw authorityError("ROUTE_ENTITY_MISMATCH", "Body entity does not match route", 400)
  }
}

async function deliverMutation(db, wakeAuthorityProjection, env, result) {
  const delivery = await deliverAcceptedAuthorityEvent(
    db,
    {
      onAuthorityEvent: async (event) => {
        const wake = await wakeAuthorityProjection(env, event)
        const accepted = wake?.results?.find((item) => item.event_id === event.event_id)
        if (accepted?.status !== "published")
          throw new Error("Accepted manifestation authority event remains pending")
      },
    },
    result,
  )
  return {
    status: delivery.pending ? 202 : 200,
    payload: delivery.pending ? { ...result, projection_pending: true } : result,
  }
}

function errorResponse(error, json) {
  if (error instanceof ManifestationAuthorityError) {
    return json({ error: { code: error.code, message: error.message } }, error.status, NO_STORE)
  }
  return json({ error: { code: "MANIFESTATION_AUTHORITY_INTERNAL_ERROR" } }, 500, NO_STORE)
}

function requireServices(services) {
  for (const name of ["isAdmin", "json", "resolveActiveAccount", "wakeAuthorityProjection"]) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Caretaker admin route service is missing: ${name}`)
    }
  }
}

export function createIconoplasmCaretakerAdminHandlers(services) {
  requireServices(services)
  const { isAdmin, json, resolveActiveAccount, wakeAuthorityProjection } = services

  async function authorize(request, env) {
    if (!(await isAdmin(request, env))) return null
    return true
  }

  function read(handlerName, reader) {
    return async ({ request, env, done }) => {
      if (!(await authorize(request, env))) {
        return done(`${handlerName}_403`, json({ error: "Unauthorized" }, 403, NO_STORE))
      }
      try {
        const value = await reader(requireAuthoringDb(env), new URL(request.url).searchParams)
        return done(handlerName, json(value, 200, NO_STORE))
      } catch (error) {
        const response = errorResponse(error, json)
        return done(`${handlerName}_${response.status}`, response)
      }
    }
  }

  async function mutate({ match, request, env, done }) {
    const routeName = "caretaker_admin_assignment_mutation"
    if (!(await authorize(request, env))) {
      return done(`${routeName}_403`, json({ error: "Unauthorized" }, 403, NO_STORE))
    }
    try {
      requireStrictSameOriginMutation(request)
      const db = requireAuthoringDb(env)
      await requireAuthoritativeMode(db)
      const session = await resolveActiveAccount(request, env)
      const actorAccountId = requiredId(session?.account_id, "account_id")
      const parsed = await readBoundedJson(request)
      const body = parsed.value
      const command = await commandEnvelope(
        request,
        parsed.raw,
        body,
        "administrator",
        actorAccountId,
      )
      let result
      if (match?.route?.id === "caretaker_admin_offer") {
        if (body.entitlement_policy_version !== CARETAKER_ENTITLEMENT_POLICY_VERSION) {
          throw authorityError(
            "ENTITLEMENT_POLICY_VERSION_MISMATCH",
            "Caretaker entitlement policy changed; refresh the admin registry",
            409,
          )
        }
        result = await offerCaretakerAssignment(db, {
          geneId: requiredId(body.gene_id, "gene_id"),
          accountId: requiredId(body.account_id, "account_id"),
          invitedByAccountId: actorAccountId,
          entitlementPolicyVersion: CARETAKER_ENTITLEMENT_POLICY_VERSION,
          expectedGeneRevision: body.expected_gene_revision,
          ...command,
        })
      } else {
        const assignmentId = requiredId(match?.params?.assignment_id, "caretaker_assignment_id")
        bodyRouteId(body, "caretaker_assignment_id", assignmentId)
        const action = String(match?.params?.action || "")
          .trim()
          .toLowerCase()
        if (!ASSIGNMENT_ACTIONS.has(action)) {
          throw authorityError("INVALID_ASSIGNMENT_ACTION", "Assignment action is invalid", 400)
        }
        result =
          action === "end"
            ? await endCaretakerAssignment(db, {
                assignmentId,
                expectedAssignmentVersion: body.expected_assignment_version,
                expectedHeadVersion: body.expected_head_version,
                expectedCanonicalRevisionId: body.expected_canonical_revision_id,
                relinquishPolicy: body.relinquish_policy,
                reason: requiredReason(body.reason, "reason"),
                ...command,
              })
            : await transitionCaretakerAssignment(db, {
                assignmentId,
                action,
                expectedAssignmentVersion: body.expected_assignment_version,
                suspensionReason:
                  action === "suspend"
                    ? requiredReason(body.suspension_reason, "suspension_reason")
                    : null,
                graceEndsAt: body.grace_ends_at,
                ...command,
              })
      }
      const delivered = await deliverMutation(db, wakeAuthorityProjection, env, result)
      return done(routeName, json(delivered.payload, delivered.status, NO_STORE))
    } catch (error) {
      const response = errorResponse(error, json)
      return done(`${routeName}_${response.status}`, response)
    }
  }

  return Object.freeze({
    "caretaker_admin.registry": read("caretaker_admin_registry", (db, params) =>
      readCaretakerAdminRegistry(db, {
        query: params.get("query"),
        status: params.get("status"),
        limit: params.get("limit"),
        after: params.get("after"),
      }),
    ),
    "caretaker_admin.accounts": read("caretaker_admin_accounts", (db, params) =>
      searchCaretakerAdminAccounts(db, {
        query: params.get("query"),
        limit: params.get("limit"),
      }),
    ),
    "caretaker_admin.genes": read("caretaker_admin_genes", (db, params) =>
      searchCaretakerAdminGenes(db, {
        query: params.get("query"),
        limit: params.get("limit"),
      }),
    ),
    "caretaker_admin.terms": read("caretaker_admin_terms", (db) => readCaretakerAdminTerms(db)),
    "caretaker_admin.mutate": mutate,
  })
}
