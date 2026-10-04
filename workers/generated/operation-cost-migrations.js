// Generated from reviewed migrations; never accept caller SQL.
export const TAGGERIZER_DAILY_CALLS_MIGRATION_NAME = "0115_taggerizer_daily_calls.sql"
export const TAGGERIZER_DAILY_CALLS_MIGRATION_STATEMENTS = Object.freeze([
  "CREATE TABLE IF NOT EXISTS icono_taggerizer_daily_calls (\n  day TEXT NOT NULL,\n  account_id TEXT NOT NULL,\n  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),\n  PRIMARY KEY (day, account_id)\n);"
])
