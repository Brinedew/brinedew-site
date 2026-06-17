-- Benchmark infrastructure tables
-- Used by the geneguessr-benchmark Worker (workers/benchmark/)
--
-- Architectural choice:
--   This bootstrap migration defines the current canonical benchmark schema so a
--   fresh local database can replay the lane without depending on historical
--   one-off ALTER TABLE steps.
--
-- Mistake to avoid:
--   Do not strip newer canonical columns back out of this CREATE TABLE just to
--   "match history". Replayable migrations matter more than preserving every
--   old incremental step literally.

-- API keys for benchmark access. key_hash is SHA-256 of the Bearer token.
CREATE TABLE IF NOT EXISTS benchmark_api_keys (
  key_hash TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  active INTEGER NOT NULL DEFAULT 1
);

-- One row per benchmark evaluation session (one model playing one protein).
CREATE TABLE IF NOT EXISTS benchmark_sessions (
  id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  protein_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  corpus_version TEXT,
  action_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at TEXT,
  final_score REAL,
  exact_match INTEGER,
  hints_used INTEGER NOT NULL DEFAULT 0,
  checksum TEXT,
  state TEXT,
  FOREIGN KEY (api_key_hash) REFERENCES benchmark_api_keys(key_hash)
);

-- Append-only log of every action taken during a session.
CREATE TABLE IF NOT EXISTS benchmark_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  action_seq INTEGER NOT NULL,
  action TEXT NOT NULL,
  payload TEXT,
  result TEXT,
  latency_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES benchmark_sessions(id)
);

-- Indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_benchmark_actions_session
  ON benchmark_actions(session_id);

CREATE INDEX IF NOT EXISTS idx_benchmark_sessions_api_key
  ON benchmark_sessions(api_key_hash);

CREATE INDEX IF NOT EXISTS idx_benchmark_sessions_status
  ON benchmark_sessions(status);
