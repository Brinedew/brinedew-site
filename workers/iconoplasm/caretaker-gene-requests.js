// B-1137: asking a gene's caretaker for the gene. The Caretaker's Handbook:
// "Go to a gene page and click the "request swap" button in the gene toolbar.
// The caretaker for that gene will get a swap request notification and can
// either accept or reject it. You can only have one swap request active at a
// time."
//
// A person who looks after a gene of their own asks for a swap; a person who
// looks after none asks for a handover. Accepting moves both roles in one
// batch, so there is no moment when the gene is free for someone else to take,
// and the switch cooldown does not apply: both people agreed. Each new role
// starts the cooldown again. Texts stay with their gene (B-860), and both
// supervotes are withdrawn, as on any switch.
//
// Rows live in icono_caretaker_gene_requests (main migration 0133). Every role
// change voids the requests it leaves stale (caretaker/gene-request-voids.js),
// so a pending request always names two active roles.
import { readAccountProfiles } from "../iconoplasm-public-caretakers.js"
import { sha256Hex } from "../lib/iconoplasm-sha256.js"
import { geneRequestVoidStatements } from "./caretaker/gene-request-voids.js"
import { authorityError } from "./caretaker/manifestation-authority-contract.js"
import {
  LATEST_COMMENT_SQL,
  caretakerPseudonym,
  caretakerTerms,
  endedSupervoteBump,
  isConstraintError,
  publicTerms,
  readClaimContext,
  readCommandId,
  requireCurrentTerms,
  resolveGene,
} from "./caretaker-roles.js"

// A pending request expires after this many days, and a rejected one keeps its
// asker from asking for the same gene again for as long. A product rule against
// pestering, not a budget wall.
export const GENE_REQUEST_DAYS = 14
export const GENE_REQUEST_NOTE_MAX = 500
// The caretaker's gene page lists at most this many pending requests.
export const GENE_REQUEST_LIST_LIMIT = 20

const DAY_MS = 24 * 60 * 60 * 1000
const REQUEST_ID = /^request_[0-9a-f]{48}$/
const REQUEST_COLUMNS = `request_id, gene_symbol, holder_assignment_id, holder_account_id,
  requester_account_id, requester_assignment_id, offered_gene_symbol, note, terms_version_id,
  status, void_reason, seen_at, created_at, expires_at, decided_at`

const first = (db, sql, ...args) =>
  db
    .prepare(sql)
    .bind(...args)
    .first()

function plusDays(iso, days) {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString()
}

async function requestIdFor(accountId, commandId) {
  const digest = await sha256Hex(
    new TextEncoder().encode(`iconoplasm.caretaker-gene-request\n${accountId}\n${commandId}`),
  )
  return `request_${digest.slice(0, 48)}`
}

// The roles an accepted request creates are named by the request, so a retry
// never makes a second one.
async function roleIdForRequest(requestId, accountId) {
  const digest = await sha256Hex(
    new TextEncoder().encode(`iconoplasm.caretaker-request-role\n${requestId}\n${accountId}`),
  )
  return `assignment_${digest.slice(0, 48)}`
}

function unavailable(message, code = "GENE_REQUEST_UNAVAILABLE") {
  return authorityError(code, message, 409)
}

function readNote(body) {
  if (body?.note == null) return null
  if (typeof body.note !== "string")
    throw authorityError("INVALID_GENE_REQUEST_NOTE", "The note must be text", 400)
  const note = body.note.trim()
  if (!note) return null
  if (note.length > GENE_REQUEST_NOTE_MAX)
    throw authorityError(
      "INVALID_GENE_REQUEST_NOTE",
      `The note can be at most ${GENE_REQUEST_NOTE_MAX} characters`,
      400,
    )
  return note
}

function readRequestId(raw) {
  const requestId = String(raw || "").trim()
  if (!REQUEST_ID.test(requestId))
    throw authorityError("INVALID_GENE_REQUEST", "Request identity is invalid", 400)
  return requestId
}

// The account's pending request (any gene) and its latest rejection on this
// gene, in one read of its own rows.
async function requesterState(db, accountId, symbol, now) {
  const rows = await db
    .prepare(
      `SELECT ${REQUEST_COLUMNS} FROM icono_caretaker_gene_requests
        WHERE requester_account_id = ?1
          AND (status = 'pending'
               OR (gene_symbol = ?2 AND status = 'rejected' AND decided_at > ?3))
        ORDER BY decided_at DESC
        LIMIT 4`,
    )
    .bind(accountId, symbol, plusDays(now, -GENE_REQUEST_DAYS))
    .all()
  const results = rows?.results || []
  const pending = results.find((row) => row.status === "pending" && row.expires_at > now) || null
  const rejected = results.find((row) => row.status === "rejected") || null
  return {
    pending,
    rejectedUntil: rejected ? plusDays(rejected.decided_at, GENE_REQUEST_DAYS) : null,
  }
}

function requestUnavailableReason({ geneRole, accountRole, rejectedUntil }) {
  if (geneRole.status !== "active") return "caretaker_unavailable"
  if (accountRole && accountRole.status !== "active") return "account_role_unavailable"
  if (rejectedUntil) return "rejected_recently"
  return null
}

// What a signed-in person's gene page needs beside the claim button:
//  - on a gene someone else looks after, the request button (`request`);
//  - on their own gene, the requests waiting for them (`incoming`).
// Opening your own gene page marks its requests seen, so the next request sends
// a Discord message again (the read-through idea comments use).
export async function readGenePageCaretaking(db, accountDb, input) {
  const context = await readClaimContext(db, input)
  const { availability, gene, geneRole, accountRole } = context
  const reason = availability.claim.reason
  if (reason === "gene_taken")
    return { ...availability, request: await readRequestOffer(db, context, input) }
  if (reason === "already_caretaking" && geneRole?.status === "active")
    return {
      ...availability,
      incoming: await readIncomingRequests(db, accountDb, {
        gene,
        role: geneRole,
        accountRole,
        now: input.now,
      }),
    }
  return availability
}

async function readRequestOffer(db, { gene, geneRole, accountRole }, { accountId, now }) {
  const symbol = gene.canonical_symbol
  const { pending, rejectedUntil } = await requesterState(db, accountId, symbol, now)
  const reason = requestUnavailableReason({ geneRole, accountRole, rejectedUntil })
  const pendingHere = pending?.gene_symbol === symbol ? pending : null
  const pendingElsewhere = pending && !pendingHere ? pending : null
  return {
    available: reason == null && !pendingHere,
    reason,
    mode: accountRole ? "swap" : "handover",
    holder_assignment_id: geneRole.caretaker_assignment_id,
    offered: accountRole
      ? {
          caretaker_assignment_id: accountRole.caretaker_assignment_id,
          canonical_symbol: accountRole.gene_symbol,
          // As in the switch dialog: the terms box starts ticked only when this
          // role already accepted the version on offer.
          terms_version_id: accountRole.terms_version_id,
          has_supervote: Boolean(accountRole.supervote_asset_sha256),
        }
      : null,
    pending: pendingHere
      ? {
          request_id: pendingHere.request_id,
          note: pendingHere.note,
          created_at: pendingHere.created_at,
          expires_at: pendingHere.expires_at,
        }
      : null,
    replaces: pendingElsewhere
      ? {
          request_id: pendingElsewhere.request_id,
          canonical_symbol: pendingElsewhere.gene_symbol,
        }
      : null,
    ...(reason === "rejected_recently"
      ? {
          available_at: rejectedUntil,
          cooldown_seconds: GENE_REQUEST_DAYS * 24 * 60 * 60,
        }
      : {}),
    note_max_length: GENE_REQUEST_NOTE_MAX,
    terms: publicTerms(caretakerTerms()),
  }
}

async function readIncomingRequests(db, accountDb, { gene, role, now }) {
  const symbol = gene.canonical_symbol
  const results = await db.batch([
    db
      .prepare(
        `UPDATE icono_caretaker_gene_requests SET status = 'expired', decided_at = ?2
          WHERE gene_symbol = ?1 AND status = 'pending' AND expires_at <= ?2`,
      )
      .bind(symbol, now),
    db
      .prepare(
        `UPDATE icono_caretaker_gene_requests SET seen_at = ?3
          WHERE gene_symbol = ?1 AND status = 'pending' AND holder_assignment_id = ?2
            AND seen_at IS NULL`,
      )
      .bind(symbol, role.caretaker_assignment_id, now),
    db
      .prepare(
        `SELECT ${REQUEST_COLUMNS} FROM icono_caretaker_gene_requests
          WHERE gene_symbol = ?1 AND status = 'pending' AND holder_assignment_id = ?2
          ORDER BY created_at, request_id
          LIMIT ?3`,
      )
      .bind(symbol, role.caretaker_assignment_id, GENE_REQUEST_LIST_LIMIT + 1),
  ])
  const rows = results[2]?.results || []
  const shown = rows.slice(0, GENE_REQUEST_LIST_LIMIT)
  let profiles = new Map()
  try {
    profiles = await readAccountProfiles(
      accountDb,
      shown.map((row) => row.requester_account_id),
    )
  } catch (error) {
    // A missing name is not worth losing the list over; the pseudonym stands in.
    console.error("[ICONOPLASM_GENE_REQUEST_PROFILES]", error)
  }
  const requests = []
  for (const row of shown)
    requests.push({
      request_id: row.request_id,
      requester: profiles.get(row.requester_account_id) || null,
      requester_label: await caretakerPseudonym(row.requester_account_id),
      offered: row.offered_gene_symbol ? { canonical_symbol: row.offered_gene_symbol } : null,
      note: row.note,
      created_at: row.created_at,
      expires_at: row.expires_at,
    })
  return {
    requests,
    more: rows.length > GENE_REQUEST_LIST_LIMIT,
    holder: {
      caretaker_assignment_id: role.caretaker_assignment_id,
      assignment_version: Number(role.assignment_version),
      terms_version_id: role.terms_version_id,
      has_supervote: Boolean(role.supervote_asset_sha256),
    },
    terms: publicTerms(caretakerTerms()),
  }
}

// Sending a request. The page echoes the two roles it showed (the gene's
// caretaker and the asker's own gene, if any) and, when the asker already has a
// request pending for another gene, that request's ID: sending this one
// withdraws it (one request at a time).
export async function createGeneRequest(db, { geneLocator, accountId, body, now }) {
  requireCurrentTerms(body)
  const commandId = readCommandId(body)
  const note = readNote(body)
  const requestId = await requestIdFor(accountId, commandId)
  const existing = await first(
    db,
    `SELECT ${REQUEST_COLUMNS} FROM icono_caretaker_gene_requests WHERE request_id = ?`,
    requestId,
  )
  if (existing)
    return {
      result: { ok: true, replayed: true, request_id: requestId, status: existing.status },
      notify: false,
    }
  const { gene, geneRole, accountRole } = await readClaimContext(db, {
    geneLocator,
    accountId,
    now,
  })
  const symbol = gene.canonical_symbol
  if (!geneRole || geneRole.account_id === accountId)
    throw unavailable("This gene has no other caretaker to ask; refresh the gene page")
  if ((body.holder_assignment_id || null) !== geneRole.caretaker_assignment_id)
    throw unavailable("This gene's caretaker changed; refresh the gene page")
  if ((body.offered_assignment_id || null) !== (accountRole?.caretaker_assignment_id || null))
    throw unavailable("Your own caretaker role changed; refresh the gene page")
  const { pending, rejectedUntil } = await requesterState(db, accountId, symbol, now)
  const reason = requestUnavailableReason({ geneRole, accountRole, rejectedUntil })
  if (reason === "rejected_recently") {
    const refusal = authorityError(
      "GENE_REQUEST_REJECTED_RECENTLY",
      "This gene's caretaker rejected your request recently",
      429,
    )
    refusal.retryAfterSeconds = Math.max(
      1,
      Math.ceil((Date.parse(rejectedUntil) - Date.parse(now)) / 1000),
    )
    throw refusal
  }
  if (reason === "caretaker_unavailable")
    throw unavailable("This gene's caretaker can't take requests right now")
  if (reason === "account_role_unavailable")
    throw unavailable("Your own caretaker role is suspended or waiting for your answer")
  if (pending?.gene_symbol === symbol)
    throw unavailable("You already asked for this gene", "GENE_REQUEST_ALREADY_PENDING")
  if ((body.replace_request_id || null) !== (pending?.request_id || null))
    throw unavailable(
      pending
        ? `Your request for ${pending.gene_symbol} is still pending; refresh the gene page`
        : "Your pending request changed; refresh the gene page",
      "GENE_REQUEST_ALREADY_PENDING",
    )
  const statements = [
    db
      .prepare(
        `UPDATE icono_caretaker_gene_requests SET status = 'expired', decided_at = ?2
          WHERE requester_account_id = ?1 AND status = 'pending' AND expires_at <= ?2`,
      )
      .bind(accountId, now),
  ]
  if (pending)
    statements.push(
      db
        .prepare(
          `UPDATE icono_caretaker_gene_requests SET status = 'withdrawn', decided_at = ?3
            WHERE request_id = ?1 AND requester_account_id = ?2 AND status = 'pending'`,
        )
        .bind(pending.request_id, accountId, now),
    )
  statements.push(
    db
      .prepare(
        `INSERT INTO icono_caretaker_gene_requests
           (request_id, gene_symbol, holder_assignment_id, holder_account_id,
            requester_account_id, requester_assignment_id, offered_gene_symbol, note,
            terms_version_id, status, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(
        requestId,
        symbol,
        geneRole.caretaker_assignment_id,
        geneRole.account_id,
        accountId,
        accountRole?.caretaker_assignment_id || null,
        accountRole?.gene_symbol || null,
        note,
        caretakerTerms().terms_version_id,
        now,
        plusDays(now, GENE_REQUEST_DAYS),
      ),
    // One message for a run of requests the caretaker hasn't seen yet.
    db
      .prepare(
        `INSERT INTO icono_caretaker_gene_request_notifications
           (notification_key, request_id, kind, recipient_account_id, gene_symbol)
         SELECT ?1 || ':requested', ?1, 'requested', ?2, ?3
          WHERE EXISTS (SELECT 1 FROM icono_caretaker_gene_requests
                         WHERE request_id = ?1 AND status = 'pending')
            AND NOT EXISTS (SELECT 1 FROM icono_caretaker_gene_requests
                             WHERE gene_symbol = ?3 AND status = 'pending'
                               AND seen_at IS NULL AND request_id <> ?1 AND expires_at > ?4)`,
      )
      .bind(requestId, geneRole.account_id, symbol, now),
  )
  let results
  try {
    results = await db.batch(statements)
  } catch (error) {
    if (!isConstraintError(error)) throw error
    throw unavailable("Your request changed while sending; refresh the gene page")
  }
  const notified = Number(results.at(-1)?.meta?.changes || 0) === 1
  return {
    result: {
      ok: true,
      request_id: requestId,
      status: "pending",
      mode: accountRole ? "swap" : "handover",
      ...(pending ? { withdrew_request_id: pending.request_id } : {}),
    },
    notify: notified,
  }
}

async function readRequestOn(db, symbol, requestId) {
  const request = await first(
    db,
    `SELECT ${REQUEST_COLUMNS} FROM icono_caretaker_gene_requests WHERE request_id = ?`,
    requestId,
  )
  if (!request || request.gene_symbol !== symbol)
    throw authorityError("GENE_REQUEST_NOT_FOUND", "Request was not found", 404)
  return request
}

function settled(request, status) {
  return {
    result: { ok: true, replayed: true, request_id: request.request_id, status },
    reElect: [],
    notify: false,
  }
}

// The caretaker's accept or reject, or the asker's withdraw.
export async function decideGeneRequest(
  db,
  { geneLocator, requestId: rawRequestId, action, accountId, body, now },
) {
  const requestId = readRequestId(rawRequestId)
  const gene = await resolveGene(db, geneLocator)
  const request = await readRequestOn(db, gene.canonical_symbol, requestId)
  if (action === "withdraw") return withdrawRequest(db, request, accountId, now)
  if (request.holder_account_id !== accountId)
    throw authorityError("GENE_REQUEST_NOT_FOUND", "Request was not found", 404)
  if (action === "reject") return rejectRequest(db, request, now)
  if (action === "accept") return acceptRequest(db, request, body, now)
  throw authorityError("INVALID_GENE_REQUEST_ACTION", "Request action is invalid", 400)
}

async function withdrawRequest(db, request, accountId, now) {
  if (request.requester_account_id !== accountId)
    throw authorityError("GENE_REQUEST_NOT_FOUND", "Request was not found", 404)
  if (request.status === "withdrawn") return settled(request, "withdrawn")
  const result = await db
    .prepare(
      `UPDATE icono_caretaker_gene_requests SET status = 'withdrawn', decided_at = ?2
        WHERE request_id = ?1 AND status = 'pending'`,
    )
    .bind(request.request_id, now)
    .run()
  if (Number(result?.meta?.changes || 0) !== 1)
    throw unavailable(`This request is already ${request.status}; refresh the gene page`)
  return {
    result: { ok: true, request_id: request.request_id, status: "withdrawn" },
    reElect: [],
    notify: false,
  }
}

async function rejectRequest(db, request, now) {
  if (request.status === "rejected") return settled(request, "rejected")
  const results = await db.batch([
    db
      .prepare(
        `UPDATE icono_caretaker_gene_requests SET status = 'rejected', decided_at = ?2
          WHERE request_id = ?1 AND status = 'pending'`,
      )
      .bind(request.request_id, now),
    db
      .prepare(
        `INSERT INTO icono_caretaker_gene_request_notifications
           (notification_key, request_id, kind, recipient_account_id, gene_symbol)
         SELECT ?1 || ':rejected', ?1, 'rejected', requester_account_id, gene_symbol
           FROM icono_caretaker_gene_requests
          WHERE request_id = ?1 AND status = 'rejected' AND decided_at = ?2
         ON CONFLICT (notification_key) DO NOTHING`,
      )
      .bind(request.request_id, now),
  ])
  if (Number(results[0]?.meta?.changes || 0) !== 1)
    throw unavailable(`This request is already ${request.status}; refresh the gene page`)
  return {
    result: { ok: true, request_id: request.request_id, status: "rejected" },
    reElect: [],
    notify: true,
  }
}

function endRoleStatement(db, { roleId, accountId, version, reason, now, accepted }) {
  return db
    .prepare(
      `UPDATE icono_caretaker_assignments
          SET status = 'ended', assignment_version = assignment_version + 1,
              relinquish_policy = 'retain', ended_by_account_id = ?2, end_reason = ?4,
              ended_at = ?5, suspended_at = NULL, suspension_reason = NULL, updated_at = ?5
        WHERE caretaker_assignment_id = ?1 AND account_id = ?2 AND status = 'active'
          AND assignment_version = ?3 AND ${accepted.sql}`,
    )
    .bind(roleId, accountId, version, reason, now, ...accepted.args)
}

function insertRoleStatement(
  db,
  { roleId, symbol, accountId, termsVersionId, termsAcceptedAt, invitedBy, now, accepted },
) {
  return db
    .prepare(
      `INSERT INTO icono_caretaker_assignments
         (caretaker_assignment_id, gene_symbol, account_id, status, assignment_version,
          terms_version_id, terms_accepted_at, relinquish_policy, invited_by_account_id,
          started_at, created_at, updated_at, comments_read_through_id)
       SELECT ?1, ?2, ?3, 'active', 1, ?4, ?5, 'retain', ?6, ?7, ?7, ?7, ${LATEST_COMMENT_SQL("?2")}
        WHERE ${accepted.sql}`,
    )
    .bind(
      roleId,
      symbol,
      accountId,
      termsVersionId,
      termsAcceptedAt,
      invitedBy,
      now,
      ...accepted.args,
    )
}

async function acceptRequest(db, request, body, now) {
  if (request.status === "accepted") return settled(request, "accepted")
  if (request.status !== "pending")
    throw unavailable(`This request is already ${request.status}; refresh the gene page`)
  if (!(request.expires_at > now)) {
    await db
      .prepare(
        `UPDATE icono_caretaker_gene_requests SET status = 'expired', decided_at = ?2
          WHERE request_id = ?1 AND status = 'pending'`,
      )
      .bind(request.request_id, now)
      .run()
    throw unavailable("This request expired; refresh the gene page")
  }
  if (request.terms_version_id !== caretakerTerms().terms_version_id) {
    await db
      .prepare(
        `UPDATE icono_caretaker_gene_requests
            SET status = 'void', void_reason = 'terms_changed', decided_at = ?2
          WHERE request_id = ?1 AND status = 'pending'`,
      )
      .bind(request.request_id, now)
      .run()
    throw unavailable("The caretaker terms changed after this request was sent, so it has ended")
  }
  const swap = Boolean(request.requester_assignment_id)
  // The caretaker takes the asker's gene in a swap, under the current terms.
  if (swap) requireCurrentTerms(body)
  const [holderRole, requesterRole, requesterOpen] = await Promise.all([
    first(
      db,
      `SELECT caretaker_assignment_id, account_id, gene_symbol, status, assignment_version
         FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?`,
      request.holder_assignment_id,
    ),
    swap
      ? first(
          db,
          `SELECT caretaker_assignment_id, account_id, gene_symbol, status, assignment_version
             FROM icono_caretaker_assignments WHERE caretaker_assignment_id = ?`,
          request.requester_assignment_id,
        )
      : null,
    first(
      db,
      `SELECT caretaker_assignment_id FROM icono_caretaker_assignments
        WHERE account_id = ? AND status IN ('pending_acceptance', 'active', 'suspended') LIMIT 1`,
      request.requester_account_id,
    ),
  ])
  if (
    holderRole?.status !== "active" ||
    holderRole.account_id !== request.holder_account_id ||
    holderRole.gene_symbol !== request.gene_symbol
  )
    throw unavailable("Your caretaker role changed; refresh the gene page")
  if (Number(body?.expected_assignment_version) !== Number(holderRole.assignment_version))
    throw unavailable("Your caretaker role changed; refresh the gene page")
  if (
    swap
      ? requesterRole?.status !== "active" ||
        requesterRole.account_id !== request.requester_account_id ||
        requesterRole.gene_symbol !== request.offered_gene_symbol
      : requesterOpen
  )
    throw unavailable("The asker's own caretaker role changed; refresh the gene page")

  // Every write below checks that this batch is the one that accepted the
  // request, so a retry, or a request decided in between, writes nothing.
  const accepted = {
    sql: `EXISTS (SELECT 1 FROM icono_caretaker_gene_requests
                   WHERE request_id = ? AND status = 'accepted' AND decided_at = ?)`,
    args: [request.request_id, now],
  }
  const symbol = request.gene_symbol
  const offered = request.offered_gene_symbol
  const holderVersion = Number(holderRole.assignment_version)
  const requesterVersion = swap ? Number(requesterRole.assignment_version) : 0
  const endReason = swap ? "caretaker_swapped_gene" : "caretaker_handed_over_gene"
  const statements = [
    db
      .prepare(
        `UPDATE icono_caretaker_gene_requests SET status = 'accepted', decided_at = ?2
          WHERE request_id = ?1 AND status = 'pending' AND expires_at > ?2`,
      )
      .bind(request.request_id, now),
    endRoleStatement(db, {
      roleId: holderRole.caretaker_assignment_id,
      accountId: request.holder_account_id,
      version: holderVersion,
      reason: endReason,
      now,
      accepted,
    }),
    endedSupervoteBump(db, symbol, holderRole.caretaker_assignment_id, holderVersion + 1),
  ]
  if (swap)
    statements.push(
      endRoleStatement(db, {
        roleId: requesterRole.caretaker_assignment_id,
        accountId: request.requester_account_id,
        version: requesterVersion,
        reason: endReason,
        now,
        accepted,
      }),
      endedSupervoteBump(db, offered, requesterRole.caretaker_assignment_id, requesterVersion + 1),
    )
  statements.push(
    insertRoleStatement(db, {
      roleId: await roleIdForRequest(request.request_id, request.requester_account_id),
      symbol,
      accountId: request.requester_account_id,
      termsVersionId: request.terms_version_id,
      termsAcceptedAt: request.created_at,
      invitedBy: request.holder_account_id,
      now,
      accepted,
    }),
  )
  if (swap)
    statements.push(
      insertRoleStatement(db, {
        roleId: await roleIdForRequest(request.request_id, request.holder_account_id),
        symbol: offered,
        accountId: request.holder_account_id,
        termsVersionId: caretakerTerms().terms_version_id,
        termsAcceptedAt: now,
        invitedBy: request.requester_account_id,
        now,
        accepted,
      }),
    )
  statements.push(
    ...geneRequestVoidStatements(db, {
      role: { caretaker_assignment_id: holderRole.caretaker_assignment_id, gene_symbol: symbol },
      accountId: request.holder_account_id,
      now,
      reason: endReason,
    }),
    ...geneRequestVoidStatements(db, {
      role: swap
        ? { caretaker_assignment_id: requesterRole.caretaker_assignment_id, gene_symbol: offered }
        : null,
      accountId: request.requester_account_id,
      now,
      reason: endReason,
    }),
    db
      .prepare(
        `INSERT INTO icono_caretaker_gene_request_notifications
           (notification_key, request_id, kind, recipient_account_id, gene_symbol)
         SELECT ?1 || ':accepted', ?1, 'accepted', ?3, ?4
          WHERE EXISTS (SELECT 1 FROM icono_caretaker_gene_requests
                         WHERE request_id = ?1 AND status = 'accepted' AND decided_at = ?2)
         ON CONFLICT (notification_key) DO NOTHING`,
      )
      .bind(request.request_id, now, request.requester_account_id, symbol),
  )
  try {
    // The partial unique indexes refuse a second open role for a gene or a
    // person, so a role that moved on since the reads above fails the whole
    // batch and nothing is half-written.
    await db.batch(statements)
  } catch (error) {
    if (!isConstraintError(error)) throw error
    throw unavailable("The caretakers changed while accepting; refresh the gene page")
  }
  const after = await first(
    db,
    `SELECT status, decided_at FROM icono_caretaker_gene_requests WHERE request_id = ?`,
    request.request_id,
  )
  if (after?.status !== "accepted")
    throw unavailable(`This request is already ${after?.status || "gone"}; refresh the gene page`)
  if (after.decided_at !== now) return settled(request, "accepted")
  const ended = await db
    .prepare(
      `SELECT gene_symbol FROM icono_caretaker_assignments
        WHERE caretaker_assignment_id IN (?, ?) AND supervote_asset_sha256 IS NOT NULL`,
    )
    .bind(holderRole.caretaker_assignment_id, requesterRole?.caretaker_assignment_id || "")
    .all()
  return {
    result: {
      ok: true,
      request_id: request.request_id,
      status: "accepted",
      mode: swap ? "swap" : "handover",
      canonical_symbol: symbol,
      ...(swap ? { offered_symbol: offered } : {}),
    },
    reElect: (ended?.results || []).map((row) => row.gene_symbol),
    notify: true,
  }
}
