-- One mutable pointer selects the immutable factory definitions published in code.
-- Requests snapshot both axes when they are created; later pointer changes never
-- rewrite queued or historical work.

CREATE TABLE IF NOT EXISTS icono_factory_active_recipe (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  pipeline_code TEXT NOT NULL CHECK (pipeline_code GLOB '[A-Z]'),
  vision_revision INTEGER NOT NULL CHECK (vision_revision > 0),
  updated_by TEXT NOT NULL DEFAULT 'migration',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO icono_factory_active_recipe (
  singleton_id, pipeline_code, vision_revision, updated_by
) VALUES (1, 'A', 1, 'migration');

ALTER TABLE icono_generation_requests
  ADD COLUMN factory_pipeline_code TEXT NOT NULL DEFAULT 'A';

ALTER TABLE icono_generation_requests
  ADD COLUMN factory_vision_revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN factory_pipeline_code TEXT NOT NULL DEFAULT 'A';

ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN factory_vision_revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN requested_emulsion_slot INTEGER NOT NULL DEFAULT 0;

ALTER TABLE icono_portrait_assets
  ADD COLUMN public_emulsion_code TEXT;
