-- Audited Brinedew account and provider-link lifecycle.
--
-- Current account/link rows remain compact projections. Every lifecycle
-- transition is also written to an immutable event table. Provider subjects
-- are never copied into append-only history; events retain a domain-separated
-- SHA-256 fingerprint so erasure can remove the mutable external identifier.

ALTER TABLE brinedew_accounts
  ADD COLUMN account_version INTEGER NOT NULL DEFAULT 1
  CHECK (account_version >= 1);

ALTER TABLE brinedew_accounts
  ADD COLUMN author_label TEXT;

ALTER TABLE brinedew_accounts
  ADD COLUMN anonymized_at INTEGER;

ALTER TABLE brinedew_account_identities
  ADD COLUMN link_version INTEGER NOT NULL DEFAULT 1
  CHECK (link_version >= 1);

ALTER TABLE brinedew_account_identities
  ADD COLUMN unlinked_at INTEGER;

CREATE TABLE brinedew_account_lifecycle_events (
  event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('account_imported', 'account_created', 'status_changed', 'erasure_completed')),
  from_status TEXT,
  to_status TEXT NOT NULL
    CHECK (to_status IN ('active', 'disabled', 'erasure_pending', 'erased')),
  account_version INTEGER NOT NULL CHECK (account_version >= 1),
  author_label TEXT,
  final_leave_policy TEXT
    CHECK (final_leave_policy IS NULL OR final_leave_policy IN ('retain', 'withdraw')),
  reason_code TEXT NOT NULL DEFAULT '',
  actor_account_id TEXT,
  occurred_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES brinedew_accounts(account_id) ON DELETE RESTRICT,
  UNIQUE (account_id, account_version),
  UNIQUE (account_id, command_id)
);

CREATE TABLE brinedew_account_identity_events (
  event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  command_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_subject_fingerprint TEXT NOT NULL,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('identity_imported', 'identity_linked', 'identity_unlinked', 'identity_relinked', 'identity_erasure_unlinked')),
  link_version INTEGER NOT NULL CHECK (link_version >= 1),
  actor_account_id TEXT,
  occurred_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES brinedew_accounts(account_id) ON DELETE RESTRICT,
  UNIQUE (account_id, provider, provider_subject_fingerprint, link_version),
  UNIQUE (account_id, command_id, provider, provider_subject_fingerprint)
);

CREATE INDEX idx_brinedew_account_lifecycle_events_account
  ON brinedew_account_lifecycle_events (account_id, event_sequence);

CREATE INDEX idx_brinedew_account_identity_events_account
  ON brinedew_account_identity_events (account_id, event_sequence);

CREATE INDEX idx_brinedew_account_identities_active_account
  ON brinedew_account_identities (account_id, provider)
  WHERE unlinked_at IS NULL;

-- One bounded current-state outbox row per account carries primary identity
-- lifecycle into the separate manifestation authority. Newer lifecycle events
-- replace older pending work; delivery is sequence-CASed and idempotent on the
-- immutable source event ID.
CREATE TABLE brinedew_authority_account_projection_outbox (
  account_id TEXT PRIMARY KEY,
  source_event_id TEXT NOT NULL UNIQUE,
  source_event_sequence INTEGER NOT NULL CHECK (source_event_sequence >= 1),
  account_version INTEGER NOT NULL CHECK (account_version >= 1),
  source_status TEXT NOT NULL
    CHECK (source_status IN ('active', 'disabled', 'erasure_pending', 'erased')),
  authority_status TEXT NOT NULL
    CHECK (authority_status IN ('active', 'disabled', 'erasure_pending', 'tombstoned')),
  public_credit_label TEXT,
  final_leave_policy TEXT
    CHECK (final_leave_policy IS NULL OR final_leave_policy IN ('retain', 'withdraw')),
  projection_state TEXT NOT NULL DEFAULT 'pending'
    CHECK (projection_state IN ('pending', 'delivered')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code TEXT,
  last_attempted_at INTEGER,
  next_attempt_at INTEGER,
  delivered_at INTEGER,
  occurred_at INTEGER NOT NULL,
  FOREIGN KEY (account_id) REFERENCES brinedew_accounts(account_id) ON DELETE RESTRICT
);

CREATE INDEX idx_brinedew_authority_account_projection_pending
  ON brinedew_authority_account_projection_outbox (
    projection_state, next_attempt_at, source_event_sequence
  );

CREATE TRIGGER trg_brinedew_account_event_queues_authority_projection
AFTER INSERT ON brinedew_account_lifecycle_events
BEGIN
  INSERT INTO brinedew_authority_account_projection_outbox (
    account_id, source_event_id, source_event_sequence, account_version,
    source_status, authority_status, public_credit_label, final_leave_policy,
    projection_state, attempt_count, last_error_code, last_attempted_at,
    next_attempt_at, delivered_at, occurred_at
  ) VALUES (
    NEW.account_id, NEW.event_id, NEW.event_sequence, NEW.account_version,
    NEW.to_status,
    CASE WHEN NEW.to_status = 'erased' THEN 'tombstoned' ELSE NEW.to_status END,
    NEW.author_label, NEW.final_leave_policy,
    'pending', 0, NULL, NULL, NULL, NULL, NEW.occurred_at
  )
  ON CONFLICT(account_id) DO UPDATE SET
    source_event_id = excluded.source_event_id,
    source_event_sequence = excluded.source_event_sequence,
    account_version = excluded.account_version,
    source_status = excluded.source_status,
    authority_status = excluded.authority_status,
    public_credit_label = excluded.public_credit_label,
    final_leave_policy = excluded.final_leave_policy,
    projection_state = 'pending',
    attempt_count = 0,
    last_error_code = NULL,
    last_attempted_at = NULL,
    next_attempt_at = NULL,
    delivered_at = NULL,
    occurred_at = excluded.occurred_at
  WHERE excluded.source_event_sequence > source_event_sequence;
END;

-- Seed one origin event per pre-existing projection. Legacy SQL migrations do
-- not have SHA-256, so imported links receive an explicit non-reversible
-- unknown fingerprint. Every runtime event uses the sha256:... contract.
INSERT INTO brinedew_account_lifecycle_events (
  event_id,
  command_id,
  account_id,
  event_type,
  from_status,
  to_status,
  account_version,
  author_label,
  reason_code,
  actor_account_id,
  occurred_at
)
SELECT
  'account_event_' || lower(hex(randomblob(16))),
  'migration:0028:account:' || account_id,
  account_id,
  'account_imported',
  NULL,
  status,
  account_version,
  author_label,
  'migration_0028',
  NULL,
  updated_at
FROM brinedew_accounts
ORDER BY account_id ASC;

INSERT INTO brinedew_account_identity_events (
  event_id,
  command_id,
  account_id,
  provider,
  provider_subject_fingerprint,
  event_type,
  link_version,
  actor_account_id,
  occurred_at
)
SELECT
  'identity_event_' || lower(hex(randomblob(16))),
  'migration:0028:identity:' || provider || ':' || rowid,
  account_id,
  provider,
  'legacy_unavailable_' || lower(hex(randomblob(16))),
  'identity_imported',
  link_version,
  NULL,
  created_at
FROM brinedew_account_identities
ORDER BY provider ASC, provider_subject ASC;

CREATE TRIGGER trg_brinedew_account_events_append_only_update
BEFORE UPDATE ON brinedew_account_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'Brinedew account lifecycle events are append-only');
END;

CREATE TRIGGER trg_brinedew_account_events_append_only_delete
BEFORE DELETE ON brinedew_account_lifecycle_events
BEGIN
  SELECT RAISE(ABORT, 'Brinedew account lifecycle events are append-only');
END;

CREATE TRIGGER trg_brinedew_identity_events_append_only_update
BEFORE UPDATE ON brinedew_account_identity_events
BEGIN
  SELECT RAISE(ABORT, 'Brinedew identity link events are append-only');
END;

CREATE TRIGGER trg_brinedew_identity_events_append_only_delete
BEFORE DELETE ON brinedew_account_identity_events
BEGIN
  SELECT RAISE(ABORT, 'Brinedew identity link events are append-only');
END;

CREATE TRIGGER trg_brinedew_erased_account_is_terminal
BEFORE UPDATE OF status ON brinedew_accounts
WHEN OLD.status = 'erased' AND NEW.status <> 'erased'
BEGIN
  SELECT RAISE(ABORT, 'An erased Brinedew account cannot be reactivated');
END;

CREATE TRIGGER trg_brinedew_anonymized_label_is_immutable
BEFORE UPDATE OF author_label ON brinedew_accounts
WHEN OLD.author_label IS NOT NULL AND NEW.author_label IS NOT OLD.author_label
BEGIN
  SELECT RAISE(ABORT, 'An anonymized Brinedew author label is immutable');
END;

CREATE TRIGGER trg_brinedew_identity_owner_is_immutable
BEFORE UPDATE OF provider, provider_subject, account_id ON brinedew_account_identities
WHEN NEW.provider IS NOT OLD.provider
  OR NEW.provider_subject IS NOT OLD.provider_subject
  OR NEW.account_id IS NOT OLD.account_id
BEGIN
  SELECT RAISE(ABORT, 'A provider identity cannot be reassigned to another Brinedew account');
END;
