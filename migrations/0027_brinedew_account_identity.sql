-- Provider-independent Brinedew account identity.
--
-- `users` remains the Discord profile/legacy ownership projection. New domain
-- ownership uses the opaque account ID resolved through the provider identity
-- table instead of binding durable records to a Discord subject directly.

CREATE TABLE IF NOT EXISTS brinedew_accounts (
  account_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disabled', 'erasure_pending', 'erased')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    substr(account_id, 1, 5) = 'acct_'
    AND length(account_id) = 37
    AND substr(account_id, 6) NOT GLOB '*[^0-9a-f]*'
  )
);

CREATE TABLE IF NOT EXISTS brinedew_account_identities (
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  account_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_subject),
  FOREIGN KEY (account_id) REFERENCES brinedew_accounts(account_id) ON DELETE RESTRICT,
  CHECK (provider <> '' AND provider = lower(provider)),
  CHECK (provider_subject <> '')
);

CREATE INDEX IF NOT EXISTS idx_brinedew_account_identities_account
  ON brinedew_account_identities (account_id, provider);

ALTER TABLE users ADD COLUMN account_id TEXT;

-- Use a one-shot mapping table so every existing Discord profile receives one
-- random opaque ID before the account and identity rows are materialized.
CREATE TABLE brinedew_account_identity_backfill (
  discord_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL UNIQUE
);

INSERT INTO brinedew_account_identity_backfill (discord_id, account_id)
SELECT discord_id, 'acct_' || lower(hex(randomblob(16)))
FROM users
ORDER BY discord_id ASC;

INSERT INTO brinedew_accounts (account_id, status, created_at, updated_at)
SELECT account_id, 'active', unixepoch() * 1000, unixepoch() * 1000
FROM brinedew_account_identity_backfill
ORDER BY discord_id ASC;

UPDATE users
SET account_id = (
  SELECT mapping.account_id
  FROM brinedew_account_identity_backfill mapping
  WHERE mapping.discord_id = users.discord_id
);

INSERT INTO brinedew_account_identities (
  provider,
  provider_subject,
  account_id,
  created_at,
  last_seen_at
)
SELECT
  'discord',
  mapping.discord_id,
  mapping.account_id,
  unixepoch() * 1000,
  unixepoch() * 1000
FROM brinedew_account_identity_backfill mapping
ORDER BY mapping.discord_id ASC;

DROP TABLE brinedew_account_identity_backfill;

CREATE INDEX IF NOT EXISTS idx_users_account_id
  ON users (account_id)
  WHERE account_id IS NOT NULL;

-- SQLite cannot add a NOT NULL foreign-key column to a populated table in
-- place. These guards make the cached users.account_id reference safe while
-- still allowing a legacy NULL row to be hydrated exactly once.
CREATE TRIGGER IF NOT EXISTS trg_users_account_id_requires_account_insert
BEFORE INSERT ON users
WHEN NEW.account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM brinedew_accounts account
    WHERE account.account_id = NEW.account_id
  )
BEGIN
  SELECT RAISE(ABORT, 'users.account_id must reference a Brinedew account');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_account_id_requires_account_update
BEFORE UPDATE OF account_id ON users
WHEN NEW.account_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM brinedew_accounts account
    WHERE account.account_id = NEW.account_id
  )
BEGIN
  SELECT RAISE(ABORT, 'users.account_id must reference a Brinedew account');
END;

CREATE TRIGGER IF NOT EXISTS trg_users_account_id_is_immutable
BEFORE UPDATE OF account_id ON users
WHEN OLD.account_id IS NOT NULL AND NEW.account_id IS NOT OLD.account_id
BEGIN
  SELECT RAISE(ABORT, 'users.account_id is immutable');
END;
