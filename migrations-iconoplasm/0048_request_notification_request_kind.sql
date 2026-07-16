-- Preserve the user journey that produced a fulfillment notification.
--
-- 0047 intentionally snapshotted fulfillment context instead of joining the
-- mutable request row at read time, but it omitted request_kind. That made the
-- first Discord copy generic enough to hide the actual free-queue action.

ALTER TABLE icono_request_notifications
  ADD COLUMN request_kind TEXT NOT NULL DEFAULT 'new_candidate'
  CHECK (request_kind IN ('new_candidate', 'edit_image'));

-- Existing notification rows predate this column. Backfill metadata only; do
-- not create or redeliver any historical notification.
UPDATE icono_request_notifications
SET request_kind = COALESCE((
  SELECT gr.request_kind
  FROM icono_generation_requests gr
  WHERE gr.id = icono_request_notifications.request_id
), 'new_candidate');

-- Replace the 0047 trigger so future rows snapshot request_kind atomically with
-- the rest of the notification. Trigger creation remains at the status
-- transition boundary; API callers must not grow their own notification path.
DROP TRIGGER IF EXISTS trg_icono_generation_request_fulfilled_notification;

CREATE TRIGGER trg_icono_generation_request_fulfilled_notification
AFTER UPDATE OF status ON icono_generation_requests
WHEN OLD.status <> 'fulfilled' AND NEW.status = 'fulfilled'
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
