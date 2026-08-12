-- Candidate prompt modes name the complete prompt authority. `taggerizer_prompt`
-- is the full stored Taggerizer derivative, never a sampled subset.
-- Rebuild the table so the database default and constraint express that
-- contract, while normalizing historical mode names in existing rows.
--
-- D1 cost fence:
-- This is a one-time bounded migration. Runtime candidate reads remain point
-- lookups by authenticated user, job id, and gene symbol.

DROP INDEX IF EXISTS idx_icono_candidate_generation_jobs_user_status_created;
DROP INDEX IF EXISTS idx_icono_candidate_generation_jobs_gene_created;

ALTER TABLE icono_candidate_generation_jobs
  RENAME TO icono_candidate_generation_jobs_0068_old;

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
  published_at TEXT,
  prompt_body_mode TEXT NOT NULL DEFAULT 'taggerizer_prompt'
    CHECK (prompt_body_mode IN ('taggerizer_prompt', 'prose_prompt')),
  community_comments_snapshot TEXT NOT NULL DEFAULT ''
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
  published_at,
  prompt_body_mode,
  community_comments_snapshot
)
SELECT
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
  published_at,
  CASE
    WHEN prompt_body_mode IN ('prose', 'full_manifestation', 'prose_sample')
      THEN 'prose_prompt'
    ELSE 'taggerizer_prompt'
  END,
  community_comments_snapshot
FROM icono_candidate_generation_jobs_0068_old;

DROP TABLE icono_candidate_generation_jobs_0068_old;

CREATE INDEX idx_icono_candidate_generation_jobs_user_status_created
  ON icono_candidate_generation_jobs (user_id, status, created_at DESC);

CREATE INDEX idx_icono_candidate_generation_jobs_gene_created
  ON icono_candidate_generation_jobs (gene_symbol, created_at DESC);
