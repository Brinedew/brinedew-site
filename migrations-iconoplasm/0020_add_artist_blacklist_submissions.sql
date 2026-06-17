-- Public artist blacklist intake queue.
--
-- The public website should not run artist-resolution tooling or pretend to be
-- the local moderation GUI. It only queues a plain submitted name/tag here.
-- Website Ops sync in the workstation consumes and acknowledges these rows.

CREATE TABLE IF NOT EXISTS icono_artist_blacklist_submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_name_input TEXT NOT NULL,
  normalized_input TEXT NOT NULL,
  requested_by TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'public_form',
  turnstile_passed INTEGER NOT NULL DEFAULT 0,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TEXT,
  resolved_by TEXT,
  resolved_status TEXT NOT NULL DEFAULT '',
  resolved_note TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_icono_artist_blacklist_submissions_pending_requested_at
  ON icono_artist_blacklist_submissions (resolved_at, requested_at ASC, id ASC);

CREATE INDEX IF NOT EXISTS idx_icono_artist_blacklist_submissions_normalized_input
  ON icono_artist_blacklist_submissions (normalized_input, requested_at DESC);
