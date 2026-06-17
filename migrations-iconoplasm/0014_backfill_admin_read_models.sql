-- 0014_backfill_admin_read_models.sql
--
-- The original version of this migration tried to backfill every admin read-model
-- table in one shot. That blew past production D1 CPU limits (code 7429), so the
-- real backfill now runs in bounded chunks through the admin bootstrap endpoint.
-- This migration only creates the progress table that makes resumable bootstrap work.

CREATE TABLE IF NOT EXISTS icono_admin_read_model_bootstrap (
  bootstrap_key TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running',
  phase TEXT NOT NULL DEFAULT 'symbols',
  last_symbol TEXT NOT NULL DEFAULT '',
  last_vision_id TEXT NOT NULL DEFAULT '',
  processed_symbols INTEGER NOT NULL DEFAULT 0,
  total_symbols INTEGER NOT NULL DEFAULT 0,
  processed_visions INTEGER NOT NULL DEFAULT 0,
  total_visions INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_icono_admin_bootstrap_status
  ON icono_admin_read_model_bootstrap(status, phase);
