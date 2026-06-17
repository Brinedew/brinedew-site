ALTER TABLE icono_portrait_assets ADD COLUMN candidate_image_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_icono_portrait_assets_candidate_image_id
  ON icono_portrait_assets (candidate_image_id);

ALTER TABLE icono_image_votes ADD COLUMN candidate_image_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_icono_image_votes_candidate_image_id
  ON icono_image_votes (candidate_image_id, updated_at DESC);
