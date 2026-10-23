-- B-1163: an order's receipt waits for the requests the order actually holds,
-- counted when its first request is delivered, not for the size written on the
-- row that placed it. Repeated "Queue random" clicks on one gene now join the
-- clicker's open random order (one order, one Discord receipt), so an order can
-- grow after it was placed. It can only grow while every request in it is still
-- open (the join's insert checks that in the same statement), so this count is
-- final by the time any notification is born. For an order placed whole it
-- equals 0134's request_batch_size minus its cancelled requests.

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
    (
      SELECT COUNT(*)
      FROM icono_generation_requests INDEXED BY idx_icono_generation_requests_delivery_batch
      WHERE requester_user_id = NEW.requester_user_id
        AND request_batch_id = NEW.request_batch_id
        AND gene_symbol = NEW.gene_symbol
        AND request_kind = NEW.request_kind
        AND status <> 'cancelled'
    )
  );
END;
