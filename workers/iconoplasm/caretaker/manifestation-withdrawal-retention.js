import { sha256Hex } from "../../lib/iconoplasm-manifestation-body-crypto.js"
import { purgeManifestation } from "./manifestation-admin-commands.js"
import { all, first, requireDatabase } from "./manifestation-authority-repository.js"
import { normalizeTimestamp } from "./manifestation-authority-contract.js"

async function deterministicIds(manifestationId, rowVersion) {
  const digest = await sha256Hex(`${manifestationId}\n${rowVersion}\nwithdrawal_retention_purge_v1`)
  return {
    commandId: `command_retention_${digest.slice(0, 40)}`,
    eventUuid: `event_retention_${digest.slice(0, 40)}`,
    selectionId: `selection_retention_${digest.slice(0, 40)}`,
    requestSha256: digest,
  }
}

export async function sweepWithdrawnManifestationRetention(
  db,
  { limit = 10, now = new Date().toISOString() } = {},
) {
  requireDatabase(db)
  const timestamp = normalizeTimestamp(now)
  const pageSize = Math.max(1, Math.min(20, Math.trunc(Number(limit)) || 10))
  const due = await all(
    db,
    `SELECT manifestation.manifestation_id, manifestation.row_version,
            head.head_version, head.canonical_revision_id
       FROM icono_manifestations manifestation
       JOIN icono_manifestation_heads head ON head.gene_id = manifestation.gene_id
      WHERE manifestation.status = 'withdrawn'
        AND manifestation.purge_eligible_at IS NOT NULL
        AND manifestation.purge_eligible_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM icono_manifestation_legal_holds hold
           WHERE hold.manifestation_id = manifestation.manifestation_id
             AND hold.released_at IS NULL
        )
      ORDER BY manifestation.purge_eligible_at, manifestation.manifestation_id
      LIMIT ?`,
    timestamp,
    pageSize,
  )
  const results = []
  for (const row of due) {
    try {
      const ids = await deterministicIds(row.manifestation_id, Number(row.row_version))
      const result = await purgeManifestation(db, {
        manifestationId: row.manifestation_id,
        expectedManifestationVersion: Number(row.row_version),
        expectedHeadVersion: Number(row.head_version),
        expectedCanonicalRevisionId: row.canonical_revision_id,
        reasonCode: "withdrawal_retention_elapsed",
        urgentPurge: false,
        selectionId: ids.selectionId,
        eventUuid: ids.eventUuid,
        now: timestamp,
        commandId: ids.commandId,
        requestSha256: ids.requestSha256,
        actorKind: "service",
        actorAccountId: null,
      })
      results.push({ manifestation_id: row.manifestation_id, status: result.status })
    } catch (error) {
      results.push({
        manifestation_id: row.manifestation_id,
        status: "deferred",
        error_code: String(error?.code || "RETENTION_PURGE_FAILED").slice(0, 96),
      })
    }
  }
  const remaining = await first(
    db,
    `SELECT count(*) AS total FROM icono_manifestations manifestation
      WHERE manifestation.status = 'withdrawn' AND manifestation.purge_eligible_at <= ?
        AND NOT EXISTS (
          SELECT 1 FROM icono_manifestation_legal_holds hold
           WHERE hold.manifestation_id = manifestation.manifestation_id
             AND hold.released_at IS NULL
        )`,
    timestamp,
  )
  return Object.freeze({
    processed: results.length,
    remaining: Number(remaining?.total || 0),
    results,
  })
}

// ARCHITECTURE FENCE [IPD-012]
