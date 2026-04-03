-- Durable website-side generation requests for Iconoplasm.
--
-- The public gene page can ask for more candidate portraits, but the actual image
-- generation still happens on the workstation. Keep the request queue durable on
-- the website so logged-in users can add demand without teaching the worker how to
-- reach into the local filesystem or generation runtime directly.

CREATE TABLE IF NOT EXISTS icono_generation_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gene_symbol TEXT NOT NULL,
  requester_user_id TEXT NOT NULL,
  requester_username TEXT NOT NULL DEFAULT '',
  request_mode TEXT NOT NULL DEFAULT 'random' CHECK (request_mode IN ('random', 'specific')),
  requested_vision_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fulfilled_at TEXT,
  fulfilled_by TEXT NOT NULL DEFAULT '',
  fulfilled_asset_sha256 TEXT NOT NULL DEFAULT '',
  fulfilled_vision_id TEXT NOT NULL DEFAULT '',
  fulfillment_note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_icono_generation_requests_open_created
  ON icono_generation_requests (status, created_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_icono_generation_requests_lane
  ON icono_generation_requests (gene_symbol, request_mode, requested_vision_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_icono_generation_requests_user
  ON icono_generation_requests (requester_user_id, status, created_at DESC);
