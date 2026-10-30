-- B-1147: a vote and a winner change write fewer D1 rows, and once batch work
-- has spent its share of the day, a winner change waits for the next UTC day
-- instead of spending the readers' share.
--
-- Measured in Miniflare on the whole migrated schema
-- (workers/iconoplasm/vote-asset-summary-cost.test.js): a winner change wrote
-- 12 rows and now writes 9; a vote that changes its value wrote 5 and now
-- writes 4.
--
-- 1. idx_icono_publish_state_updated (0109) served /api/public/v1/changes,
--    which is gone. Nothing filters or sorts icono_publish_state by updated_at,
--    and every winner change rewrote the index entry: 1 row.
-- 2. trg_icono_asset_summary_publish_update (0104) recounted the live
--    portraits on every winner change: 2 rows. The count only moves when a
--    gene gains or loses its card, so the trigger now fires only then. Its
--    body is unchanged: when the card only changes hands, the old card's -1
--    and the new card's +1 cancel out.
-- 3. idx_icono_image_votes_user (0146) carried updated_at, so a vote that
--    changed its value rewrote its index entry: 1 row. Account erasure, the
--    index's only reader, finds a person's votes by user_id alone.
-- 4. icono_gene_elections_due holds the genes whose election waits, and
--    icono_publication_shed_days holds the UTC days on which batch work had
--    spent its share (85% of a D1 meter, shared/iconoplasm-d1-budget-policy.js).
--    workers/iconoplasm/votes/deferred-elections.js writes and reads both.
--
-- Cost: rebuilding the user index writes one row per vote (1,765 on the
-- 2026-10-29 copy); everything else writes 0.
--
-- Online: the Worker installed before this change reads none of the dropped
-- indexes and none of the new tables, and the trigger counts what it counted.

DROP INDEX IF EXISTS idx_icono_publish_state_updated;

DROP TRIGGER IF EXISTS trg_icono_asset_summary_publish_update;
CREATE TRIGGER trg_icono_asset_summary_publish_update AFTER UPDATE OF gene_symbol,current_asset_sha256 ON icono_publish_state
WHEN OLD.gene_symbol IS NOT NEW.gene_symbol
  OR (COALESCE(OLD.current_asset_sha256,'')<>'') IS NOT (COALESCE(NEW.current_asset_sha256,'')<>'')
BEGIN
UPDATE icono_asset_summary_counts SET (published_live_portraits,catalog_published_live_portraits)=(SELECT published_live_portraits-COALESCE(SUM(CASE WHEN COALESCE(OLD.current_asset_sha256,'')<>'' THEN 1 ELSE 0 END),0),catalog_published_live_portraits-COALESCE(SUM(CASE WHEN COALESCE(OLD.current_asset_sha256,'')<>'' AND EXISTS(SELECT 1 FROM icono_gene_catalog gc WHERE gc.gene_symbol=OLD.gene_symbol) THEN 1 ELSE 0 END),0)  WHERE 1) WHERE summary_key='default';
UPDATE icono_asset_summary_counts SET (published_live_portraits,catalog_published_live_portraits)=(SELECT published_live_portraits+COALESCE(SUM(CASE WHEN COALESCE(NEW.current_asset_sha256,'')<>'' THEN 1 ELSE 0 END),0),catalog_published_live_portraits+COALESCE(SUM(CASE WHEN COALESCE(NEW.current_asset_sha256,'')<>'' AND EXISTS(SELECT 1 FROM icono_gene_catalog gc WHERE gc.gene_symbol=NEW.gene_symbol) THEN 1 ELSE 0 END),0)  WHERE 1) WHERE summary_key='default';
END;

DROP INDEX IF EXISTS idx_icono_image_votes_user;
CREATE INDEX idx_icono_image_votes_user ON icono_image_votes (user_id);

CREATE TABLE IF NOT EXISTS icono_gene_elections_due (
  gene_symbol TEXT PRIMARY KEY
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS icono_publication_shed_days (
  day TEXT PRIMARY KEY,
  meter TEXT NOT NULL,
  projected INTEGER NOT NULL,
  stop INTEGER NOT NULL,
  noted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
