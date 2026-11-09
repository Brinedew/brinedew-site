export const DELIVERY_RECONCILIATION_BATCH_SIZE = 50
const DELIVERY_FAILED_NOTE =
  "The Discord message could not be delivered; the portrait is published and available on the gene page."
const DELIVERY_FAILED_AFTER_MS = 24 * 60 * 60 * 1000

// Two bounded ranges use the existing (status, created_at, id) index; splitting
// equal timestamps avoids SQLite scanning the entire equal-time prefix. Inspect
// candidates before checking their receipts: filtering on sent first would
// turn LIMIT 50 into an unbounded scan through a permanently unsent backlog.
export async function reconcileDeliveryBacklog(db) {
  const cursor = await db
    .prepare("SELECT created_at, request_id FROM icono_delivery_reconciliation_cursor WHERE id = 1")
    .first()
  if (!cursor) throw new Error("Delivery reconciliation checkpoint missing")
  const page = await db
    .prepare(
      `WITH same_time AS MATERIALIZED (
       SELECT id, created_at FROM icono_generation_requests
       INDEXED BY idx_icono_generation_requests_open_created
       WHERE status = 'delivery_pending' AND created_at = ? AND id > ?
       ORDER BY id ASC LIMIT ?
     ), later AS MATERIALIZED (
       SELECT id, created_at FROM icono_generation_requests
       INDEXED BY idx_icono_generation_requests_open_created
       WHERE status = 'delivery_pending' AND created_at > ?
       ORDER BY created_at ASC, id ASC LIMIT ?
     ) SELECT id, created_at FROM same_time UNION ALL SELECT id, created_at FROM later
     ORDER BY created_at ASC, id ASC LIMIT ?`,
    )
    .bind(
      cursor.created_at,
      cursor.request_id,
      DELIVERY_RECONCILIATION_BATCH_SIZE,
      cursor.created_at,
      DELIVERY_RECONCILIATION_BATCH_SIZE,
      DELIVERY_RECONCILIATION_BATCH_SIZE,
    )
    .all()
  const rows = page.results || []
  const next =
    rows.length === DELIVERY_RECONCILIATION_BATCH_SIZE
      ? { created_at: rows.at(-1).created_at, request_id: rows.at(-1).id }
      : { created_at: "", request_id: 0 }
  const statements = []
  let abandonedIds = []
  if (rows.length) {
    const ids = rows.map((row) => row.id)
    const receipt = await db
      .prepare(
        `SELECT request_id,
           MAX(CASE WHEN discord_status = 'sent' THEN 1 ELSE 0 END) AS any_sent,
           MAX(CASE WHEN discord_status IN (
             'pending', 'sending', 'retry', 'unknown', 'suppressed_not_test_recipient'
           ) THEN 1 ELSE 0 END) AS any_open,
           MAX(CASE WHEN discord_status = 'failed' THEN 1 ELSE 0 END) AS any_failed,
           MAX(COALESCE(discord_last_attempt_at, created_at)) AS last_attempt
         FROM icono_request_notifications
         WHERE request_id IN (${ids.map(() => "?").join(",")})
         GROUP BY request_id`,
      )
      .bind(...ids)
      .all()
    const cutoff = Date.now() - DELIVERY_FAILED_AFTER_MS
    abandonedIds = (receipt.results || [])
      .filter(
        (state) =>
          Number(state.any_failed) === 1 &&
          Number(state.any_open) === 0 &&
          Number(state.any_sent) === 0,
      )
      .filter((state) => {
        const lastAttempt = Date.parse(String(state.last_attempt || ""))
        return Number.isFinite(lastAttempt) && lastAttempt <= cutoff
      })
      .map((state) => Number(state.request_id))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  }
  // NOT INDEXED still permits INTEGER PRIMARY KEY lookup. Without it SQLite
  // can choose the status index and scan the whole backlog before checking IDs.
  if (rows.length)
    statements.push(
      db
        .prepare(
          `UPDATE icono_generation_requests NOT INDEXED
     SET status = 'fulfilled', updated_at = CURRENT_TIMESTAMP,
         fulfilled_at = COALESCE(fulfilled_at, CURRENT_TIMESTAMP)
     WHERE id IN (${rows.map(() => "?").join(",")}) AND status = 'delivery_pending'
       AND EXISTS (SELECT 1 FROM icono_request_notifications n
         WHERE n.request_id = icono_generation_requests.id AND n.discord_status = 'sent')
     RETURNING id`,
        )
        .bind(...rows.map((row) => row.id)),
    )
  // A permanently failed Discord DM (a closed inbox) is delivery debt, not a
  // reading failure. After a day, close the request truthfully: the portrait is
  // published, the failed notification stays as the record, and a later
  // workstation resend can still move it to retry and deliver it.
  let abandonedStatementIndex = -1
  if (abandonedIds.length) {
    abandonedStatementIndex = statements.length
    statements.push(
      db
        .prepare(
          `UPDATE icono_generation_requests NOT INDEXED
     SET status = 'fulfilled', updated_at = CURRENT_TIMESTAMP,
         fulfilled_at = COALESCE(fulfilled_at, CURRENT_TIMESTAMP),
         fulfillment_note = CASE
           WHEN TRIM(COALESCE(fulfillment_note, '')) = '' THEN ?
           ELSE fulfillment_note
         END
     WHERE id IN (${abandonedIds.map(() => "?").join(",")})
       AND status = 'delivery_pending'
     RETURNING id`,
        )
        .bind(DELIVERY_FAILED_NOTE, ...abandonedIds),
    )
  }
  if (cursor.created_at !== next.created_at || cursor.request_id !== next.request_id)
    statements.push(
      db
        .prepare(
          `UPDATE icono_delivery_reconciliation_cursor SET created_at = ?, request_id = ?
       WHERE id = 1 AND created_at = ? AND request_id = ?`,
        )
        .bind(next.created_at, next.request_id, cursor.created_at, cursor.request_id),
    )
  // Completion and checkpoint advance commit together. Compare-and-set stops
  // overlapping invocations from moving a newer checkpoint backwards.
  const results = statements.length ? await db.batch(statements) : []
  return {
    ok: true,
    finalized: rows.length ? results[0].results.length : 0,
    delivered_unnotified:
      abandonedStatementIndex >= 0 ? results[abandonedStatementIndex].results.length : 0,
    considered: rows.length,
    pending_request_ids: [],
  }
}
