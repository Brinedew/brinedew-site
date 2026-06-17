ALTER TABLE users
ADD COLUMN leaderboard_opt_in INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_leaderboard_opt_in
ON users (leaderboard_opt_in);
