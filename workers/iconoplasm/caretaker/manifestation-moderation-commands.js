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
  all,
  canonicalSelectionRecord,
  commandInputs,
  eventPayload,
  eventStatement,
  prepared,
  readGene,
  readGeneAliases,
  readHead,
  readManifestation,
  requireDatabase,
  runCommand,
} from "./manifestation-authority-repository.js"
import { administratorContext } from "./manifestation-admin-context.js"

export async function reinstateModeratedManifestation(db, input = {}) {
  requireDatabase(db)
  const admin = await administratorContext(db, input)
  if (admin.replay) return admin.replay
  const manifestationId = normalizeId(input.manifestationId, "manifestation_id")
  const manifestation = await readManifestation(db, manifestationId)
  if (!manifestation)
    throw authorityError("MANIFESTATION_NOT_FOUND", "Manifestation was not found", 404)
  if (manifestation.status !== "moderated") {
    throw authorityError("MANIFESTATION_NOT_MODERATED", "Manifestation is not moderated", 409)
  }
  const gene = await readGene(db, manifestation.gene_id)
  if (!gene) throw authorityError("GENE_NOT_FOUND", "Gene identity was not found", 404)
  gene.aliases = await readGeneAliases(db, gene.gene_id)
  const head = await readHead(db, gene.gene_id)
  const revisions = await all(
    db,
    `SELECT revision.manifestation_revision_id, revision.manifestation_id,
            revision.revision_number, revision.parent_revision_id,
            revision.source_revision_id, revision.body_sha256, revision.body_bytes,
            revision.sample_label, revision.sample_number, revision.sample_text_sha256,
            revision.author_account_id, revision.caretaker_assignment_id,
            revision.created_at, lifecycle.status AS lifecycle_status,
            lifecycle.lifecycle_version,
            CASE WHEN storage.manifestation_revision_id IS NULL THEN 0 ELSE 1 END AS has_storage
       FROM icono_manifestation_revisions revision
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       LEFT JOIN icono_manifestation_revision_storage_secrets storage
         ON storage.manifestation_revision_id = revision.manifestation_revision_id
      WHERE revision.manifestation_id = ?
      ORDER BY revision.revision_number`,
    manifestationId,
  )
  const moderated = revisions.filter((revision) => revision.lifecycle_status === "moderated")
  if (!moderated.length) {
    throw authorityError(
      "MODERATED_REVISIONS_NOT_FOUND",
      "No moderated revisions can be reinstated",
      409,
    )
  }
  const selectedRevisionId = normalizeOptionalId(input.selectRevisionId, "select_revision_id")
  const selected = selectedRevisionId
    ? moderated.find((revision) => revision.manifestation_revision_id === selectedRevisionId)
    : null
  if (selectedRevisionId && (!selected || !selected.has_storage)) {
    throw authorityError(
      "REVISION_NOT_ELIGIBLE",
      "Selected revision cannot be reinstated as canonical",
      409,
    )
  }
  if (selected && gene.status !== "active") {
    throw authorityError(
      "GENE_READ_ONLY",
      "A merged or retired gene cannot select a canonical revision",
      409,
    )
  }
  const manifestationVersion = normalizeVersion(
    input.expectedManifestationVersion,
    "expected_manifestation_version",
  )
  const headVersion = normalizeVersion(input.expectedHeadVersion, "expected_head_version")
  const expectedCanonicalRevisionId = normalizeOptionalId(
    input.expectedCanonicalRevisionId,
    "expected_canonical_revision_id",
  )
  const timestamp = normalizeTimestamp(input.now)
  const cmd = commandInputs({
    ...input,
    actorKind: admin.actorKind,
    actorAccountId: admin.actor.account_id,
  })
  const selectionId = selected
    ? createId(
        input.selectionId,
        "canonical_selection_id",
        "selection",
        input.idFactory || defaultIdFactory,
      )
    : null
  const nextHead = selected
    ? {
        ...head,
        canonical_manifestation_id: manifestationId,
        canonical_revision_id: selectedRevisionId,
        canonical_selection_id: selectionId,
        head_version: Number(head.head_version) + 1,
        gene_revision: Number(head.gene_revision) + 1,
      }
    : { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const changedSelection = selected
    ? canonicalSelectionRecord({
        selectionId,
        geneId: gene.gene_id,
        head,
        nextHead,
        manifestationId,
        revisionId: selectedRevisionId,
        actorAccountId: admin.actor.account_id,
        assignmentId: manifestation.caretaker_assignment_id,
        reason: "moderation_reinstate",
        commandId: cmd.commandId,
        timestamp,
      })
    : null
  const nextManifestation = {
    ...manifestation,
    status: "active",
    row_version: Number(manifestation.row_version) + 1,
  }
  const changedRevision = {
    ...(selected || moderated.at(-1)),
    lifecycle_status: "active",
    lifecycle_version: Number((selected || moderated.at(-1)).lifecycle_version) + 1,
  }
  const statements = [
    prepared(
      db,
      `UPDATE icono_manifestations
          SET status = 'active', withdrawal_reason = NULL,
              row_version = row_version + 1, updated_at = ?
        WHERE manifestation_id = ? AND status = 'moderated' AND row_version = ?`,
      timestamp,
      manifestationId,
      manifestationVersion,
    ),
    prepared(
      db,
      `UPDATE icono_manifestation_revision_lifecycle
          SET status = 'active', lifecycle_version = lifecycle_version + 1,
              changed_by_account_id = ?, change_reason = 'moderation_reinstated',
              changed_at = ?
        WHERE manifestation_revision_id IN (
          SELECT manifestation_revision_id FROM icono_manifestation_revisions
           WHERE manifestation_id = ?
        ) AND status = 'moderated'`,
      admin.actor.account_id,
      timestamp,
      manifestationId,
    ),
  ]
  if (selected) {
    statements.push(
      prepared(
        db,
        `INSERT INTO icono_manifestation_canonical_selections (
           canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
           selected_manifestation_id, selected_revision_id, actor_account_id,
           caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'moderation_reinstate', ?, ?, ?, ?)`,
        selectionId,
        gene.gene_id,
        head.canonical_selection_id,
        head.canonical_revision_id,
        manifestationId,
        selectedRevisionId,
        admin.actor.account_id,
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
          WHERE gene_id = ? AND head_version = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        headVersion,
        Number(head.gene_revision),
      ),
    )
  }
  statements.push(
    eventStatement(db, {
      eventUuid: createId(
        input.eventUuid,
        "event_uuid",
        "event",
        input.idFactory || defaultIdFactory,
      ),
      commandId: cmd.commandId,
      geneId: gene.gene_id,
      geneRevision: nextHead.gene_revision,
      manifestationId,
      revisionId: selectedRevisionId || changedRevision.manifestation_revision_id,
      selectionId,
      assignmentId: manifestation.caretaker_assignment_id,
      payloadJson: eventPayload({
        cause: "manifestation.moderation_reinstated",
        gene,
        head: nextHead,
        manifestation: nextManifestation,
        revision: changedRevision,
        changedSelection,
        tombstones: moderated.map((revision) => ({
          entity_type: "manifestation_revision_lifecycle",
          entity_id: revision.manifestation_revision_id,
          state: "active",
        })),
      }),
    }),
  )
  return runCommand({
    db,
    ...cmd,
    commandType: "manifestation.moderation_reinstate",
    geneId: gene.gene_id,
    response: {
      ok: true,
      manifestation_id: manifestationId,
      status: "active",
      manifestation_row_version: nextManifestation.row_version,
      canonical_revision_id: selectedRevisionId,
      head_version: nextHead.head_version,
      gene_revision: nextHead.gene_revision,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_manifestations manifestation
        JOIN icono_manifestation_heads head ON head.gene_id = manifestation.gene_id
        WHERE manifestation.manifestation_id = ? AND manifestation.status = 'moderated'
          AND manifestation.row_version = ? AND head.head_version = ?
          AND head.canonical_revision_id IS ?
          AND NOT EXISTS (
            SELECT 1 FROM icono_manifestations conflict
             WHERE conflict.caretaker_assignment_id IS manifestation.caretaker_assignment_id
               AND conflict.manifestation_id <> manifestation.manifestation_id
               AND conflict.status = 'active'
               AND manifestation.caretaker_assignment_id IS NOT NULL
          )
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      manifestationId,
      manifestationVersion,
      headVersion,
      expectedCanonicalRevisionId,
    ],
    statements,
  })
}

// ARCHITECTURE FENCE [IPD-012]
