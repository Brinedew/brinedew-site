-- B-1069: sign-in keeps no session store; a sealed cookie is the session
-- (workers/lib/sealed-session.js). Logout records the cookie's session id here,
-- so a copy of that cookie stops working at its next account check (five
-- minutes at most). A row lives as long as the cookie it revokes: logout deletes
-- the rows whose cookies have expired, through the index, so the table holds
-- only revocations that still matter.
--
-- It lives here rather than beside the accounts in the geneguessr database
-- because only this database's migrations apply on an ordinary release
-- (scripts/apply-online-d1-migrations.mjs).
CREATE TABLE IF NOT EXISTS auth_session_revocations (
  session_id TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_auth_session_revocations_expires_at
  ON auth_session_revocations (expires_at);
