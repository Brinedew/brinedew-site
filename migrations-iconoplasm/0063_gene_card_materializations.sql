-- ARCHITECTURE FENCE [IPD-004]: Queue messages are wakeups for this durable,
-- due-time ledger. They are never the authority for whether a card is owed.
-- ARCHITECTURE FENCE [IPD-005]: one bounded row per canonical gene, no render
-- history and no PNG bytes in D1. The 19,023-gene inventory is the hard ceiling.
CREATE TABLE IF NOT EXISTS icono_gene_card_materializations (
  gene_symbol TEXT PRIMARY KEY,
  desired_card_fingerprint TEXT NOT NULL,
  desired_asset_sha256 TEXT,
  ready_card_fingerprint TEXT,
  ready_asset_sha256 TEXT,
  object_key TEXT,
  width INTEGER,
  height INTEGER,
  state TEXT NOT NULL DEFAULT 'queued'
    CHECK (state IN ('queued', 'rendering', 'ready', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count >= 1),
  wakeup_generation INTEGER NOT NULL DEFAULT 1 CHECK (wakeup_generation >= 1),
  enqueued_generation INTEGER NOT NULL DEFAULT 0 CHECK (enqueued_generation >= 0),
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rendered_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (gene_symbol) REFERENCES icono_gene_catalog(gene_symbol) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_icono_gene_card_materializations_due
  ON icono_gene_card_materializations(state, next_attempt_at, gene_symbol);

CREATE TABLE IF NOT EXISTS icono_gene_card_render_budget (
  day_utc TEXT PRIMARY KEY,
  launches INTEGER NOT NULL DEFAULT 0 CHECK (launches >= 0),
  reserved_seconds INTEGER NOT NULL DEFAULT 0 CHECK (reserved_seconds >= 0),
  used_seconds INTEGER NOT NULL DEFAULT 0 CHECK (used_seconds >= 0),
  last_launch_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;
