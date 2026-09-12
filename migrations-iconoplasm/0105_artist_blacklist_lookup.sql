-- Finalization and admin rollups compare normalized artist tags. The ordinary
-- primary-key index cannot serve this expression, so each asset scanned every
-- blacklist row. Preserve the existing case-insensitive and NULL semantics.
CREATE INDEX IF NOT EXISTS idx_icono_artist_blacklist_normalized_tag
  ON icono_artist_style_blacklist (lower(COALESCE(artist_tag, '')));
