// Generated from reviewed migrations; never accept caller SQL.
export const REQUEST_INBOX_UNREAD_PAGE_MIGRATION_NAME = "0116_request_inbox_unread_page.sql"
export const REQUEST_INBOX_UNREAD_PAGE_MIGRATION_STATEMENTS = Object.freeze([
  "CREATE INDEX IF NOT EXISTS idx_icono_request_inbox_unread_page ON icono_request_inbox_members (requester_user_id, created_at DESC, notification_id DESC) WHERE unread = 1;"
])
