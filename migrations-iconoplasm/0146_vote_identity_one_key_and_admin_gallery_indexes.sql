-- B-1188: one key for a vote, and the indexes the admin gallery reads by.
--
-- icono_image_votes enforced one identity twice: the primary key
-- (candidate_ref, user_id), where candidate_ref is 'a:' || gene || '|' || sha,
-- and the unique index (gene_symbol, asset_sha256, user_id) that 0017 added so
-- that a legacy 'c:<id>' ref could not fork a person's vote. Every new vote paid
-- for both: the vote table took 4 rows written (the row, both keys and the user
-- index). Keyed by (gene_symbol, asset_sha256, user_id) alone, as a WITHOUT
-- ROWID table, it takes 2: a whole new vote writes 7 rows instead of 9
-- (vote-asset-summary-cost.test.js). B-1065 kept the old key only because
-- dropping it needs this rebuild. 1,765 votes on 2026-10-29: about 3,700 rows
-- written now, more every day it waits.
--
-- Chesterton's fence: no index here ranks icono_vote_asset_summary by score.
-- Every vote rewrites its summary's score, so such an index costs every vote one
-- more row written (measured: 7 to 8), and writes are the meter that refuses
-- readers' votes first. The admin gallery's vote sorts scan instead.
--
-- candidate_ref stays as a column: the vote routes still write it, and history
-- imports keep their original reference. Nothing looks a vote up by it.
--
-- Online: the vote route's upsert names ON CONFLICT(gene_symbol, asset_sha256,
-- user_id), which the new primary key serves; the previous release's one query
-- that pinned the old key by name (fetchAssetStateRows, admin only) still runs,
-- by scanning, until the new Worker replaces it minutes later.
CREATE TABLE icono_image_votes_next (
  candidate_ref TEXT NOT NULL,
  gene_symbol TEXT NOT NULL,
  asset_sha256 TEXT NOT NULL,
  vision_id TEXT NOT NULL DEFAULT '',
  user_id TEXT NOT NULL,
  vote_value INTEGER NOT NULL CHECK (vote_value IN (-1, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  candidate_image_id INTEGER,
  PRIMARY KEY (gene_symbol, asset_sha256, user_id)
) WITHOUT ROWID;

INSERT INTO icono_image_votes_next (
  candidate_ref, gene_symbol, asset_sha256, vision_id, user_id, vote_value,
  created_at, updated_at, candidate_image_id
)
SELECT candidate_ref, gene_symbol, asset_sha256, vision_id, user_id, vote_value,
       created_at, updated_at, candidate_image_id
FROM icono_image_votes;

DROP TABLE icono_image_votes;
ALTER TABLE icono_image_votes_next RENAME TO icono_image_votes;

-- Account erasure finds a person's votes by user_id.
CREATE INDEX idx_icono_image_votes_user ON icono_image_votes (user_id, updated_at DESC);

-- The admin gallery's stale filter (439 portraits on 2026-10-29). is_stale
-- changes only when the pipeline or an administrator marks a portrait.
CREATE INDEX idx_icono_portrait_assets_stale
  ON icono_portrait_assets (gene_symbol, asset_sha256)
  WHERE is_stale = 1;

-- The admin gallery's pinned filter: genes an administrator pinned (none on
-- 2026-10-29). A row enters or leaves only when a pin is set or cleared.
CREATE INDEX idx_icono_publish_state_pinned
  ON icono_publish_state (gene_symbol)
  WHERE admin_override = 1;
