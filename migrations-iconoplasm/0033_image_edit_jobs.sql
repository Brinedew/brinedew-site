-- B-517: authenticated BYOK image-edit providers and durable edit jobs.
--
-- D1 cost fence:
-- Public edit routes must only use point lookups by authenticated user, job id,
-- or (gene_symbol, asset_sha256). Do not add unbounded provider/job listing to
-- the public runtime path.

CREATE TABLE IF NOT EXISTS icono_user_image_provider_keys (
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  encrypted_api_key TEXT NOT NULL,
  encryption_iv TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL DEFAULT '',
  endpoint_url TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_icono_user_image_provider_keys_user
  ON icono_user_image_provider_keys (user_id, provider_id);

CREATE TABLE IF NOT EXISTS icono_image_edit_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  source_gene_symbol TEXT NOT NULL,
  source_asset_sha256 TEXT NOT NULL,
  source_candidate_image_id INTEGER,
  source_vision_id TEXT NOT NULL DEFAULT '',
  source_upvotes INTEGER NOT NULL DEFAULT 0,
  source_downvotes INTEGER NOT NULL DEFAULT 0,
  source_score INTEGER NOT NULL DEFAULT 0,
  adjustments_json TEXT NOT NULL DEFAULT '[]',
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
  inherited_upvotes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  published_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_icono_image_edit_jobs_user_status_created
  ON icono_image_edit_jobs (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_icono_image_edit_jobs_source_asset
  ON icono_image_edit_jobs (source_gene_symbol, source_asset_sha256, created_at DESC);
