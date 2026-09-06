export const DELIVERY_RECONCILIATION_BATCH_SIZE = 50

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
    considered: rows.length,
    pending_request_ids: [],
  }
}
