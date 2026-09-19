-- B-764: compact discovery state v2. One bitmap/chronology row per user, one
-- shared aggregate row, append-only ordinals, and the durable derived-delivery
-- outbox written beside each accepted personal batch.
--
-- This migration is schema and singleton state only. Ordinals are appended on
-- demand by the bounded dictionary resolver for names that actually carry
-- discovery data, so a first application does not read or write one row per
-- catalog gene. Existing ordinals are never renumbered or recycled; a symbol
-- that leaves the catalog keeps its ordinal and simply becomes inactive.
--
-- Request handlers never run this DDL; it is applied through the admitted
-- migration path.

CREATE TABLE icono_discovery_compact_activation_v2 (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  status TEXT NOT NULL CHECK(status IN ('pending', 'complete')),
  cursor_user_id TEXT NOT NULL DEFAULT '',
  migrated_users INTEGER NOT NULL DEFAULT 0 CHECK(migrated_users >= 0),
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO icono_discovery_compact_activation_v2 (
  singleton, status, cursor_user_id, migrated_users
) VALUES (1, 'pending', '', 0);

CREATE TABLE icono_discovery_cas_guard (
  ok INTEGER NOT NULL CONSTRAINT DISCOVERY_COMPACT_CAS_CONFLICT CHECK(ok = 1)
);

CREATE TABLE icono_discovery_user_state_v2 (
  user_id TEXT PRIMARY KEY,
  dictionary_version INTEGER NOT NULL CHECK(dictionary_version >= 1),
  state_version INTEGER NOT NULL CHECK(state_version >= 1),
  membership_b64 TEXT NOT NULL CHECK(length(membership_b64) <= 16384),
  member_count INTEGER NOT NULL CHECK(member_count >= 0),
  next_event_seq INTEGER NOT NULL CHECK(next_event_seq >= 1),
  next_chunk_seq INTEGER NOT NULL CHECK(next_chunk_seq >= 1),
  active_events_json TEXT NOT NULL CHECK(json_valid(active_events_json) AND length(active_events_json) <= 262144),
  recent_receipts_json TEXT NOT NULL CHECK(json_valid(recent_receipts_json) AND length(recent_receipts_json) <= 131072),
  last_batch_id TEXT NOT NULL CHECK(length(last_batch_id) <= 128),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

CREATE TABLE icono_discovery_shared_state_v2 (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  dictionary_version INTEGER NOT NULL CHECK(dictionary_version >= 0),
  state_version INTEGER NOT NULL CHECK(state_version >= 0),
  discoverer_counts_b64 TEXT NOT NULL CHECK(length(discoverer_counts_b64) <= 200000),
  encounter_counts_b64 TEXT NOT NULL CHECK(length(encounter_counts_b64) <= 200000),
  first_at_b64 TEXT NOT NULL CHECK(length(first_at_b64) <= 200000),
  latest_at_b64 TEXT NOT NULL CHECK(length(latest_at_b64) <= 200000),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO icono_discovery_shared_state_v2 (
  singleton, dictionary_version, state_version, discoverer_counts_b64,
  encounter_counts_b64, first_at_b64, latest_at_b64
) SELECT 1, 0, 0, '', '', '', ''
WHERE NOT EXISTS (SELECT 1 FROM icono_discovery_shared_state_v2 WHERE singleton = 1);

CREATE TABLE icono_discovery_chronology_v2 (
  user_id TEXT NOT NULL,
  chunk_seq INTEGER NOT NULL CHECK(chunk_seq >= 1),
  first_event_seq INTEGER NOT NULL CHECK(first_event_seq >= 1),
  last_event_seq INTEGER NOT NULL CHECK(last_event_seq >= first_event_seq),
  events_json TEXT NOT NULL CHECK(json_valid(events_json) AND length(events_json) <= 262144),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, chunk_seq)
) WITHOUT ROWID;

CREATE TABLE icono_discovery_shared_delivery_receipts_v2 (
  delivery_id TEXT PRIMARY KEY CHECK(length(delivery_id) BETWEEN 3 AND 320),
  user_id TEXT NOT NULL CHECK(length(user_id) BETWEEN 1 AND 160),
  batch_id TEXT NOT NULL CHECK(length(batch_id) BETWEEN 1 AND 128),
  user_state_version INTEGER NOT NULL CHECK(user_state_version >= 1),
  dictionary_version INTEGER NOT NULL CHECK(dictionary_version >= 1),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256) = 64),
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

CREATE TABLE icono_discovery_shared_delivery_outbox_v2 (
  delivery_id TEXT PRIMARY KEY CHECK(length(delivery_id) BETWEEN 3 AND 320),
  user_id TEXT NOT NULL CHECK(length(user_id) BETWEEN 1 AND 160),
  batch_id TEXT NOT NULL CHECK(length(batch_id) BETWEEN 1 AND 128),
  user_state_version INTEGER NOT NULL CHECK(user_state_version >= 1),
  dictionary_version INTEGER NOT NULL CHECK(dictionary_version >= 1),
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json) AND length(payload_json) <= 262144),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_icono_discovery_shared_delivery_outbox_v2_created
  ON icono_discovery_shared_delivery_outbox_v2(created_at, delivery_id);

CREATE TABLE icono_discovery_dictionary_meta_v2 (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  version INTEGER NOT NULL CHECK(version >= 1),
  writer TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO icono_discovery_dictionary_meta_v2 (singleton, version, updated_at)
SELECT 1, 1, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM icono_discovery_dictionary_meta_v2 WHERE singleton = 1);

CREATE TABLE icono_discovery_ordinals_v2 (
  name TEXT PRIMARY KEY CHECK(length(name) BETWEEN 1 AND 64),
  ordinal INTEGER NOT NULL CHECK(ordinal >= 0 AND ordinal <= 1000000),
  canonical TEXT NOT NULL CHECK(length(canonical) BETWEEN 1 AND 64),
  active INTEGER NOT NULL CHECK(active IN (0, 1))
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_icono_discovery_ordinals_v2_ordinal
  ON icono_discovery_ordinals_v2(ordinal);

-- One canonical identity per ordinal is a structural invariant, not a
-- convention: a lost allocation race must abort inside its own transaction
-- instead of persisting a duplicate. Aliases (name != canonical) still share
-- their canonical symbol's ordinal.
CREATE UNIQUE INDEX IF NOT EXISTS idx_icono_discovery_ordinals_v2_canonical_identity
  ON icono_discovery_ordinals_v2(ordinal) WHERE name = canonical;
