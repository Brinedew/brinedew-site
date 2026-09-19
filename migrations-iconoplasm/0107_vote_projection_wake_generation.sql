-- One durable wake claim per dirty gene. A Queue send failure releases the
-- claim, while a consumer releases only the exact generation it received.
ALTER TABLE icono_vote_projection_refresh_jobs
  ADD COLUMN wake_outstanding INTEGER NOT NULL DEFAULT 0 CHECK(wake_outstanding IN (0, 1));

ALTER TABLE icono_vote_projection_refresh_jobs
  ADD COLUMN wake_version INTEGER NOT NULL DEFAULT 0 CHECK(wake_version >= 0);
