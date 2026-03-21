-- 0015_admin_vision_query_index.sql
--
-- Vision and artist admin screens need to answer directly from raw assets when
-- the heavyweight gene-centric read-model bootstrap is still catching up. The
-- artist_tag path already has an index; this adds the matching vision_id path so
-- grouped vision queries do not depend on a fully backfilled rollup table.

CREATE INDEX IF NOT EXISTS idx_icono_portrait_assets_vision_id
  ON icono_portrait_assets (vision_id, status, created_at DESC);
