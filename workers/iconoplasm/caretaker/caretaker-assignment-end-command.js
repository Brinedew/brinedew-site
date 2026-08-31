import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeActorKind,
  normalizeId,
  normalizeOptionalId,
  normalizePolicy,
  normalizeTimestamp,
  normalizeVersion,
} from "./manifestation-authority-contract.js"
import {
  canonicalSelectionRecord,
  commandInputs,
  eventPayload,
  eventStatement,
  prepared,
  readAssignmentManifestation,
  readFallback,
  readHead,
  requireActiveAccount,
  requireActiveGene,
  requireAssignment,
  requireDatabase,
  resolveCommandReplay,
  runCommand,
} from "./manifestation-authority-repository.js"
import { withdrawnManifestationPurgeEligibleAt } from "./manifestation-retention-policy.js"

export async function endCaretakerAssignment(
  db,
  {
    assignmentId,
    expectedAssignmentVersion,
    expectedHeadVersion,
    expectedCanonicalRevisionId,
    relinquishPolicy,
    reason = "caretaker_resigned",
    selectionId,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const replayActorKind = normalizeActorKind(command.actorKind || "account")
  const replay = await resolveCommandReplay(db, command, {
    actorKind: replayActorKind,
    actorAccountId: command.actorAccountId,
  })
  if (replay) return replay
  const assignment = await requireAssignment(db, assignmentId)
  if (assignment.status === "ended") {
    throw authorityError("ASSIGNMENT_ALREADY_ENDED", "Caretaker assignment has already ended", 409)
  }
  if (!["active", "suspended"].includes(assignment.status)) {
    throw authorityError(
      "INVALID_ASSIGNMENT_TRANSITION",
      "Only an accepted caretaker assignment can be ended",
      409,
    )
  }
  const actorKind = normalizeActorKind(command.actorKind || "account")
  const actorAccountId =
    actorKind === "service"
      ? normalizeOptionalId(command.actorAccountId, "actor_account_id")
      : normalizeId(command.actorAccountId, "actor_account_id")
  if (actorAccountId) await requireActiveAccount(db, actorAccountId)
  if (actorKind === "account" && assignment.account_id !== actorAccountId) {
    throw authorityError(
      "ASSIGNMENT_NOT_OWNED",
      "Caretaker assignment belongs to another account",
      403,
    )
  }
  if (!["account", "administrator", "service"].includes(actorKind)) {
    throw authorityError("INVALID_ACTOR_KIND", "Actor cannot end a caretaker assignment", 403)
  }
  const gene = await requireActiveGene(db, assignment.gene_id)
  const head = await readHead(db, gene.gene_id)
  const assignmentVersion = normalizeVersion(
    expectedAssignmentVersion,
    "expected_assignment_version",
  )
  const headVersion = normalizeVersion(expectedHeadVersion, "expected_head_version")
  const expectedRevisionId = normalizeOptionalId(
    expectedCanonicalRevisionId,
    "expected_canonical_revision_id",
  )
  if (relinquishPolicy == null) {
    throw authorityError(
      "RELINQUISH_POLICY_CONFIRMATION_REQUIRED",
      "Confirm whether to retain or withdraw the manifestation when ending",
    )
  }
  const policy = normalizePolicy(relinquishPolicy)
  const manifestation = await readAssignmentManifestation(db, assignment.caretaker_assignment_id)
  const shouldWithdraw = policy === "withdraw" && manifestation?.status === "active"
  const canonicalIsWithdrawn =
    shouldWithdraw && head.canonical_manifestation_id === manifestation.manifestation_id
  const fallback = canonicalIsWithdrawn
    ? await readFallback(db, gene.gene_id, [manifestation.manifestation_id])
    : null
  const selectionIdNorm = canonicalIsWithdrawn
    ? createId(selectionId, "canonical_selection_id", "selection", idFactory)
    : null
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({ ...command, actorKind, actorAccountId })
  const nextAssignment = {
    ...assignment,
    status: "ended",
    assignment_version: Number(assignment.assignment_version) + 1,
    relinquish_policy: policy,
    suspended_at: null,
    suspension_reason: null,
    ended_by_account_id: actorAccountId,
    end_reason: String(reason || "caretaker_resigned").slice(0, 500),
    ended_at: timestamp,
  }
  const nextManifestation = shouldWithdraw
    ? {
        ...manifestation,
        status: "withdrawn",
        row_version: Number(manifestation.row_version) + 1,
        withdrawn_at: timestamp,
        purge_eligible_at: withdrawnManifestationPurgeEligibleAt(timestamp),
      }
    : manifestation
  const nextHead = canonicalIsWithdrawn
    ? {
        ...head,
        canonical_manifestation_id: fallback.selected_manifestation_id,
        canonical_revision_id: fallback.selected_revision_id,
        canonical_selection_id: selectionIdNorm,
        head_version: Number(head.head_version) + 1,
        gene_revision: Number(head.gene_revision) + 1,
      }
    : { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const changedSelection = canonicalIsWithdrawn
    ? canonicalSelectionRecord({
        selectionId: selectionIdNorm,
        geneId: gene.gene_id,
        head,
        nextHead,
        manifestationId: fallback.selected_manifestation_id,
        revisionId: fallback.selected_revision_id,
        actorAccountId,
        assignmentId: assignment.caretaker_assignment_id,
        reason: "assignment_end_fallback",
        commandId: cmd.commandId,
        timestamp,
      })
    : null
  const response = {
    ok: true,
    caretaker_assignment_id: assignment.caretaker_assignment_id,
    status: "ended",
    assignment_version: nextAssignment.assignment_version,
    relinquish_policy: policy,
    manifestation_status: nextManifestation?.status || null,
    fallback_revision_id: fallback?.selected_revision_id || null,
    head_version: nextHead.head_version,
    gene_revision: nextHead.gene_revision,
  }
  const assignmentStatements = [
    prepared(
      db,
      `UPDATE icono_caretaker_assignments
          SET status = 'ended', assignment_version = assignment_version + 1,
              relinquish_policy = ?, ended_by_account_id = ?, end_reason = ?,
              ended_at = ?, suspended_at = NULL, suspension_reason = NULL,
              entitlement_grace_ends_at = NULL, updated_at = ?
        WHERE caretaker_assignment_id = ?`,
      policy,
      actorAccountId,
      nextAssignment.end_reason,
      timestamp,
      timestamp,
      assignment.caretaker_assignment_id,
    ),
  ]
  if (shouldWithdraw) {
    assignmentStatements.push(
      prepared(
        db,
        `UPDATE icono_manifestations
            SET status = 'withdrawn', withdrawn_by_account_id = ?, withdrawn_at = ?,
                purge_eligible_at = ?, withdrawal_reason = 'assignment_end_policy',
                row_version = row_version + 1, updated_at = ?
          WHERE manifestation_id = ?`,
        actorAccountId,
        timestamp,
        nextManifestation.purge_eligible_at,
        timestamp,
        manifestation.manifestation_id,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_revision_lifecycle
            SET status = 'withdrawn', lifecycle_version = lifecycle_version + 1,
                changed_by_account_id = ?, change_reason = 'assignment_end_policy',
                changed_at = ?
          WHERE manifestation_revision_id IN (
            SELECT manifestation_revision_id FROM icono_manifestation_revisions
             WHERE manifestation_id = ?
          ) AND status = 'active'`,
        actorAccountId,
        timestamp,
        manifestation.manifestation_id,
      ),
    )
  }
  const statements = []
  if (canonicalIsWithdrawn) {
    statements.push(
      prepared(
        db,
        `INSERT INTO icono_manifestation_canonical_selections (
           canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
           selected_manifestation_id, selected_revision_id, actor_account_id,
           caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'assignment_end_fallback', ?, ?, ?, ?)`,
        selectionIdNorm,
        gene.gene_id,
        head.canonical_selection_id,
        head.canonical_revision_id,
        fallback.selected_manifestation_id,
        fallback.selected_revision_id,
        actorAccountId,
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
        `UPDATE icono_manifestation_heads
            SET gene_revision = gene_revision + 1, updated_at = ?
          WHERE gene_id = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        Number(head.gene_revision),
      ),
    )
  }
  statements.push(...assignmentStatements)
  statements.push(
    eventStatement(db, {
      eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
      commandId: cmd.commandId,
      geneId: gene.gene_id,
      geneRevision: nextHead.gene_revision,
      manifestationId: manifestation?.manifestation_id || null,
      selectionId: selectionIdNorm,
      assignmentId: assignment.caretaker_assignment_id,
      payloadJson: eventPayload({
        cause: "caretaker.assignment_ended",
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
          : [],
      }),
    }),
  )
  return runCommand({
    db,
    ...cmd,
    commandType: "caretaker.assignment_end",
    geneId: gene.gene_id,
    response,
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_caretaker_assignments assignment
        JOIN icono_manifestation_heads head ON head.gene_id = assignment.gene_id
        WHERE assignment.caretaker_assignment_id = ?
          AND assignment.status IN ('active', 'suspended')
          AND assignment.assignment_version = ?
          AND head.head_version = ? AND head.canonical_revision_id IS ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      assignment.caretaker_assignment_id,
      assignmentVersion,
      headVersion,
      expectedRevisionId,
    ],
    statements,
  })
}

// ARCHITECTURE FENCE [IPD-012]
