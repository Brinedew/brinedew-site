-- Preserve the difference between a fully replicated portrait and one that is
-- readable only through a subset of the configured Bunny views. The latter is
-- still renderable through the first-party route, but it must remain visible
-- to Website Ops instead of being flattened into a generic success verdict.

ALTER TABLE icono_website_truth_summary
  ADD COLUMN storage_regionally_divergent_assets INTEGER NOT NULL DEFAULT 0;

ALTER TABLE icono_website_truth_summary
  ADD COLUMN storage_recheck_due_assets INTEGER NOT NULL DEFAULT 0;
