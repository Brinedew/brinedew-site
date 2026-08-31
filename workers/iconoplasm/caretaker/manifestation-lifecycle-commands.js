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
  readManifestation,
  readRevision,
  requireActiveAccount,
  requireActiveGene,
  requireAssignment,
  requireDatabase,
  resolveCommandReplay,
  runCommand,
} from "./manifestation-authority-repository.js"
import { withdrawnManifestationPurgeEligibleAt } from "./manifestation-retention-policy.js"

export async function restoreOwnManifestation(
  db,
  {
    manifestationId,
    revisionId,
    assignmentId,
    expectedManifestationVersion,
    expectedAssignmentVersion,
    expectedHeadVersion,
    expectedCanonicalRevisionId,
    selectionId,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const replay = await resolveCommandReplay(db, command, {
    actorKind: "account",
    actorAccountId: command.actorAccountId,
  })
  if (replay) return replay
  const actor = await requireActiveAccount(db, command.actorAccountId)
  const manifestation = await readManifestation(
    db,
    normalizeId(manifestationId, "manifestation_id"),
  )
  if (!manifestation || manifestation.author_account_id !== actor.account_id) {
    throw authorityError(
      "MANIFESTATION_NOT_OWNED",
      "Manifestation was not found for this account",
      404,
    )
  }
  if (manifestation.status !== "withdrawn") {
    throw authorityError("MANIFESTATION_NOT_WITHDRAWN", "Manifestation is not withdrawn", 409)
  }
  const assignment = await requireAssignment(db, assignmentId)
  if (
    assignment.account_id !== actor.account_id ||
    assignment.gene_id !== manifestation.gene_id ||
    assignment.status !== "active"
  ) {
    throw authorityError(
      "ACTIVE_ASSIGNMENT_REQUIRED",
      "An active caretaker assignment is required",
      403,
    )
  }
  const gene = await requireActiveGene(db, manifestation.gene_id)
  const head = await readHead(db, gene.gene_id)
  const revision = await readRevision(db, normalizeId(revisionId, "manifestation_revision_id"))
  if (!revision || revision.manifestation_id !== manifestation.manifestation_id) {
    throw authorityError("REVISION_NOT_FOUND", "Manifestation revision was not found", 404)
  }
  const manifestationVersion = normalizeVersion(
    expectedManifestationVersion,
    "expected_manifestation_version",
  )
  const assignmentVersion = normalizeVersion(
    expectedAssignmentVersion,
    "expected_assignment_version",
  )
  const headVersion = normalizeVersion(expectedHeadVersion, "expected_head_version")
  const expectedRevisionId = normalizeOptionalId(
    expectedCanonicalRevisionId,
    "expected_canonical_revision_id",
  )
  const selectionIdNorm = createId(selectionId, "canonical_selection_id", "selection", idFactory)
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({ ...command, actorKind: "account", actorAccountId: actor.account_id })
  const nextManifestation = {
    ...manifestation,
    status: "active",
    row_version: Number(manifestation.row_version) + 1,
    withdrawn_at: null,
    purge_eligible_at: null,
  }
  const nextRevision = {
    ...revision,
    lifecycle_status: "active",
    lifecycle_version: Number(revision.lifecycle_version) + 1,
  }
  const nextHead = {
    ...head,
    canonical_manifestation_id: manifestation.manifestation_id,
    canonical_revision_id: revision.manifestation_revision_id,
    canonical_selection_id: selectionIdNorm,
    head_version: Number(head.head_version) + 1,
    gene_revision: Number(head.gene_revision) + 1,
  }
  const changedSelection = canonicalSelectionRecord({
    selectionId: selectionIdNorm,
    geneId: gene.gene_id,
    head,
    nextHead,
    manifestationId: manifestation.manifestation_id,
    revisionId: revision.manifestation_revision_id,
    actorAccountId: actor.account_id,
    assignmentId: assignment.caretaker_assignment_id,
    reason: "restore",
    commandId: cmd.commandId,
    timestamp,
  })
  const response = {
    ok: true,
    manifestation_id: manifestation.manifestation_id,
    status: "active",
    manifestation_row_version: nextManifestation.row_version,
    manifestation_revision_id: revision.manifestation_revision_id,
    canonical_selection_id: selectionIdNorm,
    head_version: nextHead.head_version,
    gene_revision: nextHead.gene_revision,
  }
  return runCommand({
    db,
    ...cmd,
    commandType: "manifestation.restore",
    geneId: gene.gene_id,
    response,
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1
          FROM icono_manifestations m
          JOIN icono_caretaker_assignments a ON a.caretaker_assignment_id = ?
          JOIN icono_manifestation_heads h ON h.gene_id = m.gene_id
         WHERE m.manifestation_id = ?
           AND m.author_account_id = ?
           AND m.status = 'withdrawn'
           AND m.row_version = ?
           AND a.account_id = ? AND a.gene_id = m.gene_id
           AND a.status = 'active' AND a.assignment_version = ?
           AND h.head_version = ? AND h.canonical_revision_id IS ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      assignment.caretaker_assignment_id,
      manifestation.manifestation_id,
      actor.account_id,
      manifestationVersion,
      actor.account_id,
      assignmentVersion,
      headVersion,
      expectedRevisionId,
    ],
    statements: [
      prepared(
        db,
        `UPDATE icono_manifestations
            SET status = 'active', withdrawn_by_account_id = NULL, withdrawn_at = NULL,
                purge_eligible_at = NULL,
                withdrawal_reason = NULL, row_version = row_version + 1, updated_at = ?
          WHERE manifestation_id = ?`,
        timestamp,
        manifestation.manifestation_id,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_revision_lifecycle
            SET status = 'active', lifecycle_version = lifecycle_version + 1,
                changed_by_account_id = ?, change_reason = 'author_restore', changed_at = ?
          WHERE manifestation_revision_id IN (
            SELECT manifestation_revision_id FROM icono_manifestation_revisions
             WHERE manifestation_id = ?
          ) AND status = 'withdrawn'`,
        actor.account_id,
        timestamp,
        manifestation.manifestation_id,
      ),
      prepared(
        db,
        `INSERT INTO icono_manifestation_canonical_selections (
           canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
           selected_manifestation_id, selected_revision_id, actor_account_id,
           caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'restore', ?, ?, ?, ?)`,
        selectionIdNorm,
        gene.gene_id,
        head.canonical_selection_id,
        head.canonical_revision_id,
        manifestation.manifestation_id,
        revision.manifestation_revision_id,
        actor.account_id,
        assignment.caretaker_assignment_id,
        cmd.commandId,
        nextHead.head_version,
        nextHead.gene_revision,
        timestamp,
      ),
      eventStatement(db, {
        eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
        commandId: cmd.commandId,
        geneId: gene.gene_id,
        geneRevision: nextHead.gene_revision,
        manifestationId: manifestation.manifestation_id,
        revisionId: revision.manifestation_revision_id,
        selectionId: selectionIdNorm,
        assignmentId: assignment.caretaker_assignment_id,
        payloadJson: eventPayload({
          cause: "manifestation.lineage_restored",
          gene,
          head: nextHead,
          assignment,
          manifestation: nextManifestation,
          revision: nextRevision,
          changedSelection,
        }),
      }),
    ],
  })
}

export async function withdrawOwnManifestation(
  db,
  {
    manifestationId,
    expectedManifestationVersion,
    expectedHeadVersion,
    expectedCanonicalRevisionId,
    reason = "author_withdrawal",
    selectionId,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const replay = await resolveCommandReplay(db, command, {
    actorKind: "account",
    actorAccountId: command.actorAccountId,
  })
  if (replay) return replay
  const actor = await requireActiveAccount(db, command.actorAccountId)
  const manifestation = await readManifestation(
    db,
    normalizeId(manifestationId, "manifestation_id"),
  )
  if (!manifestation || manifestation.author_account_id !== actor.account_id) {
    throw authorityError(
      "MANIFESTATION_NOT_OWNED",
      "Manifestation was not found for this account",
      404,
    )
  }
  if (manifestation.non_withdrawable) {
    throw authorityError("MANIFESTATION_NON_WITHDRAWABLE", "System seed cannot be withdrawn", 409)
  }
  if (manifestation.status !== "active") {
    throw authorityError("MANIFESTATION_NOT_ACTIVE", "Manifestation is not active", 409)
  }
  const gene = await requireActiveGene(db, manifestation.gene_id)
  const head = await readHead(db, gene.gene_id)
  const manifestationVersion = normalizeVersion(
    expectedManifestationVersion,
    "expected_manifestation_version",
  )
  const headVersion = normalizeVersion(expectedHeadVersion, "expected_head_version")
  const expectedRevisionId = normalizeOptionalId(
    expectedCanonicalRevisionId,
    "expected_canonical_revision_id",
  )
  const canonicalIsWithdrawn = head.canonical_manifestation_id === manifestation.manifestation_id
  const fallback = canonicalIsWithdrawn
    ? await readFallback(db, gene.gene_id, [manifestation.manifestation_id])
    : null
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({ ...command, actorKind: "account", actorAccountId: actor.account_id })
  const selectionIdNorm = canonicalIsWithdrawn
    ? createId(selectionId, "canonical_selection_id", "selection", idFactory)
    : null
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
        actorAccountId: actor.account_id,
        assignmentId: manifestation.caretaker_assignment_id,
        reason: "withdrawal_fallback",
        commandId: cmd.commandId,
        timestamp,
      })
    : null
  const nextManifestation = {
    ...manifestation,
    status: "withdrawn",
    row_version: Number(manifestation.row_version) + 1,
    withdrawn_at: timestamp,
    purge_eligible_at: withdrawnManifestationPurgeEligibleAt(timestamp),
  }
  const response = {
    ok: true,
    manifestation_id: manifestation.manifestation_id,
    status: "withdrawn",
    manifestation_row_version: nextManifestation.row_version,
    fallback_revision_id: fallback?.selected_revision_id || null,
    canonical_selection_id: selectionIdNorm || head.canonical_selection_id,
    head_version: nextHead.head_version,
    gene_revision: nextHead.gene_revision,
  }
  const withdrawalStatements = [
    prepared(
      db,
      `UPDATE icono_manifestations
          SET status = 'withdrawn', withdrawn_by_account_id = ?, withdrawn_at = ?,
              purge_eligible_at = ?, withdrawal_reason = ?,
              row_version = row_version + 1, updated_at = ?
        WHERE manifestation_id = ?`,
      actor.account_id,
      timestamp,
      nextManifestation.purge_eligible_at,
      String(reason || "author_withdrawal").slice(0, 500),
      timestamp,
      manifestation.manifestation_id,
    ),
    prepared(
      db,
      `UPDATE icono_manifestation_revision_lifecycle
          SET status = 'withdrawn', lifecycle_version = lifecycle_version + 1,
              changed_by_account_id = ?, change_reason = ?, changed_at = ?
        WHERE manifestation_revision_id IN (
          SELECT manifestation_revision_id FROM icono_manifestation_revisions
           WHERE manifestation_id = ?
        ) AND status = 'active'`,
      actor.account_id,
      String(reason || "author_withdrawal").slice(0, 500),
      timestamp,
      manifestation.manifestation_id,
    ),
  ]
  const statements = []
  if (canonicalIsWithdrawn) {
    statements.push(
      prepared(
        db,
        `INSERT INTO icono_manifestation_canonical_selections (
           canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
           selected_manifestation_id, selected_revision_id, actor_account_id,
           caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'withdrawal_fallback', ?, ?, ?, ?)`,
        selectionIdNorm,
        gene.gene_id,
        head.canonical_selection_id,
        head.canonical_revision_id,
        fallback.selected_manifestation_id,
        fallback.selected_revision_id,
        actor.account_id,
        manifestation.caretaker_assignment_id,
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
  statements.push(...withdrawalStatements)
  statements.push(
    eventStatement(db, {
      eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
      commandId: cmd.commandId,
      geneId: gene.gene_id,
      geneRevision: nextHead.gene_revision,
      manifestationId: manifestation.manifestation_id,
      revisionId: null,
      selectionId: selectionIdNorm,
      assignmentId: manifestation.caretaker_assignment_id,
      payloadJson: eventPayload({
        cause: "manifestation.lineage_withdrawn",
        gene,
        head: nextHead,
        manifestation: nextManifestation,
        changedSelection,
        tombstones: [
          {
            entity_type: "manifestation",
            entity_id: manifestation.manifestation_id,
            state: "withdrawn",
          },
        ],
      }),
    }),
  )
  return runCommand({
    db,
    ...cmd,
    commandType: "manifestation.withdraw",
    geneId: gene.gene_id,
    response,
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1
          FROM icono_manifestations m
          JOIN icono_manifestation_heads h ON h.gene_id = m.gene_id
         WHERE m.manifestation_id = ?
           AND m.author_account_id = ?
           AND m.status = 'active'
           AND m.non_withdrawable = 0
           AND m.row_version = ?
           AND h.head_version = ?
           AND h.canonical_revision_id IS ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      manifestation.manifestation_id,
      actor.account_id,
      manifestationVersion,
      headVersion,
      expectedRevisionId,
    ],
    statements,
  })
}

// ARCHITECTURE FENCE [IPD-012]
