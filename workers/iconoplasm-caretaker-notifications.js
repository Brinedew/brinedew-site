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
         authority_event_id, authority_event_sequence, resolved_at,
         comments_read_through_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CASE WHEN ? THEN NULL ELSE CURRENT_TIMESTAMP END,
         CASE WHEN ? THEN 0 ELSE COALESCE((SELECT MAX(id) FROM icono_gene_comments
                                           WHERE gene_symbol = ? AND status = 'visible'), 0) END)
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
      pending ? 1 : 0,
      canonicalSymbol,
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

export async function readCaretakerCoordination(primaryDb, { accountId } = {}) {
  const db = requirePrimaryDb(primaryDb)
  const stableAccountId = requiredId(accountId, "account_id")
  const row = await db
    .prepare(
      `SELECT caretaker_assignment_id, gene_id, canonical_symbol,
              assignment_status, assignment_version, authority_event_sequence,
              comments_read_through_id
         FROM icono_caretaker_assignment_notifications
        WHERE account_id = ? AND assignment_status IN ('active', 'suspended')
        ORDER BY authority_event_sequence DESC LIMIT 1`,
    )
    .bind(stableAccountId)
    .first()
  if (!row) return Object.freeze({ ok: true, caretaker: null })
  const commentState = await db
    .prepare(
      `SELECT COUNT(*) AS unread_count, COALESCE(MAX(id), 0) AS latest_comment_id
         FROM icono_gene_comments
        WHERE gene_symbol = ? AND status = 'visible' AND id > ?`,
    )
    .bind(row.canonical_symbol, Number(row.comments_read_through_id || 0))
    .first()
  const href = `/gene/${encodeURIComponent(row.canonical_symbol)}`
  return Object.freeze({
    ok: true,
    caretaker: Object.freeze({
      caretaker_assignment_id: row.caretaker_assignment_id,
      gene_id: row.gene_id,
      canonical_symbol: row.canonical_symbol,
      assignment_status: row.assignment_status,
      assignment_version: Number(row.assignment_version),
      href,
      comments_href: `${href}#gene-comments`,
      unread_comment_count: Number(commentState?.unread_count || 0),
      latest_comment_id: Number(commentState?.latest_comment_id || 0),
    }),
  })
}

export async function markCaretakerCommentsRead(
  primaryDb,
  { accountId, assignmentId, throughCommentId } = {},
) {
  const db = requirePrimaryDb(primaryDb)
  const stableAccountId = requiredId(accountId, "account_id")
  const stableAssignmentId = requiredId(assignmentId, "caretaker_assignment_id")
  const stableThroughCommentId = Math.trunc(Number(throughCommentId))
  if (!Number.isSafeInteger(stableThroughCommentId) || stableThroughCommentId < 0) {
    throw authorityError("INVALID_COMMENT_HIGH_WATER", "through_comment_id is invalid", 400)
  }
  const result = await db
    .prepare(
      `UPDATE icono_caretaker_assignment_notifications
          SET comments_read_through_id = MAX(
                comments_read_through_id,
                MIN(?, COALESCE((SELECT MAX(id) FROM icono_gene_comments
                                  WHERE gene_symbol = canonical_symbol AND status = 'visible'), 0))
              ),
              updated_at = CURRENT_TIMESTAMP
        WHERE caretaker_assignment_id = ? AND account_id = ?
          AND assignment_status IN ('active', 'suspended')`,
    )
    .bind(stableThroughCommentId, stableAssignmentId, stableAccountId)
    .run()
  if (Number(result?.meta?.changes || 0) !== 1) {
    throw authorityError(
      "CARETAKER_ASSIGNMENT_NOT_FOUND",
      "Current caretaker assignment was not found",
      404,
    )
  }
  return readCaretakerCoordination(db, { accountId: stableAccountId })
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
        const value = await readCaretakerCoordination(env.ICONOPLASM_DB, { accountId })
        return done("caretaker_coordination", json(value, 200, NO_STORE))
      }
      requireStrictSameOriginMutation(request)
      const { value: body } = await readBoundedJson(request, 8 * 1024)
      const value = await markCaretakerCommentsRead(env.ICONOPLASM_DB, {
        accountId,
        assignmentId: body.caretaker_assignment_id,
        throughCommentId: body.through_comment_id,
      })
      return done("caretaker_coordination_comments_read", json(value, 200, NO_STORE))
    } catch (error) {
      const response = errorResponse(error, json)
      return done(`caretaker_coordination_${response.status}`, response)
    }
  }
  return Object.freeze({ caretaker_notifications: handle })
}
