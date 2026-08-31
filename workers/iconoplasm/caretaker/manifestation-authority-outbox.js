import { authorityError, normalizeTimestamp } from "./manifestation-authority-contract.js"
import { all, prepared, requireDatabase } from "./manifestation-authority-repository.js"

export async function sweepManifestationAuthorityOutbox(
  db,
  onAuthorityEvent,
  { limit = 20, now } = {},
) {
  requireDatabase(db)
  if (typeof onAuthorityEvent !== "function") {
    throw new TypeError("Authority outbox projector callback is required")
  }
  const timestamp = normalizeTimestamp(now)
  const boundedLimit = Math.max(1, Math.min(50, Math.trunc(Number(limit)) || 20))
  const events = await all(
    db,
    `SELECT event_uuid, event_sequence, gene_id, payload_json
       FROM icono_manifestation_events
      WHERE projection_status IN ('pending', 'failed')
        AND (projection_next_attempt_at IS NULL OR projection_next_attempt_at <= ?)
      ORDER BY event_sequence LIMIT ?`,
    timestamp,
    boundedLimit,
  )
  let published = 0
  let failed = 0
  for (const row of events) {
    const event = {
      event_id: row.event_uuid,
      event_sequence: Number(row.event_sequence),
      gene_id: row.gene_id,
      payload: JSON.parse(row.payload_json),
    }
    try {
      await onAuthorityEvent(event)
      await prepared(
        db,
        `UPDATE icono_manifestation_events
            SET projection_status = 'published', projection_attempts = projection_attempts + 1,
                projection_next_attempt_at = NULL
          WHERE event_sequence = ? AND projection_status IN ('pending', 'failed')`,
        row.event_sequence,
      ).run()
      published += 1
    } catch (error) {
      const retryAt = new Date(Date.parse(timestamp) + 60_000).toISOString()
      await prepared(
        db,
        `UPDATE icono_manifestation_events
            SET projection_status = 'failed', projection_attempts = projection_attempts + 1,
                projection_next_attempt_at = ?
          WHERE event_sequence = ? AND projection_status IN ('pending', 'failed')`,
        retryAt,
        row.event_sequence,
      ).run()
      failed += 1
      if (error?.code === "AUTHORITY_PROJECTION_FATAL") {
        throw authorityError(
          "AUTHORITY_PROJECTION_FATAL",
          "Authority projection failed permanently",
          500,
          error,
        )
      }
    }
  }
  return Object.freeze({ examined: events.length, published, failed })
}
