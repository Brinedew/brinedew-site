-- Budget read-model support for the admin gallery.
--
-- The gallery page used to compute total counts with COUNT(*) OVER() on the
-- paginated query and normalize search with upper(...) predicates at read time.
-- Keep those costs on the explicit read-model sync path instead of every admin
-- page refresh.
--
-- Operational lesson from the 2026-05 sync: admin proof panels are not free.
-- They are allowed to be slightly stale and then refreshed by an explicit
-- mutation path; they are not allowed to rescan hot tables every few seconds
-- just because a browser is open. The Website Ops GUI now polls cheap status
-- frequently and slower proof snapshots on a TTL. If this migration looks
-- "denormalized", that is the point: precomputed search columns and count-cache
-- rows are cheaper and safer than COUNT(*) OVER() / upper(...) LIKE on every
-- admin gallery page load.

ALTER TABLE icono_admin_gene_rollup ADD COLUMN search_symbol TEXT;
ALTER TABLE icono_admin_gene_rollup ADD COLUMN search_full_name TEXT;

UPDATE icono_admin_gene_rollup
SET search_symbol = gene_symbol,
    search_full_name = upper(COALESCE(NULLIF(TRIM(full_name), ''), gene_symbol))
WHERE search_symbol IS NULL
   OR search_full_name IS NULL;

CREATE INDEX IF NOT EXISTS idx_icono_admin_gene_rollup_search_symbol
  ON icono_admin_gene_rollup (search_symbol, gene_symbol);

CREATE INDEX IF NOT EXISTS idx_icono_admin_gene_rollup_search_full_name
  ON icono_admin_gene_rollup (search_full_name, gene_symbol);

CREATE TABLE IF NOT EXISTS icono_admin_gallery_count_cache (
  count_key TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  filter TEXT NOT NULL,
  total INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_icono_admin_gallery_count_cache_mode_filter
  ON icono_admin_gallery_count_cache (mode, filter);
