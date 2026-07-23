-- ARCHITECTURE FENCE [IPD-006]
-- A queue action is the durable delivery unit. Persist its identity instead of
-- attempting to infer batches later from completion time or adjacent row IDs.
-- Existing rows become one-request legacy batches so this migration can never
-- merge historical requests into a surprise Discord message.

ALTER TABLE icono_generation_requests
  ADD COLUMN request_batch_id TEXT NOT NULL DEFAULT '';

ALTER TABLE icono_generation_requests
  ADD COLUMN request_batch_size INTEGER NOT NULL DEFAULT 1
    CHECK (request_batch_size BETWEEN 1 AND 500);

UPDATE icono_generation_requests
SET request_batch_id = 'legacy-request:' || id
WHERE request_batch_id = '';

CREATE INDEX idx_icono_generation_requests_delivery_batch
  ON icono_generation_requests (
    requester_user_id,
    request_batch_id,
    gene_symbol,
    request_kind,
    status,
    id
  );

ALTER TABLE icono_request_notifications
  ADD COLUMN request_batch_id TEXT NOT NULL DEFAULT '';

ALTER TABLE icono_request_notifications
  ADD COLUMN request_batch_size INTEGER NOT NULL DEFAULT 1
    CHECK (request_batch_size BETWEEN 1 AND 500);

UPDATE icono_request_notifications
SET request_batch_id = 'legacy-request:' || request_id
WHERE request_batch_id = '';

CREATE INDEX idx_icono_request_notifications_delivery_batch
  ON icono_request_notifications (
    requester_user_id,
    request_batch_id,
    gene_symbol,
    request_kind,
    discord_status,
    id
  );

DROP TRIGGER IF EXISTS trg_icono_generation_request_delivery_pending_notification;

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
    fulfilled_vision_id,
    request_batch_id,
    request_batch_size
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
    COALESCE(NEW.fulfilled_vision_id, ''),
    NEW.request_batch_id,
    NEW.request_batch_size
  );
END;
