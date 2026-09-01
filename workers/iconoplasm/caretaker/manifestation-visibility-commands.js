import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeId,
  normalizeTimestamp,
  normalizeVersion,
} from "./manifestation-authority-contract.js"
import {
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

export async function setManifestationPageVisibility(
  db,
  {
    assignmentId,
    manifestationId,
    visible,
    expectedAssignmentVersion,
    expectedManifestationVersion,
    expectedGeneRevision,
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
  if (typeof visible !== "boolean") {
    throw authorityError("INVALID_PAGE_VISIBILITY", "Page visibility must be true or false")
  }
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
  const manifestation = await readManifestation(
    db,
    normalizeId(manifestationId, "manifestation_id"),
  )
  if (
    !manifestation ||
    manifestation.gene_id !== gene.gene_id ||
    manifestation.author_account_id !== actor.account_id ||
    manifestation.caretaker_assignment_id !== assignment.caretaker_assignment_id ||
    manifestation.status !== "active"
  ) {
    throw authorityError(
      "MANIFESTATION_NOT_EDITABLE",
      "Only the active manifestation from this caretaker tenure can be made visible",
      403,
    )
  }
  const head = await readHead(db, gene.gene_id)
  const revision = manifestation.manifestation_head_revision_id
    ? await readRevision(db, manifestation.manifestation_head_revision_id)
    : null
  const assignmentVersion = normalizeVersion(
    expectedAssignmentVersion,
    "expected_assignment_version",
  )
  const manifestationVersion = normalizeVersion(
    expectedManifestationVersion,
    "expected_manifestation_version",
  )
  const geneRevision = normalizeVersion(expectedGeneRevision, "expected_gene_revision")
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({ ...command, actorKind: "account", actorAccountId: actor.account_id })
  const nextManifestation = {
    ...manifestation,
    public_page_visible: visible ? 1 : 0,
    row_version: Number(manifestation.row_version) + 1,
  }
  const nextHead = { ...head, gene_revision: Number(head.gene_revision) + 1 }
  return runCommand({
    db,
    ...cmd,
    commandType: "manifestation.page_visibility_set",
    geneId: gene.gene_id,
    response: {
      ok: true,
      manifestation_id: manifestation.manifestation_id,
      public_page_visible: visible,
      manifestation_row_version: nextManifestation.row_version,
      gene_revision: nextHead.gene_revision,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_caretaker_assignments assignment
        JOIN icono_manifestations manifestation
          ON manifestation.caretaker_assignment_id = assignment.caretaker_assignment_id
        JOIN icono_manifestation_heads head ON head.gene_id = assignment.gene_id
        WHERE assignment.caretaker_assignment_id = ? AND assignment.account_id = ?
          AND assignment.status = 'active' AND assignment.assignment_version = ?
          AND manifestation.manifestation_id = ? AND manifestation.author_account_id = ?
          AND manifestation.status = 'active' AND manifestation.row_version = ?
          AND head.gene_revision = ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      assignment.caretaker_assignment_id,
      actor.account_id,
      assignmentVersion,
      manifestation.manifestation_id,
      actor.account_id,
      manifestationVersion,
      geneRevision,
    ],
    statements: [
      prepared(
        db,
        `UPDATE icono_manifestations
            SET public_page_visible = ?, row_version = row_version + 1, updated_at = ?
          WHERE manifestation_id = ? AND row_version = ?`,
        visible ? 1 : 0,
        timestamp,
        manifestation.manifestation_id,
        manifestationVersion,
      ),
      prepared(
        db,
        `UPDATE icono_manifestation_heads SET gene_revision = gene_revision + 1, updated_at = ?
          WHERE gene_id = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        geneRevision,
      ),
      eventStatement(db, {
        eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
        commandId: cmd.commandId,
        geneId: gene.gene_id,
        geneRevision: nextHead.gene_revision,
        manifestationId: manifestation.manifestation_id,
        revisionId: revision?.manifestation_revision_id || null,
        assignmentId: assignment.caretaker_assignment_id,
        payloadJson: eventPayload({
          cause: "manifestation.page_visibility_changed",
          gene,
          head: nextHead,
          assignment,
          manifestation: nextManifestation,
          revision,
        }),
      }),
    ],
  })
}
