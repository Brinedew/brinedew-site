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

const SELECT_OBSERVATIONS_FOR_DAY_SQL = `
  SELECT
    observed_day,
    minute_bucket,
    operation,
    session_kind,
    outcome,
    error_fingerprint,
    count,
    first_seen_at,
    last_seen_at
  FROM game_session_write_observations_do_not_delete
  WHERE observed_day = ?
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

export async function recordGameSessionWriteObservation(db, details) {
  if (!db) {
    return false
  }

  const occurredAt = Number.isFinite(details?.occurredAt) ? details.occurredAt : Date.now()
  const observedDay = toUtcDay(occurredAt)
  const minuteBucket = toUtcMinuteBucket(occurredAt)
  const operation = normalizeOperation(details?.operation)
  const sessionKind = classifySessionKind(details?.sessionId)
  const outcome = details?.outcome === "failure" ? "failure" : "success"
  const errorFingerprint = outcome === "failure" ? normalizeErrorFingerprint(details?.errorMessage) : ""
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
      outcome,
      errorFingerprint,
      occurredAt,
      occurredAt,
    )
    .run()

  if (outcome === "failure") {
    await db
      .prepare(INSERT_FAILURE_SAMPLE_SQL)
      .bind(
        observedDay,
        occurredAt,
        operation,
        sessionKind,
        requestPath,
        normalizeErrorFingerprint(details?.errorMessage) || "Unknown GameSession write error",
      )
      .run()
  }

  return true
}

async function safeRecordGameSessionWriteObservation(db, details) {
  try {
    await recordGameSessionWriteObservation(db, details)
  } catch (err) {
    console.warn("GameSession write evidence recording failed", err?.message || err)
  }
}

export async function withObservedGameSessionWrite(env, details, writeOperation) {
  const db = env?.DB
  const occurredAt = Date.now()
  try {
    const result = await writeOperation()
    await safeRecordGameSessionWriteObservation(db, {
      ...details,
      occurredAt,
      outcome: "success",
    })
    return result
  } catch (err) {
    const errorMessage = err?.message || String(err || "Unknown GameSession write error")
    console.warn("GameSession write failed", {
      operation: normalizeOperation(details?.operation),
      session_kind: classifySessionKind(details?.sessionId),
      request_path: normalizeRequestPath(details?.requestPath),
      error: errorMessage,
    })
    await safeRecordGameSessionWriteObservation(db, {
      ...details,
      occurredAt,
      outcome: "failure",
      errorMessage,
    })
    throw err
  }
}

function aggregateObservationRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : []
  const summary = {
    attempts: 0,
    successes: 0,
    failures: 0,
    first_success_at: null,
    first_failure_at: null,
    last_success_at: null,
    last_failure_at: null,
    successes_before_first_failure: 0,
    attempts_before_first_failure: 0,
  }
  const byOperation = new Map()
  const byFailureFingerprint = new Map()
  const byMinute = new Map()

  for (const row of safeRows) {
    const count = Number(row?.count) || 0
    const outcome = row?.outcome === "failure" ? "failure" : "success"
    const firstSeenAt = Number(row?.first_seen_at) || null
    const lastSeenAt = Number(row?.last_seen_at) || null
    const operation = normalizeOperation(row?.operation)
    const sessionKind = String(row?.session_kind || "unknown")
    const errorFingerprint = normalizeErrorFingerprint(row?.error_fingerprint)

    summary.attempts += count
    if (outcome === "failure") {
      summary.failures += count
      summary.first_failure_at =
        summary.first_failure_at == null || (firstSeenAt != null && firstSeenAt < summary.first_failure_at)
          ? firstSeenAt
          : summary.first_failure_at
      summary.last_failure_at =
        summary.last_failure_at == null || (lastSeenAt != null && lastSeenAt > summary.last_failure_at)
          ? lastSeenAt
          : summary.last_failure_at
      if (errorFingerprint) {
        const currentFingerprint = byFailureFingerprint.get(errorFingerprint) || {
          error_fingerprint: errorFingerprint,
          count: 0,
          first_seen_at: null,
          last_seen_at: null,
        }
        currentFingerprint.count += count
        currentFingerprint.first_seen_at =
          currentFingerprint.first_seen_at == null ||
          (firstSeenAt != null && firstSeenAt < currentFingerprint.first_seen_at)
            ? firstSeenAt
            : currentFingerprint.first_seen_at
        currentFingerprint.last_seen_at =
          currentFingerprint.last_seen_at == null ||
          (lastSeenAt != null && lastSeenAt > currentFingerprint.last_seen_at)
            ? lastSeenAt
            : currentFingerprint.last_seen_at
        byFailureFingerprint.set(errorFingerprint, currentFingerprint)
      }
    } else {
      summary.successes += count
      summary.first_success_at =
        summary.first_success_at == null || (firstSeenAt != null && firstSeenAt < summary.first_success_at)
          ? firstSeenAt
          : summary.first_success_at
      summary.last_success_at =
        summary.last_success_at == null || (lastSeenAt != null && lastSeenAt > summary.last_success_at)
          ? lastSeenAt
          : summary.last_success_at
    }

    const operationKey = `${operation}::${sessionKind}`
    const currentOperation = byOperation.get(operationKey) || {
      operation,
      session_kind: sessionKind,
      attempts: 0,
      successes: 0,
      failures: 0,
      first_success_at: null,
      first_failure_at: null,
      last_success_at: null,
      last_failure_at: null,
    }
    currentOperation.attempts += count
    if (outcome === "failure") {
      currentOperation.failures += count
      currentOperation.first_failure_at =
        currentOperation.first_failure_at == null ||
        (firstSeenAt != null && firstSeenAt < currentOperation.first_failure_at)
          ? firstSeenAt
          : currentOperation.first_failure_at
      currentOperation.last_failure_at =
        currentOperation.last_failure_at == null ||
        (lastSeenAt != null && lastSeenAt > currentOperation.last_failure_at)
          ? lastSeenAt
          : currentOperation.last_failure_at
    } else {
      currentOperation.successes += count
      currentOperation.first_success_at =
        currentOperation.first_success_at == null ||
        (firstSeenAt != null && firstSeenAt < currentOperation.first_success_at)
          ? firstSeenAt
          : currentOperation.first_success_at
      currentOperation.last_success_at =
        currentOperation.last_success_at == null ||
        (lastSeenAt != null && lastSeenAt > currentOperation.last_success_at)
          ? lastSeenAt
          : currentOperation.last_success_at
    }
    byOperation.set(operationKey, currentOperation)

    const minuteBucket = String(row?.minute_bucket || "")
    const currentMinute = byMinute.get(minuteBucket) || {
      minute_bucket: minuteBucket,
      attempts: 0,
      successes: 0,
      failures: 0,
      first_success_at: null,
      first_failure_at: null,
      last_success_at: null,
      last_failure_at: null,
    }
    currentMinute.attempts += count
    if (outcome === "failure") {
      currentMinute.failures += count
      currentMinute.first_failure_at =
        currentMinute.first_failure_at == null ||
        (firstSeenAt != null && firstSeenAt < currentMinute.first_failure_at)
          ? firstSeenAt
          : currentMinute.first_failure_at
      currentMinute.last_failure_at =
        currentMinute.last_failure_at == null ||
        (lastSeenAt != null && lastSeenAt > currentMinute.last_failure_at)
          ? lastSeenAt
          : currentMinute.last_failure_at
    } else {
      currentMinute.successes += count
      currentMinute.first_success_at =
        currentMinute.first_success_at == null ||
        (firstSeenAt != null && firstSeenAt < currentMinute.first_success_at)
          ? firstSeenAt
          : currentMinute.first_success_at
      currentMinute.last_success_at =
        currentMinute.last_success_at == null ||
        (lastSeenAt != null && lastSeenAt > currentMinute.last_success_at)
          ? lastSeenAt
          : currentMinute.last_success_at
    }
    byMinute.set(minuteBucket, currentMinute)
  }

  if (summary.first_failure_at == null) {
    summary.successes_before_first_failure = summary.successes
    summary.attempts_before_first_failure = summary.attempts
  } else {
    for (const row of safeRows) {
      const count = Number(row?.count) || 0
      const outcome = row?.outcome === "failure" ? "failure" : "success"
      const lastSeenAt = Number(row?.last_seen_at) || null
      if (lastSeenAt == null || lastSeenAt >= summary.first_failure_at) {
        continue
      }
      summary.attempts_before_first_failure += count
      if (outcome === "success") {
        summary.successes_before_first_failure += count
      }
    }
  }

  return {
    summary,
    by_operation: Array.from(byOperation.values()).sort((left, right) => {
      return right.failures - left.failures || right.attempts - left.attempts || left.operation.localeCompare(right.operation)
    }),
    failure_fingerprints: Array.from(byFailureFingerprint.values()).sort((left, right) => {
      return right.count - left.count || left.error_fingerprint.localeCompare(right.error_fingerprint)
    }),
    minute_buckets: Array.from(byMinute.values()).sort((left, right) => left.minute_bucket.localeCompare(right.minute_bucket)),
  }
}

export async function getGameSessionWriteEvidence(db, options = {}) {
  if (!db) {
    return {
      ok: false,
      reason: "missing_db",
    }
  }

  const observedDay = typeof options?.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.day)
    ? options.day
    : toUtcDay()
  const sampleLimit = Math.max(1, Math.min(Number(options?.sampleLimit) || 20, 100))
  const minuteLimit = Math.max(1, Math.min(Number(options?.minuteLimit) || 180, 1440))

  await ensureGameSessionWriteEvidenceSchema(db)
  const observationRows = await db.prepare(SELECT_OBSERVATIONS_FOR_DAY_SQL).bind(observedDay).all()
  const failureRows = await db.prepare(SELECT_FAILURE_SAMPLES_FOR_DAY_SQL).bind(observedDay, sampleLimit).all()

  const aggregated = aggregateObservationRows(Array.isArray(observationRows?.results) ? observationRows.results : [])
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
    recent_failures: (Array.isArray(failureRows?.results) ? failureRows.results : []).map((row) => ({
      occurred_at: Number(row?.occurred_at) || 0,
      operation: normalizeOperation(row?.operation),
      session_kind: String(row?.session_kind || "unknown"),
      request_path: normalizeRequestPath(row?.request_path),
      error_message: normalizeErrorFingerprint(row?.error_message) || "Unknown GameSession write error",
    })),
  }
}
