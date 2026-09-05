import { authorityError } from "./manifestation-authority-contract.js"
import { first, prepared } from "./manifestation-authority-repository.js"

export async function deliverAcceptedAuthorityEvent(db, callbacks, result) {
  if (result.accepted_event_sequence == null) return { pending: false }
  const { onAuthorityEvent, onAssignmentEvent } = callbacks || {}
  if (typeof onAuthorityEvent !== "function" && typeof onAssignmentEvent !== "function") {
    return { pending: false }
  }
  const event = await first(
    db,
    `SELECT event_uuid, event_sequence, gene_id, payload_json, projection_status
       FROM icono_manifestation_events WHERE event_sequence = ?`,
    result.accepted_event_sequence,
  )
  if (!event) throw authorityError("AUTHORITY_EVENT_MISSING", "Authority event is missing", 500)
  if (event.projection_status === "published") return { pending: false }
  const payload = JSON.parse(event.payload_json)
  try {
    const fullEvent = {
      event_id: event.event_uuid,
      event_sequence: Number(event.event_sequence),
      gene_id: event.gene_id,
      payload,
    }
    if (typeof onAuthorityEvent === "function") await onAuthorityEvent(fullEvent)
    if (typeof onAssignmentEvent === "function" && payload.assignment) {
      await onAssignmentEvent({
        event_id: event.event_uuid,
        event_sequence: Number(event.event_sequence),
        gene_id: event.gene_id,
        canonical_symbol: payload.gene.canonical_symbol,
        caretaker_assignment_id: payload.assignment.caretaker_assignment_id,
        caretaker_account_id: payload.assignment.account_id,
        status: payload.assignment.status,
        assignment_version: Number(payload.assignment.assignment_version),
      })
    }
    await prepared(
      db,
      `UPDATE icono_manifestation_events
          SET projection_status = 'published', projection_attempts = projection_attempts + 1,
              projection_next_attempt_at = NULL
        WHERE event_sequence = ? AND projection_status <> 'published'`,
      result.accepted_event_sequence,
    ).run()
    return { pending: false }
  } catch (error) {
    await prepared(
      db,
      `UPDATE icono_manifestation_events
          SET projection_status = 'failed', projection_attempts = projection_attempts + 1,
              projection_next_attempt_at = datetime('now', '+1 minute')
        WHERE event_sequence = ? AND projection_status <> 'published'`,
      result.accepted_event_sequence,
    )
      .run()
      .catch(() => undefined)
    return { pending: true }
  }
}
