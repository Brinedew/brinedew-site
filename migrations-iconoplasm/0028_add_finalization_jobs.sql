-- Chesterton's fence: late Website sync finalization was failing after ingest had already
-- done the expensive work. Persist the per-symbol finalization state here so reconcile and
-- read-model refresh can resume in bounded steps instead of pretending one giant request is safe.
CREATE TABLE IF NOT EXISTS icono_sync_finalization_jobs (
  gene_symbol TEXT PRIMARY KEY,
  actor_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  phase TEXT NOT NULL DEFAULT 'reconcile',
  keep_assets_json TEXT NOT NULL DEFAULT '[]',
  legacy_assets_json TEXT NOT NULL DEFAULT '[]',
  vision_ids_json TEXT NOT NULL DEFAULT '[]',
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_icono_sync_finalization_jobs_status_next_attempt
  ON icono_sync_finalization_jobs (status, next_attempt_at, requested_at);

CREATE INDEX IF NOT EXISTS idx_icono_sync_finalization_jobs_phase_status
  ON icono_sync_finalization_jobs (phase, status, requested_at);
