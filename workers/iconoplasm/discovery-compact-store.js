const USER_SELECT_SQL = `SELECT
  dictionary_version, state_version, membership_b64, member_count,
  next_event_seq, next_chunk_seq, active_events_json, recent_receipts_json, last_batch_id
FROM icono_discovery_user_state_v2 WHERE user_id = ?`

const SHARED_SELECT_SQL = `SELECT
  dictionary_version, state_version, discoverer_counts_b64, encounter_counts_b64,
  first_at_b64, latest_at_b64
FROM icono_discovery_shared_state_v2 WHERE singleton = 1`

const USER_CAS_GUARD_SQL = `INSERT INTO icono_discovery_cas_guard(ok)
SELECT 0 WHERE
  COALESCE((SELECT state_version FROM icono_discovery_user_state_v2 WHERE user_id = ?), 0) <> ?`

const USER_SHARED_CAS_GUARD_SQL = `INSERT INTO icono_discovery_cas_guard(ok)
SELECT 0 WHERE
  COALESCE((SELECT state_version FROM icono_discovery_user_state_v2 WHERE user_id = ?), 0) <> ?
  OR (SELECT state_version FROM icono_discovery_shared_state_v2 WHERE singleton = 1) <> ?`

const USER_UPSERT_SQL = `INSERT INTO icono_discovery_user_state_v2 (
  user_id, dictionary_version, state_version, membership_b64, member_count,
  next_event_seq, next_chunk_seq, active_events_json, recent_receipts_json, last_batch_id, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
ON CONFLICT(user_id) DO UPDATE SET
  dictionary_version = excluded.dictionary_version,
  state_version = excluded.state_version,
  membership_b64 = excluded.membership_b64,
  member_count = excluded.member_count,
  next_event_seq = excluded.next_event_seq,
  next_chunk_seq = excluded.next_chunk_seq,
  active_events_json = excluded.active_events_json,
  recent_receipts_json = excluded.recent_receipts_json,
  last_batch_id = excluded.last_batch_id,
  updated_at = CURRENT_TIMESTAMP
WHERE icono_discovery_user_state_v2.state_version = ?
RETURNING state_version, last_batch_id`

const SHARED_UPDATE_SQL = `UPDATE icono_discovery_shared_state_v2 SET
  dictionary_version = ?, state_version = ?, discoverer_counts_b64 = ?, encounter_counts_b64 = ?,
  first_at_b64 = ?, latest_at_b64 = ?, updated_at = CURRENT_TIMESTAMP
WHERE singleton = 1 AND state_version = ?
RETURNING state_version`

const CHUNKS_INSERT_SQL = `INSERT OR IGNORE INTO icono_discovery_chronology_v2 (
  user_id, chunk_seq, first_event_seq, last_event_seq, events_json, created_at
)
SELECT ?,
  CAST(json_extract(value, '$.chunk_seq') AS INTEGER),
  CAST(json_extract(value, '$.first_event_seq') AS INTEGER),
  CAST(json_extract(value, '$.last_event_seq') AS INTEGER),
  json_extract(value, '$.events'),
  CURRENT_TIMESTAMP
FROM json_each(?)`

function rows(result) {
  return Array.isArray(result?.results) ? result.results : []
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    throw new Error("Invalid compact discovery JSON state")
  }
}

export async function readCompactDiscoveryState(db, userId) {
  const result = await db.batch([
    db.prepare(USER_SELECT_SQL).bind(userId),
    db.prepare(SHARED_SELECT_SQL),
  ])
  const user = rows(result[0])[0] || null
  const shared = rows(result[1])[0]
  if (!shared) throw new Error("Compact discovery shared state is not initialized")
  return {
    user: user
      ? {
          dictionary_version: Number(user.dictionary_version || 0),
          state_version: Number(user.state_version || 0),
          membership_b64: String(user.membership_b64 || ""),
          member_count: Number(user.member_count || 0),
          next_event_seq: Number(user.next_event_seq || 1),
          next_chunk_seq: Number(user.next_chunk_seq || 1),
          active_events: parseJsonArray(user.active_events_json),
          recent_receipts: parseJsonArray(user.recent_receipts_json),
          last_batch_id: String(user.last_batch_id || ""),
        }
      : null,
    shared: {
      dictionary_version: Number(shared.dictionary_version || 0),
      state_version: Number(shared.state_version || 0),
      discoverer_counts_b64: String(shared.discoverer_counts_b64 || ""),
      encounter_counts_b64: String(shared.encounter_counts_b64 || ""),
      first_at_b64: String(shared.first_at_b64 || ""),
      latest_at_b64: String(shared.latest_at_b64 || ""),
    },
  }
}

export async function commitCompactDiscoveryBatch(
  db,
  {
    userId,
    expectedUserVersion,
    expectedSharedVersion,
    nextUserState,
    nextSharedState,
    sealedChunks = [],
    batchId,
    includeShared = true,
  },
) {
  if (!nextUserState || !batchId) throw new TypeError("Compact discovery commit is incomplete")
  if (includeShared && !nextSharedState) throw new TypeError("Shared compact state is required")
  const guard = includeShared
    ? db.prepare(USER_SHARED_CAS_GUARD_SQL).bind(userId, expectedUserVersion, expectedSharedVersion)
    : db.prepare(USER_CAS_GUARD_SQL).bind(userId, expectedUserVersion)
  const statements = [
    guard,
    db
      .prepare(USER_UPSERT_SQL)
      .bind(
        userId,
        nextUserState.dictionary_version,
        nextUserState.state_version,
        nextUserState.membership_b64,
        nextUserState.member_count,
        nextUserState.next_event_seq,
        nextUserState.next_chunk_seq,
        JSON.stringify(nextUserState.active_events || []),
        JSON.stringify(nextUserState.recent_receipts || []),
        batchId,
        expectedUserVersion,
      ),
  ]
  if (includeShared) {
    statements.push(
      db
        .prepare(SHARED_UPDATE_SQL)
        .bind(
          nextSharedState.dictionary_version,
          nextSharedState.state_version,
          nextSharedState.discoverer_counts_b64,
          nextSharedState.encounter_counts_b64,
          nextSharedState.first_at_b64,
          nextSharedState.latest_at_b64,
          expectedSharedVersion,
        ),
    )
  }
  if (sealedChunks.length)
    statements.push(db.prepare(CHUNKS_INSERT_SQL).bind(userId, JSON.stringify(sealedChunks)))
  let result
  try {
    result = await db.batch(statements)
  } catch (error) {
    if (String(error?.message || error).includes("DISCOVERY_COMPACT_CAS_CONFLICT")) {
      return { committed: false, conflict: true }
    }
    throw error
  }
  const userWrite = rows(result[1])[0]
  if (!userWrite || Number(userWrite.state_version) !== Number(nextUserState.state_version)) {
    return { committed: false, conflict: true }
  }
  if (includeShared) {
    const sharedWrite = rows(result[2])[0]
    if (!sharedWrite || Number(sharedWrite.state_version) !== Number(nextSharedState.state_version))
      throw new Error("Compact discovery atomic batch lost its shared update")
  }
  return { committed: true, conflict: false, state_version: Number(userWrite.state_version) }
}

// Kept with the storage adapter until cutover so the migration and executable
// tests share one reviewed schema. Production must apply this through the
// repository migration path; request handlers never execute DDL.
export const DISCOVERY_COMPACT_SCHEMA_SQL = `
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
) VALUES (1, 0, 0, '', '', '', '');
CREATE TABLE icono_discovery_chronology_v2 (
  user_id TEXT NOT NULL,
  chunk_seq INTEGER NOT NULL CHECK(chunk_seq >= 1),
  first_event_seq INTEGER NOT NULL CHECK(first_event_seq >= 1),
  last_event_seq INTEGER NOT NULL CHECK(last_event_seq >= first_event_seq),
  events_json TEXT NOT NULL CHECK(json_valid(events_json) AND length(events_json) <= 262144),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(user_id, chunk_seq)
) WITHOUT ROWID;
`
