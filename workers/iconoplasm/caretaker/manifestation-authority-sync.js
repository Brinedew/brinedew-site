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
            stream_version, source_baseline_rowid, build_phase, build_after_key, next_part_ordinal, build_chain_sha256,
            total_parts, manifest_sha256,
            expires_at, ready_at, created_at, completed_at,
            (SELECT authority_epoch FROM icono_authority_state WHERE singleton=1) AS current_authority_epoch
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
      WHERE consumer_id = ? AND status IN ('building', 'open')
        AND (expires_at <= ? OR stream_version <> 2 OR authority_epoch <>
          (SELECT authority_epoch FROM icono_authority_state WHERE singleton=1))`,
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
      schema_version: 2,
      snapshot_id: lease.snapshot_id,
      status: "streaming",
      resume_cursor: await snapshotEventCursor(input.cursorSecret, lease),
      authority_epoch: Number(lease.authority_epoch),
      snapshot_watermark_sequence: Number(lease.watermark_event_sequence),
      expires_at: lease.expires_at,
      resumed: true,
    })
  }
  const state = await first(
    db,
    `SELECT event_retention_floor, authority_epoch,
            (SELECT COALESCE(MAX(rowid), 0) FROM icono_gene_identity_baselines) AS baseline_rowid,
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
  const ttl = Math.max(60, Math.min(3600, Math.trunc(Number(input.ttlSeconds)) || 3600))
  const expiresAt = new Date(new Date(timestamp).getTime() + ttl * 1000).toISOString()
  try {
    await prepared(
      db,
      `INSERT INTO icono_manifestation_snapshot_leases (
         snapshot_id, consumer_id, authority_epoch, watermark_event_sequence,
         source_checkpoint_id, source_checkpoint_watermark_sequence, status,
         build_phase, build_after_key, next_part_ordinal, stream_version, source_baseline_rowid,
         expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'building', ?, NULL, 1, 2, ?, ?, ?)`,
      snapshotId,
      consumerId,
      Number(state.authority_epoch),
      Number(state?.watermark || 0),
      checkpoint?.checkpoint_id || null,
      floor,
      checkpoint ? "checkpoint_entities" : "baselines",
      Number(state.baseline_rowid),
      expiresAt,
      timestamp,
    ).run()
  } catch (error) {
    if (/snapshot_source_changed/.test(String(error?.message || ""))) {
      throw authorityError(
        "SNAPSHOT_SOURCE_CHANGED",
        "History was compacted while opening the snapshot; retry",
        409,
        error,
      )
    }
    if (
      /uq_icono_open_snapshot_consumer|unique constraint failed/i.test(String(error?.message || ""))
    ) {
      throw authorityError("SNAPSHOT_ALREADY_OPEN", "Consumer already has a snapshot", 409, error)
    }
    throw error
  }
  return Object.freeze({
    schema_version: 2,
    snapshot_id: snapshotId,
    status: "streaming",
    resume_cursor: await snapshotEventCursor(input.cursorSecret, {
      authority_epoch: state.authority_epoch,
      watermark_event_sequence: state.watermark,
    }),
    authority_epoch: Number(state.authority_epoch),
    snapshot_watermark_sequence: Number(state?.watermark || 0),
    expires_at: expiresAt,
    resumed: false,
  })
}

// ARCHITECTURE FENCE [IPD-012]: immutable source pages, no per-consumer D1 copy.
function snapshotEventCursor(secret, lease) {
  return encodeCursor(secret, {
    version: 1,
    kind: "events",
    authority_epoch: Number(lease.authority_epoch),
    after_sequence: Number(lease.watermark_event_sequence),
  })
}

function requireStreamingLease(lease, now, { completed = false } = {}) {
  if (!lease) throw authorityError("SNAPSHOT_NOT_FOUND", "Snapshot was not found", 404)
  if (
    Number(lease.stream_version) !== 2 ||
    Number(lease.authority_epoch) !== Number(lease.current_authority_epoch) ||
    !(lease.status === "building" || (completed && lease.status === "completed")) ||
    (lease.status !== "completed" && lease.expires_at <= now)
  ) {
    throw authorityError("SNAPSHOT_EXPIRED", "Snapshot is no longer available", 410)
  }
}

function requireSnapshotCursor(cursor, lease) {
  if (
    cursor &&
    (cursor.snapshot_id !== lease.snapshot_id ||
      Number(cursor.authority_epoch) !== Number(lease.authority_epoch) ||
      Number(cursor.watermark_sequence) !== Number(lease.watermark_event_sequence))
  ) {
    throw authorityError("INVALID_CURSOR", "Cursor belongs to another snapshot")
  }
}

async function sourcePage(db, lease, phase, after, limit) {
  if (phase === "baselines")
    return all(
      db,
      `SELECT rowid AS source_ordinal, gene_id, canonical_symbol, registered_at
       FROM icono_gene_identity_baselines WHERE rowid > ? AND rowid <= ?
       ORDER BY rowid LIMIT ?`,
      Number(after),
      Number(lease.source_baseline_rowid),
      limit,
    )
  if (phase === "checkpoint_entities")
    return all(
      db,
      `SELECT entity.entity_ordinal AS source_ordinal, entity.entity_kind, entity.entity_key,
            entity.gene_id, entity.source_event_sequence, entity.entity_json, entity.payload_sha256,
            checkpoint.checkpoint_id, checkpoint.authority_epoch,
            checkpoint.target_watermark_event_sequence, checkpoint.manifest_sha256
       FROM icono_manifestation_event_checkpoint_entities entity
       JOIN icono_manifestation_event_checkpoints checkpoint ON checkpoint.checkpoint_id=entity.checkpoint_id
      WHERE entity.checkpoint_id=? AND checkpoint.status='active' AND entity.entity_ordinal>?
      ORDER BY entity.entity_ordinal LIMIT ?`,
      lease.source_checkpoint_id,
      Number(after),
      limit,
    )
  return all(
    db,
    `SELECT event_sequence AS source_ordinal, event_sequence, event_uuid, event_type, gene_id,
            gene_revision, manifestation_id, manifestation_revision_id, canonical_selection_id,
            caretaker_assignment_id, payload_json, created_at
       FROM icono_manifestation_events WHERE event_sequence > ? AND event_sequence <= ?
       ORDER BY event_sequence LIMIT ?`,
    Number(after),
    Number(lease.watermark_event_sequence),
    limit,
  )
}

export async function readManifestationSnapshotPage(db, input = {}) {
  requireDatabase(db)
  const lease = await readSnapshotLease(db, normalizeId(input.snapshotId, "snapshot_id"))
  requireStreamingLease(lease, normalizeTimestamp(input.now))
  if (lease.source_checkpoint_id) {
    const checkpoint = await readActiveManifestationEventCheckpoint(db)
    if (
      checkpoint?.checkpoint_id !== lease.source_checkpoint_id ||
      Number(checkpoint.authority_epoch) !== Number(lease.authority_epoch) ||
      Number(checkpoint.target_watermark_event_sequence) !==
        Number(lease.source_checkpoint_watermark_sequence)
    ) {
      throw authorityError(
        "SNAPSHOT_SOURCE_HISTORY_UNAVAILABLE",
        "Pinned checkpoint is no longer available",
        410,
      )
    }
  }
  const cursor = await decodeCursor(input.cursorSecret, input.cursor, "snapshot_stream")
  requireSnapshotCursor(cursor, lease)
  const limit = Math.max(1, Math.min(250, Math.trunc(Number(input.limit)) || 100))
  let phase = cursor?.phase || (lease.source_checkpoint_id ? "checkpoint_entities" : "baselines")
  let after = Number(cursor?.after_key || 0)
  let ordinal = Number(cursor?.after_ordinal || 0)
  let chain = cursor?.chain_sha256 || "0".repeat(64)
  let done = Boolean(cursor?.done)
  const parts = []
  while (!done && parts.length < limit) {
    const rows = await sourcePage(db, lease, phase, after, limit - parts.length + 1)
    const selected = rows.slice(0, limit - parts.length)
    for (const row of selected) {
      const payload =
        phase === "baselines"
          ? baselinePart(row)
          : phase === "checkpoint_entities"
            ? checkpointEntityPart(row, row)
            : eventPart(row)
      const bytes = utf8Bytes(JSON.stringify(payload))
      const digest = await sha256Hex(bytes)
      ordinal += 1
      chain = await advanceManifestationSnapshotChain(chain, ordinal, digest)
      parts.push({
        ordinal,
        part_kind: payload.part_kind,
        source_key:
          phase === "baselines"
            ? row.gene_id
            : phase === "checkpoint_entities"
              ? `${row.entity_kind}:${row.entity_key}`
              : String(row.event_sequence),
        gene_id: row.gene_id,
        payload_sha256: digest,
        payload_base64url: bytesToBase64Url(bytes),
      })
      after = Number(row.source_ordinal)
    }
    if (rows.length > selected.length) break
    if (phase === "events") done = true
    else {
      phase = "events"
      after = Number(lease.source_checkpoint_watermark_sequence)
    }
  }
  return Object.freeze({
    schema_version: 2,
    snapshot_id: lease.snapshot_id,
    authority_epoch: Number(lease.authority_epoch),
    snapshot_watermark_sequence: Number(lease.watermark_event_sequence),
    total_parts: ordinal,
    manifest_sha256: chain,
    resume_cursor: await snapshotEventCursor(input.cursorSecret, lease),
    payload_encoding: "base64url+utf8-json",
    parts,
    has_more: !done,
    parts_resume_cursor: await encodeCursor(input.cursorSecret, {
      version: 1,
      kind: "snapshot_stream",
      snapshot_id: lease.snapshot_id,
      authority_epoch: Number(lease.authority_epoch),
      watermark_sequence: Number(lease.watermark_event_sequence),
      phase,
      after_key: after,
      after_ordinal: ordinal,
      chain_sha256: chain,
      done,
    }),
  })
}

export async function completeManifestationSnapshot(db, input = {}) {
  requireDatabase(db)
  const lease = await readSnapshotLease(db, normalizeId(input.snapshotId, "snapshot_id"))
  const now = normalizeTimestamp(input.now)
  requireStreamingLease(lease, now, { completed: true })
  const proof = await decodeCursor(input.cursorSecret, input.completionCursor, "snapshot_stream")
  requireSnapshotCursor(proof, lease)
  if (
    !proof?.done ||
    proof.after_ordinal !== input.totalParts ||
    proof.chain_sha256 !== input.manifestSha256
  ) {
    throw authorityError("INVALID_SNAPSHOT_COMPLETION", "Complete signed stream proof is required")
  }
  if (lease.status === "completed") {
    if (
      Number(lease.total_parts) !== proof.after_ordinal ||
      lease.manifest_sha256 !== proof.chain_sha256
    )
      throw authorityError("INVALID_SNAPSHOT_COMPLETION", "Snapshot receipt does not match")
  } else {
    const result = await prepared(
      db,
      `UPDATE icono_manifestation_snapshot_leases SET status='completed', completed_at=?,
              total_parts=?, manifest_sha256=? WHERE snapshot_id=? AND status='building' AND expires_at>?`,
      now,
      proof.after_ordinal,
      proof.chain_sha256,
      lease.snapshot_id,
      now,
    ).run()
    if (Number(result?.meta?.changes || 0) !== 1)
      throw authorityError("SNAPSHOT_NOT_OPEN", "Snapshot is not open", 409)
  }
  return Object.freeze({
    schema_version: 2,
    ok: true,
    snapshot_id: lease.snapshot_id,
    status: "completed",
    authority_epoch: Number(lease.authority_epoch),
    total_parts: proof.after_ordinal,
    manifest_sha256: proof.chain_sha256,
    resume_cursor: await snapshotEventCursor(input.cursorSecret, lease),
  })
}

export async function readManifestationSnapshotStatus(db, input = {}) {
  const lease = await readSnapshotLease(db, normalizeId(input.snapshotId, "snapshot_id"))
  requireStreamingLease(lease, normalizeTimestamp(input.now), { completed: true })
  return Object.freeze({
    schema_version: 2,
    snapshot_id: lease.snapshot_id,
    status: lease.status === "completed" ? "completed" : "streaming",
    authority_epoch: Number(lease.authority_epoch),
    snapshot_watermark_sequence: Number(lease.watermark_event_sequence),
    expires_at: lease.expires_at,
    total_parts: lease.total_parts,
    manifest_sha256: lease.manifest_sha256,
    resume_cursor: await snapshotEventCursor(input.cursorSecret, lease),
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
  const statements = [
    prepared(
      db,
      `DELETE FROM icono_manifestation_snapshot_parts WHERE rowid IN (
      SELECT part.rowid FROM icono_manifestation_snapshot_parts part
      JOIN icono_manifestation_snapshot_leases lease ON lease.snapshot_id=part.snapshot_id
      WHERE lease.status IN ('completed','expired') AND COALESCE(lease.completed_at,lease.expires_at)<=?
      ORDER BY lease.snapshot_id,part.ordinal LIMIT 250)`,
      cutoff,
    ),
  ]
  for (const lease of leases) {
    statements.push(
      prepared(
        db,
        `DELETE FROM icono_manifestation_snapshot_leases
          WHERE snapshot_id = ? AND status IN ('completed', 'expired')
          AND NOT EXISTS (SELECT 1 FROM icono_manifestation_snapshot_parts part
                          WHERE part.snapshot_id=icono_manifestation_snapshot_leases.snapshot_id)`,
        lease.snapshot_id,
      ),
    )
  }
  const results = await db.batch(statements)
  return Object.freeze({
    purged: results
      .slice(1)
      .reduce((total, result) => total + Number(result.meta?.changes || 0), 0),
    parts_purged: Number(results[0].meta?.changes || 0),
  })
}

export { decodeCursor, encodeCursor } from "./manifestation-sync-cursor.js"

// ARCHITECTURE FENCE [IPD-012]
