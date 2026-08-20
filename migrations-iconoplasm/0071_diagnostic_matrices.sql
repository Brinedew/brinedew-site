-- Diagnostic matrices are admin-owned experiment batches. They use the same
-- durable generation queue as ordinary requests, but never create user
-- notifications. Each request snapshots its real emulsion slot and factory
-- recipe; the obsolete candidate-preview "reference gene" fields are removed.

ALTER TABLE icono_generation_requests
  DROP COLUMN requested_reference_asset_sha256;

ALTER TABLE icono_generation_requests
  DROP COLUMN requested_reference_gene_symbol;

ALTER TABLE icono_generation_requests
  ADD COLUMN requested_emulsion_slot INTEGER NOT NULL DEFAULT 0;

ALTER TABLE icono_generation_requests
  ADD COLUMN request_origin TEXT NOT NULL DEFAULT 'user'
  CHECK (request_origin IN ('user', 'diagnostic_matrix'));

ALTER TABLE icono_generation_requests
  ADD COLUMN diagnostic_run_id TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_icono_generation_requests_diagnostic_run
  ON icono_generation_requests (diagnostic_run_id, id);

CREATE TABLE icono_diagnostic_matrix_runs (
  id TEXT PRIMARY KEY,
  gene_symbol TEXT NOT NULL,
  vision_revision INTEGER NOT NULL CHECK (vision_revision > 0),
  pipeline_codes_json TEXT NOT NULL,
  emulsion_slots_json TEXT NOT NULL,
  cell_count INTEGER NOT NULL CHECK (cell_count > 0 AND cell_count <= 100),
  prompt_body_mode TEXT NOT NULL DEFAULT 'taggerizer_prompt'
    CHECK (prompt_body_mode IN ('taggerizer_prompt', 'prose_prompt')),
  queue_state TEXT NOT NULL DEFAULT 'building'
    CHECK (queue_state IN ('building', 'queued')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_icono_diagnostic_matrix_runs_created
  ON icono_diagnostic_matrix_runs (created_at DESC, id DESC);

CREATE TABLE icono_diagnostic_matrix_cells (
  run_id TEXT NOT NULL,
  pipeline_code TEXT NOT NULL CHECK (pipeline_code GLOB '[A-Z]'),
  vision_revision INTEGER NOT NULL CHECK (vision_revision > 0),
  emulsion_slot INTEGER NOT NULL CHECK (emulsion_slot > 0),
  generation_request_id INTEGER NOT NULL UNIQUE,
  PRIMARY KEY (run_id, pipeline_code, vision_revision, emulsion_slot),
  FOREIGN KEY (run_id) REFERENCES icono_diagnostic_matrix_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (generation_request_id) REFERENCES icono_generation_requests(id) ON DELETE CASCADE
);

CREATE INDEX idx_icono_diagnostic_matrix_cells_run
  ON icono_diagnostic_matrix_cells (run_id, pipeline_code, emulsion_slot);
