import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeOptionalId,
  normalizeSha256,
  normalizeTimestamp,
  normalizeVersion,
} from "./manifestation-authority-contract.js"
import {
  canonicalSelectionRecord,
  commandInputs,
  eventPayload,
  eventStatement,
  first,
  prepared,
  readAssignmentManifestation,
  readHead,
  readRevision,
  requireActiveAccount,
  requireActiveGene,
  requireAssignment,
  requireDatabase,
  resolveCommandReplay,
  runCommand,
} from "./manifestation-authority-repository.js"
import { storageFields } from "./manifestation-storage-contract.js"
import {
  derivativeHeadSnapshot,
  derivativeSnapshot,
  manualTagsDerivative,
} from "./manifestation-derivative-commands.js"

function requireOpaqueObjectLocator(storage, revisionId) {
  const locator =
    storage.object_key
      .split("/")
      .at(-1)
      ?.replace(/\.bin$/, "") || ""
  if (locator.length < 32 || locator === revisionId) {
    throw authorityError(
      "PREDICTABLE_OBJECT_KEY",
      "Manifestation storage requires an independent random locator",
      400,
    )
  }
}

// An upload whose commit fails stays an unadopted upload intent; the sweep in
// manifestation-upload-intents.js deletes its stored body once the lease ends.
function commitFailure(error) {
  return error instanceof Error
    ? error
    : authorityError("AUTHORITY_COMMIT_FAILED", "Authority commit failed", 500)
}

function revisionInsertStatements(
  db,
  {
    manifestationId,
    revisionId,
    revisionNumber,
    parentRevisionId,
    sourceRevisionId,
    baseSelectionId,
    sampleLabel = null,
    sampleNumber = null,
    sampleTextSha256 = null,
    actorAccountId,
    assignmentId,
    storage,
    timestamp,
  },
) {
  return [
    prepared(
      db,
      `INSERT INTO icono_manifestation_revisions (
         manifestation_revision_id, manifestation_id, revision_number,
         parent_revision_id, source_revision_id, base_canonical_selection_id,
         body_sha256, body_bytes, sample_label, sample_number, sample_text_sha256,
         author_account_id, caretaker_assignment_id, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      revisionId,
      manifestationId,
      revisionNumber,
      parentRevisionId,
      sourceRevisionId,
      baseSelectionId,
      storage.body_sha256,
      storage.body_bytes,
      sampleLabel,
      sampleNumber,
      sampleTextSha256,
      actorAccountId,
      assignmentId,
      timestamp,
    ),
    prepared(
      db,
      `INSERT INTO icono_manifestation_revision_storage_secrets (
         manifestation_revision_id, object_key, ciphertext_sha256, ciphertext_bytes,
         body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version,
         aad_version, object_etag, verified_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      revisionId,
      storage.object_key,
      storage.ciphertext_sha256,
      storage.ciphertext_bytes,
      storage.body_iv_base64,
      storage.wrapped_dek_base64,
      storage.wrap_iv_base64,
      storage.key_version,
      storage.aad_version,
      storage.object_etag,
      storage.verified_at,
      timestamp,
    ),
    prepared(
      db,
      `INSERT INTO icono_manifestation_revision_lifecycle (
         manifestation_revision_id, status, changed_by_account_id, changed_at
       ) VALUES (?, 'active', ?, ?)`,
      revisionId,
      actorAccountId,
      timestamp,
    ),
  ]
}

export async function seedSystemManifestation(
  db,
  {
    geneId,
    storage: rawStorage,
    expectedHeadVersion = 0,
    expectedCanonicalRevisionId = null,
    sampleLabel = null,
    sampleNumber = null,
    sampleTextSha256 = null,
    manifestationId,
    revisionId,
    selectionId,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const replay = await resolveCommandReplay(db, command, {
    actorKind: command.actorKind || "migration",
    actorAccountId: command.actorAccountId,
  })
  if (replay) return replay
  const gene = await requireActiveGene(db, geneId)
  const head = await readHead(db, gene.gene_id)
  const storage = storageFields(rawStorage)
  const headVersion = normalizeVersion(expectedHeadVersion, "expected_head_version")
  const expectedRevisionId = normalizeOptionalId(
    expectedCanonicalRevisionId,
    "expected_canonical_revision_id",
  )
  const manifestationIdNorm = createId(
    manifestationId,
    "manifestation_id",
    "manifestation",
    idFactory,
  )
  const revisionIdNorm = createId(revisionId, "manifestation_revision_id", "revision", idFactory)
  requireOpaqueObjectLocator(storage, revisionIdNorm)
  const selectionIdNorm = createId(selectionId, "canonical_selection_id", "selection", idFactory)
  const timestamp = normalizeTimestamp(now)
  const normalizedSampleLabel =
    sampleLabel == null ? null : String(sampleLabel).trim().slice(0, 256) || null
  const normalizedSampleNumber = sampleNumber == null ? null : Number(sampleNumber)
  if (
    normalizedSampleNumber != null &&
    (!Number.isSafeInteger(normalizedSampleNumber) || normalizedSampleNumber < 0)
  ) {
    throw authorityError("INVALID_SAMPLE_NUMBER", "sample_number is invalid")
  }
  const normalizedSampleTextSha256 =
    sampleTextSha256 == null ? null : normalizeSha256(sampleTextSha256, "sample_text_sha256")
  const cmd = commandInputs({ ...command, actorKind: command.actorKind || "migration" })
  const nextHead = {
    ...head,
    canonical_manifestation_id: manifestationIdNorm,
    canonical_revision_id: revisionIdNorm,
    canonical_selection_id: selectionIdNorm,
    head_version: Number(head.head_version) + 1,
    gene_revision: Number(head.gene_revision) + 1,
  }
  const changedSelection = canonicalSelectionRecord({
    selectionId: selectionIdNorm,
    geneId: gene.gene_id,
    head,
    nextHead,
    manifestationId: manifestationIdNorm,
    revisionId: revisionIdNorm,
    actorAccountId: null,
    assignmentId: null,
    reason: "seed",
    commandId: cmd.commandId,
    timestamp,
  })
  const manifestation = {
    manifestation_id: manifestationIdNorm,
    gene_id: gene.gene_id,
    author_account_id: null,
    caretaker_assignment_id: null,
    origin: "system_seed",
    status: "active",
    manifestation_head_revision_id: revisionIdNorm,
    source_manifestation_id: null,
    row_version: 1,
    non_withdrawable: 1,
  }
  const revision = {
    manifestation_revision_id: revisionIdNorm,
    manifestation_id: manifestationIdNorm,
    revision_number: 1,
    parent_revision_id: null,
    source_revision_id: null,
    body_sha256: storage.body_sha256,
    body_bytes: storage.body_bytes,
    sample_label: normalizedSampleLabel,
    sample_number: normalizedSampleNumber,
    sample_text_sha256: normalizedSampleTextSha256,
    author_account_id: null,
    caretaker_assignment_id: null,
    lifecycle_status: "active",
    lifecycle_version: 1,
    created_at: timestamp,
  }
  const response = {
    ok: true,
    manifestation_id: manifestationIdNorm,
    manifestation_revision_id: revisionIdNorm,
    canonical_selection_id: selectionIdNorm,
    head_version: nextHead.head_version,
    gene_revision: nextHead.gene_revision,
    storage_adoption: {
      status: "adopted",
      manifestation_revision_id: revisionIdNorm,
    },
  }
  try {
    return await runCommand({
      db,
      ...cmd,
      commandType: "manifestation.seed",
      geneId: gene.gene_id,
      response,
      guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_manifestation_heads h
         WHERE h.gene_id = ? AND h.head_version = ?
           AND h.canonical_revision_id IS ?
      ) THEN 1 ELSE 0 END`,
      guardParams: [cmd.commandId, gene.gene_id, headVersion, expectedRevisionId],
      statements: [
        prepared(
          db,
          `INSERT INTO icono_manifestations (
           manifestation_id, gene_id, origin, status, manifestation_head_revision_id,
           row_version, non_withdrawable, created_at, updated_at
         ) VALUES (?, ?, 'system_seed', 'active', NULL, 1, 1, ?, ?)`,
          manifestationIdNorm,
          gene.gene_id,
          timestamp,
          timestamp,
        ),
        ...revisionInsertStatements(db, {
          manifestationId: manifestationIdNorm,
          revisionId: revisionIdNorm,
          revisionNumber: 1,
          parentRevisionId: null,
          sourceRevisionId: null,
          baseSelectionId: head.canonical_selection_id,
          sampleLabel: normalizedSampleLabel,
          sampleNumber: normalizedSampleNumber,
          sampleTextSha256: normalizedSampleTextSha256,
          actorAccountId: null,
          assignmentId: null,
          storage,
          timestamp,
        }),
        prepared(
          db,
          `UPDATE icono_manifestations
              SET manifestation_head_revision_id = ?, updated_at = ?
            WHERE manifestation_id = ?`,
          revisionIdNorm,
          timestamp,
          manifestationIdNorm,
        ),
        prepared(
          db,
          `INSERT INTO icono_manifestation_canonical_selections (
           canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
           selected_manifestation_id, selected_revision_id, actor_account_id,
           caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'seed', ?, ?, ?, ?)`,
          selectionIdNorm,
          gene.gene_id,
          head.canonical_selection_id,
          head.canonical_revision_id,
          manifestationIdNorm,
          revisionIdNorm,
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
          manifestationId: manifestationIdNorm,
          revisionId: revisionIdNorm,
          selectionId: selectionIdNorm,
          payloadJson: eventPayload({
            cause: "manifestation.system_seed_created",
            gene,
            head: nextHead,
            manifestation,
            revision,
            changedSelection,
          }),
        }),
      ],
    })
  } catch (error) {
    throw commitFailure(error)
  }
}

// Everything a caretaker save checks, and the rows its revision writes: the
// lineage (new, or advanced to the new head), the revision, its storage (which
// adopts the upload intent) and its lifecycle. The revision save and the
// combined save (B-859 step 3) share it, so the rules exist once.
async function prepareRevisionSave(
  db,
  {
    assignmentId,
    expectedAssignmentVersion,
    expectedManifestationVersion,
    storage: rawStorage,
    sourceRevisionId = null,
    manifestationId,
    revisionId,
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
  if (replay) return { replay }
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
  const expectedAssignment = normalizeVersion(
    expectedAssignmentVersion,
    "expected_assignment_version",
  )
  const expectedManifestation = normalizeVersion(
    expectedManifestationVersion,
    "expected_manifestation_version",
  )
  const storage = storageFields(rawStorage)
  const manifestation = await readAssignmentManifestation(db, assignment.caretaker_assignment_id)
  if (manifestation?.status === "withdrawn") {
    throw authorityError(
      "MANIFESTATION_WITHDRAWN",
      "Restore the withdrawn manifestation before saving",
      409,
    )
  }
  if (manifestation && manifestation.status !== "active") {
    throw authorityError(
      "MANIFESTATION_NOT_ACTIVE",
      "The caretaker lineage is unavailable for authoring",
      409,
    )
  }
  const isNewManifestation = !manifestation
  const manifestationIdNorm = isNewManifestation
    ? createId(manifestationId, "manifestation_id", "manifestation", idFactory)
    : manifestation.manifestation_id
  const previousRevision = manifestation?.manifestation_head_revision_id
    ? await readRevision(db, manifestation.manifestation_head_revision_id)
    : null
  const revisionNumber = Number(previousRevision?.revision_number || 0) + 1
  const revisionIdNorm = createId(revisionId, "manifestation_revision_id", "revision", idFactory)
  requireOpaqueObjectLocator(storage, revisionIdNorm)
  if (
    (isNewManifestation && expectedManifestation !== 0) ||
    (!isNewManifestation && expectedManifestation !== Number(manifestation.row_version))
  ) {
    throw authorityError(
      "STALE_AUTHORITY_STATE",
      "The caretaker manifestation changed before this command was prepared",
      409,
    )
  }
  const sourceRevisionIdNorm = normalizeOptionalId(sourceRevisionId, "source_revision_id")
  let sourceRevision = null
  if (sourceRevisionIdNorm) {
    sourceRevision = await readRevision(db, sourceRevisionIdNorm)
    if (!sourceRevision || sourceRevision.gene_id !== gene.gene_id) {
      throw authorityError(
        "SOURCE_REVISION_NOT_FOUND",
        "Source revision is not eligible for this gene",
        404,
      )
    }
  }
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({ ...command, actorKind: "account", actorAccountId: actor.account_id })
  const nextHead = {
    ...head,
    gene_revision: Number(head.gene_revision) + 1,
  }
  const nextManifestation = isNewManifestation
    ? {
        manifestation_id: manifestationIdNorm,
        gene_id: gene.gene_id,
        author_account_id: actor.account_id,
        caretaker_assignment_id: assignment.caretaker_assignment_id,
        origin: sourceRevisionIdNorm ? "fork" : "caretaker",
        status: "active",
        manifestation_head_revision_id: revisionIdNorm,
        source_manifestation_id: sourceRevision?.manifestation_id || null,
        row_version: 1,
        non_withdrawable: 0,
      }
    : {
        ...manifestation,
        manifestation_head_revision_id: revisionIdNorm,
        row_version: Number(manifestation.row_version) + 1,
      }
  const revision = {
    manifestation_revision_id: revisionIdNorm,
    manifestation_id: manifestationIdNorm,
    revision_number: revisionNumber,
    parent_revision_id: previousRevision?.manifestation_revision_id || null,
    source_revision_id: sourceRevisionIdNorm,
    body_sha256: storage.body_sha256,
    body_bytes: storage.body_bytes,
    author_account_id: actor.account_id,
    caretaker_assignment_id: assignment.caretaker_assignment_id,
    lifecycle_status: "active",
    lifecycle_version: 1,
    created_at: timestamp,
  }
  const response = {
    ok: true,
    manifestation_id: manifestationIdNorm,
    manifestation_row_version: Number(nextManifestation.row_version),
    manifestation_revision_id: revisionIdNorm,
    revision_number: revisionNumber,
    canonical_changed: false,
    canonical_revision_id: head.canonical_revision_id,
    canonical_selection_id: head.canonical_selection_id,
    head_version: nextHead.head_version,
    gene_revision: nextHead.gene_revision,
    storage_adoption: {
      status: "adopted",
      manifestation_revision_id: revisionIdNorm,
    },
  }
  const manifestationStatements = isNewManifestation
    ? [
        prepared(
          db,
          `INSERT INTO icono_manifestations (
             manifestation_id, gene_id, author_account_id, caretaker_assignment_id,
             origin, status, manifestation_head_revision_id, source_manifestation_id,
             row_version, non_withdrawable, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, 'active', NULL, ?, 1, 0, ?, ?)`,
          manifestationIdNorm,
          gene.gene_id,
          actor.account_id,
          assignment.caretaker_assignment_id,
          nextManifestation.origin,
          nextManifestation.source_manifestation_id,
          timestamp,
          timestamp,
        ),
      ]
    : []
  return {
    actor,
    assignment,
    cmd,
    gene,
    head,
    nextHead,
    nextManifestation,
    revision,
    response,
    timestamp,
    manifestationId: manifestationIdNorm,
    revisionId: revisionIdNorm,
    sourceRevisionId: sourceRevisionIdNorm,
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1
          FROM icono_caretaker_assignments a
         WHERE a.caretaker_assignment_id = ?
           AND a.account_id = ?
           AND a.status = 'active'
           AND a.assignment_version = ?
           AND (
             (? = 0 AND NOT EXISTS (
               SELECT 1 FROM icono_manifestations m
                WHERE m.caretaker_assignment_id = a.caretaker_assignment_id
                  AND m.origin IN ('caretaker', 'fork')
             ))
             OR EXISTS (
               SELECT 1 FROM icono_manifestations m
                WHERE m.caretaker_assignment_id = a.caretaker_assignment_id
                  AND m.origin IN ('caretaker', 'fork')
                   AND m.row_version = ?
              )
            )
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      assignment.caretaker_assignment_id,
      actor.account_id,
      expectedAssignment,
      expectedManifestation,
      expectedManifestation,
    ],
    statements: [
      ...manifestationStatements,
      ...revisionInsertStatements(db, {
        manifestationId: manifestationIdNorm,
        revisionId: revisionIdNorm,
        revisionNumber,
        parentRevisionId: previousRevision?.manifestation_revision_id || null,
        sourceRevisionId: sourceRevisionIdNorm,
        baseSelectionId: head.canonical_selection_id,
        actorAccountId: actor.account_id,
        assignmentId: assignment.caretaker_assignment_id,
        storage,
        timestamp,
      }),
      prepared(
        db,
        `UPDATE icono_manifestations
            SET manifestation_head_revision_id = ?, row_version = row_version + ?,
                updated_at = ?
          WHERE manifestation_id = ?`,
        revisionIdNorm,
        isNewManifestation ? 0 : 1,
        timestamp,
        manifestationIdNorm,
      ),
    ],
  }
}

export async function saveManifestationRevision(
  db,
  { eventUuid, idFactory = defaultIdFactory, ...input } = {},
) {
  const save = await prepareRevisionSave(db, { idFactory, ...input })
  if (save.replay) return save.replay
  try {
    return await runCommand({
      db,
      ...save.cmd,
      commandType: "manifestation.save",
      geneId: save.gene.gene_id,
      response: save.response,
      guardSql: save.guardSql,
      guardParams: save.guardParams,
      statements: [
        ...save.statements,
        prepared(
          db,
          `UPDATE icono_manifestation_heads
              SET gene_revision = gene_revision + 1, updated_at = ?
            WHERE gene_id = ? AND gene_revision = ?`,
          save.timestamp,
          save.gene.gene_id,
          Number(save.head.gene_revision),
        ),
        eventStatement(db, {
          eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
          commandId: save.cmd.commandId,
          geneId: save.gene.gene_id,
          geneRevision: save.nextHead.gene_revision,
          manifestationId: save.manifestationId,
          revisionId: save.revisionId,
          assignmentId: save.assignment.caretaker_assignment_id,
          payloadJson: eventPayload({
            cause: save.sourceRevisionId
              ? "manifestation.revision_forked"
              : "manifestation.revision_saved",
            gene: save.gene,
            head: save.nextHead,
            assignment: save.assignment,
            manifestation: save.nextManifestation,
            revision: save.revision,
          }),
        }),
      ],
    })
  } catch (error) {
    throw commitFailure(error)
  }
}

// B-859 step 3: one caretaker autosave as one command. The editor used to send
// four (revision, Tags, Tags head, canonical selection); each wrote its own
// guard, receipt and event and woke its own projection drain, 151 rows in all
// (caretaker-save-cost.workerd.test.js). This writes the revision, its Tags,
// the Tags head and the canonical selection in one batch, under one guard,
// receipt and event. The event is one gene snapshot carrying every change; the
// workstation replica applies an event's records whatever produced them
// (Iconoplasm manifestation_authority_replica_events.apply_event_page).
//
// The canonical selection insert bumps the gene revision (its trigger requires
// head + 1), so nothing else in the batch touches it. A stale head aborts the
// batch through that trigger, which runCommand reports as STALE_AUTHORITY_STATE.
export async function saveManifestationWithTags(
  db,
  {
    tags,
    expectedHeadVersion,
    expectedCanonicalRevisionId,
    selectionId,
    eventUuid,
    idFactory = defaultIdFactory,
    ...input
  } = {},
) {
  const save = await prepareRevisionSave(db, { idFactory, ...input })
  if (save.replay) return save.replay
  const { actor, assignment, cmd, gene, head, timestamp } = save
  const expectedHead = normalizeVersion(expectedHeadVersion, "expected_head_version")
  const expectedCanonical = normalizeOptionalId(
    expectedCanonicalRevisionId,
    "expected_canonical_revision_id",
  )
  if (
    expectedHead !== Number(head.head_version) ||
    expectedCanonical !== (head.canonical_revision_id || null)
  ) {
    throw authorityError(
      "STALE_AUTHORITY_STATE",
      "The gene's canonical version changed before this save was prepared",
      409,
    )
  }
  const derivativeId = createId(
    tags?.derivativeId,
    "manifestation_derivative_id",
    "derivative",
    idFactory,
  )
  const { derivative, statements: derivativeStatements } = manualTagsDerivative(db, {
    ...tags,
    derivativeId,
    revisionId: save.revisionId,
    sourceBodySha256: save.revision.body_sha256,
    timestamp,
  })
  // The revision insert's trigger creates its Tags head at version 0.
  const derivativeHead = {
    manifestation_revision_id: save.revisionId,
    accepted_derivative_id: derivativeId,
    derivative_head_version: 1,
  }
  const selectionIdNorm = createId(selectionId, "canonical_selection_id", "selection", idFactory)
  const nextHead = {
    ...head,
    canonical_manifestation_id: save.manifestationId,
    canonical_revision_id: save.revisionId,
    canonical_selection_id: selectionIdNorm,
    head_version: Number(head.head_version) + 1,
    gene_revision: Number(head.gene_revision) + 1,
  }
  const changedSelection = canonicalSelectionRecord({
    selectionId: selectionIdNorm,
    geneId: gene.gene_id,
    head,
    nextHead,
    manifestationId: save.manifestationId,
    revisionId: save.revisionId,
    actorAccountId: actor.account_id,
    assignmentId: assignment.caretaker_assignment_id,
    reason: "select",
    commandId: cmd.commandId,
    timestamp,
  })
  try {
    return await runCommand({
      db,
      ...cmd,
      commandType: "manifestation.save_with_tags",
      geneId: gene.gene_id,
      response: {
        ...save.response,
        canonical_changed: true,
        canonical_revision_id: save.revisionId,
        canonical_selection_id: selectionIdNorm,
        head_version: nextHead.head_version,
        gene_revision: nextHead.gene_revision,
        manifestation_derivative_id: derivativeId,
        derivative_head_version: derivativeHead.derivative_head_version,
        tags_storage_adoption: {
          status: "adopted",
          manifestation_derivative_id: derivativeId,
        },
      },
      guardSql: save.guardSql,
      guardParams: save.guardParams,
      statements: [
        ...save.statements,
        ...derivativeStatements,
        prepared(
          db,
          `UPDATE icono_manifestation_derivative_heads
              SET accepted_derivative_id = ?, derivative_head_version = 1, updated_at = ?
            WHERE manifestation_revision_id = ? AND derivative_head_version = 0`,
          derivativeId,
          timestamp,
          save.revisionId,
        ),
        prepared(
          db,
          `INSERT INTO icono_manifestation_canonical_selections (
             canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
             selected_manifestation_id, selected_revision_id, actor_account_id,
             caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'select', ?, ?, ?, ?)`,
          selectionIdNorm,
          gene.gene_id,
          head.canonical_selection_id,
          head.canonical_revision_id,
          save.manifestationId,
          save.revisionId,
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
          manifestationId: save.manifestationId,
          revisionId: save.revisionId,
          selectionId: selectionIdNorm,
          assignmentId: assignment.caretaker_assignment_id,
          payloadJson: eventPayload({
            cause: "manifestation.saved_with_tags",
            gene,
            head: nextHead,
            assignment,
            manifestation: save.nextManifestation,
            revision: save.revision,
            changedSelection,
            changedDerivative: derivativeSnapshot(derivative),
            derivativeHead: derivativeHeadSnapshot(derivativeHead),
          }),
        }),
      ],
    })
  } catch (error) {
    throw commitFailure(error)
  }
}

// B-1011: the workstation's regenerated text for a gene, appended to the gene's
// system lineage with its Tags in one command, the standing form of what B-994's
// one-off migration did for 669 genes. It becomes canonical only while the system
// lineage is canonical, so a caretaker's version keeps winning. One guard, one
// receipt, one event, like the caretaker's combined save (B-859 step 3).
export async function appendSystemRevisionWithTags(
  db,
  {
    geneId,
    storage: rawStorage,
    tags,
    expectedHeadVersion,
    expectedCanonicalRevisionId,
    expectedSystemRevisionId,
    revisionId,
    selectionId,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const actorKind = command.actorKind || "service"
  if (!["service", "administrator"].includes(actorKind)) {
    throw authorityError(
      "SYSTEM_REVISION_SERVICE_REQUIRED",
      "System revisions are written by the workstation's service authority",
      403,
    )
  }
  const replay = await resolveCommandReplay(db, command, {
    actorKind,
    actorAccountId: command.actorAccountId,
  })
  if (replay) return replay
  const gene = await requireActiveGene(db, geneId)
  const head = await readHead(db, gene.gene_id)
  const manifestation = await first(
    db,
    `SELECT * FROM icono_manifestations
      WHERE gene_id = ? AND origin = 'system_seed' AND status = 'active'
      ORDER BY created_at ASC LIMIT 1`,
    gene.gene_id,
  )
  if (!manifestation?.manifestation_head_revision_id) {
    throw authorityError("SYSTEM_LINEAGE_NOT_FOUND", "This gene has no system text to revise", 404)
  }
  const expectedHead = normalizeVersion(expectedHeadVersion, "expected_head_version")
  const expectedCanonical = normalizeOptionalId(
    expectedCanonicalRevisionId,
    "expected_canonical_revision_id",
  )
  const expectedSystem = normalizeOptionalId(
    expectedSystemRevisionId,
    "expected_system_revision_id",
  )
  if (
    expectedHead !== Number(head.head_version) ||
    expectedCanonical !== (head.canonical_revision_id || null) ||
    (expectedSystem && expectedSystem !== manifestation.manifestation_head_revision_id)
  ) {
    throw authorityError(
      "STALE_AUTHORITY_STATE",
      "The gene changed since this regeneration was prepared",
      409,
    )
  }
  const previousRevision = await readRevision(db, manifestation.manifestation_head_revision_id)
  const storage = storageFields(rawStorage)
  const revisionIdNorm = createId(revisionId, "manifestation_revision_id", "revision", idFactory)
  requireOpaqueObjectLocator(storage, revisionIdNorm)
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({ ...command, actorKind })
  const revisionNumber = Number(previousRevision?.revision_number || 0) + 1
  const derivativeId = createId(
    tags?.derivativeId,
    "manifestation_derivative_id",
    "derivative",
    idFactory,
  )
  const { derivative, statements: derivativeStatements } = manualTagsDerivative(db, {
    ...tags,
    derivativeId,
    revisionId: revisionIdNorm,
    sourceBodySha256: storage.body_sha256,
    timestamp,
  })
  const derivativeHead = {
    manifestation_revision_id: revisionIdNorm,
    accepted_derivative_id: derivativeId,
    derivative_head_version: 1,
  }
  const select = head.canonical_manifestation_id === manifestation.manifestation_id
  const selectionIdNorm = select
    ? createId(selectionId, "canonical_selection_id", "selection", idFactory)
    : null
  const nextHead = select
    ? {
        ...head,
        canonical_revision_id: revisionIdNorm,
        canonical_selection_id: selectionIdNorm,
        head_version: Number(head.head_version) + 1,
        gene_revision: Number(head.gene_revision) + 1,
      }
    : { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const nextManifestation = {
    ...manifestation,
    manifestation_head_revision_id: revisionIdNorm,
    row_version: Number(manifestation.row_version) + 1,
  }
  const revision = {
    manifestation_revision_id: revisionIdNorm,
    manifestation_id: manifestation.manifestation_id,
    revision_number: revisionNumber,
    parent_revision_id: previousRevision?.manifestation_revision_id || null,
    source_revision_id: null,
    body_sha256: storage.body_sha256,
    body_bytes: storage.body_bytes,
    author_account_id: null,
    caretaker_assignment_id: null,
    lifecycle_status: "active",
    lifecycle_version: 1,
    created_at: timestamp,
  }
  const changedSelection = select
    ? canonicalSelectionRecord({
        selectionId: selectionIdNorm,
        geneId: gene.gene_id,
        head,
        nextHead,
        manifestationId: manifestation.manifestation_id,
        revisionId: revisionIdNorm,
        actorAccountId: null,
        assignmentId: null,
        reason: "select",
        commandId: cmd.commandId,
        timestamp,
      })
    : null
  const statements = [
    ...revisionInsertStatements(db, {
      manifestationId: manifestation.manifestation_id,
      revisionId: revisionIdNorm,
      revisionNumber,
      parentRevisionId: previousRevision?.manifestation_revision_id || null,
      sourceRevisionId: null,
      baseSelectionId: head.canonical_selection_id,
      actorAccountId: null,
      assignmentId: null,
      storage,
      timestamp,
    }),
    prepared(
      db,
      `UPDATE icono_manifestations
          SET manifestation_head_revision_id = ?, row_version = row_version + 1, updated_at = ?
        WHERE manifestation_id = ? AND row_version = ?`,
      revisionIdNorm,
      timestamp,
      manifestation.manifestation_id,
      Number(manifestation.row_version),
    ),
    ...derivativeStatements,
    prepared(
      db,
      `UPDATE icono_manifestation_derivative_heads
          SET accepted_derivative_id = ?, derivative_head_version = 1, updated_at = ?
        WHERE manifestation_revision_id = ? AND derivative_head_version = 0`,
      derivativeId,
      timestamp,
      revisionIdNorm,
    ),
    select
      ? prepared(
          db,
          `INSERT INTO icono_manifestation_canonical_selections (
             canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
             selected_manifestation_id, selected_revision_id, actor_account_id,
             caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 'select', ?, ?, ?, ?)`,
          selectionIdNorm,
          gene.gene_id,
          head.canonical_selection_id,
          head.canonical_revision_id,
          manifestation.manifestation_id,
          revisionIdNorm,
          cmd.commandId,
          nextHead.head_version,
          nextHead.gene_revision,
          timestamp,
        )
      : prepared(
          db,
          `UPDATE icono_manifestation_heads
              SET gene_revision = gene_revision + 1, updated_at = ?
            WHERE gene_id = ? AND gene_revision = ?`,
          timestamp,
          gene.gene_id,
          Number(head.gene_revision),
        ),
    eventStatement(db, {
      eventUuid: createId(eventUuid, "event_uuid", "event", idFactory),
      commandId: cmd.commandId,
      geneId: gene.gene_id,
      geneRevision: nextHead.gene_revision,
      manifestationId: manifestation.manifestation_id,
      revisionId: revisionIdNorm,
      selectionId: selectionIdNorm,
      payloadJson: eventPayload({
        cause: "manifestation.system_revision_appended",
        gene,
        head: nextHead,
        manifestation: nextManifestation,
        revision,
        changedSelection,
        changedDerivative: derivativeSnapshot(derivative),
        derivativeHead: derivativeHeadSnapshot(derivativeHead),
      }),
    }),
  ]
  try {
    return await runCommand({
      db,
      ...cmd,
      commandType: "manifestation.system_revision_append",
      geneId: gene.gene_id,
      response: {
        ok: true,
        manifestation_id: manifestation.manifestation_id,
        manifestation_revision_id: revisionIdNorm,
        revision_number: revisionNumber,
        manifestation_derivative_id: derivativeId,
        canonical_changed: select,
        canonical_revision_id: nextHead.canonical_revision_id,
        canonical_selection_id: nextHead.canonical_selection_id,
        head_version: nextHead.head_version,
        gene_revision: nextHead.gene_revision,
      },
      guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_manifestation_heads h
        JOIN icono_manifestations m ON m.gene_id = h.gene_id
         WHERE h.gene_id = ? AND h.head_version = ? AND h.canonical_revision_id IS ?
           AND m.manifestation_id = ? AND m.row_version = ?
           AND m.manifestation_head_revision_id = ?
      ) THEN 1 ELSE 0 END`,
      guardParams: [
        cmd.commandId,
        gene.gene_id,
        expectedHead,
        expectedCanonical,
        manifestation.manifestation_id,
        Number(manifestation.row_version),
        manifestation.manifestation_head_revision_id,
      ],
      statements,
    })
  } catch (error) {
    throw commitFailure(error)
  }
}
