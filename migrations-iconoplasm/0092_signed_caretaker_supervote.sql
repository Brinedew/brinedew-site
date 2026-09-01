-- A caretaker owns one signed 10x vote for the duration of one gene tenure.
-- Existing active selections were positive-only, so they migrate to +1.

ALTER TABLE icono_caretaker_supervote_projection
  ADD COLUMN direction INTEGER CHECK (direction IN (-1, 1) OR direction IS NULL);

UPDATE icono_caretaker_supervote_projection
   SET direction = CASE WHEN active = 1 THEN 1 ELSE NULL END;

ALTER TABLE icono_caretaker_supervote_events
  ADD COLUMN from_direction INTEGER
  CHECK (from_direction IN (-1, 1) OR from_direction IS NULL);

ALTER TABLE icono_caretaker_supervote_events
  ADD COLUMN to_direction INTEGER
  CHECK (to_direction IN (-1, 1) OR to_direction IS NULL);

UPDATE icono_caretaker_supervote_events
   SET from_direction = CASE WHEN from_asset_sha256 IS NOT NULL THEN 1 ELSE NULL END,
       to_direction = CASE WHEN to_asset_sha256 IS NOT NULL THEN 1 ELSE NULL END;

CREATE TRIGGER icono_caretaker_supervote_projection_direction_guard_insert
BEFORE INSERT ON icono_caretaker_supervote_projection
BEGIN
  SELECT case
    WHEN (NEW.active = 1 AND (NEW.direction IS NULL OR NEW.asset_sha256 IS NULL))
      OR (NEW.active = 0 AND (NEW.direction IS NOT NULL OR NEW.asset_sha256 IS NOT NULL))
    THEN RAISE(ABORT, 'caretaker_supervote_direction_state_mismatch')
  end;
end;

CREATE TRIGGER icono_caretaker_supervote_projection_direction_guard_update
BEFORE UPDATE ON icono_caretaker_supervote_projection
BEGIN
  SELECT case
    WHEN (NEW.active = 1 AND (NEW.direction IS NULL OR NEW.asset_sha256 IS NULL))
      OR (NEW.active = 0 AND (NEW.direction IS NOT NULL OR NEW.asset_sha256 IS NOT NULL))
    THEN RAISE(ABORT, 'caretaker_supervote_direction_state_mismatch')
  end;
end;

CREATE TABLE icono_caretaker_supervote_notifications (
  notification_key TEXT PRIMARY KEY,
  caretaker_assignment_id TEXT NOT NULL,
  caretaker_account_id TEXT NOT NULL,
  gene_symbol TEXT NOT NULL COLLATE NOCASE,
  preferred_asset_sha256 TEXT NOT NULL CHECK (length(preferred_asset_sha256) = 64),
  canonical_asset_sha256 TEXT NOT NULL CHECK (length(canonical_asset_sha256) = 64),
  supervote_version INTEGER NOT NULL CHECK (supervote_version >= 1),
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

CREATE INDEX idx_icono_caretaker_supervote_notifications_due
  ON icono_caretaker_supervote_notifications (
    discord_status,
    discord_next_attempt_at,
    created_at
  );

-- The publication event and its notification intent commit in the same D1
-- transaction. Discord identity is resolved only by the delivery worker, so an
-- account-database outage can delay a DM but can never erase the intent.
CREATE TRIGGER icono_caretaker_positive_supervote_lost_canon
AFTER INSERT ON icono_publish_events
WHEN NEW.action = 'publish'
 AND NEW.from_asset_sha256 IS NOT NULL
 AND NEW.to_asset_sha256 IS NOT NULL
 AND NEW.from_asset_sha256 IS NOT NEW.to_asset_sha256
BEGIN
  INSERT INTO icono_caretaker_supervote_notifications (
    notification_key, caretaker_assignment_id, caretaker_account_id,
    gene_symbol, preferred_asset_sha256, canonical_asset_sha256,
    supervote_version
  )
  SELECT 'supervote-canon-lost:' || upper(NEW.gene_symbol) || ':' || NEW.id,
         supervote.caretaker_assignment_id, supervote.caretaker_account_id,
         upper(NEW.gene_symbol), NEW.from_asset_sha256, NEW.to_asset_sha256,
         supervote.supervote_version
    FROM icono_caretaker_supervote_projection supervote
    JOIN icono_caretaker_assignment_notifications assignment
      ON assignment.caretaker_assignment_id = supervote.caretaker_assignment_id
     AND assignment.account_id = supervote.caretaker_account_id
     AND assignment.canonical_symbol = supervote.gene_symbol
   WHERE supervote.gene_symbol = NEW.gene_symbol
     AND supervote.active = 1
     AND supervote.direction = 1
     AND supervote.asset_sha256 = NEW.from_asset_sha256
     AND assignment.assignment_status IN ('active', 'suspended');
end;
