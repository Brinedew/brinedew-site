-- Direct Image API candidate jobs are novel generations, not local emulsion
-- requests. This rebuilds the table so the database contract names that mode
-- directly while keeping old specific-emulsion jobs readable.
--
-- D1 cost fence:
-- This job table may store a specific requested vision for historical jobs, but
-- the live direct Image API path must stay point-keyed by authenticated user,
-- job id, and gene symbol. Do not add a public/runtime scan over portrait
-- assets or generation option rollups here.

DROP INDEX IF EXISTS idx_icono_candidate_generation_jobs_user_status_created;
DROP INDEX IF EXISTS idx_icono_candidate_generation_jobs_gene_created;

ALTER TABLE icono_candidate_generation_jobs
  RENAME TO icono_candidate_generation_jobs_0037_old;

CREATE TABLE icono_candidate_generation_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  gene_symbol TEXT NOT NULL,
  request_mode TEXT NOT NULL DEFAULT 'novel'
    CHECK (request_mode IN ('specific', 'novel')),
  requested_vision_id TEXT NOT NULL DEFAULT '',
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

INSERT INTO icono_candidate_generation_jobs (
  id,
  user_id,
  provider_id,
  gene_symbol,
  request_mode,
  requested_vision_id,
  requested_emulsion_id,
  requested_emulsion_label,
  gene_full_name,
  manifestation,
  sample_label,
  sample_number,
  sample_text_hash,
  reference_assets_json,
  prompt,
  status,
  error,
  result_asset_sha256,
  result_r2_key_full,
  result_r2_key_medium,
  result_r2_key_thumb,
  result_mime,
  result_width,
  result_height,
  result_bytes,
  created_at,
  updated_at,
  completed_at,
  published_at
)
SELECT
  id,
  user_id,
  provider_id,
  gene_symbol,
  CASE WHEN request_mode = 'specific' THEN 'specific' ELSE 'novel' END,
  COALESCE(requested_vision_id, ''),
  COALESCE(requested_emulsion_id, ''),
  COALESCE(requested_emulsion_label, ''),
  COALESCE(gene_full_name, ''),
  COALESCE(manifestation, ''),
  sample_label,
  COALESCE(sample_number, 0),
  sample_text_hash,
  COALESCE(reference_assets_json, '[]'),
  COALESCE(prompt, ''),
  status,
  COALESCE(error, ''),
  COALESCE(result_asset_sha256, ''),
  COALESCE(result_r2_key_full, ''),
  COALESCE(result_r2_key_medium, ''),
  COALESCE(result_r2_key_thumb, ''),
  COALESCE(result_mime, ''),
  result_width,
  result_height,
  result_bytes,
  created_at,
  updated_at,
  completed_at,
  published_at
FROM icono_candidate_generation_jobs_0037_old;

DROP TABLE icono_candidate_generation_jobs_0037_old;

CREATE INDEX idx_icono_candidate_generation_jobs_user_status_created
  ON icono_candidate_generation_jobs (user_id, status, created_at DESC);

CREATE INDEX idx_icono_candidate_generation_jobs_gene_created
  ON icono_candidate_generation_jobs (gene_symbol, created_at DESC);
