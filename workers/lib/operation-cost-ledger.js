// ARCHITECTURE FENCE [IPD-012]: reserve before dispatch; unknown outcomes retain
// their reservation. This ledger is internal to the existing budget authority.
// A caller-supplied bound is NOT proof that an arbitrary SQL query is bounded.
import { D1_OPERATOR_DAILY_LIMITS } from "../../shared/iconoplasm-d1-budget-policy.js"

const METERS = ["rows_read", "rows_written", "requests"]
const LIMITS = {
  rows_read: D1_OPERATOR_DAILY_LIMITS.reads,
  rows_written: D1_OPERATOR_DAILY_LIMITS.writes,
  requests: 2_500,
}
export const ACCOUNT_CEILINGS = Object.freeze({
  rows_read: 3_500_000,
  rows_written: 70_000,
  requests: 75_000,
})
const CONTROL_REQUEST_HEADROOM = 100

export class OperationCostError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}

function requireValue(condition, code) {
  if (!condition) throw new OperationCostError(code)
}

function vector(value, prediction = false) {
  requireValue(value && typeof value === "object", "COST_VECTOR_REQUIRED")
  const result = {}
  for (const meter of METERS) {
    requireValue(
      Number.isSafeInteger(value[meter]) &&
        value[meter] >= 0 &&
        value[meter] <= (prediction ? Math.floor(Number.MAX_SAFE_INTEGER / 2) : LIMITS[meter]),
      "COST_VECTOR_INVALID",
    )
    result[meter] = value[meter]
  }
  return result
}

function identity(value) {
  requireValue(
    typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/.test(value),
    "COST_ID_INVALID",
  )
  requireValue(!Object.hasOwn(Object.prototype, value), "COST_ID_INVALID")
  return value
}

function digest(value) {
  requireValue(typeof value === "string" && /^[a-f0-9]{64}$/.test(value), "COST_DIGEST_INVALID")
  return value
}

export class OperationCostLedger {
  constructor(
    storage,
    now = () => Date.now(),
    readAccountUsage = () => null,
    readOtherUsage = () => ({ rows_read: 0, rows_written: 0, requests: 0 }),
  ) {
    this.storage = storage
    this.now = now
    // Supplied by the authority's control-plane telemetry reader, never a
    // caller's prediction document. Absence must stop dispatch.
    this.readAccountUsage = readAccountUsage
    this.readOtherUsage = readOtherUsage
  }

  initialize() {
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS operation_cost_days (
      day TEXT PRIMARY KEY, rows_read INTEGER NOT NULL, rows_written INTEGER NOT NULL,
      requests INTEGER NOT NULL, registrations INTEGER NOT NULL)`)
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS operation_cost_plans (
      id TEXT PRIMARY KEY, day TEXT NOT NULL, document TEXT NOT NULL)`)
    this.storage.sql.exec(
      `CREATE INDEX IF NOT EXISTS operation_cost_plans_day ON operation_cost_plans(day)`,
    )
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS operation_cost_invalid_bounds (
      executable_sha256 TEXT NOT NULL, schema_sha256 TEXT NOT NULL, resource TEXT NOT NULL,
      operation_id TEXT NOT NULL, step_id TEXT NOT NULL,
      PRIMARY KEY(executable_sha256, schema_sha256, resource))`)
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS operation_cost_account_usage (
      day TEXT PRIMARY KEY, measured_at INTEGER NOT NULL, rows_read INTEGER NOT NULL,
      rows_written INTEGER NOT NULL, requests INTEGER NOT NULL)`)
  }

  day() {
    return new Date(this.now()).toISOString().slice(0, 10)
  }

  row(sql, ...args) {
    return this.storage.sql.exec(sql, ...args).toArray()[0] || null
  }

  storedAccountUsage() {
    return this.row("SELECT * FROM operation_cost_account_usage WHERE day = ?", this.day())
  }

  rememberAccountUsage(sample) {
    requireValue(
      sample &&
        sample.day === this.day() &&
        Number.isSafeInteger(sample.measured_at) &&
        sample.measured_at <= this.now() &&
        this.now() - sample.measured_at <= 60_000 &&
        METERS.every((meter) => Number.isSafeInteger(sample[meter]) && sample[meter] >= 0),
      "COST_ACCOUNT_USAGE_UNAVAILABLE",
    )
    return this.storage.transactionSync(() => {
      const previous = this.storedAccountUsage()
      const next = { day: sample.day, measured_at: sample.measured_at }
      for (const meter of METERS) next[meter] = Math.max(sample[meter], previous?.[meter] ?? 0)
      if (
        previous &&
        previous.measured_at === next.measured_at &&
        METERS.every((meter) => previous[meter] === next[meter])
      )
        return previous
      this.storage.sql.exec(
        `INSERT INTO operation_cost_account_usage VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(day) DO UPDATE SET measured_at = excluded.measured_at,
        rows_read = excluded.rows_read, rows_written = excluded.rows_written, requests = excluded.requests`,
        next.day,
        next.measured_at,
        next.rows_read,
        next.rows_written,
        next.requests,
      )
      return next
    })
  }

  readPlan(id) {
    const row = this.row("SELECT document FROM operation_cost_plans WHERE id = ?", identity(id))
    requireValue(row, "COST_PREDICTION_NOT_REGISTERED")
    return JSON.parse(row.document)
  }

  save(plan) {
    this.storage.sql.exec(
      "UPDATE operation_cost_plans SET document = ? WHERE id = ?",
      JSON.stringify(plan),
      plan.id,
    )
  }

  recordControlRequest() {
    return this.storage.transactionSync(() => {
      const day = this.day()
      const usage = this.row("SELECT requests FROM operation_cost_days WHERE day = ?", day)
      const other = this.readOtherUsage(day)
      requireValue(
        Number.isSafeInteger(other?.requests) && other.requests >= 0,
        "COST_SHARED_USAGE_UNAVAILABLE",
      )
      requireValue(
        (usage?.requests || 0) + other.requests < LIMITS.requests,
        "COST_SHARED_DAILY_LIMIT",
      )
      this.storage.sql.exec(
        `INSERT INTO operation_cost_days VALUES (?, 0, 0, 1, 0)
         ON CONFLICT(day) DO UPDATE SET requests = requests + 1`,
        day,
      )
    })
  }

  register(input) {
    requireValue(input && typeof input === "object", "COST_PREDICTION_REQUIRED")
    const id = identity(input.id)
    const prediction = vector(input.prediction, true)
    requireValue(prediction.requests > 0, "COST_REQUEST_PREDICTION_REQUIRED")
    const now = this.now()
    const day = this.day()
    requireValue(
      Number.isSafeInteger(input.expires_at) &&
        input.expires_at > now &&
        input.expires_at <= now + 3_600_000 &&
        new Date(input.expires_at).toISOString().slice(0, 10) === day,
      "COST_EXPIRY_INVALID",
    )
    const immutable = {
      id,
      day,
      prediction,
      expires_at: input.expires_at,
      executable_sha256: digest(input.executable_sha256),
      schema_sha256: digest(input.schema_sha256),
      resource: identity(input.resource),
      adapter_id: identity(input.adapter_id),
      principal: identity(input.principal),
      ...(input.predecessor_id === undefined
        ? {}
        : { predecessor_id: identity(input.predecessor_id) }),
    }
    return this.storage.transactionSync(() => {
      const previous = this.row("SELECT document FROM operation_cost_plans WHERE id = ?", id)
      if (previous) {
        const plan = JSON.parse(previous.document)
        requireValue(
          JSON.stringify(plan.immutable) === JSON.stringify(immutable),
          "COST_PREDICTION_IMMUTABLE",
        )
        return plan
      }
      let predecessor = null
      if (immutable.predecessor_id) {
        predecessor = this.readPlan(immutable.predecessor_id)
        const correctedImplementation = ["executable_sha256", "schema_sha256"].some(
          (key) => immutable[key] !== predecessor.immutable[key],
        )
        requireValue(
          (predecessor.status === "active" && predecessor.immutable.expires_at <= now) ||
            (correctedImplementation && ["active", "tripped"].includes(predecessor.status)),
          "COST_CONTINUATION_NOT_AVAILABLE",
        )
        requireValue(
          ["resource", "adapter_id", "principal"].every(
            (key) => immutable[key] === predecessor.immutable[key],
          ) && JSON.stringify(prediction) === JSON.stringify(predecessor.immutable.prediction),
          "COST_CONTINUATION_MUST_PRESERVE_PREDICTION",
        )
      }
      this.storage.sql.exec(
        `INSERT INTO operation_cost_days (day, rows_read, rows_written, requests, registrations) VALUES (?, 0, 0, 0, 0) ON CONFLICT(day) DO NOTHING`,
        day,
      )
      const usage = this.row("SELECT * FROM operation_cost_days WHERE day = ?", day)
      requireValue(usage.registrations < 500, "COST_REGISTRATION_DAILY_LIMIT")
      const ceiling = predecessor
        ? { ...predecessor.ceiling }
        : Object.fromEntries(METERS.map((meter) => [meter, 2 * prediction[meter]]))
      const plan = {
        id,
        immutable,
        ceiling,
        // Expiry permits continuation, never a reset. Unknown steps retain
        // their complete reservation, even across UTC days and process death.
        used: predecessor
          ? { ...predecessor.used }
          : { rows_read: 0, rows_written: 0, requests: 0 },
        steps: {},
        status: "active",
      }
      this.storage.sql.exec(
        "INSERT INTO operation_cost_plans VALUES (?, ?, ?)",
        id,
        day,
        JSON.stringify(plan),
      )
      if (predecessor) {
        predecessor.status = "continued"
        predecessor.successor_id = id
        this.save(predecessor)
      }
      this.storage.sql.exec(
        "UPDATE operation_cost_days SET registrations = registrations + 1 WHERE day = ?",
        day,
      )
      // At most 500 plans/day; delete indexed expired-day records once per day's
      // first registration. Retain seven days of receipts, never a growing audit.
      if (usage.registrations === 0) {
        const oldest = new Date(now - 7 * 86_400_000).toISOString().slice(0, 10)
        this.storage.sql.exec("DELETE FROM operation_cost_plans WHERE day < ?", oldest)
        this.storage.sql.exec("DELETE FROM operation_cost_days WHERE day < ?", oldest)
        this.storage.sql.exec("DELETE FROM operation_cost_account_usage WHERE day < ?", oldest)
      }
      return plan
    })
  }

  reserve(input) {
    requireValue(input && typeof input === "object", "COST_PREDICTION_REQUIRED")
    const bound = vector(input.bound)
    requireValue(bound.requests > 0, "COST_REQUEST_BOUND_REQUIRED")
    const stepId = identity(input.step_id)
    const stepDigest = digest(input.step_sha256)
    return this.storage.transactionSync(() => {
      const plan = this.readPlan(input.id)
      requireValue(plan.status === "active", "COST_PLAN_TRIPPED")
      requireValue(
        plan.immutable.day === this.day() && plan.immutable.expires_at > this.now(),
        "COST_PLAN_EXPIRED",
      )
      requireValue(
        input.resource === plan.immutable.resource &&
          input.adapter_id === plan.immutable.adapter_id &&
          input.executable_sha256 === plan.immutable.executable_sha256 &&
          input.schema_sha256 === plan.immutable.schema_sha256,
        "COST_PLAN_IDENTITY_MISMATCH",
      )
      // Never return another dispatch permit for an existing step, including an
      // unknown outcome after process death. Receipt lookup is read-only.
      requireValue(!Object.hasOwn(plan.steps, stepId), "COST_STEP_ALREADY_RESERVED")
      // A complete baseline plus event suffix can exceed 128 pages at the
      // workstation's default page size. The shared 2500-request allowance
      // still bounds total retained steps across all plans in a day.
      requireValue(Object.keys(plan.steps).length < 1024, "COST_PLAN_STEP_LIMIT")
      const usage = this.row("SELECT * FROM operation_cost_days WHERE day = ?", plan.immutable.day)
      const otherUsage = this.readOtherUsage(plan.immutable.day)
      requireValue(
        otherUsage &&
          METERS.every(
            (meter) => Number.isSafeInteger(otherUsage[meter]) && otherUsage[meter] >= 0,
          ),
        "COST_SHARED_USAGE_UNAVAILABLE",
      )
      requireValue(
        !this.row(
          `SELECT 1 AS invalid FROM operation_cost_invalid_bounds
        WHERE executable_sha256 = ? AND schema_sha256 = ? AND resource = ?`,
          plan.immutable.executable_sha256,
          plan.immutable.schema_sha256,
          plan.immutable.resource,
        ),
        "COST_VERIFIED_BOUND_INVALIDATED",
      )
      const account = this.readAccountUsage()
      requireValue(
        account &&
          account.day === plan.immutable.day &&
          Number.isSafeInteger(account.measured_at) &&
          account.measured_at <= this.now() &&
          this.now() - account.measured_at <= 60_000 &&
          METERS.every((meter) => Number.isSafeInteger(account[meter]) && account[meter] >= 0),
        "COST_ACCOUNT_USAGE_UNAVAILABLE",
      )
      for (const meter of METERS) {
        requireValue(
          plan.used[meter] + bound[meter] <= plan.ceiling[meter],
          "COST_TWICE_PREDICTION_LIMIT",
        )
        requireValue(
          usage[meter] + otherUsage[meter] + bound[meter] <=
            LIMITS[meter] - (meter === "requests" ? CONTROL_REQUEST_HEADROOM : 0),
          "COST_SHARED_DAILY_LIMIT",
        )
        // Deliberately conservative: outstanding and today's settled operator
        // work remain additive to account telemetry, including where telemetry
        // already contains that work. Never subtract an assumed overlap.
        requireValue(
          account[meter] + usage[meter] + otherUsage[meter] + bound[meter] <=
            ACCOUNT_CEILINGS[meter],
          "COST_ACCOUNT_HEADROOM_LIMIT",
        )
      }
      for (const meter of METERS) plan.used[meter] += bound[meter]
      plan.steps[stepId] = { digest: stepDigest, bound, status: "reserved" }
      this.save(plan)
      this.storage.sql.exec(
        "UPDATE operation_cost_days SET rows_read = rows_read + ?, rows_written = rows_written + ?, requests = requests + ? WHERE day = ?",
        bound.rows_read,
        bound.rows_written,
        bound.requests,
        plan.immutable.day,
      )
      return { id: plan.id, step_id: stepId, step_sha256: stepDigest, reserved: bound }
    })
  }

  settle(input) {
    // Actual values may exceed allocation when a bound is defective. Preserve
    // that evidence and trip the plan instead of dropping it during validation.
    requireValue(
      input?.actual &&
        METERS.every(
          (meter) => Number.isSafeInteger(input.actual[meter]) && input.actual[meter] >= 0,
        ),
      "COST_RECEIPT_REQUIRED",
    )
    return this.storage.transactionSync(() => {
      const plan = this.readPlan(input.id)
      const step = plan.steps[identity(input.step_id)]
      requireValue(step && step.digest === input.step_sha256, "COST_RECEIPT_IDENTITY_MISMATCH")
      const actual = Object.fromEntries(METERS.map((meter) => [meter, input.actual[meter]]))
      requireValue(actual.requests === step.bound.requests, "COST_REQUEST_RECEIPT_MISMATCH")
      if (step.status === "settled") {
        requireValue(
          JSON.stringify(step.actual) === JSON.stringify(actual),
          "COST_RECEIPT_IMMUTABLE",
        )
        return plan
      }
      const delta = {}
      for (const meter of METERS) {
        delta[meter] = actual[meter] - step.bound[meter]
        requireValue(Number.isSafeInteger(plan.used[meter] + delta[meter]), "COST_RECEIPT_OVERFLOW")
        plan.used[meter] += delta[meter]
        if (actual[meter] > step.bound[meter]) plan.status = "tripped"
      }
      step.status = "settled"
      step.actual = actual
      this.save(plan)
      this.storage.sql.exec(
        "UPDATE operation_cost_days SET rows_read = rows_read + ?, rows_written = rows_written + ?, requests = requests + ? WHERE day = ?",
        delta.rows_read,
        delta.rows_written,
        delta.requests,
        plan.immutable.day,
      )
      if (plan.status === "tripped") {
        // A fresh plan or UTC day cannot rehabilitate defective authority code.
        // A corrected executable/schema identity can proceed through normal
        // admission immediately, without waiting for a reset or human unlock.
        this.storage.sql.exec(
          `INSERT INTO operation_cost_invalid_bounds VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(executable_sha256, schema_sha256, resource) DO NOTHING`,
          plan.immutable.executable_sha256,
          plan.immutable.schema_sha256,
          plan.immutable.resource,
          plan.id,
          input.step_id,
        )
      }
      return plan
    })
  }
}
