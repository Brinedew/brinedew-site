-- Admin read models for Iconoplasm.
--
-- The raw tables remain the source of truth. These tables exist only to keep
-- admin/dashboard reads cheap and predictable as vote and asset counts grow.
-- Rebuilds are driven explicitly from worker code so the mutation boundary stays
-- visible and debuggable instead of disappearing into a trigger maze.

CREATE TABLE IF NOT EXISTS icono_vote_asset_summary (
  gene_symbol TEXT NOT NULL,
  asset_sha256 TEXT NOT NULL,
  candidate_ref TEXT NOT NULL,
  vision_id TEXT NOT NULL DEFAULT '',
  candidate_image_id INTEGER,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  vote_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gene_symbol, asset_sha256)
);

CREATE INDEX IF NOT EXISTS idx_icono_vote_asset_summary_candidate_ref
  ON icono_vote_asset_summary (candidate_ref);

CREATE INDEX IF NOT EXISTS idx_icono_vote_asset_summary_vision_id
  ON icono_vote_asset_summary (vision_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS icono_admin_gene_rollup (
  gene_symbol TEXT PRIMARY KEY,
  full_name TEXT,
  manifestation TEXT,
  current_asset_sha256 TEXT,
  current_asset_missing INTEGER NOT NULL DEFAULT 0,
  admin_override INTEGER NOT NULL DEFAULT 0,
  total_assets INTEGER NOT NULL DEFAULT 0,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  approved_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  stale_count INTEGER NOT NULL DEFAULT 0,
  legacy_count INTEGER NOT NULL DEFAULT 0,
  last_asset_at TEXT,
  live_status TEXT,
  live_is_stale INTEGER NOT NULL DEFAULT 0,
  live_is_legacy INTEGER NOT NULL DEFAULT 0,
  live_autopick_eligible INTEGER NOT NULL DEFAULT 0,
  live_vision_id TEXT,
  live_artist_tag TEXT,
  live_artist_name TEXT,
  live_upvotes INTEGER NOT NULL DEFAULT 0,
  live_downvotes INTEGER NOT NULL DEFAULT 0,
  live_score INTEGER NOT NULL DEFAULT 0,
  live_created_at TEXT,
  live_r2_key_full TEXT,
  live_r2_key_medium TEXT,
  live_r2_key_thumb TEXT,
  leader_asset_sha256 TEXT,
  leader_vision_id TEXT,
  leader_artist_tag TEXT,
  leader_artist_name TEXT,
  leader_upvotes INTEGER NOT NULL DEFAULT 0,
  leader_downvotes INTEGER NOT NULL DEFAULT 0,
  leader_score INTEGER NOT NULL DEFAULT 0,
  leader_created_at TEXT,
  leader_r2_key_full TEXT,
  leader_r2_key_medium TEXT,
  leader_r2_key_thumb TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_admin_gene_rollup_candidate_count
  ON icono_admin_gene_rollup (candidate_count, gene_symbol);

CREATE INDEX IF NOT EXISTS idx_icono_admin_gene_rollup_current_asset_missing
  ON icono_admin_gene_rollup (current_asset_missing, gene_symbol);

CREATE INDEX IF NOT EXISTS idx_icono_admin_gene_rollup_admin_override
  ON icono_admin_gene_rollup (admin_override, gene_symbol);

CREATE INDEX IF NOT EXISTS idx_icono_admin_gene_rollup_stale_count
  ON icono_admin_gene_rollup (stale_count, gene_symbol);

CREATE TABLE IF NOT EXISTS icono_admin_dashboard_summary (
  summary_key TEXT PRIMARY KEY,
  genes INTEGER NOT NULL DEFAULT 0,
  with_live INTEGER NOT NULL DEFAULT 0,
  overrides INTEGER NOT NULL DEFAULT 0,
  drift INTEGER NOT NULL DEFAULT 0,
  current_asset_missing INTEGER NOT NULL DEFAULT 0,
  missing INTEGER NOT NULL DEFAULT 0,
  no_live INTEGER NOT NULL DEFAULT 0,
  stale_assets INTEGER NOT NULL DEFAULT 0,
  legacy_assets INTEGER NOT NULL DEFAULT 0,
  zero_candidates INTEGER NOT NULL DEFAULT 0,
  one_candidate INTEGER NOT NULL DEFAULT 0,
  two_to_five_candidates INTEGER NOT NULL DEFAULT 0,
  six_plus_candidates INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS icono_admin_vision_rollup (
  vision_id TEXT PRIMARY KEY,
  artist_tag TEXT,
  artist_name TEXT,
  image_count INTEGER NOT NULL DEFAULT 0,
  avg_vote REAL NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  rejection_rate REAL NOT NULL DEFAULT 0,
  upvotes INTEGER NOT NULL DEFAULT 0,
  downvotes INTEGER NOT NULL DEFAULT 0,
  score INTEGER NOT NULL DEFAULT 0,
  live_count INTEGER NOT NULL DEFAULT 0,
  blacklisted INTEGER NOT NULL DEFAULT 0,
  blacklist_reason TEXT,
  blacklist_updated_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_admin_vision_rollup_live_score
  ON icono_admin_vision_rollup (live_count DESC, score DESC, image_count DESC, vision_id ASC);
