import { sha256Hex } from "../../lib/iconoplasm-envelope-crypto.js"
import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeId,
  normalizePolicy,
  normalizeTimestamp,
} from "./manifestation-authority-contract.js"
import {
  assignmentSnapshot,
  canonicalSelectionRecord,
  commandInputs,
  eventPayload,
  eventStatement,
  first,
  prepared,
  readAssignmentManifestation,
  readFallback,
  readGene,
  readGeneAliases,
  readHead,
  requireDatabase,
  runCommand,
} from "./manifestation-authority-repository.js"
import { withdrawnManifestationPurgeEligibleAt } from "./manifestation-retention-policy.js"

const ACCOUNT_STATUSES = new Set(["active", "disabled", "erasure_pending", "tombstoned"])

function creditLabel(raw, fallback) {
  const value = String(raw ?? fallback ?? "").trim()
  if (value.length < 3 || value.length > 64 || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw authorityError("INVALID_PUBLIC_CREDIT_LABEL", "Public caretaker credit label is invalid")
  }
  return value
}

async function requestHash(input) {
  return sha256Hex(
    JSON.stringify({
      account_id: input.accountId,
      status: input.status,
      public_credit_label: input.publicCreditLabel ?? null,
      final_leave_policy: input.finalLeavePolicy ?? null,
      source_event_id: input.sourceEventId,
      source_event_sequence: Number(input.sourceEventSequence),
      occurred_at: input.occurredAt,
    }),
  )
}

async function readProjectionReceipt(db, sourceEventId, hash) {
  const row = await first(
    db,
    `SELECT request_sha256, response_json
       FROM icono_authority_account_projection_receipts WHERE source_event_id = ?`,
    sourceEventId,
  )
  if (!row) return null
  if (row.request_sha256 !== hash) {
    throw authorityError(
      "IDEMPOTENCY_KEY_REUSED",
      "Account source event was reused with different content",
      409,
    )
  }
  return Object.freeze({ ...JSON.parse(row.response_json), replayed: true })
}

function projectionReceipt(db, input, hash, response, timestamp) {
  return prepared(
    db,
    `INSERT INTO icono_authority_account_projection_receipts (
       source_event_id, source_event_sequence, account_id,
       request_sha256, response_json, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
    input.sourceEventId,
    input.sourceEventSequence,
    input.accountId,
    hash,
    JSON.stringify(response),
    timestamp,
  )
}

function accountUpdateStatement(db, account, target, label, input, timestamp) {
  return prepared(
    db,
    `UPDATE icono_authority_accounts
        SET public_credit_label = ?, status = ?, identity_version = identity_version + 1,
            source_event_sequence = ?, source_event_id = ?, updated_at = ?,
            disabled_at = CASE WHEN ? = 'disabled' THEN ? ELSE NULL END,
            erasure_requested_at = CASE
              WHEN ? IN ('erasure_pending', 'tombstoned')
                THEN COALESCE(erasure_requested_at, ?)
              ELSE NULL END,
            tombstoned_at = CASE WHEN ? = 'tombstoned' THEN ? ELSE NULL END
      WHERE account_id = ? AND identity_version = ? AND source_event_sequence < ?`,
    label,
    target,
    input.sourceEventSequence,
    input.sourceEventId,
    timestamp,
    target,
    timestamp,
    target,
    timestamp,
    target,
    timestamp,
    account.account_id,
    Number(account.identity_version),
    input.sourceEventSequence,
  )
}

async function currentAccount(db, accountId) {
  return first(
    db,
    `SELECT account_id, public_credit_label, status, identity_version,
            source_event_sequence, source_event_id
       FROM icono_authority_accounts WHERE account_id = ?`,
    accountId,
  )
}

async function latestAssignment(db, accountId) {
  return first(
    db,
    `SELECT assignment.*, account.public_credit_label AS account_public_credit_label,
            account.status AS account_status
       FROM icono_caretaker_assignments assignment
       JOIN icono_authority_accounts account ON account.account_id = assignment.account_id
      WHERE assignment.account_id = ?
      ORDER BY CASE WHEN assignment.status IN ('pending_acceptance','active','suspended')
                    THEN 0 ELSE 1 END,
               assignment.created_at DESC, assignment.caretaker_assignment_id DESC
      LIMIT 1`,
    accountId,
  )
}

function validateTransition(current, target) {
  if (current === "tombstoned" && target !== "tombstoned") {
    throw authorityError(
      "ACCOUNT_STATUS_TERMINAL",
      "A tombstoned account cannot be reactivated",
      409,
    )
  }
  if (current === "erasure_pending" && !["erasure_pending", "tombstoned"].includes(target)) {
    throw authorityError(
      "ACCOUNT_ERASURE_IN_PROGRESS",
      "Account erasure cannot be reversed here",
      409,
    )
  }
  if (target === "tombstoned" && current !== "erasure_pending" && current !== "tombstoned") {
    throw authorityError(
      "ACCOUNT_ERASURE_NOT_READY",
      "Account must finish erasure before tombstoning",
      409,
    )
  }
}

function assignmentTransition(assignment, target, timestamp, policy) {
  if (!assignment) return null
  const next = { ...assignment, account_status: target }
  if (target === "disabled" && assignment.status === "active") {
    return {
      ...next,
      status: "suspended",
      assignment_version: Number(assignment.assignment_version) + 1,
      suspended_at: timestamp,
      suspension_reason: "account_disabled",
    }
  }
  if (
    target === "active" &&
    assignment.status === "suspended" &&
    assignment.suspension_reason === "account_disabled"
  ) {
    return {
      ...next,
      status: "active",
      assignment_version: Number(assignment.assignment_version) + 1,
      suspended_at: null,
      suspension_reason: null,
    }
  }
  if (target === "erasure_pending" && assignment.status === "pending_acceptance") {
    return {
      ...next,
      status: "ended",
      assignment_version: Number(assignment.assignment_version) + 1,
      end_reason: "account_erasure_requested",
      ended_at: timestamp,
      relinquish_policy: null,
      suspended_at: null,
      suspension_reason: null,
    }
  }
  if (target === "erasure_pending" && ["active", "suspended"].includes(assignment.status)) {
    return {
      ...next,
      status: "ended",
      assignment_version: Number(assignment.assignment_version) + 1,
      end_reason: "account_erasure_requested",
      ended_at: timestamp,
      relinquish_policy: policy,
      suspended_at: null,
      suspension_reason: null,
    }
  }
  return next
}

function assignmentUpdateStatement(db, assignment, next, timestamp) {
  if (
    !assignment ||
    (assignment.status === next.status && assignment.assignment_version === next.assignment_version)
  )
    return null
  return prepared(
    db,
    `UPDATE icono_caretaker_assignments
        SET status = ?, assignment_version = ?, relinquish_policy = ?,
            suspended_at = ?, suspension_reason = ?, end_reason = ?, ended_at = ?,
            updated_at = ?
      WHERE caretaker_assignment_id = ? AND assignment_version = ? AND status = ?`,
    next.status,
    Number(next.assignment_version),
    next.relinquish_policy || null,
    next.suspended_at || null,
    next.suspension_reason || null,
    next.end_reason || null,
    next.ended_at || null,
    timestamp,
    assignment.caretaker_assignment_id,
    Number(assignment.assignment_version),
    assignment.status,
  )
}

async function insertWithoutGene(db, input, account, target, label, hash, timestamp) {
  const response = {
    ok: true,
    account_id: account.account_id,
    status: target,
    identity_version: Number(account.identity_version) + 1,
    source_event_sequence: input.sourceEventSequence,
    accepted_event_sequence: null,
  }
  try {
    await db.batch([
      accountUpdateStatement(db, account, target, label, input, timestamp),
      projectionReceipt(db, input, hash, response, timestamp),
    ])
  } catch (error) {
    const replay = await readProjectionReceipt(db, input.sourceEventId, hash)
    if (replay) return replay
    throw error
  }
  return Object.freeze({ ...response, replayed: false })
}

export async function projectAuthorityAccountStatus(db, rawInput = {}) {
  requireDatabase(db)
  const input = {
    accountId: normalizeId(rawInput.accountId, "account_id"),
    status: String(rawInput.status || "")
      .trim()
      .toLowerCase(),
    publicCreditLabel: rawInput.publicCreditLabel,
    finalLeavePolicy: rawInput.finalLeavePolicy,
    sourceEventId: normalizeId(rawInput.sourceEventId, "source_event_id"),
    sourceEventSequence: Number(rawInput.sourceEventSequence),
    occurredAt: normalizeTimestamp(rawInput.occurredAt),
  }
  if (!ACCOUNT_STATUSES.has(input.status)) {
    throw authorityError("INVALID_ACCOUNT_STATUS", "Account status is invalid")
  }
  if (!Number.isSafeInteger(input.sourceEventSequence) || input.sourceEventSequence < 1) {
    throw authorityError("INVALID_EVENT_SEQUENCE", "Source event sequence is invalid")
  }
  const hash = await requestHash(input)
  const replay = await readProjectionReceipt(db, input.sourceEventId, hash)
  if (replay) return replay
  const account = await currentAccount(db, input.accountId)
  if (!account) {
    throw authorityError(
      "ACCOUNT_NOT_REGISTERED",
      "Register the stable authority account first",
      404,
    )
  }
  if (input.sourceEventSequence <= Number(account.source_event_sequence)) {
    return Object.freeze({
      ok: true,
      applied: false,
      stale: true,
      account_id: account.account_id,
      status: account.status,
      identity_version: Number(account.identity_version),
      source_event_sequence: Number(account.source_event_sequence),
      replayed: false,
    })
  }
  validateTransition(account.status, input.status)
  const assignment = await latestAssignment(db, account.account_id)
  if (
    input.status === "tombstoned" &&
    assignment &&
    ["pending_acceptance", "active", "suspended"].includes(assignment.status)
  ) {
    throw authorityError(
      "ACCOUNT_HAS_OPEN_ASSIGNMENT",
      "End the open caretaker assignment before tombstoning",
      409,
    )
  }
  const needsPolicy =
    input.status === "erasure_pending" &&
    assignment &&
    ["active", "suspended"].includes(assignment.status)
  if (needsPolicy && input.finalLeavePolicy == null) {
    throw authorityError(
      "RELINQUISH_POLICY_CONFIRMATION_REQUIRED",
      "Erasure requires an explicit final leave policy",
    )
  }
  const policy = needsPolicy ? normalizePolicy(input.finalLeavePolicy) : null
  const timestamp = input.occurredAt
  const anonymous = `Former caretaker ${(await sha256Hex(account.account_id)).slice(0, 8).toUpperCase()}`
  const label =
    input.status === "tombstoned"
      ? anonymous
      : creditLabel(input.publicCreditLabel, account.public_credit_label)
  if (!assignment) {
    return insertWithoutGene(db, input, account, input.status, label, hash, timestamp)
  }

  const gene = await readGene(db, assignment.gene_id)
  gene.aliases = await readGeneAliases(db, gene.gene_id)
  const head = await readHead(db, gene.gene_id)
  const nextAssignment = assignmentTransition(assignment, input.status, timestamp, policy)
  nextAssignment.account_public_credit_label = label
  const manifestation = await readAssignmentManifestation(db, assignment.caretaker_assignment_id)
  const shouldWithdraw =
    input.status === "erasure_pending" &&
    policy === "withdraw" &&
    manifestation?.status === "active"
  const canonicalWithdraw =
    shouldWithdraw && head.canonical_manifestation_id === manifestation.manifestation_id
  const fallback = canonicalWithdraw
    ? await readFallback(db, gene.gene_id, [manifestation.manifestation_id])
    : null
  const idFactory = rawInput.idFactory || defaultIdFactory
  const selectionId = canonicalWithdraw
    ? createId(rawInput.selectionId, "canonical_selection_id", "selection", idFactory)
    : null
  const nextHead = canonicalWithdraw
    ? {
        ...head,
        canonical_manifestation_id: fallback.selected_manifestation_id,
        canonical_revision_id: fallback.selected_revision_id,
        canonical_selection_id: selectionId,
        head_version: Number(head.head_version) + 1,
        gene_revision: Number(head.gene_revision) + 1,
      }
    : { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const changedSelection = canonicalWithdraw
    ? canonicalSelectionRecord({
        selectionId,
        geneId: gene.gene_id,
        head,
        nextHead,
        manifestationId: fallback.selected_manifestation_id,
        revisionId: fallback.selected_revision_id,
        actorAccountId: null,
        assignmentId: assignment.caretaker_assignment_id,
        reason: "assignment_end_fallback",
        commandId: input.sourceEventId,
        timestamp,
      })
    : null
  const nextManifestation = shouldWithdraw
    ? { ...manifestation, status: "withdrawn", row_version: Number(manifestation.row_version) + 1 }
    : manifestation
  const response = {
    ok: true,
    applied: true,
    account_id: account.account_id,
    status: input.status,
    identity_version: Number(account.identity_version) + 1,
    source_event_sequence: input.sourceEventSequence,
    caretaker_assignment_id: assignment.caretaker_assignment_id,
    assignment_status: nextAssignment.status,
    assignment_version: Number(nextAssignment.assignment_version),
    relinquish_policy: nextAssignment.relinquish_policy || null,
    canonical_revision_id: nextHead.canonical_revision_id || null,
    head_version: Number(nextHead.head_version),
    gene_revision: Number(nextHead.gene_revision),
  }
  const cmd = commandInputs({
    commandId: input.sourceEventId,
    requestSha256: hash,
    actorKind: "service",
    actorAccountId: null,
  })
  const statements = [
    accountUpdateStatement(db, account, input.status, label, input, timestamp),
    projectionReceipt(db, input, hash, response, timestamp),
  ]
  const updateAssignment = assignmentUpdateStatement(db, assignment, nextAssignment, timestamp)
  if (updateAssignment) statements.push(updateAssignment)
  if (shouldWithdraw) {
    statements.push(
      prepared(
        db,
        `UPDATE icono_manifestations
            SET status = 'withdrawn', withdrawn_at = ?, purge_eligible_at = ?,
                withdrawal_reason = 'account_erasure',
                row_version = row_version + 1, updated_at = ?
          WHERE manifestation_id = ? AND status = 'active'`,
        timestamp,
        withdrawnManifestationPurgeEligibleAt(timestamp),
        timestamp,
        manifestation.manifestation_id,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_revision_lifecycle
            SET status = 'withdrawn', lifecycle_version = lifecycle_version + 1,
                change_reason = 'account_erasure', changed_at = ?
          WHERE manifestation_revision_id IN (
            SELECT manifestation_revision_id FROM icono_manifestation_revisions
             WHERE manifestation_id = ?
          ) AND status = 'active'`,
        timestamp,
        manifestation.manifestation_id,
      ),
    )
  }
  if (canonicalWithdraw) {
    statements.push(
      prepared(
        db,
        `INSERT INTO icono_manifestation_canonical_selections (
         canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
         selected_manifestation_id, selected_revision_id, actor_account_id,
         caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, 'assignment_end_fallback', ?, ?, ?, ?)`,
        selectionId,
        gene.gene_id,
        head.canonical_selection_id,
        head.canonical_revision_id,
        fallback.selected_manifestation_id,
        fallback.selected_revision_id,
        assignment.caretaker_assignment_id,
        cmd.commandId,
        nextHead.head_version,
        nextHead.gene_revision,
        timestamp,
      ),
    )
  } else {
    statements.push(
      prepared(
        db,
        `UPDATE icono_manifestation_heads SET gene_revision = gene_revision + 1, updated_at = ?
        WHERE gene_id = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        Number(head.gene_revision),
      ),
    )
  }
  statements.push(
    eventStatement(db, {
      eventUuid: createId(rawInput.authorityEventId, "event_uuid", "event", idFactory),
      commandId: cmd.commandId,
      geneId: gene.gene_id,
      geneRevision: nextHead.gene_revision,
      manifestationId: manifestation?.manifestation_id || null,
      selectionId,
      assignmentId: assignment.caretaker_assignment_id,
      payloadJson: eventPayload({
        cause: `authority.account_${input.status}`,
        gene,
        head: nextHead,
        assignment: nextAssignment,
        manifestation: nextManifestation,
        changedSelection,
        tombstones: shouldWithdraw
          ? [
              {
                entity_type: "manifestation",
                entity_id: manifestation.manifestation_id,
                state: "withdrawn",
              },
            ]
          : input.status === "tombstoned"
            ? [
                {
                  entity_type: "authority_account",
                  entity_id: account.account_id,
                  state: "tombstoned",
                },
              ]
            : [],
      }),
    }),
  )
  return runCommand({
    db,
    ...cmd,
    commandType: "authority.account_status_projected",
    geneId: gene.gene_id,
    response,
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_authority_accounts account
        JOIN icono_manifestation_heads head ON head.gene_id = ?
        WHERE account.account_id = ? AND account.identity_version = ?
          AND account.source_event_sequence < ? AND head.gene_revision = ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      gene.gene_id,
      account.account_id,
      Number(account.identity_version),
      input.sourceEventSequence,
      Number(head.gene_revision),
    ],
    statements,
  })
}
