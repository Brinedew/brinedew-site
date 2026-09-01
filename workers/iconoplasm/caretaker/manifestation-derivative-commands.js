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
  commandInputs,
  eventPayload,
  eventStatement,
  first,
  prepared,
  readHead,
  readManifestation,
  readRevision,
  requireActiveAccount,
  requireActiveGene,
  requireDatabase,
  resolveCommandReplay,
  runCommand,
} from "./manifestation-authority-repository.js"

async function derivativeActor(db, command) {
  const actorKind = normalizeActorKind(command.actorKind || "service")
  if (!new Set(["account", "administrator", "service", "migration"]).has(actorKind)) {
    throw authorityError(
      "DERIVATIVE_SERVICE_REQUIRED",
      "Derivative service authority is required",
      403,
    )
  }
  const actorAccountId = normalizeOptionalId(command.actorAccountId, "actor_account_id")
  if (actorAccountId) await requireActiveAccount(db, actorAccountId)
  const replay = await resolveCommandReplay(db, command, { actorKind, actorAccountId })
  return { actorAccountId, actorKind, replay }
}

function boundedToken(raw, label, { nullable = false } = {}) {
  if (nullable && (raw == null || raw === "")) return null
  const value = String(raw || "").trim()
  if (!value || value.length > 256 || !/^[A-Za-z0-9._:/@+-]+$/.test(value)) {
    throw authorityError("INVALID_DERIVATIVE_PROVENANCE", `${label} is invalid`)
  }
  return value
}

function derivativeStorage(raw) {
  const value = raw && typeof raw === "object" ? raw : {}
  const bodyBytes = Number(value.body_bytes)
  const ciphertextBytes = Number(value.ciphertext_bytes)
  if (!Number.isSafeInteger(bodyBytes) || bodyBytes < 1 || bodyBytes > 32 * 1024) {
    throw authorityError("INVALID_DERIVATIVE_BODY_SIZE", "Tags body size is invalid")
  }
  if (ciphertextBytes !== bodyBytes + 16) {
    throw authorityError("INVALID_DERIVATIVE_CIPHERTEXT_SIZE", "Tags ciphertext size is invalid")
  }
  const objectKey = String(value.object_key || "").trim()
  const locator =
    objectKey
      .split("/")
      .at(-1)
      ?.replace(/\.bin$/, "") || ""
  if (
    !/^private\/manifestations\/v1\/[a-f0-9]{2}\/[A-Za-z0-9_-]{32,128}\.bin$/.test(objectKey) ||
    locator.length < 32
  ) {
    throw authorityError("INVALID_DERIVATIVE_OBJECT_KEY", "Tags storage locator is invalid")
  }
  const keyVersion = Number(value.key_version)
  if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) {
    throw authorityError("INVALID_KEY_VERSION", "Tags key version is invalid")
  }
  for (const field of ["body_iv_base64", "wrapped_dek_base64", "wrap_iv_base64"]) {
    if (!/^[A-Za-z0-9_-]{12,256}$/.test(String(value[field] || ""))) {
      throw authorityError("INVALID_ENCRYPTION_METADATA", `${field} is invalid`)
    }
  }
  return {
    body_sha256: normalizeSha256(value.body_sha256, "body_sha256"),
    body_bytes: bodyBytes,
    object_key: objectKey,
    ciphertext_sha256: normalizeSha256(value.ciphertext_sha256, "ciphertext_sha256"),
    ciphertext_bytes: ciphertextBytes,
    body_iv_base64: String(value.body_iv_base64),
    wrapped_dek_base64: String(value.wrapped_dek_base64),
    wrap_iv_base64: String(value.wrap_iv_base64),
    key_version: keyVersion,
    aad_version: 1,
    object_etag: String(value.object_etag || "").trim() || null,
    verified_at: normalizeTimestamp(value.verified_at),
  }
}

function derivativeSnapshot(row) {
  return row
    ? {
        manifestation_derivative_id: row.manifestation_derivative_id,
        manifestation_revision_id: row.manifestation_revision_id,
        derivative_kind: "tags",
        status: row.status,
        source_body_sha256: row.source_body_sha256,
        body_sha256: row.body_sha256 || null,
        body_bytes: row.body_bytes == null ? null : Number(row.body_bytes),
        tags_sha256: row.tags_sha256 || null,
        tags_bytes: row.tags_bytes == null ? null : Number(row.tags_bytes),
        fields_sha256: row.fields_sha256 || null,
        fields_bytes: row.fields_bytes == null ? null : Number(row.fields_bytes),
        recipe_id: row.recipe_id || null,
        recipe_version: row.recipe_version || null,
        provider_id: row.provider_id || null,
        model_id: row.model_id || null,
        tagger_config_sha256: row.tagger_config_sha256 || null,
        provenance_status: row.provenance_status,
        failure_code: row.failure_code || null,
        created_at: row.created_at,
        completed_at: row.completed_at || null,
      }
    : null
}

function derivativeHeadSnapshot(row) {
  return {
    manifestation_revision_id: row.manifestation_revision_id,
    accepted_derivative_id: row.accepted_derivative_id || null,
    derivative_head_version: Number(row.derivative_head_version),
  }
}

export async function submitTagsDerivative(
  db,
  {
    revisionId,
    status,
    sourceBodySha256,
    tagsSha256 = null,
    tagsBytes = null,
    fieldsSha256 = null,
    fieldsBytes = null,
    storage: rawStorage = null,
    recipeId = null,
    recipeVersion = null,
    providerId = null,
    modelId = null,
    taggerConfigSha256 = null,
    legacyUnknown = false,
    failureCode = null,
    expectedGeneRevision,
    derivativeId,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const actor = await derivativeActor(db, command)
  if (actor.replay) return actor.replay
  const revision = await readRevision(db, normalizeId(revisionId, "manifestation_revision_id"))
  if (!revision) throw authorityError("REVISION_NOT_FOUND", "Revision was not found", 404)
  const gene = await requireActiveGene(db, revision.gene_id)
  const head = await readHead(db, gene.gene_id)
  const manifestation = await readManifestation(db, revision.manifestation_id)
  if (actor.actorKind === "account") {
    const assignment = await first(
      db,
      `SELECT caretaker_assignment_id FROM icono_caretaker_assignments
        WHERE caretaker_assignment_id = ? AND account_id = ? AND gene_id = ? AND status = 'active'`,
      revision.caretaker_assignment_id,
      actor.actorAccountId,
      gene.gene_id,
    )
    if (!assignment || manifestation.author_account_id !== actor.actorAccountId) {
      throw authorityError(
        "DERIVATIVE_MANIFESTATION_NOT_OWNED",
        "Caretakers may edit Tags only for their current manifestation",
        403,
      )
    }
  }
  const sourceHash = normalizeSha256(sourceBodySha256, "source_body_sha256")
  if (sourceHash !== revision.body_sha256) {
    throw authorityError(
      "DERIVATIVE_SOURCE_STALE",
      "Tags source hash does not match the revision",
      409,
    )
  }
  const statusNorm = String(status || "")
    .trim()
    .toLowerCase()
  if (!new Set(["complete", "failed"]).has(statusNorm)) {
    throw authorityError(
      "INVALID_DERIVATIVE_STATUS",
      "Derivative status must be complete or failed",
    )
  }
  if (legacyUnknown && actor.actorKind !== "migration") {
    throw authorityError(
      "LEGACY_PROVENANCE_FORBIDDEN",
      "Only migration may record unknown provenance",
      403,
    )
  }
  const provenance = legacyUnknown
    ? {
        recipeId: null,
        recipeVersion: null,
        providerId: null,
        modelId: null,
        taggerConfigSha256: null,
        status: "legacy_unknown",
      }
    : {
        recipeId: boundedToken(recipeId, "recipe_id"),
        recipeVersion: boundedToken(recipeVersion, "recipe_version"),
        providerId: boundedToken(providerId, "provider_id"),
        modelId: boundedToken(modelId, "model_id"),
        taggerConfigSha256: normalizeSha256(taggerConfigSha256, "tagger_config_sha256"),
        status: "generated",
      }
  const storage = statusNorm === "complete" ? derivativeStorage(rawStorage) : null
  if (statusNorm === "failed" && rawStorage != null) {
    throw authorityError("FAILED_DERIVATIVE_HAS_BODY", "Failed derivative cannot have a body")
  }
  const outputDescriptor =
    statusNorm === "complete"
      ? {
          tagsSha256: normalizeSha256(tagsSha256, "tags_sha256"),
          tagsBytes: Number(tagsBytes),
          fieldsSha256: normalizeSha256(fieldsSha256, "fields_sha256"),
          fieldsBytes: Number(fieldsBytes),
        }
      : null
  if (
    outputDescriptor &&
    (!Number.isSafeInteger(outputDescriptor.tagsBytes) ||
      outputDescriptor.tagsBytes < 1 ||
      !Number.isSafeInteger(outputDescriptor.fieldsBytes) ||
      outputDescriptor.fieldsBytes < 2 ||
      storage.body_bytes !== outputDescriptor.tagsBytes + 1 + outputDescriptor.fieldsBytes)
  ) {
    throw authorityError("INVALID_DERIVATIVE_BODY_SIZE", "Tags output framing sizes are invalid")
  }
  if (
    statusNorm === "failed" &&
    [tagsSha256, tagsBytes, fieldsSha256, fieldsBytes].some((value) => value != null)
  ) {
    throw authorityError(
      "FAILED_DERIVATIVE_HAS_BODY",
      "Failed derivative cannot have output hashes",
    )
  }
  const failure = statusNorm === "failed" ? boundedToken(failureCode, "failure_code") : null
  const geneRevision = normalizeVersion(expectedGeneRevision, "expected_gene_revision")
  const derivativeIdNorm = createId(
    derivativeId,
    "manifestation_derivative_id",
    "derivative",
    idFactory,
  )
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({
    ...command,
    actorKind: actor.actorKind,
    actorAccountId: actor.actorAccountId,
  })
  const derivative = {
    manifestation_derivative_id: derivativeIdNorm,
    manifestation_revision_id: revision.manifestation_revision_id,
    status: statusNorm,
    source_body_sha256: sourceHash,
    body_sha256: storage?.body_sha256 || null,
    body_bytes: storage?.body_bytes || null,
    tags_sha256: outputDescriptor?.tagsSha256 || null,
    tags_bytes: outputDescriptor?.tagsBytes || null,
    fields_sha256: outputDescriptor?.fieldsSha256 || null,
    fields_bytes: outputDescriptor?.fieldsBytes || null,
    recipe_id: provenance.recipeId,
    recipe_version: provenance.recipeVersion,
    provider_id: provenance.providerId,
    model_id: provenance.modelId,
    tagger_config_sha256: provenance.taggerConfigSha256,
    provenance_status: provenance.status,
    failure_code: failure,
    created_at: timestamp,
    completed_at: timestamp,
  }
  const derivativeHead = await first(
    db,
    `SELECT manifestation_revision_id, accepted_derivative_id, derivative_head_version
       FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?`,
    revision.manifestation_revision_id,
  )
  if (!derivativeHead)
    throw authorityError("DERIVATIVE_HEAD_MISSING", "Derivative head is missing", 500)
  const nextHead = { ...head, gene_revision: Number(head.gene_revision) + 1 }
  const statements = [
    prepared(
      db,
      `INSERT INTO icono_manifestation_derivatives (
         manifestation_derivative_id, manifestation_revision_id, derivative_kind,
         status, source_body_sha256, body_sha256, body_bytes,
         tags_sha256, tags_bytes, fields_sha256, fields_bytes, recipe_id,
         recipe_version, provider_id, model_id, tagger_config_sha256,
         provenance_status, failure_code, created_at, completed_at
       ) VALUES (?, ?, 'tags', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      derivativeIdNorm,
      revision.manifestation_revision_id,
      statusNorm,
      sourceHash,
      derivative.body_sha256,
      derivative.body_bytes,
      derivative.tags_sha256,
      derivative.tags_bytes,
      derivative.fields_sha256,
      derivative.fields_bytes,
      provenance.recipeId,
      provenance.recipeVersion,
      provenance.providerId,
      provenance.modelId,
      provenance.taggerConfigSha256,
      provenance.status,
      failure,
      timestamp,
      timestamp,
    ),
  ]
  if (storage) {
    statements.push(
      prepared(
        db,
        `INSERT INTO icono_manifestation_derivative_storage_secrets (
           manifestation_derivative_id, object_key, ciphertext_sha256, ciphertext_bytes,
           body_iv_base64, wrapped_dek_base64, wrap_iv_base64, key_version,
           aad_version, object_etag, verified_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
        derivativeIdNorm,
        storage.object_key,
        storage.ciphertext_sha256,
        storage.ciphertext_bytes,
        storage.body_iv_base64,
        storage.wrapped_dek_base64,
        storage.wrap_iv_base64,
        storage.key_version,
        storage.object_etag,
        storage.verified_at,
        timestamp,
      ),
    )
  }
  statements.push(
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
      revisionId: revision.manifestation_revision_id,
      assignmentId: revision.caretaker_assignment_id,
      payloadJson: eventPayload({
        cause: `manifestation.tags_${statusNorm}`,
        gene,
        head: nextHead,
        manifestation,
        revision,
        changedDerivative: derivativeSnapshot(derivative),
        derivativeHead: derivativeHeadSnapshot(derivativeHead),
      }),
    }),
  )
  return runCommand({
    db,
    ...cmd,
    commandType: `manifestation.tags_${statusNorm}`,
    geneId: gene.gene_id,
    response: {
      ok: true,
      manifestation_derivative_id: derivativeIdNorm,
      status: statusNorm,
      derivative_head_version: Number(derivativeHead.derivative_head_version),
      gene_revision: nextHead.gene_revision,
      storage_adoption: storage
        ? { status: "adopted", manifestation_derivative_id: derivativeIdNorm }
        : null,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_manifestation_revisions revision
        JOIN icono_manifestations manifestation
          ON manifestation.manifestation_id = revision.manifestation_id
        JOIN icono_manifestation_heads head ON head.gene_id = manifestation.gene_id
        WHERE revision.manifestation_revision_id = ? AND revision.body_sha256 = ?
          AND manifestation.status = 'active' AND head.gene_revision = ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [cmd.commandId, revision.manifestation_revision_id, sourceHash, geneRevision],
    statements,
  })
}

export async function selectTagsDerivativeHead(
  db,
  {
    derivativeId,
    expectedDerivativeHeadVersion,
    expectedGeneRevision,
    eventUuid,
    idFactory = defaultIdFactory,
    now,
    ...command
  } = {},
) {
  requireDatabase(db)
  const actor = await derivativeActor(db, command)
  if (actor.replay) return actor.replay
  const derivativeIdNorm = normalizeId(derivativeId, "manifestation_derivative_id")
  const derivative = await first(
    db,
    `SELECT derivative.*, revision.manifestation_id, manifestation.gene_id,
            revision.caretaker_assignment_id
       FROM icono_manifestation_derivatives derivative
       JOIN icono_manifestation_revisions revision
         ON revision.manifestation_revision_id = derivative.manifestation_revision_id
       JOIN icono_manifestations manifestation
         ON manifestation.manifestation_id = revision.manifestation_id
      WHERE derivative.manifestation_derivative_id = ?`,
    derivativeIdNorm,
  )
  if (!derivative || derivative.status !== "complete") {
    throw authorityError("DERIVATIVE_NOT_ELIGIBLE", "Tags derivative is not eligible", 404)
  }
  const gene = await requireActiveGene(db, derivative.gene_id)
  const head = await readHead(db, gene.gene_id)
  const manifestation = await readManifestation(db, derivative.manifestation_id)
  if (actor.actorKind === "account") {
    const assignment = await first(
      db,
      `SELECT caretaker_assignment_id FROM icono_caretaker_assignments
        WHERE caretaker_assignment_id = ? AND account_id = ? AND gene_id = ? AND status = 'active'`,
      derivative.caretaker_assignment_id,
      actor.actorAccountId,
      gene.gene_id,
    )
    if (!assignment || manifestation.author_account_id !== actor.actorAccountId) {
      throw authorityError(
        "DERIVATIVE_MANIFESTATION_NOT_OWNED",
        "Caretakers may select Tags only for their current manifestation",
        403,
      )
    }
  }
  const revision = await readRevision(db, derivative.manifestation_revision_id)
  const derivativeHead = await first(
    db,
    `SELECT manifestation_revision_id, accepted_derivative_id, derivative_head_version
       FROM icono_manifestation_derivative_heads WHERE manifestation_revision_id = ?`,
    derivative.manifestation_revision_id,
  )
  const expectedDerivativeVersion = normalizeVersion(
    expectedDerivativeHeadVersion,
    "expected_derivative_head_version",
  )
  const geneRevision = normalizeVersion(expectedGeneRevision, "expected_gene_revision")
  const timestamp = normalizeTimestamp(now)
  const cmd = commandInputs({
    ...command,
    actorKind: actor.actorKind,
    actorAccountId: actor.actorAccountId,
  })
  const nextDerivativeHead = {
    manifestation_revision_id: derivative.manifestation_revision_id,
    accepted_derivative_id: derivativeIdNorm,
    derivative_head_version: Number(derivativeHead.derivative_head_version) + 1,
  }
  const nextHead = { ...head, gene_revision: Number(head.gene_revision) + 1 }
  return runCommand({
    db,
    ...cmd,
    commandType: "manifestation.tags_select",
    geneId: gene.gene_id,
    response: {
      ok: true,
      manifestation_derivative_id: derivativeIdNorm,
      derivative_head_version: nextDerivativeHead.derivative_head_version,
      gene_revision: nextHead.gene_revision,
    },
    guardSql: `INSERT INTO icono_authority_command_guards (command_id, guard_value)
      SELECT ?, CASE WHEN EXISTS (
        SELECT 1 FROM icono_manifestation_derivative_heads derivative_head
        JOIN icono_manifestation_derivatives derivative
          ON derivative.manifestation_revision_id = derivative_head.manifestation_revision_id
        JOIN icono_manifestation_revisions revision
          ON revision.manifestation_revision_id = derivative.manifestation_revision_id
        JOIN icono_manifestations manifestation
          ON manifestation.manifestation_id = revision.manifestation_id
        JOIN icono_manifestation_heads head ON head.gene_id = manifestation.gene_id
        WHERE derivative.manifestation_derivative_id = ? AND derivative.status = 'complete'
          AND derivative.source_body_sha256 = revision.body_sha256
          AND derivative_head.derivative_head_version = ? AND head.gene_revision = ?
      ) THEN 1 ELSE 0 END`,
    guardParams: [cmd.commandId, derivativeIdNorm, expectedDerivativeVersion, geneRevision],
    statements: [
      prepared(
        db,
        `UPDATE icono_manifestation_derivative_heads
            SET accepted_derivative_id = ?, derivative_head_version = derivative_head_version + 1,
                updated_at = ?
          WHERE manifestation_revision_id = ? AND derivative_head_version = ?`,
        derivativeIdNorm,
        timestamp,
        derivative.manifestation_revision_id,
        expectedDerivativeVersion,
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
        revisionId: revision.manifestation_revision_id,
        assignmentId: derivative.caretaker_assignment_id,
        payloadJson: eventPayload({
          cause: "manifestation.tags_selected",
          gene,
          head: nextHead,
          manifestation,
          revision,
          changedDerivative: derivativeSnapshot(derivative),
          derivativeHead: derivativeHeadSnapshot(nextDerivativeHead),
        }),
      }),
    ],
  })
}

export { derivativeHeadSnapshot, derivativeSnapshot }

// ARCHITECTURE FENCE [IPD-012]
