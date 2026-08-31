// ARCHITECTURE FENCE [IPD-012]: bounded, resumable operator state machine for
// planning, freezing, encrypted materialization, shadow verification, release,
// and separately backup-gated legacy plaintext retirement.
import {
  activateManifestationAuthority,
  beginManifestationAuthorityCutover,
  freezeLegacyManifestationWriter,
  ManifestationAuthorityCutoverError,
  planNextManifestationCutoverPage,
} from "./manifestation-authority-cutover.js"
import {
  beginLegacyManifestationPlaintextRetirement,
  retireNextLegacyManifestationPlaintextPage,
} from "./manifestation-authority-plaintext-retirement.js"
import { materializeManifestationCutoverItem } from "./manifestation-cutover-materializer.js"
import {
  verifyPublicCanonicalMaterial,
  verifyPublicCanonicalMaterialItem,
} from "./manifestation-public-canonical-material.js"
import {
  advanceManifestationCutoverBackupArtifact,
  beginManifestationCutoverBackupArtifact,
  safeArtifact,
} from "./manifestation-cutover-backup-artifact.js"
import {
  scheduleManifestationCutoverBackupRetention,
  sweepDeletedCutoverBackupAudit,
  sweepManifestationCutoverBackupRetention,
} from "./manifestation-cutover-backup-retention.js"
import { all, first, prepared, requireDatabase } from "./manifestation-authority-repository.js"
import { sweepExpiredManifestationUploadIntents } from "./manifestation-upload-intents.js"

function cutoverError(code, message, status = 409) {
  return new ManifestationAuthorityCutoverError(code, message, status)
}

function pageLimit(raw, maximum = 10) {
  const value = Math.trunc(Number(raw)) || maximum
  return Math.max(1, Math.min(maximum, value))
}

async function readRun(authoringDb, runId) {
  const run = await first(
    authoringDb,
    "SELECT * FROM icono_manifestation_cutover_runs WHERE cutover_run_id = ?",
    runId,
  )
  if (!run) throw cutoverError("CUTOVER_RUN_NOT_FOUND", "Cutover run was not found", 404)
  return run
}

async function reconcileRunCounts(authoringDb, runId, now) {
  await prepared(
    authoringDb,
    `UPDATE icono_manifestation_cutover_runs
        SET adopted_items = (
              SELECT count(*) FROM icono_manifestation_cutover_items
               WHERE cutover_run_id = ?
                 AND status IN ('adopted', 'projected', 'verified')
            ),
            verified_items = (
              SELECT count(*) FROM icono_manifestation_cutover_items
               WHERE cutover_run_id = ? AND status = 'verified'
            ),
            updated_at = ?
      WHERE cutover_run_id = ?`,
    runId,
    runId,
    now,
    runId,
  ).run()
}

export async function readManifestationCutoverStatus(authoringDb, primaryDb, cutoverRunId) {
  requireDatabase(authoringDb)
  requireDatabase(primaryDb)
  const run = await readRun(authoringDb, cutoverRunId)
  const [counts, primary, authority, retirement, backup] = await Promise.all([
    first(
      authoringDb,
      `SELECT count(*) AS total,
              sum(CASE WHEN status = 'planned' THEN 1 ELSE 0 END) AS planned,
              sum(CASE WHEN status = 'uploading' THEN 1 ELSE 0 END) AS uploading,
              sum(CASE WHEN status = 'adopted' THEN 1 ELSE 0 END) AS adopted,
              sum(CASE WHEN status = 'registered_unseeded' THEN 1 ELSE 0 END) AS unseeded,
              sum(CASE WHEN status = 'projected' THEN 1 ELSE 0 END) AS projected,
              sum(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
              sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
         FROM icono_manifestation_cutover_items WHERE cutover_run_id = ?`,
      cutoverRunId,
    ),
    first(primaryDb, "SELECT * FROM icono_manifestation_projection_authority WHERE singleton = 1"),
    first(
      authoringDb,
      "SELECT authority_epoch, authority_mode FROM icono_authority_state WHERE singleton = 1",
    ),
    first(primaryDb, "SELECT * FROM icono_manifestation_plaintext_retirement WHERE singleton = 1"),
    first(
      authoringDb,
      "SELECT * FROM icono_manifestation_cutover_backup_artifacts WHERE cutover_run_id = ?",
      cutoverRunId,
    ),
  ])
  return Object.freeze({
    schema_version: 1,
    cutover_run_id: run.cutover_run_id,
    source_snapshot_id: run.source_snapshot_id,
    source_snapshot_sha256: run.source_snapshot_sha256 || null,
    target_authority_epoch: Number(run.target_authority_epoch),
    status: run.status,
    scan_after_symbol: run.scan_after_symbol || null,
    planned_items: Number(run.planned_items),
    source_gene_count: Number(run.source_gene_count || 0),
    source_manifestation_count: Number(run.source_manifestation_count || 0),
    source_manifestation_bytes: Number(run.source_manifestation_bytes || 0),
    counts: Object.freeze(
      Object.fromEntries(
        [
          "total",
          "planned",
          "uploading",
          "adopted",
          "unseeded",
          "projected",
          "verified",
          "failed",
        ].map((key) => [key, Number(counts?.[key] || 0)]),
      ),
    ),
    authority: Object.freeze({
      epoch: Number(authority?.authority_epoch || 0),
      mode: authority?.authority_mode || null,
    }),
    primary: Object.freeze({
      epoch: Number(primary?.authority_epoch || 0),
      mode: primary?.mode || null,
      source_snapshot_sha256: primary?.source_snapshot_sha256 || null,
      plaintext_retired_at: primary?.plaintext_retired_at || null,
    }),
    retirement: retirement
      ? Object.freeze({
          status: retirement.status,
          scan_after_symbol: retirement.scan_after_symbol || null,
          retired_rows: Number(retirement.retired_rows || 0),
          retired_bytes: Number(retirement.retired_bytes || 0),
          verified_at: retirement.verified_at || null,
        })
      : null,
    backup: backup
      ? Object.freeze({
          ...safeArtifact(backup),
          retention_expires_at: backup.retention_expires_at || null,
          deletion_status: backup.status,
          deleted_object_count:
            backup.deleted_object_count == null ? null : Number(backup.deleted_object_count),
          deletion_receipt_sha256: backup.deletion_receipt_sha256 || null,
          deleted_at: backup.deleted_at || null,
        })
      : null,
  })
}

async function freezeCutover(primaryDb, authoringDb, run, actorAccountId, now) {
  if (run.status !== "ready" && run.status !== "importing") {
    throw cutoverError("CUTOVER_NOT_READY", "Cutover planning must finish before writer freeze")
  }
  await freezeLegacyManifestationWriter(primaryDb, {
    targetAuthorityEpoch: run.target_authority_epoch,
    sourceSnapshotSha256: run.source_snapshot_sha256,
    expectedGeneCount: run.source_gene_count,
    actorAccountId,
  })
  const result = await prepared(
    authoringDb,
    `UPDATE icono_authority_state
        SET authority_epoch = ?, updated_at = ?
      WHERE singleton = 1 AND authority_mode = 'shadow'
        AND authority_epoch <= ?`,
    Number(run.target_authority_epoch),
    now,
    Number(run.target_authority_epoch),
  ).run()
  const state = await first(
    authoringDb,
    "SELECT authority_epoch, authority_mode FROM icono_authority_state WHERE singleton = 1",
  )
  if (
    state?.authority_mode !== "shadow" ||
    Number(state.authority_epoch) !== Number(run.target_authority_epoch)
  ) {
    throw cutoverError(
      "CUTOVER_AUTHORITY_EPOCH_MISMATCH",
      "Authoring authority did not enter the frozen epoch",
    )
  }
  if (Number(result?.meta?.changes || 0) > 1) {
    throw cutoverError(
      "CUTOVER_AUTHORITY_EPOCH_RACE",
      "Authoring authority epoch changed concurrently",
    )
  }
  await prepared(
    authoringDb,
    `UPDATE icono_manifestation_cutover_runs
        SET status = 'importing', updated_at = ?
      WHERE cutover_run_id = ? AND status IN ('ready', 'importing')`,
    now,
    run.cutover_run_id,
  ).run()
}

async function itemStatus(authoringDb, runId, geneId) {
  return first(
    authoringDb,
    `SELECT * FROM icono_manifestation_cutover_items
      WHERE cutover_run_id = ? AND gene_id = ?`,
    runId,
    geneId,
  )
}

async function latestProjectionEvent(authoringDb, geneId) {
  const latest = await first(
    authoringDb,
    `SELECT event_uuid, event_sequence, payload_json
       FROM icono_manifestation_events WHERE gene_id = ?
      ORDER BY event_sequence DESC LIMIT 1`,
    geneId,
  )
  if (!latest) throw new Error("cutover_seed_event_missing")
  return Object.freeze({
    event_id: latest.event_uuid,
    event_sequence: Number(latest.event_sequence),
    gene_id: geneId,
    payload: JSON.parse(latest.payload_json),
  })
}

async function markItem(authoringDb, item, fromStatuses, status, now) {
  const slots = fromStatuses.map(() => "?").join(", ")
  await prepared(
    authoringDb,
    `UPDATE icono_manifestation_cutover_items
        SET status = ?, failure_code = NULL, failure_message = NULL,
            next_attempt_at = NULL, updated_at = ?
      WHERE cutover_run_id = ? AND gene_id = ? AND status IN (${slots})`,
    status,
    now,
    item.cutover_run_id,
    item.gene_id,
    ...fromStatuses,
  ).run()
  return itemStatus(authoringDb, item.cutover_run_id, item.gene_id)
}

async function verifyAndMarkItem(context, item, now) {
  const proof = await verifyPublicCanonicalMaterialItem({
    primaryDb: context.primaryDb,
    authoringDb: context.authoringDb,
    env: context.env,
    run: item.cutover_run_id,
    item,
    onIntegrityFailure: context.onIntegrityFailure,
  })
  const result = await prepared(
    context.authoringDb,
    `UPDATE icono_manifestation_cutover_items
        SET status = 'verified', authority_event_sequence = ?,
            public_material_proof_sha256 = ?, public_material_event_sequence = ?,
            public_material_verified_at = ?, verified_at = ?,
            failure_code = NULL, failure_message = NULL,
            next_attempt_at = NULL, updated_at = ?
      WHERE cutover_run_id = ? AND gene_id = ? AND status = 'projected'
        AND public_material_proof_sha256 IS NULL
        AND public_material_event_sequence IS NULL
        AND public_material_verified_at IS NULL`,
    Number(proof.authority_event_sequence),
    proof.public_material_proof_sha256,
    Number(proof.authority_event_sequence),
    now,
    now,
    now,
    item.cutover_run_id,
    item.gene_id,
  ).run()
  if (Number(result?.meta?.changes || 0) !== 1) {
    throw cutoverError(
      "CUTOVER_PUBLIC_MATERIAL_PROOF_RACE",
      "Cutover public material proof changed concurrently",
    )
  }
  return itemStatus(context.authoringDb, item.cutover_run_id, item.gene_id)
}

async function recordItemFailure(authoringDb, item, error, now) {
  console.error("[ICONOPLASM_CUTOVER_ITEM_FAILURE]", {
    cutover_run_id: String(item.cutover_run_id || "").slice(0, 96),
    gene_id: String(item.gene_id || "").slice(0, 96),
    item_status: String(item.status || "").slice(0, 40),
    error_name: String(error?.name || "Error").slice(0, 80),
    error_code: String(error?.code || "CUTOVER_ITEM_TRANSIENT_FAILURE").slice(0, 96),
    // Cutover errors never interpolate source prose. Keep the message bounded
    // so operational diagnosis cannot turn into a payload logging path.
    error_message: String(error?.message || "Cutover item failed").slice(0, 320),
  })
  const permanent = /^CUTOVER_(?:SOURCE|INVALID|FIELDS|TAGS)/.test(String(error?.code || ""))
  const retryDelayMs = isStoragePropagationPending(error) ? 5_000 : 2 * 60 * 1000
  const nextAttempt = new Date(Date.parse(now) + retryDelayMs).toISOString()
  const boundedFailureMessage = `${String(error?.name || "Error").slice(0, 80)}: ${String(
    error?.message || "Cutover item failed",
  ).slice(0, 320)}`
  const failureCode = String(error?.code || "CUTOVER_ITEM_TRANSIENT_FAILURE").slice(0, 96)
  if (permanent) {
    await prepared(
      authoringDb,
      `UPDATE icono_manifestation_cutover_items
          SET status = 'failed', attempts = attempts + 1, failure_code = ?,
              failure_message = COALESCE(failure_message, ?),
              next_attempt_at = NULL, updated_at = ?
        WHERE cutover_run_id = ? AND gene_id = ?`,
      failureCode,
      boundedFailureMessage,
      now,
      item.cutover_run_id,
      item.gene_id,
    ).run()
    return
  }
  await prepared(
    authoringDb,
    `UPDATE icono_manifestation_cutover_items
        SET attempts = attempts + 1, failure_code = ?,
            failure_message = COALESCE(failure_message, ?),
            next_attempt_at = ?, updated_at = ?
      WHERE cutover_run_id = ? AND gene_id = ?`,
    failureCode,
    boundedFailureMessage,
    nextAttempt,
    now,
    item.cutover_run_id,
    item.gene_id,
  ).run()
}

function isStoragePropagationPending(error) {
  return (
    error?.code === "CUTOVER_STORAGE_PENDING" ||
    /^PUBLIC_CANONICAL_(?:REVISION|TAGS)_BODY_UNAVAILABLE$/.test(String(error?.code || ""))
  )
}

async function processOneItem(context, rawItem, now) {
  let item = rawItem
  if (item.status === "failed")
    item = await markItem(context.authoringDb, item, ["failed"], "planned", now)
  if (item.source_kind === "no_manifestation") {
    if (item.status === "planned") {
      await materializeManifestationCutoverItem({ ...context, item, now })
      await markItem(context.authoringDb, item, ["planned"], "registered_unseeded", now)
      return
    }
    if (item.status === "registered_unseeded") {
      if (typeof context.projectShadowEvent !== "function") {
        throw cutoverError(
          "CUTOVER_PROJECTOR_REQUIRED",
          "A gated shadow-frozen projector is required",
          500,
        )
      }
      await context.projectShadowEvent({
        primaryDb: context.primaryDb,
        authoringDb: context.authoringDb,
        cutoverRunId: item.cutover_run_id,
        event: await latestProjectionEvent(context.authoringDb, item.gene_id),
      })
      await markItem(context.authoringDb, item, ["registered_unseeded"], "projected", now)
      return
    }
    if (item.status === "projected") {
      await verifyAndMarkItem(context, item, now)
    }
    return
  }
  if (item.status === "planned") {
    await markItem(context.authoringDb, item, ["planned"], "uploading", now)
    return
  }
  if (item.status === "uploading") {
    const result = await materializeManifestationCutoverItem({ ...context, item, now })
    if (result.complete !== true) return
    await markItem(context.authoringDb, item, ["uploading"], "adopted", now)
    return
  }
  if (item.status === "adopted") {
    if (typeof context.projectShadowEvent !== "function") {
      throw cutoverError(
        "CUTOVER_PROJECTOR_REQUIRED",
        "A gated shadow-frozen projector is required",
        500,
      )
    }
    await context.projectShadowEvent({
      primaryDb: context.primaryDb,
      authoringDb: context.authoringDb,
      cutoverRunId: item.cutover_run_id,
      event: await latestProjectionEvent(context.authoringDb, item.gene_id),
    })
    await markItem(context.authoringDb, item, ["adopted"], "projected", now)
    return
  }
  if (item.status === "projected") {
    await verifyAndMarkItem(context, item, now)
  }
}

async function materializePage(context, run, input, now) {
  if (!new Set(["importing", "seeded"]).has(run.status)) {
    throw cutoverError("CUTOVER_NOT_IMPORTING", "Cutover is not in materialization state")
  }
  // Public Free-plan HTTP invocations have a 10 ms CPU ceiling. Bulk cutover
  // actions are therefore routed through the dedicated SQLite Durable Object,
  // whose documented Free-plan CPU envelope is 30 seconds. Keep the old
  // single-item ceiling fail-closed if this function is ever called directly.
  const durableCutover = context.env?.ICONOPLASM_CUTOVER_EXECUTION_PLANE === "durable_object"
  const limit = pageLimit(input.limit, durableCutover ? 25 : 1)
  const shardCount = Math.trunc(Number(input.shardCount)) || 1
  const shardIndex = Math.trunc(Number(input.shardIndex)) || 0
  if (![1, 2, 4, 8, 16].includes(shardCount) || shardIndex < 0 || shardIndex >= shardCount) {
    throw cutoverError("INVALID_CUTOVER_SHARD", "Cutover shard identity is invalid", 400)
  }
  await sweepExpiredManifestationUploadIntents(context.authoringDb, context.env, { now, limit: 10 })
  const retryFailed = input.retryFailed === true
  const shardClause =
    shardCount === 1 ? "" : "AND (instr('0123456789abcdef', substr(gene_id, -1, 1)) - 1) % ? = ?"
  const queryParams =
    shardCount === 1
      ? [run.cutover_run_id, now, limit]
      : [run.cutover_run_id, now, shardCount, shardIndex, limit]
  const items = await all(
    context.authoringDb,
    `SELECT * FROM icono_manifestation_cutover_items
      WHERE cutover_run_id = ?
        AND status IN (${
          retryFailed
            ? "'planned', 'uploading', 'adopted', 'registered_unseeded', 'projected', 'failed'"
            : "'planned', 'uploading', 'adopted', 'registered_unseeded', 'projected'"
        })
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        ${shardClause}
      ORDER BY canonical_symbol COLLATE NOCASE ASC LIMIT ?`,
    ...queryParams,
  )
  // The page query is the single deterministic claim point. Concurrency lives
  // between disjoint shard requests, while each request owns one gene phase.
  let processed = 0
  let failed = 0
  for (const rawItem of items) {
    try {
      // The edge fallback advances exactly one phase. Inside the Free-plan
      // Durable Object, drain a small fixed number of already-durable phases
      // so obsolete edge-era request churn does not dominate the migration.
      // Bunny propagation still throws CUTOVER_STORAGE_PENDING immediately;
      // that preserves the resumable boundary and never sleeps in this loop.
      const phaseLimit = durableCutover ? 8 : 1
      let current = rawItem
      for (let phase = 0; phase < phaseLimit; phase += 1) {
        await processOneItem(context, current, now)
        current = await itemStatus(context.authoringDb, current.cutover_run_id, current.gene_id)
        if (!current || current.status === "verified" || current.status === "failed") break
      }
      processed += 1
    } catch (error) {
      await recordItemFailure(
        context.authoringDb,
        (await itemStatus(context.authoringDb, rawItem.cutover_run_id, rawItem.gene_id)) || rawItem,
        error,
        now,
      )
      failed += 1
    }
  }
  await reconcileRunCounts(context.authoringDb, run.cutover_run_id, now)
  const remaining = await first(
    context.authoringDb,
    `SELECT count(*) AS total FROM icono_manifestation_cutover_items
      WHERE cutover_run_id = ? AND status <> 'verified'`,
    run.cutover_run_id,
  )
  if (Number(remaining?.total || 0) === 0) {
    await prepared(
      context.authoringDb,
      `UPDATE icono_manifestation_cutover_runs SET status = 'seeded', updated_at = ?
        WHERE cutover_run_id = ? AND status = 'importing'`,
      now,
      run.cutover_run_id,
    ).run()
  }
  return Object.freeze({ processed, failed, remaining: Number(remaining?.total || 0) })
}

async function verifyCutover(authoringDb, primaryDb, env, run, now) {
  await reconcileRunCounts(authoringDb, run.cutover_run_id, now)
  const refreshed = await readRun(authoringDb, run.cutover_run_id)
  await verifyPublicCanonicalMaterial({ primaryDb, authoringDb, run: refreshed })
  const primary = await first(
    primaryDb,
    "SELECT * FROM icono_manifestation_projection_authority WHERE singleton = 1",
  )
  if (
    refreshed.status !== "seeded" ||
    Number(refreshed.verified_items) !== Number(refreshed.planned_items) ||
    primary?.mode !== "shadow_frozen" ||
    Number(primary.authority_epoch) !== Number(refreshed.target_authority_epoch) ||
    primary.source_snapshot_sha256 !== refreshed.source_snapshot_sha256 ||
    Number(primary.expected_gene_count) !== Number(refreshed.source_gene_count)
  ) {
    throw cutoverError(
      "CUTOVER_SHADOW_VERIFICATION_FAILED",
      "Cutover counts or frozen authority identity differ",
    )
  }
  await prepared(
    authoringDb,
    `UPDATE icono_manifestation_cutover_runs
        SET status = 'shadow_verified', updated_at = ?
      WHERE cutover_run_id = ? AND status = 'seeded'`,
    now,
    refreshed.cutover_run_id,
  ).run()
}

export async function advanceManifestationAuthorityCutover({
  primaryDb,
  authoringDb,
  env,
  projectShadowEvent,
  input = {},
  actor = {},
} = {}) {
  requireDatabase(primaryDb)
  requireDatabase(authoringDb)
  const action = String(input.action || "status")
    .trim()
    .toLowerCase()
  const now = input.now || new Date().toISOString()
  const runId = String(input.cutoverRunId || "").trim()
  if (action === "create") {
    if (input.dryRun === true) {
      return Object.freeze({ dry_run: true, action, cutover_run_id: runId })
    }
    await beginManifestationAuthorityCutover(authoringDb, {
      cutoverRunId: runId,
      sourceSnapshotId: input.sourceSnapshotId,
      targetAuthorityEpoch: input.targetAuthorityEpoch,
      createdByActorKind: actor.actorKind,
      createdByAccountId: actor.actorAccountId,
      now,
    })
  } else if (action === "status") {
    return readManifestationCutoverStatus(authoringDb, primaryDb, runId)
  } else {
    const run = await readRun(authoringDb, runId)
    if (input.dryRun === true) {
      return Object.freeze({ dry_run: true, action, status: run.status, cutover_run_id: runId })
    }
    if (action === "plan") {
      await planNextManifestationCutoverPage(primaryDb, authoringDb, {
        cutoverRunId: runId,
        limit: Math.max(1, Math.min(250, Number(input.limit) || 100)),
        now,
      })
    } else if (action === "freeze") {
      await freezeCutover(primaryDb, authoringDb, run, actor.actorAccountId, now)
    } else if (action === "materialize") {
      await materializePage({ primaryDb, authoringDb, env, projectShadowEvent }, run, input, now)
    } else if (action === "verify") {
      await verifyCutover(authoringDb, primaryDb, env, run, now)
    } else if (action === "activate") {
      if (input.confirm !== "activate_verified_authority") {
        throw cutoverError(
          "CUTOVER_CONFIRMATION_REQUIRED",
          "Explicit authority activation confirmation is required",
          400,
        )
      }
      await verifyPublicCanonicalMaterial({ primaryDb, authoringDb, run })
      await activateManifestationAuthority(authoringDb, primaryDb, { cutoverRunId: runId, now })
    } else if (action === "begin_backup") {
      await beginManifestationCutoverBackupArtifact(authoringDb, env, {
        cutoverRunId: runId,
        backupArtifactId: input.backupArtifactId,
        idFactory: input.idFactory,
        now,
      })
    } else if (action === "backup") {
      await advanceManifestationCutoverBackupArtifact(authoringDb, env, {
        cutoverRunId: runId,
        limit: input.limit,
        now,
      })
    } else if (action === "begin_retirement") {
      if (input.confirm !== "retire_verified_legacy_plaintext") {
        throw cutoverError(
          "CUTOVER_CONFIRMATION_REQUIRED",
          "Explicit plaintext retirement confirmation is required",
          400,
        )
      }
      await verifyPublicCanonicalMaterial({ primaryDb, authoringDb, run })
      await beginLegacyManifestationPlaintextRetirement(authoringDb, primaryDb, env, {
        cutoverRunId: runId,
        sourceSnapshotSha256: run.source_snapshot_sha256,
        backupArtifactId: input.backupArtifactId,
        now,
      })
    } else if (action === "retire_plaintext") {
      const retirement = await retireNextLegacyManifestationPlaintextPage(primaryDb, {
        limit: Math.max(1, Math.min(250, Number(input.limit) || 100)),
        now,
      })
      if (retirement.status === "verified") {
        await scheduleManifestationCutoverBackupRetention(authoringDb, {
          cutoverRunId: runId,
          backupArtifactId: retirement.backup_artifact_id,
          plaintextRetirementVerifiedAt: retirement.verified_at,
          now,
        })
      }
    } else if (action === "sweep_backup_retention") {
      await sweepManifestationCutoverBackupRetention(authoringDb, env, { limit: input.limit, now })
    } else if (action === "sweep_backup_audit") {
      await sweepDeletedCutoverBackupAudit(authoringDb, { limit: input.limit, now })
    } else {
      throw cutoverError("CUTOVER_INVALID_ACTION", "Cutover action is invalid", 400)
    }
  }
  return readManifestationCutoverStatus(authoringDb, primaryDb, runId)
}

// ARCHITECTURE FENCE [IPD-012]
