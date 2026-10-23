import { authorityError } from "./iconoplasm/caretaker/manifestation-authority-contract.js"
import {
  readBoundedJson,
  requireStrictSameOriginMutation,
} from "./iconoplasm/caretaker/manifestation-authority-http-security.js"
import { readAccountProfiles } from "./iconoplasm-public-caretakers.js"
import { discordAvatarSource } from "./lib/avatar-proxy.js"

const NO_STORE = Object.freeze({ "Cache-Control": "private, no-store" })
// Faces beside each count in the sidebar, newest first (GitHub's facepile).
const FACES = 3
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,191}$/

function requiredId(value, field) {
  const normalized = String(value || "").trim()
  if (!ID_PATTERN.test(normalized)) {
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

// Who wrote the unread comments, one face per person, newest first. Comment
// rows keep the /api/avatar path; the sidebar is signed-in only, so it gets
// Discord's own address and costs no Worker request per face. Read only when
// something is unread.
async function readCommentFaces(db, symbol, readThroughId) {
  const result = await db
    .prepare(
      `SELECT username, avatar_url, MAX(id) AS latest_id
         FROM icono_gene_comments
        WHERE gene_symbol = ? AND status = 'visible' AND id > ?
        GROUP BY user_id
        ORDER BY latest_id DESC
        LIMIT ?`,
    )
    .bind(symbol, readThroughId, FACES)
    .all()
  return (result?.results || []).map((row) =>
    Object.freeze({
      name: String(row.username || ""),
      avatar_url: discordAvatarSource(row.avatar_url) || null,
    }),
  )
}

// Who is asking for the gene, newest first. Read only when a request waits.
// A missing profile keeps its face as a blank, so the count still shows.
async function readRequestFaces(db, accountDb, row, now) {
  const result = await db
    .prepare(
      `SELECT requester_account_id FROM icono_caretaker_gene_requests
        WHERE gene_symbol = ?1 AND status = 'pending' AND holder_assignment_id = ?2
          AND expires_at > ?3
        ORDER BY created_at DESC
        LIMIT ?4`,
    )
    .bind(row.canonical_symbol, row.caretaker_assignment_id, now, FACES)
    .all()
  const ids = (result?.results || []).map((request) => request.requester_account_id)
  let profiles = new Map()
  try {
    profiles = await readAccountProfiles(accountDb, ids, { discordUrls: true })
  } catch (error) {
    console.error("[ICONOPLASM_CARETAKER_REQUEST_FACES]", error)
  }
  return ids.map((id) => {
    const profile = profiles.get(id)
    return Object.freeze({
      name: profile?.username || "",
      avatar_url: profile?.avatar_url || null,
    })
  })
}

// B-1065 B2b: a caretaker's own role, its unread gene comments and its
// supervote, read from the role row (icono_caretaker_assignments) in the main
// database. Until now they came from a copy of every role made by an event
// replay. B-1137: also the requests for the gene that wait on this caretaker.
// The sidebar shows both as one pair under the caretaker film, each a count
// with the faces behind it, wherever the person is on the site; the Discord
// message is only the nudge for people who aren't here. `accountDb` holds the
// askers' Discord profiles.
export async function readCaretakerCoordination(primaryDb, { accountId, accountDb } = {}) {
  const db = requirePrimaryDb(primaryDb)
  const stableAccountId = requiredId(accountId, "account_id")
  const now = new Date().toISOString()
  const row = await db
    .prepare(
      `SELECT role.caretaker_assignment_id, texts.gene_id,
              role.gene_symbol AS canonical_symbol, role.status AS assignment_status,
              role.assignment_version, role.comments_read_through_id,
              CASE WHEN role.supervote_asset_sha256 IS NOT NULL THEN 1 ELSE 0 END
                AS supervote_active,
              role.supervote_direction, role.supervote_version,
              (SELECT COUNT(*) FROM icono_caretaker_gene_requests request
                WHERE request.gene_symbol = role.gene_symbol AND request.status = 'pending'
                  AND request.holder_assignment_id = role.caretaker_assignment_id
                  AND request.expires_at > ?2) AS pending_request_count
         FROM icono_caretaker_assignments role
         LEFT JOIN icono_gene_texts texts ON texts.gene_symbol = role.gene_symbol
        WHERE role.account_id = ?1
          AND role.status IN ('pending_acceptance', 'active', 'suspended')
        LIMIT 1`,
    )
    .bind(stableAccountId, now)
    .first()
  if (!row || row.assignment_status === "pending_acceptance")
    return Object.freeze({ ok: true, caretaker: null })
  const commentState = await db
    .prepare(
      `SELECT COUNT(*) AS unread_count, COALESCE(MAX(id), 0) AS latest_comment_id
         FROM icono_gene_comments
        WHERE gene_symbol = ? AND status = 'visible' AND id > ?`,
    )
    .bind(row.canonical_symbol, Number(row.comments_read_through_id || 0))
    .first()
  const unreadCount = Number(commentState?.unread_count || 0)
  const pendingRequestCount = Number(row.pending_request_count || 0)
  const [commentFaces, requestFaces] = await Promise.all([
    unreadCount
      ? readCommentFaces(db, row.canonical_symbol, Number(row.comments_read_through_id || 0))
      : [],
    pendingRequestCount ? readRequestFaces(db, accountDb, row, now) : [],
  ])
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
      unread_comment_count: unreadCount,
      latest_comment_id: Number(commentState?.latest_comment_id || 0),
      comment_faces: Object.freeze(commentFaces),
      requests_href: `${href}#gene-requests`,
      pending_request_count: pendingRequestCount,
      request_faces: Object.freeze(requestFaces),
      supervote_active: Number(row.supervote_active || 0) === 1,
      supervote_direction: [-1, 1].includes(Number(row.supervote_direction))
        ? Number(row.supervote_direction)
        : null,
      supervote_version: Math.max(0, Number(row.supervote_version || 0) || 0),
    }),
  })
}

export async function markCaretakerCommentsRead(
  primaryDb,
  { accountId, accountDb, assignmentId, throughCommentId } = {},
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
      `UPDATE icono_caretaker_assignments
          SET comments_read_through_id = MAX(
                comments_read_through_id,
                MIN(?, COALESCE((SELECT MAX(c.id) FROM icono_gene_comments c
                                  WHERE c.gene_symbol = icono_caretaker_assignments.gene_symbol
                                    AND c.status = 'visible'), 0))
              )
        WHERE caretaker_assignment_id = ? AND account_id = ?
          AND status IN ('active', 'suspended')`,
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
  return readCaretakerCoordination(db, { accountId: stableAccountId, accountDb })
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
        const value = await readCaretakerCoordination(env.ICONOPLASM_DB, {
          accountId,
          accountDb: env.DB,
        })
        return done("caretaker_coordination", json(value, 200, NO_STORE))
      }
      requireStrictSameOriginMutation(request)
      const { value: body } = await readBoundedJson(request, 8 * 1024)
      const value = await markCaretakerCommentsRead(env.ICONOPLASM_DB, {
        accountId,
        accountDb: env.DB,
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
