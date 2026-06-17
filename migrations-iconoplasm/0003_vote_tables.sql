-- Phase 4: Remote vote source of truth for Iconoplasm.
--
-- Votes are keyed by (candidate_ref, user_id) so historical local candidate votes
-- can be imported losslessly, while still storing gene/asset/vision metadata.
-- Vision vote stats are derived by aggregating image votes on vision_id.

CREATE TABLE IF NOT EXISTS icono_image_votes (
  candidate_ref TEXT NOT NULL,
  gene_symbol TEXT NOT NULL,
  asset_sha256 TEXT NOT NULL,
  vision_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL,
  vote_value INTEGER NOT NULL CHECK (vote_value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (candidate_ref, user_id)
);

CREATE INDEX IF NOT EXISTS idx_icono_image_votes_user
  ON icono_image_votes (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_icono_image_votes_vision
  ON icono_image_votes (vision_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_icono_image_votes_candidate
  ON icono_image_votes (candidate_ref, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_icono_image_votes_asset
  ON icono_image_votes (gene_symbol, asset_sha256);
