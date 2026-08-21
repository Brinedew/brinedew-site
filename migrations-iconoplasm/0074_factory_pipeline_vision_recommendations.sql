-- Pipeline definitions remain immutable. This table owns only the mutable
-- operator-selected Vision recommendation shown by the admin and style picker.

CREATE TABLE IF NOT EXISTS icono_factory_pipeline_vision_recommendations (
  pipeline_code TEXT PRIMARY KEY CHECK (pipeline_code GLOB '[A-Z]'),
  vision_revision INTEGER NOT NULL CHECK (vision_revision > 0),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
