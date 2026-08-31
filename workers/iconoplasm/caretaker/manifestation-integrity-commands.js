import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeActorKind,
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
  first,
  prepared,
  readGene,
  readGeneAliases,
  readHead,
  readManifestation,
  requireActiveAccount,
  requireDatabase,
  resolveCommandReplay,
  runCommand,
} from "./manifestation-authority-repository.js"

const INTEGRITY_REASONS = new Set([
  "missing_object",
  "ciphertext_mismatch",
  "decrypt_failed",
  "manual_integrity_failure",
])

async function integrityActor(db, input) {
  const actorKind = normalizeActorKind(input.actorKind || "service")
  if (!new Set(["administrator", "service"]).has(actorKind)) {
    throw authorityError(
      "ADMINISTRATOR_REQUIRED",
      "Integrity quarantine requires service authority",
      403,
    )
  }
  const actorAccountId = normalizeOptionalId(input.actorAccountId, "actor_account_id")
  if (actorKind === "administrator" && !actorAccountId) {
    throw authorityError("AUDIT_ACCOUNT_REQUIRED", "Administrator account is required", 403)
  }
  if (actorAccountId) await requireActiveAccount(db, actorAccountId)
  return { actorKind, actorAccountId }
}

async function readIntegrityRevision(db, revisionId) {
  return first(
    db,
    `SELECT revision.manifestation_revision_id, revision.manifestation_id,
            revision.revision_number, revision.parent_revision_id,
            revision.source_revision_id, revision.body_sha256, revision.body_bytes,
            revision.sample_label, revision.sample_number, revision.sample_text_sha256,
            revision.author_account_id, revision.caretaker_assignment_id,
            revision.created_at, manifestation.gene_id,
            lifecycle.status AS lifecycle_status,
            lifecycle.lifecycle_version, storage.ciphertext_sha256
       FROM icono_manifestation_revisions revision
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       LEFT JOIN icono_manifestation_revision_storage_secrets storage
         ON storage.manifestation_revision_id = revision.manifestation_revision_id
      WHERE revision.manifestation_revision_id = ?`,
    revisionId,
  )
}

async function readIntegrityFallback(db, geneId, excludedRevisionId) {
  return first(
    db,
    `SELECT selection.selected_manifestation_id, selection.selected_revision_id
       FROM icono_manifestation_canonical_selections selection
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = selection.selected_manifestation_id
       JOIN icono_manifestation_revisions revision
         ON revision.manifestation_revision_id = selection.selected_revision_id
       JOIN icono_manifestation_revision_lifecycle lifecycle
         ON lifecycle.manifestation_revision_id = revision.manifestation_revision_id
       JOIN icono_manifestation_revision_storage_secrets storage
         ON storage.manifestation_revision_id = revision.manifestation_revision_id
      WHERE selection.gene_id = ?
        AND selection.selected_revision_id <> ?
        AND manifestation.status = 'active'
        AND lifecycle.status = 'active'
      ORDER BY selection.head_version DESC, selection.canonical_selection_id DESC
      LIMIT 1`,
    geneId,
    excludedRevisionId,
  )
}

export function integrityReconciliationDescriptor({
  revisionId,
  geneId,
  bodySha256,
  ciphertextSha256 = null,
  reasonCode,
} = {}) {
  const reason = String(reasonCode || "")
    .trim()
    .toLowerCase()
  if (!INTEGRITY_REASONS.has(reason)) {
    throw authorityError("INVALID_INTEGRITY_REASON", "Integrity failure reason is invalid")
  }
  return Object.freeze({
    command: "manifestation.revision_integrity_quarantine",
    entity_kind: "revision",
    entity_id: normalizeId(revisionId, "manifestation_revision_id"),
    gene_id: normalizeId(geneId, "gene_id"),
    expected_body_sha256: normalizeSha256(bodySha256, "body_sha256"),
    expected_ciphertext_sha256:
      ciphertextSha256 == null ? null : normalizeSha256(ciphertextSha256, "ciphertext_sha256"),
    reason_code: reason,
  })
}

export async function quarantineManifestationRevision(db, input = {}) {
  requireDatabase(db)
  const actor = await integrityActor(db, input)
  const replay = await resolveCommandReplay(db, input, actor)
  if (replay) return replay
  const revisionId = normalizeId(input.revisionId, "manifestation_revision_id")
  const revision = await readIntegrityRevision(db, revisionId)
  if (!revision)
    throw authorityError("REVISION_NOT_FOUND", "Manifestation revision was not found", 404)
  if (revision.lifecycle_status === "purged") {
    throw authorityError(
      "PURGED_ENTITY_RESTORE_FORBIDDEN",
      "Purged revision cannot be quarantined",
      409,
    )
  }
  if (revision.lifecycle_status !== "active") {
    throw authorityError("REVISION_NOT_ACTIVE", "Only an active revision can be quarantined", 409)
  }
  const reason = String(input.reasonCode || "")
    .trim()
    .toLowerCase()
  if (!INTEGRITY_REASONS.has(reason)) {
    throw authorityError("INVALID_INTEGRITY_REASON", "Integrity failure reason is invalid")
  }
  const gene = await readGene(db, revision.gene_id)
  if (!gene) throw authorityError("GENE_NOT_FOUND", "Gene identity was not found", 404)
  gene.aliases = await readGeneAliases(db, gene.gene_id)
  const head = await readHead(db, gene.gene_id)
  const manifestation = await readManifestation(db, revision.manifestation_id)
  const lifecycleVersion = normalizeVersion(
    input.expectedLifecycleVersion,
    "expected_lifecycle_version",
  )
  const headVersion = normalizeVersion(input.expectedHeadVersion, "expected_head_version")
  const expectedCanonicalRevisionId = normalizeOptionalId(
    input.expectedCanonicalRevisionId,
    "expected_canonical_revision_id",
  )
  const expectedStorageHash =
    input.expectedStorageCiphertextSha256 == null
      ? null
      : normalizeSha256(input.expectedStorageCiphertextSha256, "expected_storage_ciphertext_sha256")
  const isCanonical = head.canonical_revision_id === revisionId
  const fallback = isCanonical ? await readIntegrityFallback(db, gene.gene_id, revisionId) : null
  const timestamp = normalizeTimestamp(input.now)
  const cmd = commandInputs({ ...input, ...actor })
  const selectionId =
    isCanonical && fallback
      ? createId(
          input.selectionId,
          "canonical_selection_id",
          "selection",
          input.idFactory || defaultIdFactory,
        )
      : null
  const nextHead = isCanonical
    ? {
        ...head,
        canonical_manifestation_id: fallback?.selected_manifestation_id || null,
        canonical_revision_id: fallback?.selected_revision_id || null,
        canonical_selection_id: selectionId,
        head_version: Number(head.head_version) + 1,
        gene_revision: Number(head.gene_revision) + 1,
      }
    : { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const changedSelection = fallback
    ? canonicalSelectionRecord({
        selectionId,
        geneId: gene.gene_id,
        head,
        nextHead,
        manifestationId: fallback.selected_manifestation_id,
        revisionId: fallback.selected_revision_id,
        actorAccountId: actor.actorAccountId,
        assignmentId: null,
        reason: "integrity_fallback",
        commandId: cmd.commandId,
        timestamp,
      })
    : null
  const nextRevision = {
    ...revision,
    lifecycle_status: "quarantined",
    lifecycle_version: Number(revision.lifecycle_version) + 1,
  }
  const statements = []
  if (fallback) {
    statements.push(
      prepared(
        db,
        `INSERT INTO icono_manifestation_canonical_selections (
           canonical_selection_id, gene_id, previous_selection_id, previous_revision_id,
           selected_manifestation_id, selected_revision_id, actor_account_id,
           caretaker_assignment_id, reason, command_id, head_version, gene_revision, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'integrity_fallback', ?, ?, ?, ?)`,
        selectionId,
        gene.gene_id,
        head.canonical_selection_id,
        head.canonical_revision_id,
        fallback.selected_manifestation_id,
        fallback.selected_revision_id,
        actor.actorAccountId,
        cmd.commandId,
        nextHead.head_version,
        nextHead.gene_revision,
        timestamp,
      ),
    )
  } else if (isCanonical) {
    statements.push(
      prepared(
        db,
        `UPDATE icono_manifestation_heads
            SET canonical_manifestation_id = NULL, canonical_revision_id = NULL,
                canonical_selection_id = NULL, head_version = head_version + 1,
                gene_revision = gene_revision + 1, updated_at = ?
          WHERE gene_id = ? AND head_version = ? AND gene_revision = ?`,
        timestamp,
        gene.gene_id,
        headVersion,
        Number(head.gene_revision),
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
    prepared(
      db,
      `UPDATE icono_manifestation_revision_lifecycle
          SET status = 'quarantined', lifecycle_version = lifecycle_version + 1,
              changed_by_account_id = ?, change_reason = ?, changed_at = ?
        WHERE manifestation_revision_id = ? AND status = 'active'
          AND lifecycle_version = ?`,
      actor.actorAccountId,
      reason,
      timestamp,
      revisionId,
      lifecycleVersion,
    ),
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
      manifestationId: manifestation.manifestation_id,
      revisionId,
      selectionId,
      assignmentId: revision.caretaker_assignment_id,
      payloadJson: eventPayload({
        cause: "manifestation.revision_integrity_quarantined",
        gene,
        head: nextHead,
        manifestation,
        revision: nextRevision,
        changedSelection,
        tombstones:
          isCanonical && !fallback
            ? [{ entity_type: "canonical_head", entity_id: revisionId, state: "cleared" }]
            : [],
      }),
    }),
  )
  return runCommand({
    db,
    ...cmd,
    commandType: "manifestation.revision_integrity_quarantine",
    geneId: gene.gene_id,
    response: {
      ok: true,
      manifestation_revision_id: revisionId,
      lifecycle_status: "quarantined",
      lifecycle_version: nextRevision.lifecycle_version,
      fallback_revision_id: fallback?.selected_revision_id || null,
      head_version: nextHead.head_version,
      gene_revision: nextHead.gene_revision,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_manifestation_revision_lifecycle lifecycle
        JOIN icono_manifestation_revisions revision
          ON revision.manifestation_revision_id = lifecycle.manifestation_revision_id
        JOIN icono_manifestations manifestation
          ON manifestation.manifestation_id = revision.manifestation_id
        JOIN icono_manifestation_heads head ON head.gene_id = manifestation.gene_id
        WHERE lifecycle.manifestation_revision_id = ? AND lifecycle.status = 'active'
          AND lifecycle.lifecycle_version = ? AND head.head_version = ?
          AND head.canonical_revision_id IS ?
          AND (SELECT ciphertext_sha256 FROM icono_manifestation_revision_storage_secrets
                WHERE manifestation_revision_id = lifecycle.manifestation_revision_id) IS ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [
      cmd.commandId,
      revisionId,
      lifecycleVersion,
      headVersion,
      expectedCanonicalRevisionId,
      expectedStorageHash,
    ],
    statements,
  })
}

// ARCHITECTURE FENCE [IPD-012]
