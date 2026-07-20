-- Personal saved emulsions for the public request picker.
-- The visible family ID is the stable identity: edited variants such as
-- A1-255-e and A1-255-e-e intentionally resolve to A1-255.

CREATE TABLE IF NOT EXISTS icono_user_emulsion_favorites (
  user_id TEXT NOT NULL,
  emulsion_family_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, emulsion_family_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_icono_user_emulsion_favorites_recent
  ON icono_user_emulsion_favorites (user_id, created_at DESC, emulsion_family_id ASC);

ALTER TABLE icono_generation_request_vision_option_rollup
  ADD COLUMN emulsion_family_id TEXT NOT NULL DEFAULT '';

WITH RECURSIVE normalized(vision_id, family_id) AS (
  SELECT vision_id, COALESCE(emulsion_id, '')
  FROM icono_generation_request_vision_option_rollup

  UNION ALL

  SELECT vision_id, substr(family_id, 1, length(family_id) - 2)
  FROM normalized
  WHERE lower(family_id) LIKE '%-e'
)
UPDATE icono_generation_request_vision_option_rollup
SET emulsion_family_id = COALESCE(
  (
    SELECT upper(family_id)
    FROM normalized
    WHERE normalized.vision_id = icono_generation_request_vision_option_rollup.vision_id
    ORDER BY length(family_id) ASC
    LIMIT 1
  ),
  ''
);

CREATE INDEX IF NOT EXISTS idx_icono_generation_request_options_family
  ON icono_generation_request_vision_option_rollup (
    builder_version,
    emulsion_family_id,
    vote_h_index DESC,
    live_count DESC,
    score DESC,
    image_count DESC,
    vision_id ASC
  );
