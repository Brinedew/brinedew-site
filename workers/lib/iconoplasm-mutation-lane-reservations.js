// ARCHITECTURE FENCE [IPD-004]
// One concern, one owner: these reservations live inside the existing shared
// Iconoplasm daily-budget Durable Object. They are not a second coordinator.
// Each accepted operation keeps its full reservation after an uncertain
// outcome, and no lane may spend another lane's unused capacity.

export const D1_PROVIDER_DAILY_WRITE_LIMIT = 100_000
export const MUTATION_UNALLOCATED_HEADROOM = 30_000
export const MUTATION_LANE_DAILY_LIMITS = Object.freeze({
  user_action: 40_000,
  publication: 10_000,
  finalization_recovery: 10_000,
  laptop_delivery: 10_000,
})

const LANES = new Set(Object.keys(MUTATION_LANE_DAILY_LIMITS))
const ALLOCATED = Object.values(MUTATION_LANE_DAILY_LIMITS).reduce((sum, value) => sum + value, 0)
if (ALLOCATED + MUTATION_UNALLOCATED_HEADROOM !== D1_PROVIDER_DAILY_WRITE_LIMIT) {
  throw new Error("Mutation lane allocation must retain exactly 30 percent provider headroom")
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

  initialize() {
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS daily_mutation_lane_usage (
      day TEXT NOT NULL,
      lane TEXT NOT NULL,
      reserved_units INTEGER NOT NULL DEFAULT 0,
      reservation_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(day, lane)
    )`)
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS daily_mutation_lane_reservations (
      operation_id TEXT PRIMARY KEY,
      day TEXT NOT NULL,
      lane TEXT NOT NULL,
      reserved_units INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
      Number.isSafeInteger(units) && units > 0 && units <= MUTATION_LANE_DAILY_LIMITS[lane],
      "MUTATION_RESERVATION_UNITS_INVALID",
    )

    return this.transactionSync(() => {
      const previous = this.row(
        `SELECT day, lane, reserved_units
         FROM daily_mutation_lane_reservations
         WHERE operation_id = ?`,
        operationId,
      )
      if (previous) {
        requireValue(
          previous.lane === lane && Number(previous.reserved_units) === units,
          "MUTATION_RESERVATION_IDENTITY_MISMATCH",
        )
        return {
          ok: true,
          replayed: true,
          day: previous.day,
          requested_day: day,
          carried_from_day: previous.day === day ? null : previous.day,
          lane,
          operation_id: operationId,
          reserved_units: units,
        }
      }

      const usage = this.row(
        `SELECT reserved_units, reservation_count
         FROM daily_mutation_lane_usage
         WHERE day = ? AND lane = ?`,
        day,
        lane,
      )
      const used = Math.max(0, Number(usage?.reserved_units || 0) || 0)
      const limit = MUTATION_LANE_DAILY_LIMITS[lane]
      if (used + units > limit) {
        return {
          ok: false,
          code: "MUTATION_LANE_CAPACITY_EXHAUSTED",
          disposition: lane === "user_action" ? "pending_or_retryable_refusal" : "durable_pending",
          day,
          lane,
          requested_units: units,
          reserved_units: used,
          lane_limit: limit,
          lane_remaining: Math.max(0, limit - used),
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
        `INSERT INTO daily_mutation_lane_usage
         (day, lane, reserved_units, reservation_count)
         VALUES (?, ?, ?, 1)
         ON CONFLICT(day, lane) DO UPDATE SET
           reserved_units = daily_mutation_lane_usage.reserved_units + excluded.reserved_units,
           reservation_count = daily_mutation_lane_usage.reservation_count + 1`,
        day,
        lane,
        units,
      )
      return {
        ok: true,
        replayed: false,
        day,
        lane,
        operation_id: operationId,
        reserved_units: units,
        lane_limit: limit,
        lane_remaining: limit - used - units,
      }
    })
  }

  snapshot(day) {
    const safeDay = cleanDay(day)
    const rows = this.storage.sql
      .exec(
        `SELECT lane, reserved_units, reservation_count
         FROM daily_mutation_lane_usage
         WHERE day = ?`,
        safeDay,
      )
      .toArray()
    const byLane = new Map(rows.map((row) => [row.lane, row]))
    return {
      day: safeDay,
      provider_limit: D1_PROVIDER_DAILY_WRITE_LIMIT,
      unallocated_headroom: MUTATION_UNALLOCATED_HEADROOM,
      lanes: Object.fromEntries(
        Object.entries(MUTATION_LANE_DAILY_LIMITS).map(([lane, limit]) => {
          const reserved = Math.max(0, Number(byLane.get(lane)?.reserved_units || 0) || 0)
          return [
            lane,
            {
              limit,
              reserved,
              remaining: Math.max(0, limit - reserved),
              reservations: Math.max(0, Number(byLane.get(lane)?.reservation_count || 0) || 0),
            },
          ]
        }),
      ),
    }
  }
}
