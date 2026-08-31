import { sha256Hex } from "../../lib/iconoplasm-envelope-crypto.js"
import { normalizeTimestamp } from "./manifestation-authority-contract.js"
import { all, first, prepared, requireDatabase } from "./manifestation-authority-repository.js"

function boundedDays(raw, fallback, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Math.trunc(Number(raw)) || fallback))
}

function boundedLimit(raw) {
  return Math.max(1, Math.min(50, Math.trunc(Number(raw)) || 25))
}

export async function compactManifestationCommandReceipts(db, input = {}) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(input.now)
  const retentionDays = boundedDays(input.retentionDays, 90, 7, 365)
  const cutoff = new Date(new Date(timestamp).getTime() - retentionDays * 86_400_000).toISOString()
  const limit = boundedLimit(input.limit)
  const state = await first(
    db,
    "SELECT event_retention_floor FROM icono_authority_state WHERE singleton = 1",
  )
  const floor = Number(state?.event_retention_floor || 0)
  if (!floor) return Object.freeze({ schema_version: 1, compacted: 0 })
  const receipts = await all(
    db,
    `SELECT receipt.command_id, receipt.command_type, receipt.actor_kind,
            receipt.actor_account_id, receipt.gene_id, receipt.request_sha256,
            receipt.response_json, receipt.accepted_event_sequence,
            receipt.accepted_event_uuid, receipt.accepted_gene_revision,
            receipt.created_at
       FROM icono_authoring_command_receipts receipt
      WHERE receipt.accepted_event_sequence <= ?
        AND unixepoch(receipt.created_at) <= unixepoch(?)
        AND NOT EXISTS (
          SELECT 1 FROM icono_manifestation_events event
           WHERE event.command_id = receipt.command_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM icono_authority_command_guards guard
           WHERE guard.command_id = receipt.command_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM icono_manifestation_storage_mutation_guards guard
           WHERE guard.command_id = receipt.command_id
        )
      ORDER BY receipt.accepted_event_sequence, receipt.command_id LIMIT ?`,
    floor,
    cutoff,
    limit,
  )
  for (const receipt of receipts) {
    const responseSha256 = await sha256Hex(new TextEncoder().encode(receipt.response_json))
    await db.batch([
      prepared(
        db,
        `INSERT INTO icono_authoring_command_tombstones (
           command_id, command_type, actor_kind, actor_account_id, gene_id,
           request_sha256, response_sha256, accepted_event_sequence,
           accepted_event_uuid, accepted_gene_revision,
           original_created_at, compacted_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        receipt.command_id,
        receipt.command_type,
        receipt.actor_kind,
        receipt.actor_account_id,
        receipt.gene_id,
        receipt.request_sha256,
        responseSha256,
        Number(receipt.accepted_event_sequence),
        receipt.accepted_event_uuid,
        Number(receipt.accepted_gene_revision),
        receipt.created_at,
        timestamp,
      ),
      prepared(
        db,
        `DELETE FROM icono_authoring_command_receipts
          WHERE command_id = ? AND accepted_event_sequence = ?
            AND accepted_event_uuid = ?`,
        receipt.command_id,
        Number(receipt.accepted_event_sequence),
        receipt.accepted_event_uuid,
      ),
    ])
  }
  return Object.freeze({ schema_version: 1, compacted: receipts.length })
}

export async function sweepManifestationCommandTombstones(db, input = {}) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(input.now)
  const retentionDays = boundedDays(input.retentionDays, 365, 90, 730)
  const cutoff = new Date(new Date(timestamp).getTime() - retentionDays * 86_400_000).toISOString()
  const limit = boundedLimit(input.limit)
  const rows = await all(
    db,
    `SELECT tombstone.command_id
       FROM icono_authoring_command_tombstones tombstone
       JOIN icono_authority_state state ON state.singleton = 1
       LEFT JOIN icono_manifestation_heads head ON head.gene_id = tombstone.gene_id
      WHERE unixepoch(tombstone.compacted_at) <= unixepoch(?)
        AND state.event_retention_floor >= tombstone.accepted_event_sequence
        AND (tombstone.gene_id IS NULL
          OR head.gene_revision >= tombstone.accepted_gene_revision)
      ORDER BY tombstone.compacted_at, tombstone.command_id LIMIT ?`,
    cutoff,
    limit,
  )
  if (rows.length) {
    await db.batch(
      rows.map((row) =>
        prepared(
          db,
          "DELETE FROM icono_authoring_command_tombstones WHERE command_id = ?",
          row.command_id,
        ),
      ),
    )
  }
  return Object.freeze({ schema_version: 1, purged: rows.length })
}
