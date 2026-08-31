import { authorityError } from "./iconoplasm/caretaker/manifestation-authority-contract.js"
import {
  readBoundedJson,
  requireStrictSameOriginMutation,
} from "./iconoplasm/caretaker/manifestation-authority-http-security.js"

const NO_STORE = Object.freeze({ "Cache-Control": "private, no-store" })
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,191}$/
const ASSIGNMENT_STATUSES = new Set(["pending_acceptance", "active", "suspended", "ended"])

function requiredId(value, field) {
  const normalized = String(value || "").trim()
  if (!ID_PATTERN.test(normalized)) {
    throw authorityError("INVALID_CARETAKER_NOTIFICATION", `${field} is invalid`, 400)
  }
  return normalized
}

function positiveVersion(value, field) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw authorityError("INVALID_CARETAKER_NOTIFICATION", `${field} is invalid`, 400)
  }
  return normalized
}

function requirePrimaryDb(db) {
  if (!db?.prepare) {
    throw authorityError("PRIMARY_DB_REQUIRED", "Iconoplasm primary database is unavailable", 503)
  }
  return db
}

export async function projectCaretakerAssignmentNotification(primaryDb, event) {
  const db = requirePrimaryDb(primaryDb)
  const assignment = event?.assignment
  const gene = event?.gene
  if (!assignment || !gene) return Object.freeze({ ok: true, skipped: true })
  const assignmentId = requiredId(assignment.caretaker_assignment_id, "caretaker_assignment_id")
  const accountId = requiredId(assignment.account_id, "account_id")
  const geneId = requiredId(event?.gene_id || gene.gene_id, "gene_id")
  const canonicalSymbol = String(gene.canonical_symbol || "")
    .trim()
    .toUpperCase()
  if (!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(canonicalSymbol)) {
    throw authorityError("INVALID_CARETAKER_NOTIFICATION", "canonical_symbol is invalid", 400)
  }
  const assignmentStatus = String(assignment.status || "").trim()
  if (!ASSIGNMENT_STATUSES.has(assignmentStatus)) {
    throw authorityError("INVALID_CARETAKER_NOTIFICATION", "assignment status is invalid", 400)
  }
  const assignmentVersion = positiveVersion(assignment.assignment_version, "assignment_version")
  const eventId = requiredId(event?.event_id, "event_id")
  const eventSequence = positiveVersion(event?.event_sequence, "event_sequence")
  const pending = assignmentStatus === "pending_acceptance"

  const write = await db
    .prepare(
      `INSERT INTO icono_caretaker_assignment_notifications (
         caretaker_assignment_id, account_id, gene_id, canonical_symbol,
         assignment_status, assignment_version, notification_state,
         authority_event_id, authority_event_sequence, resolved_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END)
       ON CONFLICT(caretaker_assignment_id) DO UPDATE SET
         canonical_symbol = excluded.canonical_symbol,
         assignment_status = excluded.assignment_status,
         assignment_version = excluded.assignment_version,
         notification_state = excluded.notification_state,
         authority_event_id = excluded.authority_event_id,
         authority_event_sequence = excluded.authority_event_sequence,
         updated_at = CURRENT_TIMESTAMP,
         resolved_at = CASE
           WHEN excluded.notification_state = 'resolved'
             THEN COALESCE(icono_caretaker_assignment_notifications.resolved_at, CURRENT_TIMESTAMP)
           ELSE NULL
         END
       WHERE excluded.authority_event_sequence > authority_event_sequence`,
    )
    .bind(
      assignmentId,
      accountId,
      geneId,
      canonicalSymbol,
      assignmentStatus,
      assignmentVersion,
      pending ? "pending" : "resolved",
      eventId,
      eventSequence,
      pending ? 1 : 0,
    )
    .run()

  const row = await db
    .prepare(
      `SELECT caretaker_assignment_id, account_id, gene_id, canonical_symbol,
              assignment_status, assignment_version, notification_state,
              authority_event_id, authority_event_sequence, read_at, resolved_at
         FROM icono_caretaker_assignment_notifications
        WHERE caretaker_assignment_id = ?`,
    )
    .bind(assignmentId)
    .first()
  return Object.freeze({
    ok: true,
    skipped: false,
    replayed: Number(write?.meta?.changes || 0) === 0,
    caretaker_assignment_id: row.caretaker_assignment_id,
    notification_state: row.notification_state,
    authority_event_sequence: Number(row.authority_event_sequence),
  })
}

export async function readCaretakerAssignmentNotifications(
  primaryDb,
  { accountId, limit = 20 } = {},
) {
  const db = requirePrimaryDb(primaryDb)
  const stableAccountId = requiredId(accountId, "account_id")
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit) || 20)))
  const response = await db
    .prepare(
      `SELECT caretaker_assignment_id, gene_id, canonical_symbol,
              assignment_status, assignment_version, notification_state,
              authority_event_id, authority_event_sequence,
              read_at, created_at, updated_at, resolved_at
         FROM icono_caretaker_assignment_notifications
        WHERE account_id = ?
        ORDER BY CASE notification_state WHEN 'pending' THEN 0 ELSE 1 END,
                 authority_event_sequence DESC
        LIMIT ?`,
    )
    .bind(stableAccountId, boundedLimit)
    .all()
  const rows = Array.isArray(response?.results) ? response.results : []
  const invitations = rows.map((row) =>
    Object.freeze({
      caretaker_assignment_id: row.caretaker_assignment_id,
      gene_id: row.gene_id,
      canonical_symbol: row.canonical_symbol,
      href: `/gene/${encodeURIComponent(row.canonical_symbol)}`,
      assignment_status: row.assignment_status,
      assignment_version: Number(row.assignment_version),
      notification_state: row.notification_state,
      authority_event_id: row.authority_event_id,
      authority_event_sequence: Number(row.authority_event_sequence),
      read_at: row.read_at || null,
      created_at: row.created_at,
      updated_at: row.updated_at,
      resolved_at: row.resolved_at || null,
    }),
  )
  return Object.freeze({
    ok: true,
    pending_count: invitations.filter((item) => item.notification_state === "pending").length,
    unread_count: invitations.filter((item) => item.read_at == null).length,
    invitations: Object.freeze(invitations),
  })
}

export async function markCaretakerAssignmentNotificationRead(
  primaryDb,
  { accountId, assignmentId } = {},
) {
  const db = requirePrimaryDb(primaryDb)
  const stableAccountId = requiredId(accountId, "account_id")
  const stableAssignmentId = requiredId(assignmentId, "caretaker_assignment_id")
  await db
    .prepare(
      `UPDATE icono_caretaker_assignment_notifications
          SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
        WHERE caretaker_assignment_id = ? AND account_id = ?`,
    )
    .bind(stableAssignmentId, stableAccountId)
    .run()
  const row = await db
    .prepare(
      `SELECT read_at FROM icono_caretaker_assignment_notifications
        WHERE caretaker_assignment_id = ? AND account_id = ?`,
    )
    .bind(stableAssignmentId, stableAccountId)
    .first()
  if (!row) {
    throw authorityError(
      "CARETAKER_NOTIFICATION_NOT_FOUND",
      "Caretaker invitation was not found",
      404,
    )
  }
  return Object.freeze({
    ok: true,
    caretaker_assignment_id: stableAssignmentId,
    read_at: row.read_at,
  })
}

function errorResponse(error, json) {
  const status = Number.isInteger(error?.status) ? error.status : 500
  const code = String(error?.code || "CARETAKER_NOTIFICATION_INTERNAL_ERROR")
  return json({ error: { code } }, status, NO_STORE)
}

export function createIconoplasmCaretakerNotificationHandlers({ json, resolveActiveAccount } = {}) {
  if (typeof json !== "function" || typeof resolveActiveAccount !== "function") {
    throw new TypeError("Caretaker notification handlers require json and resolveActiveAccount")
  }
  async function handle({ request, env, done }) {
    try {
      const session = await resolveActiveAccount(request, env)
      const accountId = requiredId(session?.account_id, "account_id")
      if (request.method === "GET" || request.method === "HEAD") {
        const value = await readCaretakerAssignmentNotifications(env.ICONOPLASM_DB, {
          accountId,
          limit: new URL(request.url).searchParams.get("limit"),
        })
        return done("caretaker_invitations", json(value, 200, NO_STORE))
      }
      requireStrictSameOriginMutation(request)
      const { value: body } = await readBoundedJson(request, 8 * 1024)
      const value = await markCaretakerAssignmentNotificationRead(env.ICONOPLASM_DB, {
        accountId,
        assignmentId: body.caretaker_assignment_id,
      })
      return done("caretaker_invitations_read", json(value, 200, NO_STORE))
    } catch (error) {
      const response = errorResponse(error, json)
      return done(`caretaker_invitations_${response.status}`, response)
    }
  }
  return Object.freeze({ caretaker_notifications: handle })
}
