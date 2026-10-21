-- ARCHITECTURE FENCE [IPD-006]
-- One reader order is one Discord receipt, however many Drain sessions draw it
-- (B-1145). 0062 grouped receipts by the publication that finished them, so an
-- order drawn across two sessions came back as two messages (54 orders in the
-- 2026-10-20 nightly copy). The notification is now born in its order's group:
-- the group key is the order's request_batch_id, and the group waits for every
-- request in the order that can still finish. A request cancelled before its
-- order is delivered leaves the group, so the rest are never held back by it.
--
-- Every request has an order id: a single request is an order of one
-- ("single-<uuid>"), and 0058 gave historical rows "legacy-request:<id>".
-- fulfillment_publication_id on a notification is this delivery-group key; on
-- a request row it stays the publication that finished it.

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
    NEW.request_batch_id,
    MAX(1, NEW.request_batch_size - (
      SELECT COUNT(*)
      FROM icono_generation_requests INDEXED BY idx_icono_generation_requests_delivery_batch
      WHERE requester_user_id = NEW.requester_user_id
        AND request_batch_id = NEW.request_batch_id
        AND gene_symbol = NEW.gene_symbol
        AND request_kind = NEW.request_kind
        AND status = 'cancelled'
    ))
  );
END;

-- A request cancelled while its order waits shrinks the order's group, so the
-- receipt goes out when everything that can finish has finished.
CREATE TRIGGER trg_icono_generation_request_cancel_shrinks_delivery_group
AFTER UPDATE OF status ON icono_generation_requests
WHEN OLD.status = 'open' AND NEW.status = 'cancelled'
BEGIN
  UPDATE icono_request_notifications
  SET fulfillment_group_size = MAX(1, fulfillment_group_size - 1)
  WHERE id IN (
    SELECT id FROM icono_request_notifications
    INDEXED BY idx_icono_request_notifications_fulfillment_publication
    WHERE requester_user_id = NEW.requester_user_id
      AND fulfillment_publication_id = NEW.request_batch_id
      AND gene_symbol = NEW.gene_symbol
    ORDER BY id LIMIT 501
  )
    AND discord_status <> 'sent';
END;
