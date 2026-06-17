-- Authenticated BYOK candidate generation jobs.
--
-- D1 cost fence:
-- The public mutation path must stay point-keyed by the authenticated user,
-- job id, gene symbol, and one selected precomputed emulsion rollup row. Do not
-- turn direct image generation into a live portrait scan or an unbounded job
-- listing endpoint.

CREATE TABLE IF NOT EXISTS icono_candidate_generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  gene_symbol TEXT NOT NULL,
  request_mode TEXT NOT NULL DEFAULT 'specific'
    CHECK (request_mode IN ('specific')),
  requested_vision_id TEXT NOT NULL,
  requested_emulsion_id TEXT NOT NULL DEFAULT '',
  requested_emulsion_label TEXT NOT NULL DEFAULT '',
  gene_full_name TEXT NOT NULL DEFAULT '',
  manifestation TEXT NOT NULL DEFAULT '',
  sample_label TEXT,
  sample_number INTEGER NOT NULL DEFAULT 0,
  sample_text_hash TEXT,
  reference_assets_json TEXT NOT NULL DEFAULT '[]',
  prompt TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  error TEXT NOT NULL DEFAULT '',
  result_asset_sha256 TEXT NOT NULL DEFAULT '',
  result_r2_key_full TEXT NOT NULL DEFAULT '',
  result_r2_key_medium TEXT NOT NULL DEFAULT '',
  result_r2_key_thumb TEXT NOT NULL DEFAULT '',
  result_mime TEXT NOT NULL DEFAULT '',
  result_width INTEGER,
  result_height INTEGER,
  result_bytes INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_icono_candidate_generation_jobs_user_status_created
  ON icono_candidate_generation_jobs (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_icono_candidate_generation_jobs_gene_created
  ON icono_candidate_generation_jobs (gene_symbol, created_at DESC);
