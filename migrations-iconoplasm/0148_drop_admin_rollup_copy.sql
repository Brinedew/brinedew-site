-- B-1188: drop the admin pages' copy of each gene, its count cache, and the
-- admin home counters that nothing keeps any more.
--
-- Chesterton's fence: icono_admin_gene_rollup copied each gene's card, pin,
-- vote leader and portrait counts so the admin pages could sort and count
-- without joining, and icono_admin_gallery_count_cache held the gallery's
-- totals. Only admin actions rebuilt them, so they drifted: on the 2026-10-29
-- copy the rollup showed an old card for 160 genes, TP53 among them, and the
-- admin home summed it into 610 genes "with no candidate" that each had one.
-- The gallery (#791), the clans page (#792), the admin home (#793), the
-- canon audit, the nightly canon repair and the storage audit (#794) now read
-- the catalogue, the portraits, icono_publish_state and the vote summaries,
-- and nothing reads or writes these two tables.
--
-- with_live, overrides, no_live, stale_assets and legacy_assets in
-- icono_admin_dashboard_summary were seeded once by 0147 and are kept by no
-- trigger; the admin home reads them from icono_asset_summary_counts and the
-- pinned index.
--
-- Cost, measured in Miniflare: DROP TABLE of 20,000 rows with six indexes
-- wrote 0 rows; a DROP COLUMN on a one-row table wrote 4.
--
-- Online: the Worker installed since #794 reads and writes none of these.

DROP TABLE IF EXISTS icono_admin_gene_rollup;
DROP TABLE IF EXISTS icono_admin_gallery_count_cache;

ALTER TABLE icono_admin_dashboard_summary DROP COLUMN with_live;
ALTER TABLE icono_admin_dashboard_summary DROP COLUMN overrides;
ALTER TABLE icono_admin_dashboard_summary DROP COLUMN no_live;
ALTER TABLE icono_admin_dashboard_summary DROP COLUMN stale_assets;
ALTER TABLE icono_admin_dashboard_summary DROP COLUMN legacy_assets;
