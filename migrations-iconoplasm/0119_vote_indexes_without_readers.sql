-- B-1065: a vote wrote 15-21 rows, most of them index entries. Every index is
-- one more row per insert, and a rewrite whenever an update touches its
-- columns; four of these carried updated_at, which every vote change sets.
-- Audited against every query on main that reads these tables:
--
--   icono_image_votes
--     (gene_symbol, asset_sha256)          a prefix of the unique index
--                                          (gene_symbol, asset_sha256, user_id),
--                                          which serves every lookup it could
--     (candidate_image_id, updated_at)     no query filters or sorts on it
--     (vision_id, updated_at)              no query filters or sorts on it
--     (candidate_ref, updated_at)          one query pinned it by name; it now
--                                          uses the primary key (candidate_ref,
--                                          user_id), which leads with the same column
--   icono_vote_asset_summary
--     (candidate_ref)                      every reader joins on the primary key
--     (vision_id, updated_at)              (gene_symbol, asset_sha256)
--
-- Kept: both unique rules on icono_image_votes (the upsert's ON CONFLICT names
-- (gene_symbol, asset_sha256, user_id); the primary key can't go without a
-- table rebuild) and (user_id, updated_at), which account erasure reads.
DROP INDEX IF EXISTS idx_icono_image_votes_asset;
DROP INDEX IF EXISTS idx_icono_image_votes_candidate_image_id;
DROP INDEX IF EXISTS idx_icono_image_votes_vision;
DROP INDEX IF EXISTS idx_icono_image_votes_candidate;
DROP INDEX IF EXISTS idx_icono_vote_asset_summary_candidate_ref;
DROP INDEX IF EXISTS idx_icono_vote_asset_summary_vision_id;
