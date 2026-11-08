-- The admin activity feed reads the newest events of each kind, a page at a
-- time. Without a newest-first index each page scans the whole table, so the
-- owner's page would get slower as readers vote and request portraits. These
-- indexes make every page bounded. The publish events need none: their
-- autoincrement id is already the newest-first order.

CREATE INDEX IF NOT EXISTS idx_icono_image_votes_activity
  ON icono_image_votes (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_icono_gene_comments_activity
  ON icono_gene_comments (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_icono_generation_requests_activity
  ON icono_generation_requests (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_icono_image_edit_jobs_activity
  ON icono_image_edit_jobs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_icono_caretaker_text_versions_activity
  ON icono_caretaker_text_versions (created_at DESC, version_id DESC);

CREATE INDEX IF NOT EXISTS idx_icono_caretaker_supervote_events_activity
  ON icono_caretaker_supervote_events (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_icono_caretaker_gene_requests_activity
  ON icono_caretaker_gene_requests (created_at DESC, request_id DESC);

CREATE INDEX IF NOT EXISTS idx_icono_artist_blacklist_submissions_activity
  ON icono_artist_blacklist_submissions (requested_at DESC, id DESC);
