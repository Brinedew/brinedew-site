// Migration 0096 transactionally maintains exact live receipt membership.
// CROSS JOIN pins the bounded user-page index as the outer cursor. The original
// request/asset identity checks remain mandatory for every returned card.
export const REQUEST_INBOX_COUNTS_SQL = `SELECT ready_count, unread_count,
  ready_group_count, unread_group_count
  FROM icono_request_inbox_summary WHERE requester_user_id = ?`

export const REQUEST_INBOX_PAGE_SQL = `SELECT n.*,
  gr.created_at AS request_created_at, pa.created_at AS asset_created_at,
  pa.candidate_image_id
  FROM icono_request_inbox_members membership INDEXED BY idx_icono_request_inbox_page
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
    AND n.requester_user_id = membership.requester_user_id
    AND n.discord_status = 'sent'
  ORDER BY membership.created_at DESC, membership.notification_id DESC
  LIMIT ?`
