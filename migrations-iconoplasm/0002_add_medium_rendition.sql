-- Phase 3: Add medium rendition to portrait assets table.
--
-- Based on B-369 decisions:
--   Renditions: full (<=1MP, aspect preserved), medium (512px long edge), thumb (256x256 crop)
--   R2 key layout: portraits/v1/{sha256[0:2]}/{sha256}/{rendition}.webp
--
-- Rename r2_key_hero -> r2_key_full so the column name matches the rendition identifier.
-- Add r2_key_medium for the 512px long-edge rendition (used in extension tooltip, gallery grid).
--
-- Nothing has been published yet so there is no data to migrate.

ALTER TABLE icono_portrait_assets RENAME COLUMN r2_key_hero TO r2_key_full;
ALTER TABLE icono_portrait_assets ADD COLUMN r2_key_medium TEXT;
