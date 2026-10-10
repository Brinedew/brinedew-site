-- B-1065: each person's vote changes per UTC day. A vote batch adds to the
-- voter's row first and is refused whole past the allowance
-- (VOTE_PERSON_DAILY_LIMIT, workers/iconoplasm/votes/vote-guards.js). It
-- replaces the one global counter, icono_vote_daily_budget, which lets one
-- script spend everyone's votes for the day; that table goes next release,
-- once nothing writes it. A person's earlier days are deleted by their next
-- vote, so the table holds about one row per person.
CREATE TABLE IF NOT EXISTS icono_vote_person_day (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  changes INTEGER NOT NULL CHECK (changes >= 0),
  PRIMARY KEY (user_id, day)
) WITHOUT ROWID;
