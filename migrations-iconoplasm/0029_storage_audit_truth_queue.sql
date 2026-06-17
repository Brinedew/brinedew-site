-- 0029_storage_audit_truth_queue.sql
--
-- Request-time storage HEAD sweeps made Website Ops rediscover image truth the
-- expensive way. These tables keep the audit backlog and the last known summary
-- in D1 so admin routes can read durable state instead of probing Bunny on every
-- request.

-- Production already has an earlier storage-audit prototype with a different
-- schema and key shape. That prototype never accumulated meaningful backlog
-- state, but it does collide with the queue-backed design this migration needs.
-- Replace it outright so the worker and the database stop disagreeing about
-- what these tables mean.

DROP TABLE IF EXISTS icono_storage_audit_queue;
DROP TABLE IF EXISTS icono_storage_audit_queue_state;
DROP TABLE IF EXISTS icono_website_truth_summary;

CREATE TABLE IF NOT EXISTS icono_storage_audit_queue (
  gene_symbol TEXT NOT NULL,
  asset_sha256 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  audit_state TEXT NOT NULL DEFAULT 'unknown',
  missing_renditions_json TEXT NOT NULL DEFAULT '[]',
  is_current INTEGER NOT NULL DEFAULT 0,
  is_stale INTEGER NOT NULL DEFAULT 0,
  is_legacy INTEGER NOT NULL DEFAULT 0,
  asset_status TEXT NOT NULL DEFAULT '',
  created_at TEXT,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_audited_at TEXT,
  last_error TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (gene_symbol, asset_sha256)
);

CREATE INDEX IF NOT EXISTS idx_icono_storage_audit_queue_status_next_attempt
  ON icono_storage_audit_queue (status, next_attempt_at, is_current DESC, gene_symbol ASC, asset_sha256 ASC);

CREATE INDEX IF NOT EXISTS idx_icono_storage_audit_queue_audit_state
  ON icono_storage_audit_queue (audit_state, is_current DESC, last_audited_at ASC, gene_symbol ASC, asset_sha256 ASC);

CREATE INDEX IF NOT EXISTS idx_icono_storage_audit_queue_symbol_state
  ON icono_storage_audit_queue (gene_symbol, audit_state, last_audited_at ASC, asset_sha256 ASC);

CREATE TABLE IF NOT EXISTS icono_storage_audit_queue_state (
  queue_key TEXT PRIMARY KEY,
  seed_status TEXT NOT NULL DEFAULT 'idle',
  last_seeded_symbol TEXT NOT NULL DEFAULT '',
  processed_symbols INTEGER NOT NULL DEFAULT 0,
  total_symbols INTEGER NOT NULL DEFAULT 0,
  seeded_complete INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  started_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_icono_storage_audit_queue_state_seed
  ON icono_storage_audit_queue_state (seeded_complete, seed_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS icono_website_truth_summary (
  summary_key TEXT PRIMARY KEY,
  candidate_assets INTEGER NOT NULL DEFAULT 0,
  stale_assets INTEGER NOT NULL DEFAULT 0,
  legacy_assets INTEGER NOT NULL DEFAULT 0,
  published_live_portraits INTEGER NOT NULL DEFAULT 0,
  audited_assets INTEGER NOT NULL DEFAULT 0,
  verified_renderable_images INTEGER NOT NULL DEFAULT 0,
  storage_audit_coverage_percent REAL NOT NULL DEFAULT 0,
  storage_incomplete_assets INTEGER NOT NULL DEFAULT 0,
  broken_live_images INTEGER NOT NULL DEFAULT 0,
  renderable_live_confirmed INTEGER NOT NULL DEFAULT 0,
  unverified_live_portraits INTEGER NOT NULL DEFAULT 0,
  renderable_live_exact_known INTEGER NOT NULL DEFAULT 0,
  last_exact_audit_total INTEGER,
  last_exact_audit_at TEXT,
  storage_queue_backlog_assets INTEGER NOT NULL DEFAULT 0,
  storage_queue_seeded_complete INTEGER NOT NULL DEFAULT 0,
  storage_audit_status_note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);