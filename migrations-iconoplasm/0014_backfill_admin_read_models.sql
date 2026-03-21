-- Backfill the admin read models outside the request path.
--
-- The worker keeps these tables fresh after writes, but the very first
-- population must not happen during a live request. Production data volume is
-- now large enough that rebuilding everything on first page load can blow D1's
-- worker CPU budget and turn the admin into a brick.

DELETE FROM icono_vote_asset_summary;

INSERT INTO icono_vote_asset_summary (
  gene_symbol,
  asset_sha256,
  candidate_ref,
  vision_id,
  candidate_image_id,
  upvotes,
  downvotes,
  score,
  vote_count,
  updated_at
)
SELECT
  upper(pa.gene_symbol) AS gene_symbol,
  lower(pa.asset_sha256) AS asset_sha256,
  'a:' || upper(pa.gene_symbol) || '|' || lower(pa.asset_sha256) AS candidate_ref,
  COALESCE(MAX(NULLIF(iv.vision_id, '')), MAX(NULLIF(pa.vision_id, '')), '') AS vision_id,
  COALESCE(MAX(iv.candidate_image_id), MAX(pa.candidate_image_id)) AS candidate_image_id,
  COALESCE(SUM(CASE WHEN iv.vote_value = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
  COALESCE(SUM(CASE WHEN iv.vote_value = -1 THEN 1 ELSE 0 END), 0) AS downvotes,
  COALESCE(SUM(iv.vote_value), 0) AS score,
  COALESCE(COUNT(iv.user_id), 0) AS vote_count,
  CURRENT_TIMESTAMP AS updated_at
FROM icono_portrait_assets pa
LEFT JOIN icono_image_votes iv
  ON upper(iv.gene_symbol) = upper(pa.gene_symbol)
 AND lower(iv.asset_sha256) = lower(pa.asset_sha256)
GROUP BY upper(pa.gene_symbol), lower(pa.asset_sha256);

DELETE FROM icono_admin_gene_rollup;

INSERT INTO icono_admin_gene_rollup (
  gene_symbol,
  full_name,
  manifestation,
  current_asset_sha256,
  current_asset_missing,
  admin_override,
  total_assets,
  candidate_count,
  approved_count,
  rejected_count,
  stale_count,
  legacy_count,
  last_asset_at,
  live_status,
  live_is_stale,
  live_is_legacy,
  live_autopick_eligible,
  live_vision_id,
  live_artist_tag,
  live_artist_name,
  live_upvotes,
  live_downvotes,
  live_score,
  live_created_at,
  live_r2_key_full,
  live_r2_key_medium,
  live_r2_key_thumb,
  leader_asset_sha256,
  leader_vision_id,
  leader_artist_tag,
  leader_artist_name,
  leader_upvotes,
  leader_downvotes,
  leader_score,
  leader_created_at,
  leader_r2_key_full,
  leader_r2_key_medium,
  leader_r2_key_thumb,
  updated_at
)
WITH all_symbols AS (
  SELECT upper(gene_symbol) AS gene_symbol FROM icono_gene_catalog
  UNION
  SELECT upper(gene_symbol) AS gene_symbol FROM icono_portrait_assets
  UNION
  SELECT upper(gene_symbol) AS gene_symbol FROM icono_publish_state
),
publish_info AS (
  SELECT
    s.gene_symbol,
    gc.full_name,
    ge.manifestation,
    lower(COALESCE(ps.current_asset_sha256, '')) AS current_asset_sha256,
    COALESCE(ps.admin_override, 0) AS admin_override
  FROM all_symbols s
  LEFT JOIN icono_gene_catalog gc
    ON upper(gc.gene_symbol) = s.gene_symbol
  LEFT JOIN icono_gene_essence ge
    ON upper(ge.gene_symbol) = s.gene_symbol
  LEFT JOIN icono_publish_state ps
    ON upper(ps.gene_symbol) = s.gene_symbol
),
asset_base AS (
  SELECT
    upper(pa.gene_symbol) AS gene_symbol,
    lower(pa.asset_sha256) AS asset_sha256,
    pa.r2_key_full,
    pa.r2_key_medium,
    pa.r2_key_thumb,
    lower(COALESCE(pa.status, 'draft')) AS status,
    COALESCE(pa.autopick_eligible, 1) AS autopick_eligible,
    COALESCE(pa.is_stale, 0) AS is_stale,
    COALESCE(pa.is_legacy, 0) AS is_legacy,
    COALESCE(pa.vision_id, '') AS vision_id,
    COALESCE(pa.artist_tag, '') AS artist_tag,
    COALESCE(pa.artist_name, '') AS artist_name,
    COALESCE(pa.created_at, '') AS created_at,
    COALESCE(vs.upvotes, 0) AS upvotes,
    COALESCE(vs.downvotes, 0) AS downvotes,
    COALESCE(vs.score, 0) AS score
  FROM icono_portrait_assets pa
  LEFT JOIN icono_vote_asset_summary vs
    ON vs.gene_symbol = upper(pa.gene_symbol)
   AND vs.asset_sha256 = lower(pa.asset_sha256)
),
asset_counts AS (
  SELECT
    gene_symbol,
    COUNT(*) AS total_assets,
    SUM(
      CASE
        WHEN COALESCE(autopick_eligible, 1) = 1
         AND COALESCE(status, 'draft') <> 'rejected'
         AND COALESCE(r2_key_medium, r2_key_thumb, r2_key_full, '') <> '' THEN 1
        ELSE 0
      END
    ) AS candidate_count,
    SUM(CASE WHEN COALESCE(status, 'draft') = 'approved' THEN 1 ELSE 0 END) AS approved_count,
    SUM(CASE WHEN COALESCE(status, 'draft') = 'rejected' THEN 1 ELSE 0 END) AS rejected_count,
    SUM(CASE WHEN COALESCE(is_stale, 0) = 1 THEN 1 ELSE 0 END) AS stale_count,
    SUM(CASE WHEN COALESCE(is_legacy, 0) = 1 THEN 1 ELSE 0 END) AS legacy_count,
    MAX(NULLIF(created_at, '')) AS last_asset_at
  FROM asset_base
  GROUP BY gene_symbol
),
current_asset AS (
  SELECT
    pi.gene_symbol,
    ab.asset_sha256,
    ab.status,
    ab.is_stale,
    ab.is_legacy,
    ab.autopick_eligible,
    ab.vision_id,
    ab.artist_tag,
    ab.artist_name,
    ab.upvotes,
    ab.downvotes,
    ab.score,
    ab.created_at,
    ab.r2_key_full,
    ab.r2_key_medium,
    ab.r2_key_thumb
  FROM publish_info pi
  LEFT JOIN asset_base ab
    ON ab.gene_symbol = pi.gene_symbol
   AND ab.asset_sha256 = pi.current_asset_sha256
),
ranked_candidates AS (
  SELECT
    ab.gene_symbol,
    ab.asset_sha256,
    ab.vision_id,
    ab.artist_tag,
    ab.artist_name,
    ab.upvotes,
    ab.downvotes,
    ab.score,
    ab.created_at,
    ab.r2_key_full,
    ab.r2_key_medium,
    ab.r2_key_thumb,
    ROW_NUMBER() OVER (
      PARTITION BY ab.gene_symbol
      ORDER BY
        COALESCE(ab.score, 0) DESC,
        CASE WHEN COALESCE(ab.is_legacy, 0) = 0 THEN 1 ELSE 0 END DESC,
        COALESCE(ab.upvotes, 0) DESC,
        CASE WHEN pi.current_asset_sha256 = ab.asset_sha256 THEN 1 ELSE 0 END DESC,
        COALESCE(ab.created_at, '') DESC,
        ab.asset_sha256 ASC
    ) AS row_num
  FROM asset_base ab
  JOIN publish_info pi
    ON pi.gene_symbol = ab.gene_symbol
  WHERE COALESCE(ab.autopick_eligible, 1) = 1
    AND COALESCE(ab.status, 'draft') <> 'rejected'
    AND COALESCE(ab.r2_key_medium, ab.r2_key_thumb, ab.r2_key_full, '') <> ''
),
leader_asset AS (
  SELECT *
  FROM ranked_candidates
  WHERE row_num = 1
)
SELECT
  pi.gene_symbol,
  COALESCE(NULLIF(TRIM(pi.full_name), ''), pi.gene_symbol) AS full_name,
  COALESCE(pi.manifestation, '') AS manifestation,
  NULLIF(pi.current_asset_sha256, '') AS current_asset_sha256,
  CASE
    WHEN NULLIF(pi.current_asset_sha256, '') IS NOT NULL
     AND (
       ca.asset_sha256 IS NULL
       OR COALESCE(ca.r2_key_medium, ca.r2_key_thumb, ca.r2_key_full, '') = ''
     ) THEN 1
    ELSE 0
  END AS current_asset_missing,
  COALESCE(pi.admin_override, 0) AS admin_override,
  COALESCE(ac.total_assets, 0) AS total_assets,
  COALESCE(ac.candidate_count, 0) AS candidate_count,
  COALESCE(ac.approved_count, 0) AS approved_count,
  COALESCE(ac.rejected_count, 0) AS rejected_count,
  COALESCE(ac.stale_count, 0) AS stale_count,
  COALESCE(ac.legacy_count, 0) AS legacy_count,
  ac.last_asset_at,
  COALESCE(ca.status, '') AS live_status,
  COALESCE(ca.is_stale, 0) AS live_is_stale,
  COALESCE(ca.is_legacy, 0) AS live_is_legacy,
  COALESCE(ca.autopick_eligible, 0) AS live_autopick_eligible,
  COALESCE(ca.vision_id, '') AS live_vision_id,
  COALESCE(ca.artist_tag, '') AS live_artist_tag,
  COALESCE(ca.artist_name, '') AS live_artist_name,
  COALESCE(ca.upvotes, 0) AS live_upvotes,
  COALESCE(ca.downvotes, 0) AS live_downvotes,
  COALESCE(ca.score, 0) AS live_score,
  COALESCE(ca.created_at, '') AS live_created_at,
  COALESCE(ca.r2_key_full, '') AS live_r2_key_full,
  COALESCE(ca.r2_key_medium, '') AS live_r2_key_medium,
  COALESCE(ca.r2_key_thumb, '') AS live_r2_key_thumb,
  la.asset_sha256 AS leader_asset_sha256,
  COALESCE(la.vision_id, '') AS leader_vision_id,
  COALESCE(la.artist_tag, '') AS leader_artist_tag,
  COALESCE(la.artist_name, '') AS leader_artist_name,
  COALESCE(la.upvotes, 0) AS leader_upvotes,
  COALESCE(la.downvotes, 0) AS leader_downvotes,
  COALESCE(la.score, 0) AS leader_score,
  COALESCE(la.created_at, '') AS leader_created_at,
  COALESCE(la.r2_key_full, '') AS leader_r2_key_full,
  COALESCE(la.r2_key_medium, '') AS leader_r2_key_medium,
  COALESCE(la.r2_key_thumb, '') AS leader_r2_key_thumb,
  CURRENT_TIMESTAMP AS updated_at
FROM publish_info pi
LEFT JOIN asset_counts ac
  ON ac.gene_symbol = pi.gene_symbol
LEFT JOIN current_asset ca
  ON ca.gene_symbol = pi.gene_symbol
LEFT JOIN leader_asset la
  ON la.gene_symbol = pi.gene_symbol;

DELETE FROM icono_admin_dashboard_summary;

INSERT INTO icono_admin_dashboard_summary (
  summary_key,
  genes,
  with_live,
  overrides,
  drift,
  current_asset_missing,
  missing,
  no_live,
  stale_assets,
  legacy_assets,
  zero_candidates,
  one_candidate,
  two_to_five_candidates,
  six_plus_candidates,
  updated_at
)
SELECT
  'default' AS summary_key,
  COUNT(*) AS genes,
  SUM(CASE WHEN COALESCE(current_asset_sha256, '') <> '' THEN 1 ELSE 0 END) AS with_live,
  SUM(CASE WHEN COALESCE(admin_override, 0) = 1 AND COALESCE(current_asset_sha256, '') <> '' THEN 1 ELSE 0 END) AS overrides,
  SUM(CASE WHEN COALESCE(current_asset_missing, 0) = 1 THEN 1 ELSE 0 END) AS drift,
  SUM(CASE WHEN COALESCE(current_asset_missing, 0) = 1 THEN 1 ELSE 0 END) AS current_asset_missing,
  SUM(CASE WHEN COALESCE(candidate_count, 0) = 0 THEN 1 ELSE 0 END) AS missing,
  SUM(CASE WHEN COALESCE(current_asset_sha256, '') = '' THEN 1 ELSE 0 END) AS no_live,
  SUM(COALESCE(stale_count, 0)) AS stale_assets,
  SUM(COALESCE(legacy_count, 0)) AS legacy_assets,
  SUM(CASE WHEN COALESCE(candidate_count, 0) = 0 THEN 1 ELSE 0 END) AS zero_candidates,
  SUM(CASE WHEN COALESCE(candidate_count, 0) = 1 THEN 1 ELSE 0 END) AS one_candidate,
  SUM(CASE WHEN COALESCE(candidate_count, 0) BETWEEN 2 AND 5 THEN 1 ELSE 0 END) AS two_to_five_candidates,
  SUM(CASE WHEN COALESCE(candidate_count, 0) >= 6 THEN 1 ELSE 0 END) AS six_plus_candidates,
  CURRENT_TIMESTAMP AS updated_at
FROM icono_admin_gene_rollup;

DELETE FROM icono_admin_vision_rollup;

INSERT INTO icono_admin_vision_rollup (
  vision_id,
  artist_tag,
  artist_name,
  image_count,
  avg_vote,
  rejected_count,
  rejection_rate,
  upvotes,
  downvotes,
  score,
  live_count,
  blacklisted,
  blacklist_reason,
  blacklist_updated_at,
  updated_at
)
SELECT
  pa.vision_id,
  MAX(NULLIF(pa.artist_tag, '')) AS artist_tag,
  MAX(NULLIF(pa.artist_name, '')) AS artist_name,
  COUNT(*) AS image_count,
  COALESCE(AVG(
    CASE
      WHEN COALESCE(vs.vote_count, 0) > 0 THEN 1.0 * COALESCE(vs.score, 0) / vs.vote_count
      ELSE NULL
    END
  ), 0) AS avg_vote,
  COALESCE(SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
  COALESCE(SUM(CASE WHEN lower(COALESCE(pa.status, '')) = 'rejected' THEN 1 ELSE 0 END) * 1.0 / NULLIF(COUNT(*), 0), 0) AS rejection_rate,
  COALESCE(SUM(COALESCE(vs.upvotes, 0)), 0) AS upvotes,
  COALESCE(SUM(COALESCE(vs.downvotes, 0)), 0) AS downvotes,
  COALESCE(SUM(COALESCE(vs.score, 0)), 0) AS score,
  COALESCE(SUM(
    CASE
      WHEN lower(COALESCE(ps.current_asset_sha256, '')) = lower(pa.asset_sha256) THEN 1
      ELSE 0
    END
  ), 0) AS live_count,
  MAX(CASE WHEN bl.artist_tag IS NOT NULL THEN 1 ELSE 0 END) AS blacklisted,
  MAX(NULLIF(bl.reason, '')) AS blacklist_reason,
  MAX(NULLIF(bl.updated_at, '')) AS blacklist_updated_at,
  CURRENT_TIMESTAMP AS updated_at
FROM icono_portrait_assets pa
LEFT JOIN icono_vote_asset_summary vs
  ON vs.gene_symbol = upper(pa.gene_symbol)
 AND vs.asset_sha256 = lower(pa.asset_sha256)
LEFT JOIN icono_publish_state ps
  ON upper(ps.gene_symbol) = upper(pa.gene_symbol)
LEFT JOIN icono_artist_style_blacklist bl
  ON lower(COALESCE(bl.artist_tag, '')) = lower(COALESCE(pa.artist_tag, ''))
WHERE COALESCE(pa.vision_id, '') <> ''
  AND lower(COALESCE(pa.vision_id, '')) NOT LIKE 'artist-random-%'
GROUP BY pa.vision_id;
