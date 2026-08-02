-- ARCHITECTURE FENCE [IPD-006]
-- Discord packages completed images from one durable workstation publication.
-- Request-time clicks and request batches are provenance, not delivery units.

ALTER TABLE icono_generation_requests
  ADD COLUMN fulfillment_publication_id TEXT NOT NULL DEFAULT '';

ALTER TABLE icono_generation_requests
  ADD COLUMN fulfillment_group_size INTEGER NOT NULL DEFAULT 1
    CHECK (fulfillment_group_size BETWEEN 1 AND 500);

ALTER TABLE icono_request_notifications
  ADD COLUMN fulfillment_publication_id TEXT NOT NULL DEFAULT '';

ALTER TABLE icono_request_notifications
  ADD COLUMN fulfillment_group_size INTEGER NOT NULL DEFAULT 1
    CHECK (fulfillment_group_size BETWEEN 1 AND 500);

UPDATE icono_request_notifications
SET fulfillment_publication_id = 'legacy-request:' || request_id
WHERE fulfillment_publication_id = '';

CREATE INDEX idx_icono_request_notifications_fulfillment_publication
  ON icono_request_notifications (
    requester_user_id,
    fulfillment_publication_id,
    gene_symbol,
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
    request_batch_size,
    fulfillment_publication_id,
    fulfillment_group_size
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
    NEW.request_batch_size,
    NEW.fulfillment_publication_id,
    NEW.fulfillment_group_size
  );
END;
