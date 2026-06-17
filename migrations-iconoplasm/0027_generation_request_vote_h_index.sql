-- Rank request-picker emulsions by durable vote strength instead of raw catalog size.
--
-- Raw image counts made the picker feel arbitrary because a lane with many weakly
-- received generations could outrank a smaller lane with repeated strong support.
-- The request rollup now stores a vote h-index: the largest h such that the lane has
-- at least h portraits with h or more approvals each.

ALTER TABLE icono_generation_request_vision_option_rollup
  ADD COLUMN vote_h_index INTEGER NOT NULL DEFAULT 0;

DROP INDEX IF EXISTS idx_icono_generation_request_vision_option_rollup_priority;

CREATE INDEX IF NOT EXISTS idx_icono_generation_request_vision_option_rollup_priority
  ON icono_generation_request_vision_option_rollup (
    vote_h_index DESC,
    live_count DESC,
    score DESC,
    image_count DESC,
    vision_id ASC
  );

WITH vote_counts AS (
  SELECT
    pa.vision_id,
    COALESCE(vs.upvotes, 0) AS upvotes
  FROM icono_portrait_assets pa
  LEFT JOIN icono_vote_asset_summary vs
    ON vs.gene_symbol = upper(pa.gene_symbol)
   AND vs.asset_sha256 = lower(pa.asset_sha256)
  WHERE COALESCE(pa.vision_id, '') <> ''
),
ranked AS (
  SELECT
    vision_id,
    upvotes,
    ROW_NUMBER() OVER (
      PARTITION BY vision_id
      ORDER BY upvotes DESC, vision_id ASC
    ) AS approval_rank
  FROM vote_counts
),
h_index AS (
  SELECT
    vision_id,
    MAX(CASE WHEN upvotes >= approval_rank THEN approval_rank ELSE 0 END) AS vote_h_index
  FROM ranked
  GROUP BY vision_id
)
UPDATE icono_generation_request_vision_option_rollup
SET vote_h_index = COALESCE(
      (
        SELECT h_index.vote_h_index
        FROM h_index
        WHERE h_index.vision_id = icono_generation_request_vision_option_rollup.vision_id
      ),
      0
    ),
    updated_at = CURRENT_TIMESTAMP;
