-- One user action can enqueue several distinct emulsions. A stable client key
-- makes retrying that action safe when the browser loses the first response.

ALTER TABLE icono_generation_requests
  ADD COLUMN client_request_id TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_icono_generation_requests_client_request
  ON icono_generation_requests (requester_user_id, client_request_id)
  WHERE client_request_id <> '';
