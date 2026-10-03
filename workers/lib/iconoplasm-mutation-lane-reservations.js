// ARCHITECTURE FENCE [IPD-004]
// One concern, one owner: these reservations live inside the existing shared
// Iconoplasm daily-budget Durable Object. They are not a second coordinator.
//
// Admission is measured against the one real resource, Cloudflare's account
// D1 rows-written meter (100k/day on the free plan):
//
//   pressure = provider rows written, observed at T
//            + worst-case units of every reservation made since T - 15 min
//
// The 15 minutes cover analytics lag: once the provider meter can see an
// operation's real writes, its worst-case receipt stops counting. An uncertain
// reservation is never cleared or refunded; it simply ages into the meter.
// With no observation today the baseline is midnight's exact zero and every
// receipt since midnight counts, so unknown capacity is never assumed.
//
// B-897 (30 Sep 2026): the previous four fixed lanes summed every reservation
// *started* today at worst case and never subtracted. 200 retried 50-unit
// finalization phases parked laptop delivery for a whole UTC day while the
// provider meter sat near 12%. Background work now stops at 70% of the meter
// and user actions at 90%, so users always keep a band background cannot take.

import { secondsUntilCloudflareDailyReset } from "./cloudflare-availability.js"

export const D1_PROVIDER_DAILY_WRITE_LIMIT = 100_000
export const MUTATION_BACKGROUND_CEILING = 70_000
export const MUTATION_USER_ACTION_CEILING = 90_000
export const MUTATION_ANALYTICS_LAG_MS = 15 * 60_000
export const MUTATION_PRESSURE_BUCKET_MS = 15 * 60_000
export const MUTATION_OBSERVATION_FUTURE_TOLERANCE_MS = 60_000
export const MUTATION_COMPLETED_RETRY_HORIZON_DAYS = 32
export const MUTATION_TOMBSTONE_RETENTION_DAYS = 32
export const MUTATION_MAX_TRACKED_IDENTITIES_AT_70K_PER_DAY =
  70_000 * (MUTATION_COMPLETED_RETRY_HORIZON_DAYS + MUTATION_TOMBSTONE_RETENTION_DAYS)
export const MUTATION_LANE_CEILINGS = Object.freeze({
  user_action: MUTATION_USER_ACTION_CEILING,
  publication: MUTATION_BACKGROUND_CEILING,
  finalization_recovery: MUTATION_BACKGROUND_CEILING,
  laptop_delivery: MUTATION_BACKGROUND_CEILING,
})

const LANES = new Set(Object.keys(MUTATION_LANE_CEILINGS))
const PRESSURE_SQL = `SELECT COALESCE(SUM(reserved_units), 0) AS units
   FROM daily_mutation_pressure_buckets
   WHERE day = ? AND bucket_start >= ?`

function bucketStart(ms) {
  // "YYYY-MM-DDTHH:MM", UTC, floored to the bucket; sorts lexicographically.
  return new Date(Math.floor(ms / MUTATION_PRESSURE_BUCKET_MS) * MUTATION_PRESSURE_BUCKET_MS)
    .toISOString()
    .slice(0, 16)
}

function timeMs(value, fallback) {
  const parsed = Date.parse(String(value ?? ""))
  return Number.isFinite(parsed) ? parsed : fallback
}

// The counted window starts 15 minutes before a valid same-day observation,
// or at midnight when there is none. Yesterday's and future-dated samples are
// not baselines for today.
// Locally recorded writes are live but partial; the provider meter is
// complete but lags. The baseline takes whichever is higher.
function pressureWindow(day, { provider_rows_written, local_rows_written, observed_at, now } = {}) {
  const midnight = Date.parse(`${day}T00:00:00.000Z`)
  const nowMs = timeMs(now, Date.now())
  const observedMs = timeMs(observed_at, Number.NaN)
  const observed =
    Number.isFinite(observedMs) &&
    new Date(observedMs).toISOString().slice(0, 10) === day &&
    observedMs <= nowMs + MUTATION_OBSERVATION_FUTURE_TOLERANCE_MS
  return {
    nowMs,
    baseline: Math.max(
      observed ? Math.max(0, Number(provider_rows_written || 0) || 0) : 0,
      Math.max(0, Number(local_rows_written || 0) || 0),
    ),
    observed_at: observed ? new Date(observedMs).toISOString() : null,
    from: bucketStart(
      Math.max(midnight, observed ? observedMs - MUTATION_ANALYTICS_LAG_MS : midnight),
    ),
  }
}

// How many seconds until a refused request is worth sending again, given what the
// ledger said when it refused (the 429 body of `reserve`). This is the one answer every
// daily-budget refusal states, in `Retry-After` and in `retry_after_seconds`; pass null
// for a refusal that has no lane (the shared day is spent, the admin limiter), which
// only the reset clears.
//
// A lane refusal has two causes, and they clear at different times:
// - Reservations in flight are the reason (the request would fit without them): they
//   stop counting once a provider sample is 15 minutes past their bucket, so time
//   alone clears it. 15 minutes is the earliest that can happen; the window is cut on
//   15 minute buckets and the sample can be a few minutes old, so it can take up to
//   twice that, and the next refusal then states the same 15 minutes again.
// - The provider's own count already blocks the request: that count never falls
//   within the UTC day, so only the reset clears it, however much is in flight.
export function mutationRefusalRetryAfterSeconds(refusal, now = Date.now()) {
  const inFlight = Number(refusal?.in_flight_units)
  const withoutInFlight = Number(refusal?.provider_rows_written) + Number(refusal?.requested_units)
  if (inFlight > 0 && withoutInFlight <= Number(refusal?.ceiling)) {
    return MUTATION_ANALYTICS_LAG_MS / 1000
  }
  return secondsUntilCloudflareDailyReset(now)
}

export class MutationLaneReservationError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function requireValue(condition, code) {
  if (!condition) throw new MutationLaneReservationError(code)
}

function cleanDay(value) {
  const day = String(value || "")
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(day), "MUTATION_RESERVATION_DAY_INVALID")
  return day
}

function cleanIdentity(value) {
  const identity = String(value || "")
  requireValue(/^[a-zA-Z0-9_.:@-]{1,255}$/.test(identity), "MUTATION_RESERVATION_IDENTITY_INVALID")
  return identity
}

export class DailyMutationLaneReservations {
  constructor(storage) {
    requireValue(storage?.sql?.exec, "MUTATION_RESERVATION_STORAGE_REQUIRED")
    this.storage = storage
    this.transactionSync =
      typeof storage.transactionSync === "function"
        ? (callback) => storage.transactionSync(callback)
        : (callback) => callback()
  }

  get pressureSql() {
    return PRESSURE_SQL
  }

  initialize() {
    // B-897: the per-lane day totals were the fixed-lane meter. Pressure
    // buckets replace them; a day holds at most 96 bucket rows.
    this.storage.sql.exec(`DROP TABLE IF EXISTS daily_mutation_lane_usage`)
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS daily_mutation_pressure_buckets (
      day TEXT NOT NULL,
      bucket_start TEXT NOT NULL,
      reserved_units INTEGER NOT NULL DEFAULT 0,
      reservation_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(day, bucket_start)
    )`)
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS daily_mutation_lane_reservations (
      operation_id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      lane TEXT NOT NULL,
      reserved_units INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'reserved',
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
    const reservationColumns = new Set(
      this.storage.sql
        .exec(`PRAGMA table_info(daily_mutation_lane_reservations)`)
        .toArray()
        .map((column) => String(column?.name || "")),
    )
    if (!reservationColumns.has("status")) {
      this.storage.sql.exec(
        `ALTER TABLE daily_mutation_lane_reservations ADD COLUMN status TEXT NOT NULL DEFAULT 'reserved'`,
      )
    }
    if (!reservationColumns.has("completed_at")) {
      this.storage.sql.exec(
        `ALTER TABLE daily_mutation_lane_reservations ADD COLUMN completed_at TEXT`,
      )
    }
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS daily_mutation_lane_reservation_tombstones (
      operation_id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      lane TEXT NOT NULL,
      reserved_units INTEGER NOT NULL,
      completed_at TEXT NOT NULL,
      compacted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`)
    this.storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_daily_mutation_lane_reservations_day_lane
       ON daily_mutation_lane_reservations(day, lane)`,
    )
  }

  row(sql, ...args) {
    return this.storage.sql.exec(sql, ...args).toArray()[0] || null
  }

  reserve(input) {
    requireValue(input && typeof input === "object", "MUTATION_RESERVATION_REQUIRED")
    const day = cleanDay(input.day)
    const lane = String(input.lane || "")
    requireValue(LANES.has(lane), "MUTATION_RESERVATION_LANE_INVALID")
    const operationId = cleanIdentity(input.operation_id)
    const units = Number(input.units)
    requireValue(
      Number.isSafeInteger(units) && units > 0 && units <= MUTATION_LANE_CEILINGS[lane],
      "MUTATION_RESERVATION_UNITS_INVALID",
    )

    return this.transactionSync(() => {
      const previous = this.row(
        `SELECT day, lane, reserved_units, status
         FROM daily_mutation_lane_reservations
         WHERE operation_id = ?`,
        operationId,
      )
      const tombstone = previous
        ? null
        : this.row(
            `SELECT day, lane, reserved_units
             FROM daily_mutation_lane_reservation_tombstones
             WHERE operation_id = ?`,
            operationId,
          )
      if (previous || tombstone) {
        const retained = previous || tombstone
        requireValue(
          retained.lane === lane && Number(retained.reserved_units) === units,
          "MUTATION_RESERVATION_IDENTITY_MISMATCH",
        )
        return {
          ok: true,
          replayed: true,
          terminal: Boolean(tombstone || previous.status === "completed"),
          day: retained.day,
          requested_day: day,
          carried_from_day: retained.day === day ? null : retained.day,
          lane,
          operation_id: operationId,
          reserved_units: units,
        }
      }

      const window = pressureWindow(day, input)
      const inFlightUnits = this.inFlightUnits(day, window.from)
      const ceiling = MUTATION_LANE_CEILINGS[lane]
      const pressure = window.baseline + inFlightUnits + units
      if (pressure > ceiling) {
        return {
          ok: false,
          code: "MUTATION_PROVIDER_HEADROOM_RESERVED",
          disposition: lane === "user_action" ? "pending_or_retryable_refusal" : "durable_pending",
          day,
          lane,
          requested_units: units,
          provider_rows_written: window.baseline,
          observed_at: window.observed_at,
          in_flight_units: inFlightUnits,
          ceiling,
          remaining: Math.max(0, ceiling - window.baseline - inFlightUnits),
        }
      }

      this.storage.sql.exec(
        `INSERT INTO daily_mutation_lane_reservations
         (operation_id, day, lane, reserved_units)
         VALUES (?, ?, ?, ?)`,
        operationId,
        day,
        lane,
        units,
      )
      this.storage.sql.exec(
        `INSERT INTO daily_mutation_pressure_buckets
         (day, bucket_start, reserved_units, reservation_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(day, bucket_start) DO UPDATE SET
           reserved_units = daily_mutation_pressure_buckets.reserved_units + excluded.reserved_units,
           reservation_count = daily_mutation_pressure_buckets.reservation_count + 1`,
        day,
        bucketStart(window.nowMs),
        units,
      )
      return {
        ok: true,
        replayed: false,
        day,
        lane,
        operation_id: operationId,
        reserved_units: units,
        pressure,
        ceiling,
        remaining: ceiling - pressure,
      }
    })
  }

  inFlightUnits(day, from) {
    return Math.max(0, Number(this.row(PRESSURE_SQL, day, from)?.units || 0) || 0)
  }

  complete(input) {
    requireValue(input && typeof input === "object", "MUTATION_RESERVATION_REQUIRED")
    const operationId = cleanIdentity(input.operation_id)
    const completedAt = String(input.completed_at || new Date().toISOString())
    requireValue(Number.isFinite(Date.parse(completedAt)), "MUTATION_COMPLETION_TIME_INVALID")
    return this.transactionSync(() => {
      const row = this.row(
        `SELECT operation_id, status FROM daily_mutation_lane_reservations WHERE operation_id = ?`,
        operationId,
      )
      if (!row) {
        const tombstone = this.row(
          `SELECT operation_id FROM daily_mutation_lane_reservation_tombstones WHERE operation_id = ?`,
          operationId,
        )
        requireValue(tombstone, "MUTATION_RESERVATION_NOT_FOUND")
        return { ok: true, replayed: true, terminal: true, operation_id: operationId }
      }
      if (row.status === "completed") {
        return { ok: true, replayed: true, terminal: true, operation_id: operationId }
      }
      this.storage.sql.exec(
        `UPDATE daily_mutation_lane_reservations
         SET status = 'completed', completed_at = ?
         WHERE operation_id = ? AND status = 'reserved'`,
        completedAt,
        operationId,
      )
      return { ok: true, replayed: false, terminal: true, operation_id: operationId }
    })
  }

  compactTerminal({ now = new Date().toISOString(), limit = 1000 } = {}) {
    const nowMs = Date.parse(String(now || ""))
    requireValue(Number.isFinite(nowMs), "MUTATION_COMPACTION_TIME_INVALID")
    const beforeTime = new Date(
      nowMs - MUTATION_COMPLETED_RETRY_HORIZON_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString()
    const safeLimit = Math.max(1, Math.min(5000, Number.parseInt(String(limit), 10) || 1000))
    return this.transactionSync(() => {
      // Operation ids are globally unique and may be retried for 32 days.
      // A second 32-day anti-reuse window catches stale clients, after which
      // reuse is a protocol violation rather than permanent per-command state.
      const tombstoneBeforeTime = new Date(
        nowMs -
          (MUTATION_COMPLETED_RETRY_HORIZON_DAYS + MUTATION_TOMBSTONE_RETENTION_DAYS) *
            24 *
            60 *
            60 *
            1000,
      ).toISOString()
      const expired = this.storage.sql
        .exec(
          `SELECT operation_id
           FROM daily_mutation_lane_reservation_tombstones
           WHERE completed_at < ?
           ORDER BY completed_at, operation_id
           LIMIT ?`,
          tombstoneBeforeTime,
          safeLimit,
        )
        .toArray()
      for (const row of expired) {
        this.storage.sql.exec(
          `DELETE FROM daily_mutation_lane_reservation_tombstones WHERE operation_id = ?`,
          row.operation_id,
        )
      }
      const rows = this.storage.sql
        .exec(
          `SELECT operation_id, day, lane, reserved_units, completed_at
           FROM daily_mutation_lane_reservations
           WHERE status = 'completed' AND completed_at < ?
           ORDER BY completed_at, operation_id
           LIMIT ?`,
          beforeTime,
          safeLimit,
        )
        .toArray()
      for (const row of rows) {
        this.storage.sql.exec(
          `INSERT INTO daily_mutation_lane_reservation_tombstones
           (operation_id, day, lane, reserved_units, completed_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(operation_id) DO NOTHING`,
          row.operation_id,
          row.day,
          row.lane,
          row.reserved_units,
          row.completed_at,
        )
        this.storage.sql.exec(
          `DELETE FROM daily_mutation_lane_reservations
           WHERE operation_id = ? AND status = 'completed'`,
          row.operation_id,
        )
      }
      return { ok: true, compacted: rows.length, expired_tombstones: expired.length }
    })
  }

  nextCompactionAt() {
    const completed = this.row(
      `SELECT MIN(completed_at) AS completed_at
       FROM daily_mutation_lane_reservations
       WHERE status = 'completed' AND completed_at IS NOT NULL`,
    )?.completed_at
    const tombstone = this.row(
      `SELECT MIN(completed_at) AS completed_at
       FROM daily_mutation_lane_reservation_tombstones`,
    )?.completed_at
    const candidates = [
      completed
        ? Date.parse(completed) + MUTATION_COMPLETED_RETRY_HORIZON_DAYS * 86400000
        : Number.NaN,
      tombstone
        ? Date.parse(tombstone) +
          (MUTATION_COMPLETED_RETRY_HORIZON_DAYS + MUTATION_TOMBSTONE_RETENTION_DAYS) * 86400000
        : Number.NaN,
    ].filter(Number.isFinite)
    return candidates.length ? Math.min(...candidates) : null
  }

  snapshot(day, observation = {}) {
    const safeDay = cleanDay(day)
    const window = pressureWindow(safeDay, observation)
    const inFlightUnits = this.inFlightUnits(safeDay, window.from)
    const pressure = window.baseline + inFlightUnits
    return {
      day: safeDay,
      provider_limit: D1_PROVIDER_DAILY_WRITE_LIMIT,
      provider_rows_written: window.baseline,
      observed_at: window.observed_at,
      counted_from: window.from,
      in_flight_units: inFlightUnits,
      pressure,
      lanes: Object.fromEntries(
        Object.entries(MUTATION_LANE_CEILINGS).map(([lane, limit]) => [
          lane,
          { limit, remaining: Math.max(0, limit - pressure) },
        ]),
      ),
    }
  }
}
