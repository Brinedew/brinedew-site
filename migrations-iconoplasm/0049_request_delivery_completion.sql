-- A generated asset and a fulfilled Free Queue request are not the same event.
--
-- The old transition marked a request fulfilled before Discord had confirmed
-- delivery. That produced the worst possible failure mode: a person could wait
-- for an image that existed, while the system insisted it had already told
-- them. Keep the request in delivery_pending until the durable notification
-- outbox records a successful Discord response.

DROP TRIGGER IF EXISTS trg_icono_generation_request_fulfilled_notification;

CREATE TABLE icono_generation_requests_delivery_completion (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gene_symbol TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  requester_username TEXT NOT NULL DEFAULT '',
  request_mode TEXT NOT NULL DEFAULT 'random' CHECK (request_mode IN ('random', 'specific')),
  requested_vision_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'delivery_pending', 'fulfilled', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fulfilled_at TEXT,
  fulfilled_by TEXT NOT NULL DEFAULT '',
  fulfilled_asset_sha256 TEXT NOT NULL DEFAULT '',
  fulfilled_vision_id TEXT NOT NULL DEFAULT '',
  fulfillment_note TEXT NOT NULL DEFAULT '',
  request_kind TEXT NOT NULL DEFAULT 'new_candidate'
    CHECK (request_kind IN ('new_candidate', 'edit_image')),
  request_prompt TEXT NOT NULL DEFAULT '',
  source_gene_symbol TEXT NOT NULL DEFAULT '',
  source_asset_sha256 TEXT NOT NULL DEFAULT ''
);

INSERT INTO icono_generation_requests_delivery_completion (
  id,
  gene_symbol,
  requester_user_id,
  requester_username,
  request_mode,
  requested_vision_id,
  status,
  created_at,
  updated_at,
  fulfilled_at,
  fulfilled_by,
  fulfilled_asset_sha256,
  fulfilled_vision_id,
  fulfillment_note,
  request_kind,
  request_prompt,
  source_gene_symbol,
  source_asset_sha256
)
SELECT
  id,
  gene_symbol,
  requester_user_id,
  requester_username,
  request_mode,
  requested_vision_id,
  status,
  created_at,
  updated_at,
  fulfilled_at,
  fulfilled_by,
  fulfilled_asset_sha256,
  fulfilled_vision_id,
  fulfillment_note,
  request_kind,
  request_prompt,
  source_gene_symbol,
  source_asset_sha256
FROM icono_generation_requests;

DROP TABLE icono_generation_requests;
ALTER TABLE icono_generation_requests_delivery_completion RENAME TO icono_generation_requests;

CREATE INDEX idx_icono_generation_requests_open_created
  ON icono_generation_requests (status, created_at ASC, id ASC);

CREATE INDEX idx_icono_generation_requests_lane
  ON icono_generation_requests (gene_symbol, request_mode, requested_vision_id, status, created_at ASC);

CREATE INDEX idx_icono_generation_requests_user
  ON icono_generation_requests (requester_user_id, status, created_at DESC);

CREATE INDEX idx_icono_generation_requests_kind
  ON icono_generation_requests (status, request_kind, created_at ASC, id ASC);

-- Retriable Discord failures use this field to avoid hot-looping; permanent
-- failures remain explicitly visible as delivery_pending rather than being
-- reclassified as fulfilled.
ALTER TABLE icono_request_notifications
  ADD COLUMN discord_next_attempt_at TEXT;

CREATE INDEX idx_icono_request_notifications_delivery_due
  ON icono_request_notifications (
    discord_status,
    discord_next_attempt_at,
    created_at ASC,
    id ASC
  );

-- The notification outbox is created atomically with the publication handoff.
-- Only the delivery worker may move the associated request to fulfilled.
CREATE TRIGGER trg_icono_generation_request_delivery_pending_notification
AFTER UPDATE OF status ON icono_generation_requests
WHEN OLD.status = 'open' AND NEW.status = 'delivery_pending'
BEGIN
  INSERT OR IGNORE INTO icono_request_notifications (
    notification_key,
    request_id,
    requester_user_id,
    gene_symbol,
    request_kind,
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
    NEW.request_kind,
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
