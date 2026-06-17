-- Users table (Discord OAuth + tier management)
CREATE TABLE users (
  discord_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  email TEXT,
  avatar_url TEXT,
  tier TEXT NOT NULL DEFAULT 'guest',
  premium_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Game sessions (daily puzzle attempts)
CREATE TABLE games (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  ip_hash TEXT,
  date TEXT NOT NULL,
  protein_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  result TEXT,
  guesses_made INTEGER DEFAULT 0,
  wrong_guesses INTEGER DEFAULT 0,
  hints_revealed TEXT DEFAULT '[]',
  FOREIGN KEY (user_id) REFERENCES users(discord_id)
);

CREATE INDEX idx_games_user_date ON games(user_id, date);
CREATE INDEX idx_games_ip_date ON games(ip_hash, date);

-- User stats (persistent across games)
CREATE TABLE stats (
  user_id TEXT PRIMARY KEY,
  total_played INTEGER DEFAULT 0,
  total_wins INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  best_streak INTEGER DEFAULT 0,
  last_played_date TEXT,
  FOREIGN KEY (user_id) REFERENCES users(discord_id)
);

-- Protein database (synced from wiki)
CREATE TABLE proteins (
  uniprot TEXT PRIMARY KEY,
  hgnc TEXT NOT NULL,
  full_name TEXT NOT NULL,
  domains TEXT,
  go_terms TEXT,
  pathways TEXT,
  tissue_specificity TEXT,
  gene_summary TEXT,
  mass_kda REAL,
  length_aa INTEGER,
  difficulty INTEGER DEFAULT 3,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_proteins_difficulty ON proteins(difficulty);
