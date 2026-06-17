-- Durable workstation-removal requests for Iconoplasm moderation.
--
-- Chesterton's fence:
-- The public worker can moderate website state immediately, but it cannot and
-- should not pretend to reach into the workstation filesystem directly. Keep
-- the cross-boundary handoff explicit and durable here so the existing
-- workstation sync can consume and acknowledge pending local deletions.

CREATE TABLE IF NOT EXISTS icono_local_removal_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gene_symbol TEXT NOT NULL,
  asset_sha256 TEXT NOT NULL,
  candidate_image_id INTEGER,
  vision_id TEXT NOT NULL DEFAULT '',
  requested_by TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'admin_remove',
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by TEXT,
  resolved_status TEXT NOT NULL DEFAULT '',
  resolved_note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_icono_local_removal_requests_pending_requested_at
  ON icono_local_removal_requests (resolved_at, requested_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_icono_local_removal_requests_symbol_asset
  ON icono_local_removal_requests (gene_symbol, asset_sha256, requested_at DESC);
