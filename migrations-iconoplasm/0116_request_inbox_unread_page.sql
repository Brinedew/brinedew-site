-- B-1029: the sidebar's Ready list shows unread results only. This partial index
-- holds just the unread receipts, so a page read costs at most its LIMIT however
-- long a person's read history grows, and marking a gene seen walks only that
-- person's unread receipts. A receipt leaves the index when it is marked read.
CREATE INDEX IF NOT EXISTS idx_icono_request_inbox_unread_page ON icono_request_inbox_members (requester_user_id, created_at DESC, notification_id DESC) WHERE unread = 1;
