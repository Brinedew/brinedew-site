// THE ONLY RECORD OF FAILED GAMESESSION WRITES: DO NOT DUPLICATE.
//
// A Durable Object session write that fails (a code update resets the object, the free tier's
// write cap is spent, the platform answers "internal error") is recorded here, and
// `GET /api/admin/status` returns the record as `game_session_write_evidence`.
//
// The record is bounded by the day, not by the number of failures (B-963). A Durable Object
// write-cap incident fails every session write until 00:00 UTC, and the D1 allowance a failure
// would spend is the one the whole account shares (Iconoplasm's sync, votes and saves), so a
// record that costs rows per failure turns that incident into a D1 outage. There is one row for
// each day, operation, session kind and error class, and a D1 statement reaches it at most once
// every five minutes:
//
// - the upsert's `DO UPDATE ... WHERE` refuses a write less than five minutes after the row's last
//   one. A refused statement writes 0 rows and reads 0, so the bound holds however many isolates
//   fail at once (a per-isolate throttle would not: a cold isolate always writes its first failure);
// - an isolate counts its failures in memory and asks D1 once a window, adding what it counted, so
//   the failing request mostly pays no D1 round trip either.
//
// A key therefore costs at most one row for its first failure and one a window after, 288 a day;
// a Durable Object outage fails about ten keys, so about 2,900 rows (3% of the 100,000 a day the
// free plan allows) whether it fails 100 writes or 100,000. The cost of that bound is exactness:
// `failures` is what reached D1, a lower bound (counts held by an isolate that dies, or that lost
// the window to another isolate, are not recorded). Workers Logs hold every failure (each one is
// `console.warn`ed below), and the provider's Worker and Durable Object meters give the volume.
//
// The error text is classified into a closed set so a message carrying a unique reference cannot
// mint a row per failure; the first message of a key is kept as its example.
const FAILURE_TABLE = "game_session_write_failures_do_not_delete"

const FAILURE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS ${FAILURE_TABLE} (
    observed_day TEXT NOT NULL,
    operation TEXT NOT NULL,
    session_kind TEXT NOT NULL,
    error_class TEXT NOT NULL,
    failures INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    request_path TEXT,
    error_message TEXT NOT NULL,
    PRIMARY KEY (observed_day, operation, session_kind, error_class)
  ) WITHOUT ROWID
`

const UPSERT_FAILURE_SQL = `
  INSERT INTO ${FAILURE_TABLE} (
    observed_day,
    operation,
    session_kind,
    error_class,
    failures,
    first_seen_at,
    last_seen_at,
    request_path,
    error_message
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(observed_day, operation, session_kind, error_class) DO UPDATE SET
    failures = failures + excluded.failures,
    last_seen_at = excluded.last_seen_at
  WHERE excluded.last_seen_at - ${FAILURE_TABLE}.last_seen_at >= ?
`

const SELECT_FAILURES_FOR_DAY_SQL = `
  SELECT
    operation,
    session_kind,
    error_class,
    failures,
    first_seen_at,
    last_seen_at,
    request_path,
    error_message
  FROM ${FAILURE_TABLE}
  WHERE observed_day = ?
  ORDER BY first_seen_at ASC, operation ASC, session_kind ASC, error_class ASC
  LIMIT 500
`

const DELETE_OLD_FAILURES_SQL = `DELETE FROM ${FAILURE_TABLE} WHERE observed_day < ?`

const EVIDENCE_RETENTION_DAYS = 14
export const GAME_SESSION_WRITE_EVIDENCE_WINDOW_MS = 5 * 60 * 1000
const MAX_PENDING_KEYS = 256

// Per isolate: failures counted but not yet in D1, and when this isolate last asked D1 about a key.
const pending = new Map()
let preparedCutoffDay = ""

function toUtcDay(value = Date.now()) {
  return new Date(value).toISOString().slice(0, 10)
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

function normalizeErrorMessage(value) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
  return (normalized || "Unknown GameSession write error").slice(0, 220)
}

// The closed set of error classes. The first pattern that matches wins.
const ERROR_CLASSES = [
  ["write_cap", /exceeded allowed rows (?:written|read)|free tier/i],
  ["reset", /\breset\b|code was updated/i],
  ["overloaded", /overloaded|too many (?:requests|concurrent)|exceeded .*(?:cpu|memory)/i],
  ["internal", /internal error/i],
]

export function classifyGameSessionWriteError(message) {
  const text = String(message || "")
  for (const [name, pattern] of ERROR_CLASSES) if (pattern.test(text)) return name
  return "other"
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

// Creates the table and prunes what is past retention, in one batch. Once an isolate per cutoff
// day, so a day with no failure and no status read costs no statement.
async function prepareEvidenceTable(db, cutoffDay) {
  if (preparedCutoffDay === cutoffDay) return
  await db.batch([
    db.prepare(FAILURE_TABLE_SQL),
    db.prepare(DELETE_OLD_FAILURES_SQL).bind(cutoffDay),
  ])
  preparedCutoffDay = cutoffDay
}

async function recordGameSessionWriteFailure(db, details) {
  if (!db) {
    return false
  }

  const occurredAt = Number.isFinite(details?.occurredAt) ? details.occurredAt : Date.now()
  const observedDay = toUtcDay(occurredAt)
  const operation = normalizeOperation(details?.operation)
  const sessionKind = classifySessionKind(details?.sessionId)
  const errorMessage = normalizeErrorMessage(details?.errorMessage)
  const errorClass = classifyGameSessionWriteError(errorMessage)

  const key = `${observedDay}|${operation}|${sessionKind}|${errorClass}`
  let entry = pending.get(key)
  if (!entry) {
    if (pending.size >= MAX_PENDING_KEYS) pending.clear()
    entry = { failures: 0, askedAt: Number.NEGATIVE_INFINITY }
    pending.set(key, entry)
  }
  entry.failures += 1
  if (occurredAt - entry.askedAt < GAME_SESSION_WRITE_EVIDENCE_WINDOW_MS) return false
  entry.askedAt = occurredAt

  await prepareEvidenceTable(db, addUtcDays(observedDay, -EVIDENCE_RETENTION_DAYS))
  const result = await db
    .prepare(UPSERT_FAILURE_SQL)
    .bind(
      observedDay,
      operation,
      sessionKind,
      errorClass,
      entry.failures,
      occurredAt,
      occurredAt,
      normalizeRequestPath(details?.requestPath),
      errorMessage,
      GAME_SESSION_WRITE_EVIDENCE_WINDOW_MS,
    )
    .run()
  // A refused write (another isolate wrote this key within the window) keeps the count for the
  // next ask.
  if (Number(result?.meta?.changes) > 0) entry.failures = 0
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

  await prepareEvidenceTable(db, addUtcDays(toUtcDay(), -EVIDENCE_RETENTION_DAYS))
  const answer = await db.prepare(SELECT_FAILURES_FOR_DAY_SQL).bind(observedDay).all()

  const summary = { failures: 0, first_failure_at: null, last_failure_at: null }
  const failures = (Array.isArray(answer?.results) ? answer.results : []).map((row) => {
    const count = Number(row?.failures) || 0
    const firstSeenAt = Number(row?.first_seen_at) || null
    const lastSeenAt = Number(row?.last_seen_at) || null
    summary.failures += count
    summary.first_failure_at = earliest(summary.first_failure_at, firstSeenAt)
    summary.last_failure_at = latest(summary.last_failure_at, lastSeenAt)
    return {
      operation: normalizeOperation(row?.operation),
      session_kind: String(row?.session_kind || "unknown"),
      error_class: String(row?.error_class || "other"),
      failures: count,
      first_seen_at: firstSeenAt,
      last_seen_at: lastSeenAt,
      request_path: normalizeRequestPath(row?.request_path),
      error_message: normalizeErrorMessage(row?.error_message),
    }
  })

  return {
    ok: true,
    observed_day: observedDay,
    reset_started_at_utc: `${observedDay}T00:00:00.000Z`,
    next_reset_at_utc: `${addUtcDays(observedDay, 1)}T00:00:00.000Z`,
    counts_are_lower_bounds:
      "D1 is written at most once every five minutes for each row; Workers Logs hold every failure and the provider's meters give the volume",
    summary,
    failures,
  }
}
