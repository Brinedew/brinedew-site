CREATE TABLE IF NOT EXISTS icono_vote_projection_refresh_jobs (
  gene_symbol TEXT PRIMARY KEY,
  actor_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_attempt_at TEXT,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_icono_vote_projection_refresh_jobs_next_attempt
  ON icono_vote_projection_refresh_jobs (next_attempt_at, requested_at);
