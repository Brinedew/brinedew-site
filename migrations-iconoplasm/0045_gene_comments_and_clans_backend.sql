-- Backend-only community resampling suggestions for genes.
--
-- Public reads are per-gene and ordered by the indexed canonical symbol. Writes
-- require a signed-in user and are rate-limited by the worker. This table is not
-- used by public catalog, gallery, card, or extension hot-read paths.
-- NOTE: avatar_url and updated_at are intentionally NOT created here. An earlier
-- variant of this migration shipped a minimal table to production, and
-- CREATE TABLE IF NOT EXISTS cannot add columns to an already-existing table.
-- Migration 0046 ALTERs both columns in, which keeps production and fresh
-- databases on the same schema (fresh DBs create the minimal table here, then
-- 0046 adds the columns).
CREATE TABLE IF NOT EXISTS icono_gene_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gene_symbol TEXT NOT NULL,
  user_id TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'visible'
    CHECK (status IN ('visible', 'hidden', 'deleted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Per-gene newest-first reads. SQLite can scan this index backward.
CREATE INDEX IF NOT EXISTS idx_icono_gene_comments_symbol_visible_created
  ON icono_gene_comments (gene_symbol, status, created_at);

-- Supports the per-user hourly write limit.
CREATE INDEX IF NOT EXISTS idx_icono_gene_comments_user_recent
  ON icono_gene_comments (user_id, created_at);

-- Durable prompt audit trail for backend/workstation generation. This stores the
-- exact bounded comment snapshot included in a candidate generation prompt.
ALTER TABLE icono_candidate_generation_jobs
  ADD COLUMN community_comments_snapshot TEXT NOT NULL DEFAULT '';
