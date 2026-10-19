// B-1065 B2b: the admin's caretaker registry and role actions, on the roles
// table of the main database (workers/iconoplasm/caretaker-roles.js). The admin
// page (quartz/static/iconoplasm/caretaker-admin-*.js) reads each role's texts
// in the caretaker panel's own words: "Version N" numbered oldest = 1 across the
// gene, as History numbers them, and "Original" for the factory's text.
//
// Offering a gene to a named person comes back with B-1083; its old route was
// never declared, so nobody could reach it.
import {
  CARETAKER_ENTITLEMENT_POLICY_VERSION,
  caretakerPseudonym,
  caretakerTerms,
  changeRole,
  rolesDb,
} from "./iconoplasm/caretaker-roles.js"
import { withdrawCaretakerTextStatements } from "./iconoplasm/caretaker-texts.js"
import {
  ManifestationAuthorityError,
  authorityError,
} from "./iconoplasm/caretaker/manifestation-authority-contract.js"
import {
  readBoundedJson,
  requireStrictSameOriginMutation,
} from "./iconoplasm/caretaker/manifestation-authority-http-security.js"

const NO_STORE = Object.freeze({ "Cache-Control": "private, no-store" })
const ACCOUNT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/
const ASSIGNMENT_ACTIONS = new Set(["cancel", "suspend", "resume", "end", "withdraw"])
const ASSIGNMENT_STATUSES = new Set(["pending_acceptance", "active", "suspended", "ended"])
const RELINQUISH_POLICIES = new Set(["retain", "withdraw"])
const DEFAULT_PAGE_LIMIT = 50
const MAX_PAGE_LIMIT = 100

export { CARETAKER_ENTITLEMENT_POLICY_VERSION }

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

// The Brinedew account status of each caretaker, from the sign-in database.
async function accountStatuses(accountDb, accountIds) {
  const ids = [...new Set(accountIds)]
  if (!ids.length || !accountDb?.prepare) return new Map()
  const rows = await all(
    accountDb,
    `SELECT account_id, status FROM brinedew_accounts
      WHERE account_id IN (${ids.map(() => "?").join(", ")})`,
    ...ids,
  )
  return new Map(rows.map((row) => [row.account_id, row.status]))
}

export async function readCaretakerAdminRegistry(env, raw = {}) {
  const db = rolesDb(env)
  const limit = boundedLimit(raw.limit)
  const query = optionalSearch(raw.query)
  const like = `%${query}%`
  const status = String(raw.status || "").trim()
  if (status && !ASSIGNMENT_STATUSES.has(status)) {
    throw authorityError("INVALID_ASSIGNMENT_STATUS", "Caretaker assignment status is invalid", 400)
  }
  const cursor = decodeCursor(raw.after)
  // Per row: the role's versions, its newest one, and the text new images are
  // drawn from (the gene's chosen version unless it was withdrawn, else the
  // Original). Each subquery walks one gene's versions by
  // icono_caretaker_text_versions_by_gene: 175 versions in all on the 10-14 copy.
  const rows = await all(
    db,
    `SELECT a.caretaker_assignment_id, t.gene_id, a.gene_symbol, a.account_id, a.status,
            a.assignment_version, a.terms_version_id, a.relinquish_policy,
            a.created_at, a.started_at, a.suspended_at, a.ended_at, a.updated_at,
            length(t.text) AS original_characters,
            (SELECT count(*) FROM icono_caretaker_text_versions v
              WHERE v.gene_symbol = a.gene_symbol
                AND v.caretaker_assignment_id = a.caretaker_assignment_id) AS version_count,
            (SELECT count(*) FROM icono_caretaker_text_versions v
              WHERE v.gene_symbol = a.gene_symbol
                AND v.caretaker_assignment_id = a.caretaker_assignment_id
                AND v.withdrawn_at IS NULL) AS kept_version_count,
            n.version_id AS newest_version_id, length(n.text) AS newest_characters,
            (SELECT count(*) FROM icono_caretaker_text_versions v
              WHERE v.gene_symbol = n.gene_symbol
                AND (v.created_at < n.created_at
                  OR (v.created_at = n.created_at AND v.version_id <= n.version_id))) AS newest_number,
            c.caretaker_assignment_id AS chosen_assignment_id, c.account_id AS chosen_account_id,
            length(c.text) AS chosen_characters,
            (SELECT count(*) FROM icono_caretaker_text_versions v
              WHERE v.gene_symbol = c.gene_symbol
                AND (v.created_at < c.created_at
                  OR (v.created_at = c.created_at AND v.version_id <= c.version_id))) AS chosen_number
       FROM icono_caretaker_assignments a
       LEFT JOIN icono_gene_texts t ON t.gene_symbol = a.gene_symbol
       LEFT JOIN icono_caretaker_text_versions c
         ON c.version_id = t.chosen_caretaker_version_id AND c.withdrawn_at IS NULL
       LEFT JOIN icono_caretaker_text_versions n ON n.version_id = (
         SELECT v.version_id FROM icono_caretaker_text_versions v
          WHERE v.gene_symbol = a.gene_symbol
            AND v.caretaker_assignment_id = a.caretaker_assignment_id
          ORDER BY v.created_at DESC, v.version_id DESC LIMIT 1)
      WHERE (? = '' OR a.status = ?)
        AND (? = '' OR a.gene_symbol LIKE ? COLLATE NOCASE
          OR a.account_id LIKE ? COLLATE NOCASE
          OR a.caretaker_assignment_id LIKE ? COLLATE NOCASE)
        AND (? IS NULL OR a.updated_at < ?
          OR (a.updated_at = ? AND a.caretaker_assignment_id < ?))
      ORDER BY a.updated_at DESC, a.caretaker_assignment_id DESC
      LIMIT ?`,
    status,
    status,
    query,
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
  const shown = rows.slice(0, limit)
  const statuses = await accountStatuses(
    env?.DB,
    shown.map((row) => row.account_id),
  )
  const page = []
  for (const row of shown) {
    const chosen = row.chosen_assignment_id
      ? {
          kind: "version",
          number: Number(row.chosen_number),
          characters: Number(row.chosen_characters),
          own: row.chosen_assignment_id === row.caretaker_assignment_id,
          author_label: await caretakerPseudonym(row.chosen_account_id),
        }
      : { kind: "original", characters: Number(row.original_characters) || null }
    page.push({
      caretaker_assignment_id: row.caretaker_assignment_id,
      gene_id: row.gene_id || null,
      canonical_symbol: row.gene_symbol,
      account_id: row.account_id,
      author_label: await caretakerPseudonym(row.account_id),
      account_status: statuses.get(row.account_id) || null,
      status: row.status,
      assignment_version: Number(row.assignment_version),
      terms_version_id: row.terms_version_id || null,
      relinquish_policy: row.relinquish_policy || null,
      created_at: row.created_at,
      started_at: row.started_at || null,
      suspended_at: row.suspended_at || null,
      ended_at: row.ended_at || null,
      versions: {
        total: Number(row.version_count) || 0,
        kept: Number(row.kept_version_count) || 0,
        newest: row.newest_version_id
          ? { number: Number(row.newest_number), characters: Number(row.newest_characters) }
          : null,
      },
      drawn_from: chosen,
      original_characters: Number(row.original_characters) || null,
    })
  }
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

// The person picker for an offer (B-1083): accounts by ID.
export async function searchCaretakerAdminAccounts(env, raw = {}) {
  const limit = boundedLimit(raw.limit, 20)
  const query = optionalSearch(raw.query)
  if (!env?.DB?.prepare)
    throw authorityError("ACCOUNTS_UNAVAILABLE", "Accounts are unavailable", 503)
  const rows = await all(
    env.DB,
    `SELECT account_id, status FROM brinedew_accounts
      WHERE (? = '' OR account_id LIKE ?)
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, account_id
      LIMIT ?`,
    query,
    `%${query}%`,
    limit,
  )
  const accounts = []
  for (const row of rows)
    accounts.push({
      account_id: row.account_id,
      author_label: await caretakerPseudonym(row.account_id),
      status: row.status,
    })
  return Object.freeze({ ok: true, accounts: Object.freeze(accounts) })
}

// The gene picker for an offer (B-1083): genes whose symbol starts with the
// query, so the lookup walks the primary key instead of every gene.
export async function searchCaretakerAdminGenes(env, raw = {}) {
  const db = rolesDb(env)
  const limit = boundedLimit(raw.limit, 20)
  const prefix = optionalSearch(raw.query).toUpperCase()
  const rows = await all(
    db,
    `SELECT t.gene_id, t.gene_symbol, t.text_id, a.status AS open_assignment_status
       FROM icono_gene_texts t
       LEFT JOIN icono_caretaker_assignments a
         ON a.gene_symbol = t.gene_symbol
        AND a.status IN ('pending_acceptance', 'active', 'suspended')
      WHERE t.gene_symbol >= ? AND t.gene_symbol < ?
      ORDER BY t.gene_symbol
      LIMIT ?`,
    prefix,
    `${prefix}￿`,
    limit,
  )
  return Object.freeze({
    ok: true,
    genes: Object.freeze(
      rows.map((row) => ({
        gene_id: row.gene_id,
        canonical_symbol: row.gene_symbol,
        status: "active",
        head_version: 0,
        gene_revision: 0,
        canonical_revision_id: row.text_id || null,
        open_assignment_status: row.open_assignment_status || null,
      })),
    ),
  })
}

export async function readCaretakerAdminTerms() {
  const terms = caretakerTerms()
  return Object.freeze({
    ok: true,
    entitlement_policy_version: CARETAKER_ENTITLEMENT_POLICY_VERSION,
    terms: Object.freeze([
      Object.freeze({
        terms_version_id: terms.terms_version_id,
        document_sha256: terms.terms_sha256,
        document_url: terms.document_url,
        display_label: terms.display_label,
        effective_at: terms.effective_at,
        retired_at: null,
      }),
    ]),
  })
}

function bodyRouteId(body, key, routeId) {
  if (body[key] != null && String(body[key]) !== routeId) {
    throw authorityError("ROUTE_ENTITY_MISMATCH", "Body entity does not match route", 400)
  }
}

// One admin change of one role. Ending with "withdraw", or withdrawing later
// from a role that ended keeping its texts, takes the role's texts out of use;
// it runs again on a retry of the same change, so a lost answer between the
// two leaves nothing half done.
export async function changeCaretakerRoleAsAdmin(
  env,
  { assignmentId, action, actorAccountId, body },
) {
  const db = rolesDb(env)
  if (!ASSIGNMENT_ACTIONS.has(action))
    throw authorityError("INVALID_ASSIGNMENT_ACTION", "Assignment action is invalid", 400)
  let reason = null
  let policy = null
  if (action === "end") {
    reason = requiredReason(body.reason, "reason")
    policy = String(body.relinquish_policy || "")
    if (!RELINQUISH_POLICIES.has(policy))
      throw authorityError(
        "INVALID_RELINQUISH_POLICY",
        "relinquish_policy must be retain or withdraw",
      )
  } else if (action === "suspend") {
    reason = requiredReason(body.suspension_reason, "suspension_reason")
  } else if (action === "cancel") {
    reason = "administrator_cancelled"
  }
  const now = new Date().toISOString()
  const change = await changeRole(db, {
    roleId: assignmentId,
    action,
    expectedVersion: body.expected_assignment_version,
    actorAccountId,
    now,
    reason,
    policy,
  })
  const settle = new Set(change.reElect)
  const { role } = change
  if (role.status === "ended" && role.relinquish_policy === "withdraw") {
    const withdrawn = await db.batch(
      withdrawCaretakerTextStatements(db, {
        symbol: role.gene_symbol,
        assignmentId: role.caretaker_assignment_id,
        at: now,
      }),
    )
    if (withdrawn.some((result) => Number(result?.meta?.changes || 0) > 0))
      settle.add(role.gene_symbol)
  }
  return { result: change.result, settle: [...settle] }
}

function errorResponse(error, json) {
  if (error instanceof ManifestationAuthorityError) {
    return json({ error: { code: error.code, message: error.message } }, error.status, NO_STORE)
  }
  console.error("[ICONOPLASM_CARETAKER_ADMIN]", error)
  return json({ error: { code: "CARETAKER_ADMIN_INTERNAL_ERROR" } }, 500, NO_STORE)
}

function requireServices(services) {
  for (const name of ["isAdmin", "json", "resolveActiveAccount", "settleGene"]) {
    if (typeof services?.[name] !== "function") {
      throw new TypeError(`Caretaker admin route service is missing: ${name}`)
    }
  }
}

// `settleGene(env, ctx, symbol)` re-runs a gene's election and republishes its
// gene object: after a role with a supervote ends, or its texts are withdrawn.
export function createIconoplasmCaretakerAdminHandlers(services) {
  requireServices(services)
  const { isAdmin, json, resolveActiveAccount, settleGene } = services

  function read(handlerName, reader) {
    return async ({ request, env, done }) => {
      if (!(await isAdmin(request, env))) {
        return done(`${handlerName}_403`, json({ error: "Unauthorized" }, 403, NO_STORE))
      }
      try {
        const value = await reader(env, new URL(request.url).searchParams)
        return done(handlerName, json(value, 200, NO_STORE))
      } catch (error) {
        const response = errorResponse(error, json)
        return done(`${handlerName}_${response.status}`, response)
      }
    }
  }

  async function mutate({ match, request, env, ctx, done }) {
    const routeName = "caretaker_admin_assignment_mutation"
    if (!(await isAdmin(request, env))) {
      return done(`${routeName}_403`, json({ error: "Unauthorized" }, 403, NO_STORE))
    }
    try {
      requireStrictSameOriginMutation(request)
      const session = await resolveActiveAccount(request, env)
      const actorAccountId = requiredId(session?.account_id, "account_id")
      const { value: body } = await readBoundedJson(request)
      const assignmentId = requiredId(match?.params?.assignment_id, "caretaker_assignment_id")
      bodyRouteId(body, "caretaker_assignment_id", assignmentId)
      const action = String(match?.params?.action || "")
        .trim()
        .toLowerCase()
      const { result, settle } = await changeCaretakerRoleAsAdmin(env, {
        assignmentId,
        action,
        actorAccountId,
        body,
      })
      for (const symbol of settle) {
        try {
          await settleGene(env, ctx, symbol)
        } catch (error) {
          console.error("[ICONOPLASM_CARETAKER_ADMIN_SETTLE]", symbol, error)
        }
      }
      return done(routeName, json(result, 200, NO_STORE))
    } catch (error) {
      const response = errorResponse(error, json)
      return done(`${routeName}_${response.status}`, response)
    }
  }

  return Object.freeze({
    "caretaker_admin.registry": read("caretaker_admin_registry", (env, params) =>
      readCaretakerAdminRegistry(env, {
        query: params.get("query"),
        status: params.get("status"),
        limit: params.get("limit"),
        after: params.get("after"),
      }),
    ),
    "caretaker_admin.accounts": read("caretaker_admin_accounts", (env, params) =>
      searchCaretakerAdminAccounts(env, {
        query: params.get("query"),
        limit: params.get("limit"),
      }),
    ),
    "caretaker_admin.genes": read("caretaker_admin_genes", (env, params) =>
      searchCaretakerAdminGenes(env, {
        query: params.get("query"),
        limit: params.get("limit"),
      }),
    ),
    "caretaker_admin.terms": read("caretaker_admin_terms", () => readCaretakerAdminTerms()),
    "caretaker_admin.mutate": mutate,
  })
}
