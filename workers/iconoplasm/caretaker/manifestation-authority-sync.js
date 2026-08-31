import {
  authorityError,
  createId,
  defaultIdFactory,
  normalizeId,
  normalizeTimestamp,
} from "./manifestation-authority-contract.js"
import { sha256Hex } from "../../lib/iconoplasm-envelope-crypto.js"
import { all, first, prepared, requireDatabase } from "./manifestation-authority-repository.js"
import { decodeCursor, encodeCursor } from "./manifestation-sync-cursor.js"
import { checkpointEntityPart } from "./manifestation-checkpoint-entities.js"
import { readActiveManifestationEventCheckpoint } from "./manifestation-authority-checkpoints.js"
import { advanceManifestationSnapshotChain } from "./manifestation-snapshot-hash.js"
import { bytesToBase64Url, utf8Bytes } from "./manifestation-sync-encoding.js"

export async function readManifestationEventPage(db, input = {}) {
  requireDatabase(db)
  const decoded = await decodeCursor(input.cursorSecret, input.cursor, "events")
  const afterSequence = Number(decoded?.after_sequence || 0)
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) {
    throw authorityError("INVALID_CURSOR", "Cursor is invalid")
  }
  const authority = await first(
    db,
    "SELECT authority_epoch, event_retention_floor FROM icono_authority_state WHERE singleton = 1",
  )
  if (decoded && Number(decoded.authority_epoch) !== Number(authority.authority_epoch)) {
    throw authorityError(
      "EVENT_CURSOR_EXPIRED_SNAPSHOT_REQUIRED",
      "Authority epoch changed; create a snapshot",
      410,
    )
  }
  const floor = Number(authority?.event_retention_floor || 0)
  if (afterSequence < floor) {
    throw authorityError(
      "EVENT_CURSOR_EXPIRED_SNAPSHOT_REQUIRED",
      "Event history before this cursor is no longer retained; create a snapshot",
      410,
    )
  }
  const limit = Math.max(1, Math.min(250, Math.trunc(Number(input.limit)) || 100))
  const rows = await all(
    db,
    `SELECT event_sequence, event_uuid, event_type, gene_id, gene_revision,
            manifestation_id, manifestation_revision_id, canonical_selection_id,
            caretaker_assignment_id, payload_json, created_at
       FROM icono_manifestation_events
      WHERE event_sequence > ? ORDER BY event_sequence LIMIT ?`,
    afterSequence,
    limit + 1,
  )
  const page = rows.slice(0, limit).map((row) => ({
    event_id: row.event_uuid,
    event_sequence: Number(row.event_sequence),
    event_type: row.event_type,
    gene_id: row.gene_id,
    gene_revision: Number(row.gene_revision),
    manifestation_id: row.manifestation_id || null,
    manifestation_revision_id: row.manifestation_revision_id || null,
    canonical_selection_id: row.canonical_selection_id || null,
    caretaker_assignment_id: row.caretaker_assignment_id || null,
    payload: JSON.parse(row.payload_json),
    created_at: row.created_at,
  }))
  const nextSequence = page.at(-1)?.event_sequence || afterSequence
  return Object.freeze({
    schema_version: 1,
    authority_epoch: Number(authority.authority_epoch),
    events: page,
    has_more: rows.length > limit,
    resume_cursor: await encodeCursor(input.cursorSecret, {
      version: 1,
      kind: "events",
      authority_epoch: Number(authority.authority_epoch),
      after_sequence: nextSequence,
    }),
  })
}

function baselinePart(row) {
  return {
    schema_version: 1,
    part_kind: "gene_baseline",
    gene: {
      gene_id: row.gene_id,
      canonical_symbol: row.canonical_symbol,
      status: "active",
      merged_into_gene_id: null,
      identity_version: 1,
      aliases: [
        {
          alias_symbol: row.canonical_symbol,
          alias_kind: "canonical",
          valid_from: row.registered_at,
          retired_at: null,
        },
      ],
    },
    canonical: {
      manifestation_id: null,
      manifestation_revision_id: null,
      canonical_selection_id: null,
      head_version: 0,
      gene_revision: 0,
    },
  }
}

function eventPart(row) {
  return {
    schema_version: 1,
    part_kind: "authority_event",
    event: {
      event_id: row.event_uuid,
      event_sequence: Number(row.event_sequence),
      event_type: row.event_type,
      gene_id: row.gene_id,
      gene_revision: Number(row.gene_revision),
      manifestation_id: row.manifestation_id || null,
      manifestation_revision_id: row.manifestation_revision_id || null,
      canonical_selection_id: row.canonical_selection_id || null,
      caretaker_assignment_id: row.caretaker_assignment_id || null,
      payload: JSON.parse(row.payload_json),
      created_at: row.created_at,
    },
  }
}

async function readSnapshotLease(db, snapshotId) {
  return first(
    db,
    `SELECT snapshot_id, consumer_id, authority_epoch, watermark_event_sequence, status,
            source_checkpoint_id, source_checkpoint_watermark_sequence,
            build_phase, build_after_key, next_part_ordinal, build_chain_sha256,
            total_parts, manifest_sha256,
            expires_at, ready_at, created_at, completed_at
       FROM icono_manifestation_snapshot_leases WHERE snapshot_id = ?`,
    snapshotId,
  )
}

export async function createManifestationSnapshot(db, input = {}) {
  requireDatabase(db)
  const consumerId = normalizeId(input.consumerId, "consumer_id")
  const timestamp = normalizeTimestamp(input.now)
  await prepared(
    db,
    `UPDATE icono_manifestation_snapshot_leases SET status = 'expired'
      WHERE consumer_id = ? AND status IN ('building', 'open') AND expires_at <= ?`,
    consumerId,
    timestamp,
  ).run()
  const existing = await first(
    db,
    `SELECT snapshot_id FROM icono_manifestation_snapshot_leases
      WHERE consumer_id = ? AND status IN ('building', 'open') LIMIT 1`,
    consumerId,
  )
  if (existing) {
    const lease = await readSnapshotLease(db, existing.snapshot_id)
    return Object.freeze({
      schema_version: 1,
      snapshot_id: lease.snapshot_id,
      status: lease.status,
      authority_epoch: Number(lease.authority_epoch),
      snapshot_watermark_sequence: Number(lease.watermark_event_sequence),
      expires_at: lease.expires_at,
      resumed: true,
    })
  }
  const state = await first(
    db,
    `SELECT event_retention_floor, authority_epoch,
            MAX(event_retention_floor,
              (SELECT COALESCE(MAX(event_sequence), 0) FROM icono_manifestation_events)
            ) AS watermark
       FROM icono_authority_state WHERE singleton = 1`,
  )
  const floor = Number(state?.event_retention_floor || 0)
  const checkpoint = floor > 0 ? await readActiveManifestationEventCheckpoint(db) : null
  if (
    floor > 0 &&
    (!checkpoint ||
      Number(checkpoint.authority_epoch) !== Number(state.authority_epoch) ||
      Number(checkpoint.target_watermark_event_sequence) !== floor)
  ) {
    throw authorityError(
      "SNAPSHOT_SOURCE_HISTORY_UNAVAILABLE",
      "The compacted event prefix has no verified checkpoint base",
      500,
    )
  }
  const snapshotId = createId(
    input.snapshotId,
    "snapshot_id",
    "snapshot",
    input.idFactory || defaultIdFactory,
  )
  const ttl = Math.max(60, Math.min(3600, Math.trunc(Number(input.ttlSeconds)) || 900))
  const expiresAt = new Date(new Date(timestamp).getTime() + ttl * 1000).toISOString()
  try {
    await prepared(
      db,
      `INSERT INTO icono_manifestation_snapshot_leases (
         snapshot_id, consumer_id, authority_epoch, watermark_event_sequence,
         source_checkpoint_id, source_checkpoint_watermark_sequence, status,
         build_phase, build_after_key, next_part_ordinal,
         expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'building', ?, NULL, 1, ?, ?)`,
      snapshotId,
      consumerId,
      Number(state.authority_epoch),
      Number(state?.watermark || 0),
      checkpoint?.checkpoint_id || null,
      floor,
      checkpoint ? "checkpoint_entities" : "baselines",
      expiresAt,
      timestamp,
    ).run()
  } catch (error) {
    if (
      /uq_icono_open_snapshot_consumer|unique constraint failed/i.test(String(error?.message || ""))
    ) {
      throw authorityError("SNAPSHOT_ALREADY_OPEN", "Consumer already has a snapshot", 409, error)
    }
    throw error
  }
  return Object.freeze({
    schema_version: 1,
    snapshot_id: snapshotId,
    status: "building",
    authority_epoch: Number(state.authority_epoch),
    snapshot_watermark_sequence: Number(state?.watermark || 0),
    expires_at: expiresAt,
    resumed: false,
  })
}

function insertPart(db, snapshotId, ordinal, kind, sourceKey, geneId, payloadJson, payloadSha256) {
  return prepared(
    db,
    `INSERT INTO icono_manifestation_snapshot_parts (
       snapshot_id, ordinal, part_kind, source_key, gene_id, part_json, payload_sha256
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    snapshotId,
    ordinal,
    kind,
    sourceKey,
    geneId,
    payloadJson,
    payloadSha256,
  )
}

export async function computeManifestationSnapshotChainHash(previous, ordinal, payloadSha256) {
  return advanceManifestationSnapshotChain(previous, ordinal, payloadSha256)
}

export async function buildManifestationSnapshotPage(db, input = {}) {
  requireDatabase(db)
  const snapshotId = normalizeId(input.snapshotId, "snapshot_id")
  const timestamp = normalizeTimestamp(input.now)
  const lease = await readSnapshotLease(db, snapshotId)
  if (!lease) throw authorityError("SNAPSHOT_NOT_FOUND", "Snapshot was not found", 404)
  if (lease.status === "open") {
    return Object.freeze({
      schema_version: 1,
      snapshot_id: snapshotId,
      status: "ready",
      authority_epoch: Number(lease.authority_epoch),
      inserted: 0,
      snapshot_watermark_sequence: Number(lease.watermark_event_sequence),
      total_parts: Number(lease.total_parts),
      manifest_sha256: lease.manifest_sha256,
    })
  }
  if (lease.status !== "building" || lease.expires_at <= timestamp) {
    if (lease.status === "building") {
      await prepared(
        db,
        "UPDATE icono_manifestation_snapshot_leases SET status = 'expired' WHERE snapshot_id = ? AND status = 'building'",
        snapshotId,
      ).run()
    }
    throw authorityError("SNAPSHOT_EXPIRED", "Snapshot build is no longer available", 410)
  }
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(input.limit)) || 25))
  const after = String(lease.build_after_key || "")
  const sourceRows =
    lease.build_phase === "baselines"
      ? await all(
          db,
          `SELECT gene_id, canonical_symbol, registered_at
           FROM icono_gene_identity_baselines WHERE gene_id > ?
          ORDER BY gene_id LIMIT ?`,
          after,
          limit,
        )
      : lease.build_phase === "checkpoint_entities"
        ? await all(
            db,
            `SELECT entity.entity_ordinal, entity.entity_kind, entity.entity_key,
                  entity.gene_id, entity.source_event_sequence,
                  entity.entity_json, entity.payload_sha256,
                  checkpoint.checkpoint_id, checkpoint.authority_epoch,
                  checkpoint.target_watermark_event_sequence,
                  checkpoint.manifest_sha256
             FROM icono_manifestation_event_checkpoint_entities entity
             JOIN icono_manifestation_event_checkpoints checkpoint
               ON checkpoint.checkpoint_id = entity.checkpoint_id
            WHERE entity.checkpoint_id = ? AND checkpoint.status = 'active'
              AND entity.entity_ordinal > ?
            ORDER BY entity.entity_ordinal LIMIT ?`,
            lease.source_checkpoint_id,
            Number(after || 0),
            limit,
          )
        : await all(
            db,
            `SELECT event_sequence, event_uuid, event_type, gene_id, gene_revision,
                manifestation_id, manifestation_revision_id, canonical_selection_id,
                caretaker_assignment_id, payload_json, created_at
           FROM icono_manifestation_events
          WHERE event_sequence > ? AND event_sequence <= ?
          ORDER BY event_sequence LIMIT ?`,
            Number(after || 0),
            Number(lease.watermark_event_sequence),
            limit,
          )
  if (!sourceRows.length) {
    if (lease.build_phase === "baselines" || lease.build_phase === "checkpoint_entities") {
      await prepared(
        db,
        `UPDATE icono_manifestation_snapshot_leases
            SET build_phase = 'events', build_after_key = ?
          WHERE snapshot_id = ? AND status = 'building' AND build_phase = ?
            AND build_after_key IS ?`,
        lease.build_phase === "checkpoint_entities"
          ? String(lease.source_checkpoint_watermark_sequence)
          : "0",
        snapshotId,
        lease.build_phase,
        lease.build_after_key,
      ).run()
      return Object.freeze({
        schema_version: 1,
        snapshot_id: snapshotId,
        status: "building",
        authority_epoch: Number(lease.authority_epoch),
        inserted: 0,
      })
    }
    await prepared(
      db,
      `UPDATE icono_manifestation_snapshot_leases
          SET status = 'open', build_phase = 'ready', ready_at = ?,
              total_parts = next_part_ordinal - 1,
              manifest_sha256 = build_chain_sha256
        WHERE snapshot_id = ? AND status = 'building' AND build_phase = 'events'
          AND build_after_key IS ?`,
      timestamp,
      snapshotId,
      lease.build_after_key,
    ).run()
    const ready = await readSnapshotLease(db, snapshotId)
    return Object.freeze({
      schema_version: 1,
      snapshot_id: snapshotId,
      status: "ready",
      authority_epoch: Number(ready.authority_epoch),
      inserted: 0,
      snapshot_watermark_sequence: Number(ready.watermark_event_sequence),
      total_parts: Number(ready.total_parts),
      manifest_sha256: ready.manifest_sha256,
    })
  }

  const startOrdinal = Number(lease.next_part_ordinal)
  let chain = lease.build_chain_sha256
  const encodedParts = []
  for (const [index, row] of sourceRows.entries()) {
    const baseline = lease.build_phase === "baselines"
    const checkpointEntity = lease.build_phase === "checkpoint_entities"
    const ordinal = startOrdinal + index
    const payloadJson = JSON.stringify(
      baseline
        ? baselinePart(row)
        : checkpointEntity
          ? checkpointEntityPart(row, row)
          : eventPart(row),
    )
    const payloadSha256 = await sha256Hex(utf8Bytes(payloadJson))
    chain = await computeManifestationSnapshotChainHash(chain, ordinal, payloadSha256)
    encodedParts.push({ row, baseline, checkpointEntity, ordinal, payloadJson, payloadSha256 })
  }
  const statements = encodedParts.map(
    ({ row, baseline, checkpointEntity, ordinal, payloadJson, payloadSha256 }) =>
      insertPart(
        db,
        snapshotId,
        ordinal,
        baseline
          ? "gene_baseline"
          : checkpointEntity
            ? "authority_checkpoint_entity"
            : "authority_event",
        baseline
          ? row.gene_id
          : checkpointEntity
            ? `${row.entity_kind}:${row.entity_key}`
            : String(row.event_sequence),
        row.gene_id,
        payloadJson,
        payloadSha256,
      ),
  )
  const lastKey =
    lease.build_phase === "baselines"
      ? sourceRows.at(-1).gene_id
      : lease.build_phase === "checkpoint_entities"
        ? String(sourceRows.at(-1).entity_ordinal)
        : String(sourceRows.at(-1).event_sequence)
  statements.push(
    prepared(
      db,
      `UPDATE icono_manifestation_snapshot_leases
          SET build_after_key = ?, next_part_ordinal = next_part_ordinal + ?,
              build_chain_sha256 = ?
        WHERE snapshot_id = ? AND status = 'building' AND build_phase = ?
          AND build_after_key IS ? AND next_part_ordinal = ?
          AND build_chain_sha256 = ?`,
      lastKey,
      sourceRows.length,
      chain,
      snapshotId,
      lease.build_phase,
      lease.build_after_key,
      startOrdinal,
      lease.build_chain_sha256,
    ),
  )
  try {
    await db.batch(statements)
  } catch (error) {
    if (/unique constraint failed|snapshot/i.test(String(error?.message || ""))) {
      throw authorityError(
        "STALE_SNAPSHOT_BUILD",
        "Snapshot build page must be retried",
        409,
        error,
      )
    }
    throw error
  }
  return Object.freeze({
    schema_version: 1,
    snapshot_id: snapshotId,
    status: "building",
    authority_epoch: Number(lease.authority_epoch),
    phase: lease.build_phase,
    inserted: sourceRows.length,
    next_part_ordinal: startOrdinal + sourceRows.length,
  })
}

export async function readManifestationSnapshotPage(db, input = {}) {
  requireDatabase(db)
  const snapshotId = normalizeId(input.snapshotId, "snapshot_id")
  const timestamp = normalizeTimestamp(input.now)
  const lease = await readSnapshotLease(db, snapshotId)
  if (!lease) throw authorityError("SNAPSHOT_NOT_FOUND", "Snapshot was not found", 404)
  if (lease.status === "building") {
    throw authorityError("SNAPSHOT_NOT_READY", "Snapshot is still building", 409)
  }
  if (lease.status !== "open" || lease.expires_at <= timestamp) {
    if (lease.status === "open") {
      await prepared(
        db,
        "UPDATE icono_manifestation_snapshot_leases SET status = 'expired' WHERE snapshot_id = ? AND status = 'open'",
        snapshotId,
      ).run()
    }
    throw authorityError("SNAPSHOT_EXPIRED", "Snapshot is no longer available", 410)
  }
  const decoded = await decodeCursor(input.cursorSecret, input.cursor, "snapshot_parts")
  if (
    decoded &&
    (decoded.snapshot_id !== snapshotId ||
      Number(decoded.authority_epoch) !== Number(lease.authority_epoch) ||
      Number(decoded.watermark_sequence) !== Number(lease.watermark_event_sequence))
  ) {
    throw authorityError("INVALID_CURSOR", "Cursor belongs to another snapshot")
  }
  const afterOrdinal = Number(decoded?.after_ordinal || 0)
  const limit = Math.max(1, Math.min(50, Math.trunc(Number(input.limit)) || 25))
  const rows = await all(
    db,
    `SELECT ordinal, part_kind, source_key, gene_id, part_json, payload_sha256
       FROM icono_manifestation_snapshot_parts
      WHERE snapshot_id = ? AND ordinal > ? ORDER BY ordinal LIMIT ?`,
    snapshotId,
    afterOrdinal,
    limit + 1,
  )
  const page = rows.slice(0, limit)
  const lastOrdinal = Number(page.at(-1)?.ordinal || afterOrdinal)
  return Object.freeze({
    schema_version: 1,
    snapshot_id: snapshotId,
    authority_epoch: Number(lease.authority_epoch),
    snapshot_watermark_sequence: Number(lease.watermark_event_sequence),
    total_parts: Number(lease.total_parts),
    manifest_sha256: lease.manifest_sha256,
    resume_cursor: await encodeCursor(input.cursorSecret, {
      version: 1,
      kind: "events",
      authority_epoch: Number(lease.authority_epoch),
      after_sequence: Number(lease.watermark_event_sequence),
    }),
    payload_encoding: "base64url+utf8-json",
    parts: page.map((row) => ({
      ordinal: Number(row.ordinal),
      part_kind: row.part_kind,
      source_key: row.source_key,
      gene_id: row.gene_id,
      payload_sha256: row.payload_sha256,
      payload_base64url: bytesToBase64Url(utf8Bytes(row.part_json)),
    })),
    has_more: rows.length > limit,
    parts_resume_cursor: await encodeCursor(input.cursorSecret, {
      version: 1,
      kind: "snapshot_parts",
      snapshot_id: snapshotId,
      authority_epoch: Number(lease.authority_epoch),
      watermark_sequence: Number(lease.watermark_event_sequence),
      after_ordinal: lastOrdinal,
    }),
  })
}

export async function completeManifestationSnapshot(db, input = {}) {
  requireDatabase(db)
  const snapshotId = normalizeId(input.snapshotId, "snapshot_id")
  const lease = await readSnapshotLease(db, snapshotId)
  if (!lease) throw authorityError("SNAPSHOT_NOT_FOUND", "Snapshot was not found", 404)
  const timestamp = normalizeTimestamp(input.now)
  const totalParts = Number(input.totalParts)
  const manifestSha256 = String(input.manifestSha256 || "")
    .trim()
    .toLowerCase()
  if (
    !Number.isSafeInteger(totalParts) ||
    totalParts < 0 ||
    !/^[a-f0-9]{64}$/.test(manifestSha256)
  ) {
    throw authorityError("INVALID_SNAPSHOT_COMPLETION", "Snapshot completion proof is invalid")
  }
  const result = await prepared(
    db,
    `UPDATE icono_manifestation_snapshot_leases
        SET status = 'completed', completed_at = ?
      WHERE snapshot_id = ? AND status = 'open' AND expires_at > ?
        AND total_parts = ? AND manifest_sha256 = ?`,
    timestamp,
    snapshotId,
    timestamp,
    totalParts,
    manifestSha256,
  ).run()
  if (Number(result?.meta?.changes || 0) !== 1) {
    throw authorityError("SNAPSHOT_NOT_OPEN", "Snapshot is not open", 409)
  }
  return Object.freeze({
    schema_version: 1,
    ok: true,
    snapshot_id: snapshotId,
    status: "completed",
    authority_epoch: Number(lease.authority_epoch),
    total_parts: totalParts,
    manifest_sha256: manifestSha256,
    resume_cursor: await encodeCursor(input.cursorSecret, {
      version: 1,
      kind: "events",
      authority_epoch: Number(lease.authority_epoch),
      after_sequence: Number(lease.watermark_event_sequence),
    }),
  })
}

export async function readManifestationSnapshotStatus(db, input = {}) {
  requireDatabase(db)
  const snapshotId = normalizeId(input.snapshotId, "snapshot_id")
  const lease = await readSnapshotLease(db, snapshotId)
  if (!lease) throw authorityError("SNAPSHOT_NOT_FOUND", "Snapshot was not found", 404)
  return Object.freeze({
    schema_version: 1,
    snapshot_id: snapshotId,
    status: lease.status === "open" ? "ready" : lease.status,
    authority_epoch: Number(lease.authority_epoch),
    snapshot_watermark_sequence: Number(lease.watermark_event_sequence),
    expires_at: lease.expires_at,
    total_parts: lease.total_parts == null ? null : Number(lease.total_parts),
    manifest_sha256: lease.manifest_sha256 || null,
    resume_cursor:
      lease.status === "open" || lease.status === "completed"
        ? await encodeCursor(input.cursorSecret, {
            version: 1,
            kind: "events",
            authority_epoch: Number(lease.authority_epoch),
            after_sequence: Number(lease.watermark_event_sequence),
          })
        : null,
    next_poll_after_seconds: lease.status === "building" ? 2 : null,
  })
}

export async function acknowledgeManifestationEvents(db, input = {}) {
  requireDatabase(db)
  const consumerId = normalizeId(input.consumerId, "consumer_id")
  const decoded = await decodeCursor(input.cursorSecret, input.resumeCursor, "events")
  if (!decoded) throw authorityError("INVALID_CURSOR", "Event acknowledgement cursor is required")
  const sequence = Number(decoded.after_sequence)
  const highWater = await first(
    db,
    `SELECT authority_epoch,
            MAX(event_retention_floor,
              (SELECT COALESCE(MAX(event_sequence), 0) FROM icono_manifestation_events)
            ) AS event_sequence
       FROM icono_authority_state WHERE singleton = 1`,
  )
  if (Number(decoded.authority_epoch) !== Number(highWater.authority_epoch)) {
    throw authorityError(
      "EVENT_CURSOR_EXPIRED_SNAPSHOT_REQUIRED",
      "Authority epoch changed; create a snapshot",
      410,
    )
  }
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 0 ||
    sequence > Number(highWater.event_sequence)
  ) {
    throw authorityError(
      "INVALID_CURSOR",
      "Event acknowledgement cursor is outside retained authority state",
    )
  }
  const timestamp = normalizeTimestamp(input.now)
  await prepared(
    db,
    `INSERT INTO icono_manifestation_consumer_cursors (
       consumer_id, last_event_sequence, updated_at
     ) VALUES (?, ?, ?)
     ON CONFLICT(consumer_id) DO UPDATE SET
       last_event_sequence = excluded.last_event_sequence,
       updated_at = excluded.updated_at
     WHERE icono_manifestation_consumer_cursors.last_event_sequence <= excluded.last_event_sequence`,
    consumerId,
    sequence,
    timestamp,
  ).run()
  const cursor = await first(
    db,
    `SELECT last_event_sequence FROM icono_manifestation_consumer_cursors WHERE consumer_id = ?`,
    consumerId,
  )
  if (Number(cursor?.last_event_sequence) !== sequence) {
    throw authorityError("EVENT_ACK_REGRESSION", "Event acknowledgement cannot move backwards", 409)
  }
  return Object.freeze({
    schema_version: 1,
    ok: true,
    consumer_id: consumerId,
    accepted_event_sequence: sequence,
    resume_cursor: input.resumeCursor,
  })
}

export async function sweepManifestationSnapshots(
  db,
  { now, retentionSeconds = 24 * 60 * 60, limit = 20 } = {},
) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(now)
  await prepared(
    db,
    `UPDATE icono_manifestation_snapshot_leases SET status = 'expired'
      WHERE status IN ('building', 'open') AND expires_at <= ?`,
    timestamp,
  ).run()
  const retention = Math.max(
    3600,
    Math.min(7 * 86_400, Math.trunc(Number(retentionSeconds)) || 86_400),
  )
  const cutoff = new Date(new Date(timestamp).getTime() - retention * 1000).toISOString()
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit)) || 20))
  const leases = await all(
    db,
    `SELECT snapshot_id FROM icono_manifestation_snapshot_leases
      WHERE status IN ('completed', 'expired')
        AND COALESCE(completed_at, expires_at) <= ?
      ORDER BY COALESCE(completed_at, expires_at), snapshot_id LIMIT ?`,
    cutoff,
    boundedLimit,
  )
  if (!leases.length) return Object.freeze({ purged: 0 })
  const statements = []
  for (const lease of leases) {
    statements.push(
      prepared(
        db,
        "DELETE FROM icono_manifestation_snapshot_parts WHERE snapshot_id = ?",
        lease.snapshot_id,
      ),
      prepared(
        db,
        `DELETE FROM icono_manifestation_snapshot_leases
          WHERE snapshot_id = ? AND status IN ('completed', 'expired')`,
        lease.snapshot_id,
      ),
    )
  }
  await db.batch(statements)
  return Object.freeze({ purged: leases.length })
}

export { decodeCursor, encodeCursor } from "./manifestation-sync-cursor.js"

// ARCHITECTURE FENCE [IPD-012]
