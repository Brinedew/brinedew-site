import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeId,
  normalizeOptionalId,
  normalizeTimestamp,
  normalizeVersion,
} from "./manifestation-authority-contract.js"
import {
  canonicalSelectionRecord,
  commandInputs,
  eventPayload,
  eventStatement,
  prepared,
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

export async function selectManifestationRevision(
  db,
  {
    assignmentId,
    revisionId,
    reason = "select",
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
  const assignment = await requireAssignment(db, assignmentId)
  const actor = await requireActiveAccount(db, command.actorAccountId)
  if (assignment.account_id !== actor.account_id) {
    throw authorityError(
      "ASSIGNMENT_NOT_OWNED",
      "Caretaker assignment belongs to another account",
      403,
    )
  }
  if (assignment.status !== "active") {
    throw authorityError("ASSIGNMENT_NOT_ACTIVE", "Caretaker assignment is not active", 409)
  }
  const gene = await requireActiveGene(db, assignment.gene_id)
  const head = await readHead(db, gene.gene_id)
  const revision = await readRevision(db, normalizeId(revisionId, "manifestation_revision_id"))
  if (
    !revision ||
    revision.gene_id !== gene.gene_id ||
    revision.manifestation_status !== "active" ||
    revision.lifecycle_status !== "active"
  ) {
    throw authorityError("REVISION_NOT_ELIGIBLE", "Manifestation revision is not eligible", 404)
  }
  const reasonNorm = String(reason || "select")
    .trim()
    .toLowerCase()
  if (!["select", "restore"].includes(reasonNorm)) {
    throw authorityError("INVALID_SELECTION_REASON", "Selection reason is invalid")
  }
  const expectedAssignment = normalizeVersion(
    expectedAssignmentVersion,
    "expected_assignment_version",
  )
  const expectedHead = normalizeVersion(expectedHeadVersion, "expected_head_version")
  const expectedRevisionId = normalizeOptionalId(
    expectedCanonicalRevisionId,
    "expected_canonical_revision_id",
  )
  const selectionIdNorm = createId(selectionId, "canonical_selection_id", "selection", idFactory)
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({ ...command, actorKind: "account", actorAccountId: actor.account_id })
  const nextHead = {
    ...head,
    canonical_manifestation_id: revision.manifestation_id,
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
    manifestationId: revision.manifestation_id,
    revisionId: revision.manifestation_revision_id,
    actorAccountId: actor.account_id,
    assignmentId: assignment.caretaker_assignment_id,
    reason: reasonNorm,
    commandId: cmd.commandId,
    timestamp,
  })
  const manifestation = await readManifestation(db, revision.manifestation_id)
  return runCommand({
    db,
    ...cmd,
    commandType: `manifestation.${reasonNorm}`,
    geneId: gene.gene_id,
    response: {
      ok: true,
      manifestation_id: revision.manifestation_id,
      manifestation_revision_id: revision.manifestation_revision_id,
      canonical_selection_id: selectionIdNorm,
      head_version: nextHead.head_version,
      gene_revision: nextHead.gene_revision,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_caretaker_assignments assignment
        JOIN icono_manifestation_heads head ON head.gene_id = assignment.gene_id
        WHERE assignment.caretaker_assignment_id = ? AND assignment.account_id = ?
          AND assignment.status = 'active' AND assignment.assignment_version = ?
          AND head.head_version = ? AND head.canonical_revision_id IS ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      assignment.caretaker_assignment_id,
      actor.account_id,
      expectedAssignment,
      expectedHead,
      expectedRevisionId,
    ],
    statements: [
      prepared(
        db,
        `INSERT INTO icono_manifestation_canonical_selections (
           canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
           selected_manifestation_id, selected_revision_id, actor_account_id,
           caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        selectionIdNorm,
        gene.gene_id,
        head.canonical_selection_id,
        head.canonical_revision_id,
        revision.manifestation_id,
        revision.manifestation_revision_id,
        actor.account_id,
        assignment.caretaker_assignment_id,
        reasonNorm,
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
        manifestationId: revision.manifestation_id,
        revisionId: revision.manifestation_revision_id,
        selectionId: selectionIdNorm,
        assignmentId: assignment.caretaker_assignment_id,
        payloadJson: eventPayload({
          cause:
            reasonNorm === "restore"
              ? "manifestation.canonical_restored"
              : "manifestation.canonical_selected",
          gene,
          head: nextHead,
          assignment,
          manifestation,
          revision,
          changedSelection,
        }),
      }),
    ],
  })
}
