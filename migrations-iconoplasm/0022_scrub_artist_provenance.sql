UPDATE icono_portrait_assets
SET artist_tag = NULL,
    artist_name = NULL
WHERE COALESCE(artist_tag, '') <> ''
   OR COALESCE(artist_name, '') <> '';

UPDATE icono_artist_style_blacklist
SET artist_name = NULL
WHERE COALESCE(artist_name, '') <> '';

UPDATE icono_admin_gene_rollup
SET live_artist_tag = NULL,
    live_artist_name = NULL,
    leader_artist_tag = NULL,
    leader_artist_name = NULL
WHERE COALESCE(live_artist_tag, '') <> ''
   OR COALESCE(live_artist_name, '') <> ''
   OR COALESCE(leader_artist_tag, '') <> ''
   OR COALESCE(leader_artist_name, '') <> '';

UPDATE icono_admin_vision_rollup
SET artist_tag = NULL,
    artist_name = NULL
WHERE COALESCE(artist_tag, '') <> ''
   OR COALESCE(artist_name, '') <> '';
