// THE ONLY RECORD OF FAILED GAMESESSION WRITES: DO NOT DUPLICATE.
//
// A Durable Object session write that fails (a code update resets the object, the free tier's
// write cap is spent, the platform answers "internal error") is recorded here: one row per
// minute, operation, session kind and error text, counting repeats, and one sample row with the
// request path. `GET /api/admin/status` returns them as `game_session_write_evidence`.
//
// A write that succeeds records nothing (B-960). The success count used to be written too, one
// D1 row per session write: 5 of the 11 rows a 3-guess visit wrote, read by no page. The
// provider's own Durable Object meter (`durableObjectsPeriodicGroups.rowsWritten`) says how many
// writes there were. The tables are created by this code on the first failure or the first
// status read, and the retention prune runs on a failure, so a day with no failure costs no D1
// statement. The `outcome` column stays so the table is unchanged; it only ever receives
// `failure`, and the reader ignores any other value (the rows an earlier version wrote age out
// with the 14-day prune).
const OBSERVATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS game_session_write_observations_do_not_delete (
    observed_day TEXT NOT NULL,
    minute_bucket TEXT NOT NULL,
    operation TEXT NOT NULL,
    session_kind TEXT NOT NULL,
    outcome TEXT NOT NULL,
    error_fingerprint TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 0,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    PRIMARY KEY (
      observed_day,
      minute_bucket,
      operation,
      session_kind,
      outcome,
      error_fingerprint
    )
  )
`

const OBSERVATION_DAY_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_game_session_write_observations_day
  ON game_session_write_observations_do_not_delete(observed_day, minute_bucket, outcome)
`

const FAILURE_SAMPLE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS game_session_write_failure_samples_do_not_delete (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    observed_day TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    operation TEXT NOT NULL,
    session_kind TEXT NOT NULL,
    request_path TEXT,
    error_message TEXT NOT NULL
  )
`

const FAILURE_SAMPLE_DAY_INDEX_SQL = `
  CREATE INDEX IF NOT EXISTS idx_game_session_write_failure_samples_day
  ON game_session_write_failure_samples_do_not_delete(observed_day, occurred_at DESC)
`

const UPSERT_OBSERVATION_SQL = `
  INSERT INTO game_session_write_observations_do_not_delete (
    observed_day,
    minute_bucket,
    operation,
    session_kind,
    outcome,
    error_fingerprint,
    count,
    first_seen_at,
    last_seen_at
  )
  VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  ON CONFLICT(
    observed_day,
    minute_bucket,
    operation,
    session_kind,
    outcome,
    error_fingerprint
  ) DO UPDATE SET
    count = game_session_write_observations_do_not_delete.count + 1,
    last_seen_at = excluded.last_seen_at
`

const INSERT_FAILURE_SAMPLE_SQL = `
  INSERT INTO game_session_write_failure_samples_do_not_delete (
    observed_day,
    occurred_at,
    operation,
    session_kind,
    request_path,
    error_message
  )
  VALUES (?, ?, ?, ?, ?, ?)
`

const SELECT_FAILURES_FOR_DAY_SQL = `
  SELECT
    observed_day,
    minute_bucket,
    operation,
    session_kind,
    error_fingerprint,
    count,
    first_seen_at,
    last_seen_at
  FROM game_session_write_observations_do_not_delete
  WHERE observed_day = ? AND outcome = 'failure'
  ORDER BY minute_bucket ASC, operation ASC, session_kind ASC
`

const SELECT_FAILURE_SAMPLES_FOR_DAY_SQL = `
  SELECT
    occurred_at,
    operation,
    session_kind,
    request_path,
    error_message
  FROM game_session_write_failure_samples_do_not_delete
  WHERE observed_day = ?
  ORDER BY occurred_at DESC
  LIMIT ?
`

const DELETE_OLD_OBSERVATIONS_SQL = `
  DELETE FROM game_session_write_observations_do_not_delete
  WHERE observed_day < ?
`

const DELETE_OLD_FAILURE_SAMPLES_SQL = `
  DELETE FROM game_session_write_failure_samples_do_not_delete
  WHERE observed_day < ?
`

const EVIDENCE_RETENTION_DAYS = 14
let schemaEnsured = false
let lastPrunedCutoffDay = ""

function toUtcDay(value = Date.now()) {
  return new Date(value).toISOString().slice(0, 10)
}

function toUtcMinuteBucket(value = Date.now()) {
  return `${new Date(value).toISOString().slice(0, 16)}Z`
}

function addUtcDays(day, days) {
  const date = new Date(`${day}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function normalizeOperation(value) {
  const normalized = String(value || "").trim()
  return normalized || "unknown"
}

function normalizeRequestPath(value) {
  const normalized = String(value || "").trim()
  return normalized || null
}

function normalizeErrorFingerprint(value) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
  if (!normalized) {
    return ""
  }
  return normalized.slice(0, 220)
}

function classifySessionKind(sessionId) {
  const raw = String(sessionId || "")
  if (!raw) return "unknown"
  if (raw.startsWith("oauth:")) return "oauth"
  if (raw.startsWith("session:")) return "auth_session"

  const practiceMode = raw.startsWith("practice_")
  const base = practiceMode ? raw.slice("practice_".length) : raw
  if (base.startsWith("guest_")) return practiceMode ? "practice_guest" : "guest"
  if (base.startsWith("user_")) return practiceMode ? "practice_user" : "user"
  return practiceMode ? "practice_unknown" : "unknown"
}

async function ensureGameSessionWriteEvidenceSchema(db) {
  if (!db || schemaEnsured) {
    return
  }
  await db.prepare(OBSERVATION_TABLE_SQL).run()
  await db.prepare(OBSERVATION_DAY_INDEX_SQL).run()
  await db.prepare(FAILURE_SAMPLE_TABLE_SQL).run()
  await db.prepare(FAILURE_SAMPLE_DAY_INDEX_SQL).run()
  schemaEnsured = true
}

async function pruneOldEvidence(db, cutoffDay) {
  if (!db || !cutoffDay || cutoffDay === lastPrunedCutoffDay) {
    return
  }
  await db.prepare(DELETE_OLD_OBSERVATIONS_SQL).bind(cutoffDay).run()
  await db.prepare(DELETE_OLD_FAILURE_SAMPLES_SQL).bind(cutoffDay).run()
  lastPrunedCutoffDay = cutoffDay
}

async function recordGameSessionWriteFailure(db, details) {
  if (!db) {
    return false
  }

  const occurredAt = Number.isFinite(details?.occurredAt) ? details.occurredAt : Date.now()
  const observedDay = toUtcDay(occurredAt)
  const minuteBucket = toUtcMinuteBucket(occurredAt)
  const operation = normalizeOperation(details?.operation)
  const sessionKind = classifySessionKind(details?.sessionId)
  const errorFingerprint = normalizeErrorFingerprint(details?.errorMessage)
  const requestPath = normalizeRequestPath(details?.requestPath)
  const cutoffDay = addUtcDays(observedDay, -EVIDENCE_RETENTION_DAYS)

  await ensureGameSessionWriteEvidenceSchema(db)
  await pruneOldEvidence(db, cutoffDay)
  await db
    .prepare(UPSERT_OBSERVATION_SQL)
    .bind(
      observedDay,
      minuteBucket,
      operation,
      sessionKind,
      "failure",
      errorFingerprint,
      occurredAt,
      occurredAt,
    )
    .run()
  await db
    .prepare(INSERT_FAILURE_SAMPLE_SQL)
    .bind(
      observedDay,
      occurredAt,
      operation,
      sessionKind,
      requestPath,
      errorFingerprint || "Unknown GameSession write error",
    )
    .run()

  return true
}

async function safeRecordGameSessionWriteFailure(db, details) {
  try {
    await recordGameSessionWriteFailure(db, details)
  } catch (err) {
    console.warn("GameSession write evidence recording failed", err?.message || err)
  }
}

// Runs a Durable Object session write. A failure is recorded and rethrown; a success returns
// the result and touches nothing.
export async function withObservedGameSessionWrite(env, details, writeOperation) {
  const occurredAt = Date.now()
  try {
    return await writeOperation()
  } catch (err) {
    const errorMessage = err?.message || String(err || "Unknown GameSession write error")
    console.warn("GameSession write failed", {
      operation: normalizeOperation(details?.operation),
      session_kind: classifySessionKind(details?.sessionId),
      request_path: normalizeRequestPath(details?.requestPath),
      error: errorMessage,
    })
    await safeRecordGameSessionWriteFailure(env?.DB, {
      ...details,
      occurredAt,
      errorMessage,
    })
    throw err
  }
}

const earliest = (current, candidate) =>
  current == null || (candidate != null && candidate < current) ? candidate : current
const latest = (current, candidate) =>
  current == null || (candidate != null && candidate > current) ? candidate : current

function aggregateFailureRows(rows) {
  const summary = { failures: 0, first_failure_at: null, last_failure_at: null }
  const byOperation = new Map()
  const byFingerprint = new Map()
  const byMinute = new Map()

  const add = (map, key, fresh, count, firstSeenAt, lastSeenAt) => {
    const current = map.get(key) || {
      ...fresh,
      failures: 0,
      first_failure_at: null,
      last_failure_at: null,
    }
    current.failures += count
    current.first_failure_at = earliest(current.first_failure_at, firstSeenAt)
    current.last_failure_at = latest(current.last_failure_at, lastSeenAt)
    map.set(key, current)
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    const count = Number(row?.count) || 0
    const firstSeenAt = Number(row?.first_seen_at) || null
    const lastSeenAt = Number(row?.last_seen_at) || null
    const operation = normalizeOperation(row?.operation)
    const sessionKind = String(row?.session_kind || "unknown")
    const errorFingerprint = normalizeErrorFingerprint(row?.error_fingerprint)
    const minuteBucket = String(row?.minute_bucket || "")

    summary.failures += count
    summary.first_failure_at = earliest(summary.first_failure_at, firstSeenAt)
    summary.last_failure_at = latest(summary.last_failure_at, lastSeenAt)
    add(
      byOperation,
      `${operation}::${sessionKind}`,
      { operation, session_kind: sessionKind },
      count,
      firstSeenAt,
      lastSeenAt,
    )
    add(byMinute, minuteBucket, { minute_bucket: minuteBucket }, count, firstSeenAt, lastSeenAt)
    if (errorFingerprint) {
      add(
        byFingerprint,
        errorFingerprint,
        { error_fingerprint: errorFingerprint },
        count,
        firstSeenAt,
        lastSeenAt,
      )
    }
  }

  return {
    summary,
    by_operation: Array.from(byOperation.values()).sort(
      (left, right) =>
        right.failures - left.failures ||
        left.operation.localeCompare(right.operation) ||
        left.session_kind.localeCompare(right.session_kind),
    ),
    failure_fingerprints: Array.from(byFingerprint.values())
      .map((entry) => ({
        error_fingerprint: entry.error_fingerprint,
        count: entry.failures,
        first_seen_at: entry.first_failure_at,
        last_seen_at: entry.last_failure_at,
      }))
      .sort(
        (left, right) =>
          right.count - left.count || left.error_fingerprint.localeCompare(right.error_fingerprint),
      ),
    minute_buckets: Array.from(byMinute.values()).sort((left, right) =>
      left.minute_bucket.localeCompare(right.minute_bucket),
    ),
  }
}

export async function getGameSessionWriteEvidence(db, options = {}) {
  if (!db) {
    return {
      ok: false,
      reason: "missing_db",
    }
  }

  const observedDay =
    typeof options?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.day)
      ? options.day
      : toUtcDay()
  const sampleLimit = Math.max(1, Math.min(Number(options?.sampleLimit) || 20, 100))
  const minuteLimit = Math.max(1, Math.min(Number(options?.minuteLimit) || 180, 1440))

  await ensureGameSessionWriteEvidenceSchema(db)
  const failureRows = await db.prepare(SELECT_FAILURES_FOR_DAY_SQL).bind(observedDay).all()
  const sampleRows = await db
    .prepare(SELECT_FAILURE_SAMPLES_FOR_DAY_SQL)
    .bind(observedDay, sampleLimit)
    .all()

  const aggregated = aggregateFailureRows(
    Array.isArray(failureRows?.results) ? failureRows.results : [],
  )
  const resetStartedAt = `${observedDay}T00:00:00.000Z`
  const nextResetDay = addUtcDays(observedDay, 1)
  const nextResetAt = `${nextResetDay}T00:00:00.000Z`

  return {
    ok: true,
    observed_day: observedDay,
    reset_started_at_utc: resetStartedAt,
    next_reset_at_utc: nextResetAt,
    summary: aggregated.summary,
    by_operation: aggregated.by_operation,
    failure_fingerprints: aggregated.failure_fingerprints,
    recent_minute_buckets: aggregated.minute_buckets.slice(-minuteLimit),
    recent_failures: (Array.isArray(sampleRows?.results) ? sampleRows.results : []).map((row) => ({
      occurred_at: Number(row?.occurred_at) || 0,
      operation: normalizeOperation(row?.operation),
      session_kind: String(row?.session_kind || "unknown"),
      request_path: normalizeRequestPath(row?.request_path),
      error_message:
        normalizeErrorFingerprint(row?.error_message) || "Unknown GameSession write error",
    })),
  }
}
