-- Account-scoped caretaker coordination. The authority projection remains the
-- source of assignment truth; this migration adds only comment-read state and
-- a durable, independent Discord delivery outbox.

ALTER TABLE icono_caretaker_assignment_notifications
  ADD COLUMN comments_read_through_id INTEGER NOT NULL DEFAULT 0
  CHECK (comments_read_through_id >= 0);

-- Coordination begins with the current tenure. Comments that predate rollout
-- (or the claim itself) are context, not unread alerts.
UPDATE icono_caretaker_assignment_notifications
   SET comments_read_through_id = COALESCE(
     (SELECT MAX(comment.id)
        FROM icono_gene_comments comment
       WHERE comment.gene_symbol = icono_caretaker_assignment_notifications.canonical_symbol
         AND comment.status = 'visible'),
     0
   )
 WHERE assignment_status IN ('active', 'suspended');

CREATE INDEX IF NOT EXISTS idx_icono_caretaker_current_assignment
  ON icono_caretaker_assignment_notifications (
    account_id,
    assignment_status,
    authority_event_sequence DESC
  );

CREATE TABLE IF NOT EXISTS icono_caretaker_comment_notifications (
  notification_key TEXT PRIMARY KEY,
  caretaker_assignment_id TEXT NOT NULL,
  caretaker_account_id TEXT NOT NULL,
  caretaker_discord_user_id TEXT NOT NULL,
  gene_symbol TEXT NOT NULL,
  comment_author_account_id TEXT NOT NULL,
  comment_author_name TEXT NOT NULL,
  comment_body TEXT NOT NULL,
  discord_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (discord_status IN ('pending', 'sending', 'retry', 'sent', 'failed', 'unknown', 'suppressed')),
  discord_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (discord_attempt_count >= 0),
  discord_next_attempt_at TEXT,
  discord_channel_id TEXT,
  discord_message_id TEXT,
  discord_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_icono_caretaker_comment_notifications_due
  ON icono_caretaker_comment_notifications (
    discord_status,
    discord_next_attempt_at,
    created_at
  );
