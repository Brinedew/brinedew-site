import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeId,
  normalizeTimestamp,
} from "./manifestation-authority-contract.js"
import { sha256Hex } from "../../lib/iconoplasm-envelope-crypto.js"
import { all, first, prepared, requireDatabase } from "./manifestation-authority-repository.js"
import {
  checkpointRecordsFromBaseline,
  checkpointRecordsFromEvent,
} from "./manifestation-checkpoint-entities.js"
import { advanceManifestationSnapshotChain } from "./manifestation-snapshot-hash.js"

const ZERO_SHA256 = "0".repeat(64)

function boundedLimit(raw, fallback = 25, max = 50) {
  return Math.max(1, Math.min(max, Math.trunc(Number(raw)) || fallback))
}

function boundedSeconds(raw, fallback, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.trunc(Number(raw)) || fallback))
}

function decodeKey(raw) {
  if (!raw) return ["", ""]
  try {
    const value = JSON.parse(raw)
    if (Array.isArray(value) && value.length === 2) return value.map(String)
  } catch {
    // Corrupt checkpoint state is handled as an authority error below.
  }
  throw authorityError("CORRUPT_EVENT_CHECKPOINT", "Checkpoint build cursor is invalid", 500)
}

function encodeKey(kind, key) {
  return JSON.stringify([String(kind), String(key)])
}

async function readCheckpoint(db, checkpointId) {
  return first(
    db,
    `SELECT checkpoint_id, authority_epoch, base_checkpoint_id,
            base_watermark_event_sequence, target_watermark_event_sequence,
            status, build_phase, build_after_key, build_after_event_sequence,
            build_event_entity_offset, next_entity_ordinal, verify_chain_sha256,
            total_entities, manifest_sha256, expires_at, created_at,
            verified_at, activated_at, superseded_at, prune_completed_at
       FROM icono_manifestation_event_checkpoints WHERE checkpoint_id = ?`,
    checkpointId,
  )
}

export async function readActiveManifestationEventCheckpoint(db) {
  requireDatabase(db)
  return first(
    db,
    `SELECT checkpoint_id, authority_epoch, base_checkpoint_id,
            base_watermark_event_sequence, target_watermark_event_sequence,
            status, total_entities, manifest_sha256, activated_at, prune_completed_at
       FROM icono_manifestation_event_checkpoints INDEXED BY uq_icono_active_event_checkpoint
      WHERE status = 'active' LIMIT 1`,
  )
}

function publicCheckpoint(row, resumed = false) {
  return Object.freeze({
    schema_version: 1,
    checkpoint_id: row.checkpoint_id,
    status: row.status,
    authority_epoch: Number(row.authority_epoch),
    base_checkpoint_id: row.base_checkpoint_id || null,
    base_watermark_sequence: Number(row.base_watermark_event_sequence),
    watermark_sequence: Number(row.target_watermark_event_sequence),
    build_phase: row.build_phase,
    build_after_event_sequence: Number(row.build_after_event_sequence),
    total_entities: row.total_entities == null ? null : Number(row.total_entities),
    manifest_sha256: row.manifest_sha256 || null,
    expires_at: row.expires_at,
    verified_at: row.verified_at || null,
    activated_at: row.activated_at || null,
    prune_completed_at: row.prune_completed_at || null,
    resumed,
  })
}

export async function readManifestationEventCheckpointStatus(db, input = {}) {
  requireDatabase(db)
  const checkpointId = normalizeId(input.checkpointId, "checkpoint_id")
  const checkpoint = await readCheckpoint(db, checkpointId)
  if (!checkpoint)
    throw authorityError("EVENT_CHECKPOINT_NOT_FOUND", "Event checkpoint was not found", 404)
  return publicCheckpoint(checkpoint)
}

export async function startManifestationEventCheckpoint(db, input = {}) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(input.now)
  const existing = await first(
    db,
    `SELECT checkpoint_id FROM icono_manifestation_event_checkpoints
      WHERE status IN ('building', 'verified') LIMIT 1`,
  )
  if (existing) return publicCheckpoint(await readCheckpoint(db, existing.checkpoint_id), true)

  const state = await first(
    db,
    "SELECT authority_epoch, event_retention_floor FROM icono_authority_state WHERE singleton = 1",
  )
  const active = await readActiveManifestationEventCheckpoint(db)
  const floor = Number(state?.event_retention_floor || 0)
  if (
    (floor > 0 && !active) ||
    (active &&
      (Number(active.authority_epoch) !== Number(state.authority_epoch) ||
        Number(active.target_watermark_event_sequence) !== floor))
  ) {
    throw authorityError(
      "EVENT_CHECKPOINT_BASE_MISSING",
      "Retained event history has no verified checkpoint base",
      500,
    )
  }

  const auditRetentionSeconds = boundedSeconds(
    input.auditRetentionSeconds,
    7 * 86_400,
    3_600,
    90 * 86_400,
  )
  const cutoff = new Date(
    new Date(timestamp).getTime() - auditRetentionSeconds * 1000,
  ).toISOString()
  const eligible = await first(
    db,
    `SELECT COALESCE(MAX(event_sequence), 0) AS watermark
       FROM icono_manifestation_events
      WHERE unixepoch(created_at) <= unixepoch(?)`,
    cutoff,
  )
  const requested =
    input.watermarkSequence == null
      ? Number(eligible?.watermark || 0)
      : Number(input.watermarkSequence)
  if (
    !Number.isSafeInteger(requested) ||
    requested <= floor ||
    requested > Number(eligible?.watermark || 0)
  ) {
    throw authorityError(
      "NO_EVENTS_ELIGIBLE_FOR_COMPACTION",
      "No event prefix is old enough to compact at the requested watermark",
      409,
    )
  }
  const checkpointId = createId(
    input.checkpointId,
    "checkpoint_id",
    "checkpoint",
    input.idFactory || defaultIdFactory,
  )
  const ttlSeconds = boundedSeconds(input.ttlSeconds, 24 * 3_600, 3_600, 7 * 86_400)
  const expiresAt = new Date(new Date(timestamp).getTime() + ttlSeconds * 1000).toISOString()
  const phase = active ? "checkpoint_entities" : "gene_baselines"
  try {
    await prepared(
      db,
      `INSERT INTO icono_manifestation_event_checkpoints (
         checkpoint_id, authority_epoch, base_checkpoint_id,
         base_watermark_event_sequence, target_watermark_event_sequence,
         status, build_phase, build_after_event_sequence,
         expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, 'building', ?, ?, ?, ?)`,
      checkpointId,
      Number(state.authority_epoch),
      active?.checkpoint_id || null,
      floor,
      requested,
      phase,
      floor,
      expiresAt,
      timestamp,
    ).run()
  } catch (error) {
    if (
      /uq_icono_building_event_checkpoint|unique constraint failed/i.test(
        String(error?.message || ""),
      )
    ) {
      throw authorityError(
        "EVENT_CHECKPOINT_BUILD_IN_PROGRESS",
        "Another checkpoint is already building",
        409,
        error,
      )
    }
    throw error
  }
  return publicCheckpoint(await readCheckpoint(db, checkpointId))
}

async function hashedRecord(value) {
  return {
    ...value,
    payloadSha256: await sha256Hex(new TextEncoder().encode(value.entityJson)),
  }
}

function upsertEntity(db, checkpointId, entity) {
  return prepared(
    db,
    `INSERT INTO icono_manifestation_event_checkpoint_entities (
       checkpoint_id, entity_kind, entity_key, gene_id,
       source_event_sequence, entity_json, payload_sha256
     ) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(checkpoint_id, entity_kind, entity_key) DO UPDATE SET
       gene_id = excluded.gene_id,
       source_event_sequence = excluded.source_event_sequence,
       entity_json = excluded.entity_json,
       payload_sha256 = excluded.payload_sha256,
       entity_ordinal = NULL
     WHERE icono_manifestation_event_checkpoint_entities.source_event_sequence
       <= excluded.source_event_sequence`,
    checkpointId,
    entity.entityKind,
    entity.entityKey,
    entity.geneId,
    entity.sourceEventSequence,
    entity.entityJson,
    entity.payloadSha256,
  )
}

async function buildBaselinePage(db, checkpoint, limit) {
  const after = String(checkpoint.build_after_key || "")
  const rows = await all(
    db,
    `SELECT gene_id, canonical_symbol, registered_at
       FROM icono_gene_identity_baselines WHERE gene_id > ? ORDER BY gene_id LIMIT ?`,
    after,
    limit,
  )
  if (!rows.length) {
    await prepared(
      db,
      `UPDATE icono_manifestation_event_checkpoints
          SET build_phase = 'events', build_after_key = NULL
        WHERE checkpoint_id = ? AND status = 'building'
          AND build_phase = 'gene_baselines' AND build_after_key IS ?`,
      checkpoint.checkpoint_id,
      checkpoint.build_after_key,
    ).run()
    return { inserted: 0, phase: "events" }
  }
  const records = []
  for (const row of rows) {
    for (const value of checkpointRecordsFromBaseline(row)) records.push(await hashedRecord(value))
  }
  const statements = records.map((value) => upsertEntity(db, checkpoint.checkpoint_id, value))
  statements.push(
    prepared(
      db,
      `UPDATE icono_manifestation_event_checkpoints SET build_after_key = ?
      WHERE checkpoint_id = ? AND status = 'building'
        AND build_phase = 'gene_baselines' AND build_after_key IS ?`,
      rows.at(-1).gene_id,
      checkpoint.checkpoint_id,
      checkpoint.build_after_key,
    ),
  )
  await db.batch(statements)
  return { inserted: records.length, phase: "gene_baselines" }
}

async function copyCheckpointPage(db, checkpoint, limit) {
  const [afterKind, afterKey] = decodeKey(checkpoint.build_after_key)
  const rows = await all(
    db,
    `SELECT entity_kind, entity_key, gene_id, source_event_sequence,
            entity_json, payload_sha256
       FROM icono_manifestation_event_checkpoint_entities
      WHERE checkpoint_id = ?
        AND (entity_kind > ? OR (entity_kind = ? AND entity_key > ?))
      ORDER BY entity_kind, entity_key LIMIT ?`,
    checkpoint.base_checkpoint_id,
    afterKind,
    afterKind,
    afterKey,
    limit,
  )
  if (!rows.length) {
    await prepared(
      db,
      `UPDATE icono_manifestation_event_checkpoints
          SET build_phase = 'events', build_after_key = NULL
        WHERE checkpoint_id = ? AND status = 'building'
          AND build_phase = 'checkpoint_entities' AND build_after_key IS ?`,
      checkpoint.checkpoint_id,
      checkpoint.build_after_key,
    ).run()
    return { inserted: 0, phase: "events" }
  }
  const statements = rows.map((row) =>
    upsertEntity(db, checkpoint.checkpoint_id, {
      entityKind: row.entity_kind,
      entityKey: row.entity_key,
      geneId: row.gene_id,
      sourceEventSequence: Number(row.source_event_sequence),
      entityJson: row.entity_json,
      payloadSha256: row.payload_sha256,
    }),
  )
  statements.push(
    prepared(
      db,
      `UPDATE icono_manifestation_event_checkpoints SET build_after_key = ?
      WHERE checkpoint_id = ? AND status = 'building'
        AND build_phase = 'checkpoint_entities' AND build_after_key IS ?`,
      encodeKey(rows.at(-1).entity_kind, rows.at(-1).entity_key),
      checkpoint.checkpoint_id,
      checkpoint.build_after_key,
    ),
  )
  await db.batch(statements)
  return { inserted: rows.length, phase: "checkpoint_entities" }
}

async function applyEventPage(db, checkpoint, limit) {
  const event = await first(
    db,
    `SELECT event_sequence, gene_id, payload_json
       FROM icono_manifestation_events
      WHERE event_sequence > ? AND event_sequence <= ?
      ORDER BY event_sequence LIMIT 1`,
    Number(checkpoint.build_after_event_sequence),
    Number(checkpoint.target_watermark_event_sequence),
  )
  if (!event) {
    await prepared(
      db,
      `UPDATE icono_manifestation_event_checkpoints
          SET build_phase = 'verify', build_after_key = NULL,
              build_event_entity_offset = 0, next_entity_ordinal = 1,
              verify_chain_sha256 = ?
        WHERE checkpoint_id = ? AND status = 'building' AND build_phase = 'events'
          AND build_after_event_sequence = ?`,
      ZERO_SHA256,
      checkpoint.checkpoint_id,
      Number(checkpoint.build_after_event_sequence),
    ).run()
    return { inserted: 0, phase: "verify" }
  }
  const records = checkpointRecordsFromEvent(event)
  const offset = Number(checkpoint.build_event_entity_offset)
  if (offset > records.length) {
    throw authorityError("CORRUPT_EVENT_CHECKPOINT", "Checkpoint event offset is invalid", 500)
  }
  const page = records.slice(offset, offset + limit)
  const encoded = []
  for (const value of page) encoded.push(await hashedRecord(value))
  const complete = offset + page.length >= records.length
  const statements = encoded.map((value) => upsertEntity(db, checkpoint.checkpoint_id, value))
  statements.push(
    prepared(
      db,
      `UPDATE icono_manifestation_event_checkpoints
        SET build_after_event_sequence = ?, build_event_entity_offset = ?
      WHERE checkpoint_id = ? AND status = 'building' AND build_phase = 'events'
        AND build_after_event_sequence = ? AND build_event_entity_offset = ?`,
      complete ? Number(event.event_sequence) : Number(checkpoint.build_after_event_sequence),
      complete ? 0 : offset + page.length,
      checkpoint.checkpoint_id,
      Number(checkpoint.build_after_event_sequence),
      offset,
    ),
  )
  await db.batch(statements)
  return { inserted: page.length, phase: "events", event_sequence: Number(event.event_sequence) }
}

async function verifyEntityPage(db, checkpoint, limit, timestamp) {
  const [afterKind, afterKey] = decodeKey(checkpoint.build_after_key)
  const rows = await all(
    db,
    `SELECT entity_kind, entity_key, entity_json, payload_sha256
       FROM icono_manifestation_event_checkpoint_entities
      WHERE checkpoint_id = ?
        AND (entity_kind > ? OR (entity_kind = ? AND entity_key > ?))
      ORDER BY entity_kind, entity_key LIMIT ?`,
    checkpoint.checkpoint_id,
    afterKind,
    afterKind,
    afterKey,
    limit,
  )
  if (!rows.length) {
    await prepared(
      db,
      `UPDATE icono_manifestation_event_checkpoints
          SET status = 'verified', build_phase = 'ready', verified_at = ?,
              total_entities = next_entity_ordinal - 1,
              manifest_sha256 = verify_chain_sha256
        WHERE checkpoint_id = ? AND status = 'building' AND build_phase = 'verify'
          AND build_after_key IS ?`,
      timestamp,
      checkpoint.checkpoint_id,
      checkpoint.build_after_key,
    ).run()
    return { inserted: 0, phase: "ready" }
  }
  let chain = checkpoint.verify_chain_sha256
  let ordinal = Number(checkpoint.next_entity_ordinal)
  const statements = []
  for (const row of rows) {
    const actual = await sha256Hex(new TextEncoder().encode(row.entity_json))
    if (actual !== row.payload_sha256) {
      throw authorityError(
        "EVENT_CHECKPOINT_HASH_MISMATCH",
        "Checkpoint entity hash failed verification",
        500,
      )
    }
    chain = await advanceManifestationSnapshotChain(chain, ordinal, actual)
    statements.push(
      prepared(
        db,
        `UPDATE icono_manifestation_event_checkpoint_entities SET entity_ordinal = ?
        WHERE checkpoint_id = ? AND entity_kind = ? AND entity_key = ?
          AND payload_sha256 = ?`,
        ordinal,
        checkpoint.checkpoint_id,
        row.entity_kind,
        row.entity_key,
        actual,
      ),
    )
    ordinal += 1
  }
  statements.push(
    prepared(
      db,
      `UPDATE icono_manifestation_event_checkpoints
        SET build_after_key = ?, next_entity_ordinal = ?, verify_chain_sha256 = ?
      WHERE checkpoint_id = ? AND status = 'building' AND build_phase = 'verify'
        AND build_after_key IS ? AND next_entity_ordinal = ? AND verify_chain_sha256 = ?`,
      encodeKey(rows.at(-1).entity_kind, rows.at(-1).entity_key),
      ordinal,
      chain,
      checkpoint.checkpoint_id,
      checkpoint.build_after_key,
      Number(checkpoint.next_entity_ordinal),
      checkpoint.verify_chain_sha256,
    ),
  )
  await db.batch(statements)
  return { inserted: rows.length, phase: "verify" }
}

export async function buildManifestationEventCheckpointPage(db, input = {}) {
  requireDatabase(db)
  const checkpointId = normalizeId(input.checkpointId, "checkpoint_id")
  const timestamp = normalizeTimestamp(input.now)
  const checkpoint = await readCheckpoint(db, checkpointId)
  if (!checkpoint)
    throw authorityError("EVENT_CHECKPOINT_NOT_FOUND", "Event checkpoint was not found", 404)
  if (checkpoint.status === "verified" || checkpoint.status === "active") {
    return { ...publicCheckpoint(checkpoint), inserted: 0 }
  }
  if (checkpoint.status !== "building" || checkpoint.expires_at <= timestamp) {
    if (checkpoint.status === "building") {
      await prepared(
        db,
        "UPDATE icono_manifestation_event_checkpoints SET status = 'failed' WHERE checkpoint_id = ? AND status = 'building'",
        checkpointId,
      ).run()
    }
    throw authorityError("EVENT_CHECKPOINT_EXPIRED", "Event checkpoint build expired", 410)
  }
  const limit = boundedLimit(input.limit)
  let progress
  if (checkpoint.build_phase === "gene_baselines") {
    progress = await buildBaselinePage(db, checkpoint, Math.max(1, Math.floor(limit / 3)))
  } else if (checkpoint.build_phase === "checkpoint_entities") {
    progress = await copyCheckpointPage(db, checkpoint, limit)
  } else if (checkpoint.build_phase === "events") {
    progress = await applyEventPage(db, checkpoint, limit)
  } else if (checkpoint.build_phase === "verify") {
    progress = await verifyEntityPage(db, checkpoint, limit, timestamp)
  } else {
    throw authorityError("CORRUPT_EVENT_CHECKPOINT", "Checkpoint build phase is invalid", 500)
  }
  return Object.freeze({
    ...publicCheckpoint(await readCheckpoint(db, checkpointId)),
    inserted: progress.inserted,
  })
}

export async function activateManifestationEventCheckpoint(db, input = {}) {
  requireDatabase(db)
  const checkpointId = normalizeId(input.checkpointId, "checkpoint_id")
  const timestamp = normalizeTimestamp(input.now)
  const checkpoint = await readCheckpoint(db, checkpointId)
  if (!checkpoint)
    throw authorityError("EVENT_CHECKPOINT_NOT_FOUND", "Event checkpoint was not found", 404)
  if (checkpoint.status === "active") return publicCheckpoint(checkpoint, true)
  if (checkpoint.status !== "verified") {
    throw authorityError("EVENT_CHECKPOINT_NOT_VERIFIED", "Event checkpoint is not verified", 409)
  }
  if (
    Number(input.totalEntities) !== Number(checkpoint.total_entities) ||
    String(input.manifestSha256 || "").toLowerCase() !== checkpoint.manifest_sha256
  ) {
    throw authorityError(
      "EVENT_CHECKPOINT_PROOF_MISMATCH",
      "Checkpoint activation proof does not match",
      409,
    )
  }
  const target = Number(checkpoint.target_watermark_event_sequence)
  const consumerActiveSeconds = boundedSeconds(
    input.consumerActiveSeconds,
    24 * 3_600,
    3_600,
    30 * 86_400,
  )
  const consumerCutoff = new Date(
    new Date(timestamp).getTime() - consumerActiveSeconds * 1000,
  ).toISOString()
  const laggingConsumer = await first(
    db,
    `SELECT consumer_id FROM icono_manifestation_consumer_cursors
      WHERE unixepoch(updated_at) > unixepoch(?) AND last_event_sequence < ?
      ORDER BY consumer_id LIMIT 1`,
    consumerCutoff,
    target,
  )
  if (laggingConsumer) {
    throw authorityError(
      "EVENT_COMPACTION_CONSUMER_LAGGING",
      "An active replica has not reached the checkpoint",
      409,
    )
  }
  const openSnapshot = await first(
    db,
    `SELECT snapshot_id FROM icono_manifestation_snapshot_leases
      WHERE status IN ('building', 'open') AND expires_at > ?
        AND source_checkpoint_watermark_sequence < ? LIMIT 1`,
    timestamp,
    target,
  )
  if (openSnapshot) {
    throw authorityError(
      "EVENT_COMPACTION_SNAPSHOT_OPEN",
      "A snapshot still depends on the compacted event prefix",
      409,
    )
  }
  const unpublished = await first(
    db,
    `SELECT event_sequence FROM icono_manifestation_events
      WHERE event_sequence <= ? AND projection_status NOT IN ('published', 'not_required')
      ORDER BY event_sequence LIMIT 1`,
    target,
  )
  if (unpublished) {
    throw authorityError(
      "EVENT_COMPACTION_PROJECTION_PENDING",
      "An event has not finished projection delivery",
      409,
    )
  }
  const missingReceipt = await first(
    db,
    `SELECT event.event_sequence
       FROM icono_manifestation_events event
       LEFT JOIN icono_authoring_command_receipts receipt
         ON receipt.command_id = event.command_id
      WHERE event.event_sequence > ? AND event.event_sequence <= ?
        AND (receipt.accepted_event_sequence IS NOT event.event_sequence
          OR receipt.accepted_event_uuid IS NOT event.event_uuid)
      LIMIT 1`,
    Number(checkpoint.base_watermark_event_sequence),
    target,
  )
  if (missingReceipt) {
    throw authorityError(
      "EVENT_COMPACTION_RECEIPT_INCOMPLETE",
      "Event receipt identity is not durable",
      500,
    )
  }
  const state = await first(
    db,
    "SELECT authority_epoch, event_retention_floor FROM icono_authority_state WHERE singleton = 1",
  )
  if (
    Number(state.authority_epoch) !== Number(checkpoint.authority_epoch) ||
    Number(state.event_retention_floor) !== Number(checkpoint.base_watermark_event_sequence)
  ) {
    throw authorityError(
      "STALE_EVENT_CHECKPOINT",
      "Authority retention state changed during checkpoint build",
      409,
    )
  }
  const statements = []
  if (checkpoint.base_checkpoint_id) {
    statements.push(
      prepared(
        db,
        `UPDATE icono_manifestation_event_checkpoints
          SET status = 'superseded', superseded_at = ?
        WHERE checkpoint_id = ? AND status = 'active'
          AND target_watermark_event_sequence = ?`,
        timestamp,
        checkpoint.base_checkpoint_id,
        Number(checkpoint.base_watermark_event_sequence),
      ),
    )
  }
  statements.push(
    prepared(
      db,
      `UPDATE icono_manifestation_event_checkpoints
          SET status = 'active', activated_at = ?
        WHERE checkpoint_id = ? AND status = 'verified'`,
      timestamp,
      checkpointId,
    ),
    prepared(
      db,
      `UPDATE icono_authority_state SET event_retention_floor = ?, updated_at = ?
        WHERE singleton = 1 AND authority_epoch = ? AND event_retention_floor = ?`,
      target,
      timestamp,
      Number(checkpoint.authority_epoch),
      Number(checkpoint.base_watermark_event_sequence),
    ),
  )
  try {
    await db.batch(statements)
  } catch (error) {
    if (/checkpoint_snapshot_open/.test(String(error?.message || ""))) {
      throw authorityError(
        "EVENT_COMPACTION_SNAPSHOT_OPEN",
        "A snapshot still depends on the compacted event prefix",
        409,
        error,
      )
    }
    if (/checkpoint_source_changed/.test(String(error?.message || ""))) {
      throw authorityError(
        "STALE_EVENT_CHECKPOINT",
        "Authority retention state changed during checkpoint activation",
        409,
        error,
      )
    }
    throw error
  }
  const activated = await readCheckpoint(db, checkpointId)
  if (activated.status !== "active") {
    throw authorityError(
      "STALE_EVENT_CHECKPOINT",
      "Checkpoint activation lost its compare-and-swap",
      409,
    )
  }
  return publicCheckpoint(activated)
}

export async function pruneManifestationEventPage(db, input = {}) {
  requireDatabase(db)
  const checkpointId = normalizeId(input.checkpointId, "checkpoint_id")
  const timestamp = normalizeTimestamp(input.now)
  const checkpoint = await readCheckpoint(db, checkpointId)
  if (!checkpoint || checkpoint.status !== "active") {
    throw authorityError("EVENT_CHECKPOINT_NOT_ACTIVE", "Event checkpoint is not active", 409)
  }
  const limit = boundedLimit(input.limit, 20, 25)
  const rows = await all(
    db,
    `SELECT event_sequence, event_uuid FROM icono_manifestation_events
      WHERE event_sequence <= ? ORDER BY event_sequence LIMIT ?`,
    Number(checkpoint.target_watermark_event_sequence),
    limit,
  )
  if (!rows.length) {
    await prepared(
      db,
      `UPDATE icono_manifestation_event_checkpoints SET prune_completed_at = COALESCE(prune_completed_at, ?)
        WHERE checkpoint_id = ? AND status = 'active'`,
      timestamp,
      checkpointId,
    ).run()
    return Object.freeze({
      schema_version: 1,
      checkpoint_id: checkpointId,
      pruned: 0,
      complete: true,
    })
  }
  const statements = []
  for (const row of rows) {
    statements.push(
      prepared(
        db,
        `INSERT INTO icono_manifestation_event_compaction_delete_guards (
           event_sequence, event_uuid, checkpoint_id, created_at
         ) VALUES (?, ?, ?, ?)`,
        Number(row.event_sequence),
        row.event_uuid,
        checkpointId,
        timestamp,
      ),
      prepared(
        db,
        "DELETE FROM icono_manifestation_events WHERE event_sequence = ? AND event_uuid = ?",
        Number(row.event_sequence),
        row.event_uuid,
      ),
      prepared(
        db,
        "DELETE FROM icono_manifestation_event_compaction_delete_guards WHERE event_sequence = ?",
        Number(row.event_sequence),
      ),
    )
  }
  await db.batch(statements)
  return Object.freeze({
    schema_version: 1,
    checkpoint_id: checkpointId,
    pruned: rows.length,
    complete: rows.length < limit,
  })
}

export async function sweepManifestationEventCheckpoints(db, input = {}) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(input.now)
  const retentionSeconds = boundedSeconds(input.retentionSeconds, 24 * 3_600, 3_600, 7 * 86_400)
  const cutoff = new Date(new Date(timestamp).getTime() - retentionSeconds * 1000).toISOString()
  const limit = boundedLimit(input.limit, 10, 20)
  await prepared(
    db,
    `UPDATE icono_manifestation_event_checkpoints SET status = 'failed'
      WHERE status = 'building' AND expires_at <= ?`,
    timestamp,
  ).run()
  const rows = await all(
    db,
    `SELECT checkpoint_id FROM icono_manifestation_event_checkpoints checkpoint
      WHERE checkpoint.status IN ('failed', 'superseded')
        AND unixepoch(COALESCE(checkpoint.superseded_at, checkpoint.expires_at)) <= unixepoch(?)
        AND NOT EXISTS (
          SELECT 1 FROM icono_manifestation_event_checkpoints candidate
           WHERE candidate.base_checkpoint_id = checkpoint.checkpoint_id
             AND candidate.status IN ('building', 'verified')
        )
      ORDER BY COALESCE(checkpoint.superseded_at, checkpoint.expires_at), checkpoint_id
      LIMIT ?`,
    cutoff,
    limit,
  )
  for (const row of rows) {
    await prepared(
      db,
      `DELETE FROM icono_manifestation_event_checkpoints
        WHERE checkpoint_id = ? AND status IN ('failed', 'superseded')`,
      row.checkpoint_id,
    ).run()
  }
  return Object.freeze({ schema_version: 1, purged: rows.length })
}
