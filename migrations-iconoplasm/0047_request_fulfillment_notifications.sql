-- Durable requester inbox + Discord delivery outbox for generation fulfillment.
--
-- Chesterton fence: notification creation belongs to the database transition,
-- not to one particular API caller. The workstation, admin UI, and any future
-- fulfillment path all update icono_generation_requests; this trigger makes the
-- inbox row part of the same D1 transaction as open -> fulfilled.
--
-- Deliberately no historical backfill. The first Discord rollout is restricted
-- to a single Brinedew test account, and old fulfillments must not surprise users.

CREATE TABLE IF NOT EXISTS icono_request_notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notification_key TEXT NOT NULL UNIQUE,
  request_id INTEGER NOT NULL UNIQUE,
  requester_user_id TEXT NOT NULL,
  gene_symbol TEXT NOT NULL,
  request_mode TEXT NOT NULL DEFAULT 'random'
    CHECK (request_mode IN ('random', 'specific')),
  requested_vision_id TEXT NOT NULL DEFAULT '',
  requested_emulsion_label TEXT NOT NULL DEFAULT '',
  fulfilled_asset_sha256 TEXT NOT NULL DEFAULT '',
  fulfilled_vision_id TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'request_fulfilled'
    CHECK (kind IN ('request_fulfilled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at TEXT,
  discord_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (discord_status IN (
      'pending',
      'sending',
      'retry',
      'sent',
      'suppressed_not_test_recipient',
      'failed',
      'unknown'
    )),
  discord_attempt_count INTEGER NOT NULL DEFAULT 0,
  discord_last_attempt_at TEXT,
  discord_sent_at TEXT,
  discord_channel_id TEXT NOT NULL DEFAULT '',
  discord_message_id TEXT NOT NULL DEFAULT '',
  discord_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_icono_request_notifications_user_created
  ON icono_request_notifications (requester_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_icono_request_notifications_user_unread
  ON icono_request_notifications (requester_user_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_icono_request_notifications_delivery
  ON icono_request_notifications (discord_status, discord_attempt_count, created_at ASC, id ASC);

CREATE TRIGGER IF NOT EXISTS trg_icono_generation_request_fulfilled_notification
AFTER UPDATE OF status ON icono_generation_requests
WHEN OLD.status <> 'fulfilled' AND NEW.status = 'fulfilled'
BEGIN
  INSERT OR IGNORE INTO icono_request_notifications (
    notification_key,
    request_id,
    requester_user_id,
    gene_symbol,
    request_mode,
    requested_vision_id,
    requested_emulsion_label,
    fulfilled_asset_sha256,
    fulfilled_vision_id
  ) VALUES (
    'request_fulfilled:' || NEW.id || ':' || COALESCE(NEW.fulfilled_asset_sha256, ''),
    NEW.id,
    NEW.requester_user_id,
    NEW.gene_symbol,
    NEW.request_mode,
    NEW.requested_vision_id,
    CASE
      WHEN NEW.request_mode = 'random' THEN 'Random default'
      ELSE COALESCE(
        NULLIF((
          SELECT emulsion_id
          FROM icono_admin_vision_rollup
          WHERE vision_id = NEW.requested_vision_id
        ), ''),
        NULLIF((
          SELECT artist_tag
          FROM icono_admin_vision_rollup
          WHERE vision_id = NEW.requested_vision_id
        ), ''),
        NULLIF((
          SELECT artist_name
          FROM icono_admin_vision_rollup
          WHERE vision_id = NEW.requested_vision_id
        ), ''),
        NULLIF(NEW.requested_vision_id, ''),
        'Specific emulsion'
      )
    END,
    COALESCE(NEW.fulfilled_asset_sha256, ''),
    COALESCE(NEW.fulfilled_vision_id, '')
  );
END;
