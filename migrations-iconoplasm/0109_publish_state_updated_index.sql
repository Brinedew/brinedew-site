-- Public change feed (/api/public/v1/changes) pages icono_publish_state by
-- updated_at. Without this index every public call scanned all ~19k rows and
-- sorted them in a temp B-tree, so ~65-125 feed calls could exhaust the
-- free-plan D1 daily read allowance (5M rows) for the whole site.
CREATE INDEX IF NOT EXISTS idx_icono_publish_state_updated
  ON icono_publish_state (updated_at);
