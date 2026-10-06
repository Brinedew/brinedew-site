// Migration 0096 transactionally maintains exact live receipt membership.
// CROSS JOIN pins the bounded user-page index as the outer cursor. The original
// request/asset identity checks remain mandatory for every returned card.
export const REQUEST_INBOX_COUNTS_SQL = `SELECT ready_count, unread_count,
  ready_group_count, unread_group_count
  FROM icono_request_inbox_summary WHERE requester_user_id = ?`

// B-1029: the Ready list shows unread results only; seen ones leave it. The
// partial index of migration 0116 holds only unread receipts, so this page reads
// at most its LIMIT however long a person's read history grows.
export const REQUEST_INBOX_PAGE_SQL = `SELECT n.*,
  gr.created_at AS request_created_at, pa.created_at AS asset_created_at,
  pa.candidate_image_id
  FROM icono_request_inbox_members membership INDEXED BY idx_icono_request_inbox_unread_page
  CROSS JOIN icono_request_notifications n ON n.id = membership.notification_id
  JOIN icono_generation_requests gr
    ON gr.id = n.request_id
   AND gr.requester_user_id = n.requester_user_id
   AND gr.gene_symbol = n.gene_symbol
   AND gr.fulfilled_asset_sha256 = n.fulfilled_asset_sha256
   AND gr.status = 'fulfilled'
  JOIN icono_portrait_assets pa
    ON pa.gene_symbol = n.gene_symbol
   AND pa.asset_sha256 = n.fulfilled_asset_sha256
  WHERE membership.requester_user_id = ?
    AND membership.unread = 1
    AND n.requester_user_id = membership.requester_user_id
    AND n.discord_status = 'sent'
  ORDER BY membership.created_at DESC, membership.notification_id DESC
  LIMIT ?`

// B-1029: opening a gene page marks that gene's results seen, however the person
// got there. The receipts come from the same unread index, so the cost is the
// person's unread count (capped), never their history or the gene's popularity.
// NOT INDEXED keeps the planner on primary-key lookups of the ids the unread index
// returns; left free it chose the gene_symbol index and walked every notification
// of a popular gene (20,024 rows read for 4 receipts in the workerd measurement).
export const REQUEST_INBOX_MARK_GENE_READ_SQL = `UPDATE icono_request_notifications NOT INDEXED
  SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
  WHERE id IN (
    SELECT membership.notification_id
      FROM icono_request_inbox_members membership INDEXED BY idx_icono_request_inbox_unread_page
     WHERE membership.requester_user_id = ?
       AND membership.unread = 1
       AND substr(membership.group_key, -length(?) - 1) = char(31) || ?
     LIMIT 500)
    AND requester_user_id = ?
    AND gene_symbol = ?
    AND discord_status = 'sent'
    AND read_at IS NULL`
