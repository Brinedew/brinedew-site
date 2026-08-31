import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeId,
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
  prepared,
  readAssignmentManifestation,
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
import { storageFields } from "./manifestation-storage-contract.js"

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

function uploadReconciliation(error, revisionId, storage) {
  const failure =
    error instanceof Error
      ? error
      : authorityError("AUTHORITY_COMMIT_FAILED", "Authority commit failed", 500)
  Object.defineProperty(failure, "storageReconciliation", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      action: "verify_revision_then_delete_if_unreferenced",
      manifestation_revision_id: revisionId,
      object_key: storage.object_key,
      ciphertext_sha256: storage.ciphertext_sha256,
    }),
  })
  return failure
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
    throw uploadReconciliation(error, revisionIdNorm, storage)
  }
}

export async function saveManifestationRevision(
  db,
  {
    assignmentId,
    expectedAssignmentVersion,
    expectedManifestationVersion,
    storage: rawStorage,
    sourceRevisionId = null,
    manifestationId,
    revisionId,
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
    throw uploadReconciliation(
      authorityError(
        "STALE_AUTHORITY_STATE",
        "The caretaker manifestation changed before this command was prepared",
        409,
      ),
      revisionIdNorm,
      storage,
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
  try {
    return await runCommand({
      db,
      ...cmd,
      commandType: "manifestation.save",
      geneId: gene.gene_id,
      response,
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
        prepared(
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
          manifestationId: manifestationIdNorm,
          revisionId: revisionIdNorm,
          assignmentId: assignment.caretaker_assignment_id,
          payloadJson: eventPayload({
            cause: sourceRevisionIdNorm
              ? "manifestation.revision_forked"
              : "manifestation.revision_saved",
            gene,
            head: nextHead,
            assignment,
            manifestation: nextManifestation,
            revision,
          }),
        }),
      ],
    })
  } catch (error) {
    throw uploadReconciliation(error, revisionIdNorm, storage)
  }
}
