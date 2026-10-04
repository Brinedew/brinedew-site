-- B-995: the caretaker editor's "Tags from prose" and "Prose from Tags" buttons
-- call Cloudflare Workers AI, whose free plan allows 10,000 Neurons a day for the
-- whole account. One row per caretaker account and UTC day counts the calls the
-- route admitted; each call adds to it in one upsert and is refused once the
-- caretaker's day limit (workers/iconoplasm/caretaker/taggerizer.js) is reached.
CREATE TABLE IF NOT EXISTS icono_taggerizer_daily_calls (
  day TEXT NOT NULL,
  account_id TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0 CHECK (calls >= 0),
  PRIMARY KEY (day, account_id)
);
