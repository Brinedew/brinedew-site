-- Drop the games table and its indexes. No code writes to this table;
-- game activity is tracked via daily_guess_aggregate instead.
DROP INDEX IF EXISTS idx_games_user_date;
DROP INDEX IF EXISTS idx_games_ip_date;
DROP TABLE IF EXISTS games;
