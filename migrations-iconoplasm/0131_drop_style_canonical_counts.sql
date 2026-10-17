-- 0128's per-style counts are retired: since 0130 the picker's style cards
-- count and show from icono_style_published_portraits, and nothing reads
-- icono_style_canonical_counts any more (B-896, 2026-10-17). Its six triggers
-- still cost every caretaker switch a written row (4 rows with them, 3
-- without, measured on Miniflare); dropping them first stops that, then the
-- table goes.
DROP TRIGGER IF EXISTS trg_icono_style_canonical_publish_insert;
DROP TRIGGER IF EXISTS trg_icono_style_canonical_publish_delete;
DROP TRIGGER IF EXISTS trg_icono_style_canonical_publish_update;
DROP TRIGGER IF EXISTS trg_icono_style_canonical_asset_insert;
DROP TRIGGER IF EXISTS trg_icono_style_canonical_asset_delete;
DROP TRIGGER IF EXISTS trg_icono_style_canonical_asset_update;
DROP TABLE IF EXISTS icono_style_canonical_counts;
