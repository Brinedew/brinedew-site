import {
  VOTE_DAILY_BUDGET_EXHAUSTED,
  VOTE_DAILY_BUDGET_MESSAGE,
  VOTE_DAILY_LIMIT,
  geneVoteVersionBumpStatement,
  isVoteDailyBudgetRefusal,
  voteDailyBudgetStatement,
} from "../votes/vote-guards.js"

export const CARETAKER_SUPERVOTE_WEIGHT = 10
export const CARETAKER_SUPERVOTE_DIRECTIONS = Object.freeze([-1, 1])

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ASSIGNMENT_STATUSES = new Set(["pending_acceptance", "active", "suspended", "ended"])

export class CaretakerSupervoteError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = "CaretakerSupervoteError"
    this.code = code
    this.status = status
  }
}

function fail(code, message, status = 400) {
  throw new CaretakerSupervoteError(code, message, status)
}

function normalizeId(value, field) {
  const normalized = String(value || "").trim()
  if (!ID_PATTERN.test(normalized)) fail("INVALID_SUPERVOTE_INPUT", `${field} is invalid`)
  return normalized
}

function normalizeSymbol(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
  if (!SYMBOL_PATTERN.test(normalized)) fail("INVALID_SUPERVOTE_INPUT", "gene_symbol is invalid")
  return normalized
}

function normalizeSha256(value, { optional = false } = {}) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
  if (optional && !normalized) return null
  if (!SHA256_PATTERN.test(normalized)) {
    fail("INVALID_SUPERVOTE_INPUT", "asset_sha256 is invalid")
  }
  return normalized
}

function normalizeVersion(value, field, { minimum = 0 } = {}) {
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < minimum) {
    fail("INVALID_SUPERVOTE_INPUT", `${field} is invalid`)
  }
  return normalized
}

function normalizeRequestSha256(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
  if (!SHA256_PATTERN.test(normalized)) {
    fail("INVALID_SUPERVOTE_INPUT", "request_sha256 is invalid")
  }
  return normalized
}

function normalizeDirection(value, { optional = false } = {}) {
  if (optional && (value == null || value === "")) return null
  const normalized = Number(value)
  if (!CARETAKER_SUPERVOTE_DIRECTIONS.includes(normalized)) {
    fail("INVALID_SUPERVOTE_INPUT", "direction must be -1 or 1")
  }
  return normalized
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(String(value || ""))
  } catch {
    return fallback
  }
}

function normalizeAssignmentEvent(rawEvent) {
  const event = rawEvent && typeof rawEvent === "object" ? rawEvent : {}
  const gene = event.gene && typeof event.gene === "object" ? event.gene : {}
  const assignment =
    event.assignment && typeof event.assignment === "object" ? event.assignment : {}
  const status = String(assignment.status || event.assignment_status || "")
    .trim()
    .toLowerCase()
  if (!ASSIGNMENT_STATUSES.has(status)) {
    fail("INVALID_ASSIGNMENT_PROJECTION", "Assignment status is invalid")
  }
  return {
    event_id: normalizeId(event.event_id || event.event_uuid, "event_id"),
    event_sequence: normalizeVersion(event.event_sequence, "event_sequence", { minimum: 1 }),
    gene_id: normalizeId(gene.gene_id || event.gene_id, "gene_id"),
    gene_symbol: normalizeSymbol(
      gene.canonical_symbol || gene.symbol || event.canonical_symbol || event.gene_symbol,
    ),
    caretaker_assignment_id: normalizeId(
      assignment.caretaker_assignment_id || event.caretaker_assignment_id,
      "caretaker_assignment_id",
    ),
    caretaker_account_id: normalizeId(
      assignment.account_id || event.caretaker_account_id || event.account_id,
      "caretaker_account_id",
    ),
    status,
    assignment_version: normalizeVersion(
      assignment.assignment_version ?? event.assignment_version,
      "assignment_version",
      { minimum: 1 },
    ),
  }
}

function assignmentEventType(previousStatus, nextStatus) {
  if (nextStatus === "ended") return "assignment_ended"
  if (nextStatus === "suspended") return "assignment_suspended"
  if (previousStatus === "suspended" && nextStatus === "active") return "assignment_resumed"
  return "assignment_projected"
}

function activeSelection(assignment, head) {
  return Boolean(
    head?.asset_sha256 &&
    CARETAKER_SUPERVOTE_DIRECTIONS.includes(Number(head?.direction)) &&
    assignment &&
    ["active", "suspended"].includes(String(assignment.status || "")),
  )
}

function assignmentSnapshot(row) {
  if (!row) return null
  return {
    gene_id: String(row.gene_id),
    gene_symbol: String(row.gene_symbol),
    caretaker_assignment_id: String(row.caretaker_assignment_id),
    caretaker_account_id: String(row.caretaker_account_id),
    status: String(row.status),
    assignment_version: Number(row.assignment_version),
    authority_event_id: String(row.authority_event_id),
    authority_event_sequence: Number(row.authority_event_sequence),
  }
}

function supervoteSnapshot(assignment, head, viewerAccountId = "") {
  const selected = activeSelection(assignment, head)
  const accountId = String(viewerAccountId || "").trim()
  return {
    schema_version: 2,
    assignment: assignmentSnapshot(assignment),
    assignment_status: assignment ? String(assignment.status) : null,
    assignment_version: Number(assignment?.assignment_version || 0),
    accepted_event_sequence: Number(assignment?.authority_event_sequence || 0),
    supervote_version: Number(head?.supervote_version || 0),
    asset_sha256: selected ? String(head.asset_sha256) : null,
    direction: selected ? Number(head.direction) : null,
    active: selected,
    suspended: String(assignment?.status || "") === "suspended",
    weight: CARETAKER_SUPERVOTE_WEIGHT,
    can_mutate: Boolean(
      assignment && assignment.status === "active" && accountId === assignment.caretaker_account_id,
    ),
  }
}

export async function caretakerSupervoteRequestSha256(fields) {
  const source = fields && typeof fields === "object" ? fields : {}
  const canonical = JSON.stringify({
    command_id: String(source.command_id || ""),
    gene_symbol: normalizeSymbol(source.gene_symbol),
    caretaker_account_id: normalizeId(source.caretaker_account_id, "caretaker_account_id"),
    asset_sha256: normalizeSha256(source.asset_sha256, { optional: true }),
    direction: normalizeDirection(source.direction, {
      optional: !normalizeSha256(source.asset_sha256, { optional: true }),
    }),
    expected_assignment_version: normalizeVersion(
      source.expected_assignment_version,
      "expected_assignment_version",
      { minimum: 1 },
    ),
    expected_supervote_version: normalizeVersion(
      source.expected_supervote_version,
      "expected_supervote_version",
    ),
  })
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
}

export function caretakerWeightedScore(row) {
  const ordinaryScore = Number(row?.score ?? row?.image_score ?? 0) || 0
  const direction = row?.caretaker_supervote
    ? normalizeDirection(row?.caretaker_supervote_direction ?? 1)
    : 0
  return ordinaryScore + direction * CARETAKER_SUPERVOTE_WEIGHT
}

export function compareCaretakerWeightedCandidates(left, right, fallback = () => 0) {
  return (
    caretakerWeightedScore(right) - caretakerWeightedScore(left) ||
    Number(
      (right?.caretaker_supervote_direction ?? (right?.caretaker_supervote ? 1 : null)) === 1,
    ) -
      Number(
        (left?.caretaker_supervote_direction ?? (left?.caretaker_supervote ? 1 : null)) === 1,
      ) ||
    fallback(left, right)
  )
}

// B-898 Stage 2: the caretaker supervote lives in D1 alone. The assignment
// projection (one row per gene), the supervote head (one row per gene, with
// its compare-and-set version), the audit events and the idempotency receipts
// are the D1 tables migration 0085 created; candidate eligibility is the
// trigger-maintained projection from migration 0088. Each write batch is
// guarded so a concurrent command can only make it a no-op, never a torn
// write.

const STATE_SQL = `SELECT a.gene_id, a.gene_symbol, a.caretaker_assignment_id, a.caretaker_account_id,
       a.status, a.assignment_version, a.authority_event_id, a.authority_event_sequence,
       s.asset_sha256 AS head_asset_sha256, s.direction AS head_direction,
       s.active AS head_active, s.supervote_version AS head_supervote_version
  FROM icono_caretaker_vote_assignment_projection a
  LEFT JOIN icono_caretaker_supervote_projection s ON s.gene_symbol = a.gene_symbol
 WHERE a.gene_symbol = ?1
 LIMIT 1`

function stateFromRow(row) {
  if (!row) return { assignment: null, head: { supervote_version: 0, asset_sha256: null } }
  const active = Number(row.head_active) === 1
  return {
    assignment: {
      gene_id: row.gene_id,
      gene_symbol: row.gene_symbol,
      caretaker_assignment_id: row.caretaker_assignment_id,
      caretaker_account_id: row.caretaker_account_id,
      status: row.status,
      assignment_version: Number(row.assignment_version),
      authority_event_id: row.authority_event_id,
      authority_event_sequence: Number(row.authority_event_sequence),
    },
    head: {
      asset_sha256: active ? row.head_asset_sha256 : null,
      direction: active ? Number(row.head_direction) : null,
      supervote_version: Number(row.head_supervote_version || 0),
    },
  }
}

export async function readCaretakerSupervoteFromD1(db, symbol, viewerAccountId = "") {
  const geneSymbol = normalizeSymbol(symbol)
  const state = stateFromRow(await db.prepare(STATE_SQL).bind(geneSymbol).first())
  return {
    ...state,
    snapshot: supervoteSnapshot(state.assignment, state.head, viewerAccountId),
  }
}

function supervoteProjectionUpsert(db, values) {
  return db
    .prepare(
      `INSERT INTO icono_caretaker_supervote_projection (
         gene_symbol, gene_id, caretaker_assignment_id, caretaker_account_id,
         asset_sha256, direction, active, weight, supervote_version,
         last_mutation_id, updated_at, deactivated_at
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, 10, ?8, ?9, CURRENT_TIMESTAMP,
              CASE WHEN ?7 = 1 THEN NULL ELSE CURRENT_TIMESTAMP END
        WHERE ${values.guardSql}
       ON CONFLICT(gene_symbol) DO UPDATE SET
         gene_id = excluded.gene_id,
         caretaker_assignment_id = excluded.caretaker_assignment_id,
         caretaker_account_id = excluded.caretaker_account_id,
         asset_sha256 = excluded.asset_sha256,
         direction = excluded.direction,
         active = excluded.active,
         weight = 10,
         supervote_version = excluded.supervote_version,
         last_mutation_id = excluded.last_mutation_id,
         updated_at = CURRENT_TIMESTAMP,
         deactivated_at = excluded.deactivated_at`,
    )
    .bind(
      values.symbol,
      values.geneId,
      values.assignmentId,
      values.accountId,
      values.asset,
      values.direction,
      values.asset ? 1 : 0,
      values.version,
      values.mutationId,
      ...values.guardArgs,
    )
}

function supervoteEventInsert(db, values) {
  return db
    .prepare(
      `INSERT INTO icono_caretaker_supervote_events (
         mutation_id, event_type, command_id, request_sha256,
         gene_id, gene_symbol, caretaker_assignment_id, caretaker_account_id,
         assignment_status, assignment_version, from_asset_sha256,
         to_asset_sha256, from_direction, to_direction,
         supervote_version, authority_event_id, authority_event_sequence, created_at
       )
       SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17,
              CURRENT_TIMESTAMP
        WHERE EXISTS (
          SELECT 1 FROM icono_caretaker_supervote_projection
           WHERE gene_symbol = ?6 AND last_mutation_id = ?1
        )
       ON CONFLICT(mutation_id) DO NOTHING`,
    )
    .bind(
      values.mutationId,
      values.eventType,
      values.commandId || null,
      values.requestSha256 || null,
      values.assignment.gene_id,
      values.symbol,
      values.assignment.caretaker_assignment_id,
      values.assignment.caretaker_account_id,
      values.assignment.status,
      values.assignment.assignment_version,
      values.fromAsset,
      values.toAsset,
      values.fromDirection,
      values.toDirection,
      values.version,
      values.assignment.authority_event_id,
      values.assignment.authority_event_sequence,
    )
}

function appliedMutationGuard(db, symbol, mutationId) {
  return geneVoteVersionBumpStatement(db, symbol, {
    whenSql:
      "EXISTS (SELECT 1 FROM icono_caretaker_supervote_projection WHERE gene_symbol = ?1 AND last_mutation_id = ?2)",
    whenArgs: [mutationId],
  })
}

/**
 * The caretaker's signed 10x vote: move, confirm or clear it. Compare-and-set
 * on the assignment version and the supervote version the caller last saw;
 * every accepted command advances the supervote version and leaves a receipt,
 * so an identical retry replays the receipt and a reused command id with a
 * different request is refused. A target must be an eligible candidate of
 * this gene in the trigger-maintained eligibility projection.
 *
 * A supervote spends one unit of the daily vote budget it shares with reader
 * votes (vote-guards.js). Once the day is spent the write batch is refused
 * whole, nothing is written, and the caller gets a 429.
 */
export async function setCaretakerSupervoteInD1(
  db,
  {
    symbol,
    accountId,
    assetSha256 = null,
    direction = null,
    commandId,
    requestSha256,
    expectedAssignmentVersion,
    expectedSupervoteVersion,
  } = {},
  { attempt = 1, dailyVoteLimit = VOTE_DAILY_LIMIT } = {},
) {
  const geneSymbol = normalizeSymbol(symbol)
  const account = normalizeId(accountId, "caretaker_account_id")
  const targetAsset = normalizeSha256(assetSha256, { optional: true })
  const targetDirection = targetAsset ? normalizeDirection(direction) : null
  const command = normalizeId(commandId, "command_id")
  const requestHash = normalizeRequestSha256(requestSha256)
  const expectedAssignment = normalizeVersion(
    expectedAssignmentVersion,
    "expected_assignment_version",
    { minimum: 1 },
  )
  const expectedSupervote = normalizeVersion(expectedSupervoteVersion, "expected_supervote_version")

  const reads = [
    db
      .prepare(
        `SELECT request_sha256, response_json FROM icono_caretaker_supervote_command_receipts
          WHERE command_id = ?1 LIMIT 1`,
      )
      .bind(command),
    db.prepare(STATE_SQL).bind(geneSymbol),
  ]
  if (targetAsset) {
    reads.push(
      db
        .prepare(
          `SELECT eligible FROM icono_caretaker_candidate_eligibility_projection
            WHERE gene_symbol = ?1 AND asset_sha256 = ?2 LIMIT 1`,
        )
        .bind(geneSymbol, targetAsset),
    )
  }
  const [receiptRead, stateRead, eligibilityRead] = await db.batch(reads)
  if (targetAsset && Number(eligibilityRead?.results?.[0]?.eligible) !== 1) {
    fail(
      "SUPERVOTE_TARGET_INELIGIBLE",
      "Caretaker supervotes require an eligible, current candidate blot",
      409,
    )
  }
  const receipt = receiptRead?.results?.[0] || null
  if (receipt) {
    if (receipt.request_sha256 !== requestHash) {
      fail("COMMAND_ID_CONFLICT", "command_id was already used for another request", 409)
    }
    return { ...parseJson(receipt.response_json, {}), replayed: true }
  }
  const { assignment, head } = stateFromRow(stateRead?.results?.[0])
  if (!assignment) fail("CARETAKER_ASSIGNMENT_REQUIRED", "Caretaker assignment is missing", 403)
  if (assignment.status === "suspended") {
    fail("CARETAKER_ASSIGNMENT_SUSPENDED", "Suspended caretakers cannot move the supervote", 409)
  }
  if (assignment.status !== "active") {
    fail("CARETAKER_ASSIGNMENT_INACTIVE", "An active caretaker assignment is required", 403)
  }
  if (assignment.caretaker_account_id !== account) {
    fail("CARETAKER_ASSIGNMENT_NOT_OWNED", "Only this gene's caretaker can move the supervote", 403)
  }
  if (Number(assignment.assignment_version) !== expectedAssignment) {
    fail("STALE_ASSIGNMENT_STATE", "Caretaker assignment changed", 409)
  }
  if (Number(head.supervote_version || 0) !== expectedSupervote) {
    fail("STALE_SUPERVOTE_STATE", "Caretaker supervote changed", 409)
  }

  const previousAsset = head.asset_sha256 || null
  const previousDirection = previousAsset ? normalizeDirection(head.direction ?? 1) : null
  const changed = previousAsset !== targetAsset || previousDirection !== targetDirection
  // Every accepted command advances the CAS token, so a receipt that leaves
  // the replay horizon can never execute its command a second time.
  const nextVersion = Number(head.supervote_version || 0) + 1
  const eventType = targetAsset
    ? previousAsset
      ? changed
        ? "supervote_moved"
        : "supervote_confirmed"
      : "supervote_set"
    : "supervote_cleared"
  const mutationId = `caretaker-supervote:${command}`
  const nextHead = {
    asset_sha256: targetAsset,
    direction: targetDirection,
    supervote_version: nextVersion,
  }
  const response = {
    ok: true,
    changed,
    replayed: false,
    mutation_id: mutationId,
    accepted_event_sequence: Number(assignment.authority_event_sequence),
    supervote: supervoteSnapshot(assignment, nextHead, account),
  }
  let results
  try {
    results = await db.batch([
      voteDailyBudgetStatement(db, 1, dailyVoteLimit),
      supervoteProjectionUpsert(db, {
        symbol: geneSymbol,
        geneId: assignment.gene_id,
        assignmentId: assignment.caretaker_assignment_id,
        accountId: account,
        asset: targetAsset,
        direction: targetDirection,
        version: nextVersion,
        mutationId,
        guardSql: `EXISTS (
          SELECT 1 FROM icono_caretaker_vote_assignment_projection
           WHERE gene_symbol = ?1 AND caretaker_assignment_id = ?3 AND caretaker_account_id = ?4
             AND status = 'active' AND assignment_version = ?10
        )
        AND COALESCE((SELECT supervote_version FROM icono_caretaker_supervote_projection
                       WHERE gene_symbol = ?1), 0) = ?11
        AND NOT EXISTS (
          SELECT 1 FROM icono_caretaker_supervote_command_receipts WHERE command_id = ?12
        )`,
        guardArgs: [expectedAssignment, expectedSupervote, command],
      }),
      supervoteEventInsert(db, {
        mutationId,
        eventType,
        commandId: command,
        requestSha256: requestHash,
        symbol: geneSymbol,
        assignment,
        fromAsset: previousAsset,
        toAsset: targetAsset,
        fromDirection: previousDirection,
        toDirection: targetDirection,
        version: nextVersion,
      }),
      db
        .prepare(
          `INSERT INTO icono_caretaker_supervote_command_receipts (
           command_id, request_sha256, mutation_id, response_json,
           accepted_event_sequence, created_at
         )
         SELECT ?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP
          WHERE EXISTS (
            SELECT 1 FROM icono_caretaker_supervote_projection
             WHERE gene_symbol = ?6 AND last_mutation_id = ?3
          )`,
        )
        .bind(
          command,
          requestHash,
          mutationId,
          JSON.stringify(response),
          Number(assignment.authority_event_sequence),
          geneSymbol,
        ),
      appliedMutationGuard(db, geneSymbol, mutationId),
    ])
  } catch (error) {
    if (isVoteDailyBudgetRefusal(error))
      fail(VOTE_DAILY_BUDGET_EXHAUSTED, VOTE_DAILY_BUDGET_MESSAGE, 429)
    throw error
  }
  if (Number(results?.[1]?.meta?.changes || 0) > 0) return response
  // A concurrent command won the compare-and-set between the read and the
  // write. Re-read once: an identical command replays its receipt, anything
  // else reports the state that changed.
  if (attempt < 2) {
    return setCaretakerSupervoteInD1(
      db,
      {
        symbol: geneSymbol,
        accountId: account,
        assetSha256: targetAsset,
        direction: targetDirection,
        commandId: command,
        requestSha256: requestHash,
        expectedAssignmentVersion: expectedAssignment,
        expectedSupervoteVersion: expectedSupervote,
      },
      { attempt: attempt + 1, dailyVoteLimit },
    )
  }
  fail("STALE_SUPERVOTE_STATE", "Caretaker supervote changed", 409)
}

/**
 * Projects one accepted caretaker assignment event (from the manifestation
 * authority outbox) into D1. Sequence and version may only move forward; a
 * different assignment replaces only an ended one. Ending or replacing the
 * assignment clears its supervote. Returns whether the supervote changed, so
 * the caller can re-run the gene's election.
 */
export async function projectCaretakerAssignmentInD1(db, rawEvent) {
  const event = normalizeAssignmentEvent(rawEvent)
  const { assignment: current, head } = stateFromRow(
    await db.prepare(STATE_SQL).bind(event.gene_symbol).first(),
  )
  if (current) {
    const currentSequence = Number(current.authority_event_sequence)
    if (event.event_sequence === currentSequence) {
      if (event.event_id !== current.authority_event_id) {
        fail("ASSIGNMENT_EVENT_CONFLICT", "Event sequence already has another event", 409)
      }
      return { ok: true, changed: false, replayed: true, supervote_changed: false }
    }
    if (event.event_sequence < currentSequence) {
      fail("STALE_ASSIGNMENT_EVENT", "Assignment projection cannot move backward", 409)
    }
    if (event.gene_id !== current.gene_id) {
      fail("ASSIGNMENT_GENE_MISMATCH", "Stable gene identity changed", 409)
    }
    if (
      event.caretaker_assignment_id === current.caretaker_assignment_id &&
      event.assignment_version === Number(current.assignment_version)
    ) {
      if (
        event.caretaker_account_id !== current.caretaker_account_id ||
        event.status !== current.status ||
        event.gene_symbol !== String(current.gene_symbol || "").toUpperCase()
      ) {
        fail(
          "ASSIGNMENT_SNAPSHOT_CONFLICT",
          "Assignment version already represents different authority state",
          409,
        )
      }
      return { ok: true, changed: false, replayed: true, supervote_changed: false }
    }
    if (
      event.caretaker_assignment_id === current.caretaker_assignment_id &&
      event.assignment_version < Number(current.assignment_version)
    ) {
      fail("STALE_ASSIGNMENT_EVENT", "Assignment version cannot move backward", 409)
    }
    if (
      event.caretaker_assignment_id !== current.caretaker_assignment_id &&
      current.status !== "ended"
    ) {
      fail("ASSIGNMENT_REPLACEMENT_CONFLICT", "Open assignment must end before replacement", 409)
    }
  }

  const previousAsset = head.asset_sha256 || null
  const previousDirection = previousAsset ? normalizeDirection(head.direction ?? 1) : null
  const assignmentChanged = Boolean(
    current && event.caretaker_assignment_id !== current.caretaker_assignment_id,
  )
  const mustDeactivate = event.status === "ended" || assignmentChanged
  const nextAsset = mustDeactivate ? null : previousAsset
  const nextDirection = mustDeactivate ? null : previousDirection
  const supervoteChanged = Boolean(previousAsset && mustDeactivate)
  const nextVersion = Number(head.supervote_version || 0) + Number(supervoteChanged)
  const mutationId = `caretaker-assignment:${event.event_id}`
  const nextAssignment = {
    gene_id: event.gene_id,
    gene_symbol: event.gene_symbol,
    caretaker_assignment_id: event.caretaker_assignment_id,
    caretaker_account_id: event.caretaker_account_id,
    status: event.status,
    assignment_version: event.assignment_version,
    authority_event_id: event.event_id,
    authority_event_sequence: event.event_sequence,
  }
  const statements = [
    db
      .prepare(
        `INSERT INTO icono_caretaker_vote_assignment_projection (
           gene_symbol, gene_id, caretaker_assignment_id, caretaker_account_id,
           status, assignment_version, authority_event_id,
           authority_event_sequence, projected_at
         )
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP
          WHERE COALESCE((SELECT authority_event_sequence
                            FROM icono_caretaker_vote_assignment_projection
                           WHERE gene_symbol = ?1), 0) = ?9
         ON CONFLICT(gene_symbol) DO UPDATE SET
           gene_id = excluded.gene_id,
           caretaker_assignment_id = excluded.caretaker_assignment_id,
           caretaker_account_id = excluded.caretaker_account_id,
           status = excluded.status,
           assignment_version = excluded.assignment_version,
           authority_event_id = excluded.authority_event_id,
           authority_event_sequence = excluded.authority_event_sequence,
           projected_at = CURRENT_TIMESTAMP`,
      )
      .bind(
        event.gene_symbol,
        event.gene_id,
        event.caretaker_assignment_id,
        event.caretaker_account_id,
        event.status,
        event.assignment_version,
        event.event_id,
        event.event_sequence,
        Number(current?.authority_event_sequence || 0),
      ),
    supervoteProjectionUpsert(db, {
      symbol: event.gene_symbol,
      geneId: event.gene_id,
      assignmentId: event.caretaker_assignment_id,
      accountId: event.caretaker_account_id,
      asset: nextAsset,
      direction: nextDirection,
      version: nextVersion,
      mutationId,
      guardSql: `EXISTS (
          SELECT 1 FROM icono_caretaker_vote_assignment_projection
           WHERE gene_symbol = ?1 AND authority_event_id = ?10
        )`,
      guardArgs: [event.event_id],
    }),
    supervoteEventInsert(db, {
      mutationId,
      eventType: assignmentEventType(String(current?.status || ""), event.status),
      symbol: event.gene_symbol,
      assignment: nextAssignment,
      fromAsset: previousAsset,
      toAsset: nextAsset,
      fromDirection: previousDirection,
      toDirection: nextDirection,
      version: nextVersion,
    }),
  ]
  if (supervoteChanged) statements.push(appliedMutationGuard(db, event.gene_symbol, mutationId))
  const results = await db.batch(statements)
  const changed = Number(results?.[0]?.meta?.changes || 0) > 0
  if (!changed) fail("STALE_ASSIGNMENT_EVENT", "Assignment projection moved concurrently", 409)
  return {
    ok: true,
    changed: true,
    replayed: false,
    symbol: event.gene_symbol,
    supervote_changed: supervoteChanged,
  }
}

/**
 * A candidate stopped being eligible (rejected, marked legacy, purged): a
 * supervote that names it is cleared. The eligibility
 * projection is maintained by D1 triggers on every candidate write; if the
 * supervote names this asset and the projection does not say ineligible, the
 * trigger chain is broken and the call fails loudly instead of guessing.
 */
export async function invalidateCaretakerSupervoteInD1(db, { symbol, assetSha256 } = {}) {
  const geneSymbol = normalizeSymbol(symbol)
  const asset = normalizeSha256(assetSha256)
  const [stateRead, eligibilityRead] = await db.batch([
    db.prepare(STATE_SQL).bind(geneSymbol),
    db
      .prepare(
        `SELECT eligible, source_event_sequence
           FROM icono_caretaker_candidate_eligibility_projection
          WHERE gene_symbol = ?1 AND asset_sha256 = ?2 LIMIT 1`,
      )
      .bind(geneSymbol, asset),
  ])
  const { assignment, head } = stateFromRow(stateRead?.results?.[0])
  if (!assignment || head.asset_sha256 !== asset) {
    return { ok: true, selection_cleared: false }
  }
  const eligibility = eligibilityRead?.results?.[0] || null
  if (!eligibility || Number(eligibility.eligible) !== 0) {
    fail(
      "CANDIDATE_INELIGIBILITY_PROJECTION_MISSING",
      "Candidate mutation did not produce an exact ineligible projection",
      503,
    )
  }
  const mutationId = `caretaker-supervote-eligibility:candidate-eligibility:${Number(
    eligibility.source_event_sequence,
  )}`
  const nextVersion = Number(head.supervote_version || 0) + 1
  const previousDirection = normalizeDirection(head.direction ?? 1)
  const results = await db.batch([
    supervoteProjectionUpsert(db, {
      symbol: geneSymbol,
      geneId: assignment.gene_id,
      assignmentId: assignment.caretaker_assignment_id,
      accountId: assignment.caretaker_account_id,
      asset: null,
      direction: null,
      version: nextVersion,
      mutationId,
      guardSql: `EXISTS (
          SELECT 1 FROM icono_caretaker_supervote_projection
           WHERE gene_symbol = ?1 AND active = 1 AND asset_sha256 = ?10
             AND supervote_version = ?11
        )`,
      guardArgs: [asset, Number(head.supervote_version || 0)],
    }),
    supervoteEventInsert(db, {
      mutationId,
      eventType: "supervote_asset_invalidated",
      symbol: geneSymbol,
      assignment,
      fromAsset: asset,
      toAsset: null,
      fromDirection: previousDirection,
      toDirection: null,
      version: nextVersion,
    }),
    appliedMutationGuard(db, geneSymbol, mutationId),
  ])
  return {
    ok: true,
    selection_cleared: Number(results?.[0]?.meta?.changes || 0) > 0,
    mutation_id: mutationId,
  }
}

export { normalizeAssignmentEvent, supervoteSnapshot }
