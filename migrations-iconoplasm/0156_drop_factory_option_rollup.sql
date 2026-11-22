-- B-1283: drop the retired duplicate factory request-option rollup and its
-- source-membership table now that PR #856 is installed and the live Worker
-- reads and writes neither table.
--
-- Chesterton's fence: migration 0075 added both tables so the style picker
-- could list factory pipeline codes separately. Later commits collapsed every
-- factory pipeline code back into its `0-<slot>` family on read, which left
-- these two tables holding 20,942 duplicate rows (7,078 rollup + 13,864
-- sources) that were 100% already rolled up in
-- icono_generation_request_vision_option_rollup under `anima-v1-<slot>`.
-- Reading them caused Favorites to undercount and slot search to double-count,
-- and writing them inflated VISION_ROLLUP_ROWS from 12 to 194.
--
-- Cost: DROP TABLE writes 0 rows in D1 (same as 0148_drop_admin_rollup_copy.sql).
-- Online: the Worker installed since #856 reads and writes neither table.

DROP TABLE IF EXISTS icono_generation_request_factory_option_rollup;
DROP TABLE IF EXISTS icono_generation_request_factory_option_sources;
