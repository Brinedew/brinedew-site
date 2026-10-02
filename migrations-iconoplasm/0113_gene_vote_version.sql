-- B-898 Stage 2: D1 is the only store for votes. Every vote, supervote and
-- candidate change bumps its gene's version; an election reads the version in
-- the same batch as its inputs and projects its winner only while the version
-- is unchanged. Two near-simultaneous votes on one gene therefore cannot let
-- the older election overwrite the newer one. One row per gene that has ever
-- been voted on; readers cost one primary-key row.
CREATE TABLE IF NOT EXISTS icono_gene_vote_version (
  gene_symbol TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

-- The daily vote budget: one row per UTC day counting admitted vote and
-- supervote batches. Each vote batch adds to it first and is refused whole
-- once the day's limit (workers/iconoplasm/votes/vote-guards.js) is reached.
CREATE TABLE IF NOT EXISTS icono_vote_daily_budget (
  day TEXT PRIMARY KEY,
  votes INTEGER NOT NULL DEFAULT 0 CHECK (votes >= 0)
) WITHOUT ROWID;
