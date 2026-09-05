import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"
import { OperationCostLedger } from "./operation-cost-ledger.js"
import { OperationCostExecutor } from "./operation-cost-executor.js"

function fixture() {
  const db = new DatabaseSync(":memory:")
  const storage = {
    sql: {
      exec(sql, ...args) {
        const statement = db.prepare(sql)
        if (statement.columns().length) return { toArray: () => statement.all(...args) }
        statement.run(...args)
        return { toArray: () => [] }
      },
    },
    transactionSync(fn) {
      db.exec("BEGIN IMMEDIATE")
      try {
        const result = fn()
        db.exec("COMMIT")
        return result
      } catch (error) {
        db.exec("ROLLBACK")
        throw error
      }
    },
  }
  let now = Date.parse("2026-09-06T12:00:00Z")
  const readAccountUsage = () => ({
    day: new Date(now).toISOString().slice(0, 10),
    measured_at: now,
    rows_read: 0,
    rows_written: 0,
    requests: 0,
  })
  const ledger = new OperationCostLedger(storage, () => now, readAccountUsage)
  ledger.initialize()
  const input = {
    id: "operation-1",
    prediction: { rows_read: 10, rows_written: 2, requests: 2 },
    expires_at: now + 60_000,
    executable_sha256: "a".repeat(64),
    schema_sha256: "b".repeat(64),
    resource: "iconoplasm",
    adapter_id: "verified-read",
    principal: "admin",
  }
  const step = (overrides = {}) => ({
    ...input,
    step_id: "step-1",
    step_sha256: "c".repeat(64),
    bound: { rows_read: 10, rows_written: 2, requests: 1 },
    ...overrides,
  })
  return {
    db,
    storage,
    ledger,
    input,
    step,
    readAccountUsage,
    advance: (ms) => {
      now += ms
    },
  }
}

test("missing predictions, underestimates and wrong executable identities never obtain a dispatch permit", () => {
  const f = fixture()
  assert.throws(() => f.ledger.reserve(f.step()), /NOT_REGISTERED/)
  f.ledger.register(f.input)
  assert.throws(
    () => f.ledger.reserve(f.step({ bound: { rows_read: 21, rows_written: 0, requests: 1 } })),
    /TWICE_PREDICTION/,
  )
  assert.throws(
    () => f.ledger.reserve(f.step({ executable_sha256: "d".repeat(64) })),
    /IDENTITY_MISMATCH/,
  )
  assert.throws(
    () => f.ledger.reserve(f.step({ adapter_id: "different-operation" })),
    /IDENTITY_MISMATCH/,
  )
  assert.deepEqual(f.ledger.readPlan(f.input.id).used, {
    rows_read: 0,
    rows_written: 0,
    requests: 0,
  })
  f.db.close()
})

test("expired continuations inherit spending and unknown reservations without reopening their predecessor", () => {
  const f = fixture()
  try {
    f.ledger.register(f.input)
    f.ledger.reserve(f.step())
    const continuation = { ...f.input, id: "continued", predecessor_id: f.input.id }
    assert.throws(() => f.ledger.register(continuation), /CONTINUATION_NOT_AVAILABLE/)
    f.advance(86_400_000)
    continuation.expires_at += 86_400_000
    assert.throws(
      () =>
        f.ledger.register({
          ...continuation,
          prediction: { ...f.input.prediction, rows_read: 20 },
        }),
      /MUST_PRESERVE_PREDICTION/,
    )
    assert.throws(
      () => f.ledger.register({ ...continuation, principal: "replica" }),
      /MUST_PRESERVE_PREDICTION/,
    )
    const next = f.ledger.register(continuation)
    assert.deepEqual(next.used, { rows_read: 10, rows_written: 2, requests: 1 })
    assert.deepEqual(f.ledger.register(continuation), next)
    assert.throws(
      () => f.ledger.register({ ...continuation, id: "second-successor" }),
      /CONTINUATION_NOT_AVAILABLE/,
    )
    assert.throws(() => f.ledger.reserve(f.step({ step_id: "old-new-step" })), /PLAN_TRIPPED/)
    f.ledger.reserve(f.step({ id: next.id, step_id: "resumed" }))
    assert.throws(
      () => f.ledger.reserve(f.step({ id: next.id, step_id: "too-much" })),
      /TWICE_PREDICTION/,
    )
    assert.equal(f.ledger.readPlan(next.id).used.rows_read, 20)
    // Only today's new work is charged to today's shared allocation. The
    // per-operation limit still contains both days, including unknown work.
    assert.equal(
      f.db.prepare("SELECT rows_read FROM operation_cost_days WHERE day='2026-09-07'").get()
        .rows_read,
      10,
    )
  } finally {
    f.db.close()
  }
})

test("a multi-day forecast never enlarges the daily allocation or resets accumulated spending", () => {
  const f = fixture()
  try {
    const prediction = { rows_read: 100, rows_written: 30_000, requests: 10 }
    let plan = f.ledger.register({ ...f.input, prediction })
    assert.equal(plan.ceiling.rows_written, 60_000)
    for (let day = 0; day < 3; day++) {
      f.ledger.reserve(
        f.step({ id: plan.id, bound: { rows_read: 1, rows_written: 20_000, requests: 1 } }),
      )
      assert.equal(f.ledger.readPlan(plan.id).used.rows_written, (day + 1) * 20_000)
      assert.throws(
        () =>
          f.ledger.reserve(
            f.step({
              id: plan.id,
              step_id: "excess",
              bound: { rows_read: 1, rows_written: 1, requests: 1 },
            }),
          ),
        day === 2 ? /TWICE_PREDICTION/ : /SHARED_DAILY_LIMIT/,
      )
      f.advance(86_400_000)
      plan = f.ledger.register({
        ...f.input,
        prediction,
        id: `day-${day + 2}`,
        predecessor_id: plan.id,
        expires_at: f.readAccountUsage().measured_at + 60_000,
      })
    }
    assert.throws(
      () =>
        f.ledger.reserve(
          f.step({ id: plan.id, bound: { rows_read: 1, rows_written: 1, requests: 1 } }),
        ),
      /TWICE_PREDICTION/,
    )
  } finally {
    f.db.close()
  }
})

test("control traffic shares the request allocation and remains available after execution stops", () => {
  const f = fixture()
  try {
    f.ledger.register(f.input)
    f.db.prepare("UPDATE operation_cost_days SET requests=2399").run()
    f.ledger.recordControlRequest()
    assert.throws(() => f.ledger.reserve(f.step()), /SHARED_DAILY_LIMIT/)
    f.ledger.recordControlRequest()
    assert.equal(f.db.prepare("SELECT requests FROM operation_cost_days").get().requests, 2401)
    f.db.prepare("UPDATE operation_cost_days SET requests=2499").run()
    f.ledger.recordControlRequest()
    assert.throws(() => f.ledger.recordControlRequest(), /SHARED_DAILY_LIMIT/)
    assert.equal(f.db.prepare("SELECT requests FROM operation_cost_days").get().requests, 2500)
  } finally {
    f.db.close()
  }
})

test("a corrected implementation continues within the original prediction instead of resetting spending", () => {
  const f = fixture()
  try {
    f.ledger.register(f.input)
    const permit = f.ledger.reserve(f.step())
    f.ledger.settle({ ...permit, actual: { rows_read: 11, rows_written: 1, requests: 1 } })
    assert.equal(f.ledger.readPlan(f.input.id).status, "tripped")
    const corrected = {
      ...f.input,
      id: "corrected",
      predecessor_id: f.input.id,
      executable_sha256: "d".repeat(64),
    }
    assert.throws(
      () =>
        f.ledger.register({
          ...corrected,
          prediction: { ...corrected.prediction, rows_read: 100 },
        }),
      /MUST_PRESERVE_PREDICTION/,
    )
    const next = f.ledger.register(corrected)
    assert.equal(next.used.rows_read, 11)
    assert.deepEqual(next.ceiling, f.ledger.readPlan(f.input.id).ceiling)
    f.ledger.reserve(
      f.step({
        id: next.id,
        executable_sha256: corrected.executable_sha256,
        bound: { rows_read: 9, rows_written: 0, requests: 1 },
      }),
    )
    assert.throws(
      () =>
        f.ledger.reserve(
          f.step({
            id: next.id,
            step_id: "excess",
            executable_sha256: corrected.executable_sha256,
            bound: { rows_read: 1, rows_written: 0, requests: 1 },
          }),
        ),
      /TWICE_PREDICTION/,
    )
  } finally {
    f.db.close()
  }
})

test("simultaneous callers share reservations; process restart and expiry do not refund unknown work", () => {
  const f = fixture()
  f.ledger.register(f.input)
  f.ledger.reserve(f.step())
  const other = new OperationCostLedger(
    f.storage,
    () => Date.parse("2026-09-06T12:00:00Z"),
    f.readAccountUsage,
  )
  other.reserve(f.step({ step_id: "step-2" }))
  assert.throws(() => other.reserve(f.step({ step_id: "step-3" })), /TWICE_PREDICTION/)
  assert.throws(() => other.reserve(f.step()), /ALREADY_RESERVED/)
  f.advance(61_000)
  assert.throws(() => f.ledger.reserve(f.step({ step_id: "step-4" })), /EXPIRED/)
  assert.equal(f.db.prepare("SELECT rows_read FROM operation_cost_days").get().rows_read, 20)
  f.db.close()
})

test("provider receipts refund unused capacity once; missing or conflicting receipts cannot release a reservation", () => {
  const f = fixture()
  f.ledger.register(f.input)
  const permit = f.ledger.reserve(f.step())
  assert.throws(() => f.ledger.settle(permit), /RECEIPT_REQUIRED/)
  const receipt = { ...permit, actual: { rows_read: 3, rows_written: 1, requests: 1 } }
  f.ledger.settle(receipt)
  f.ledger.settle(receipt)
  assert.equal(f.ledger.readPlan(f.input.id).used.rows_read, 3)
  assert.throws(
    () => f.ledger.settle({ ...receipt, actual: { ...receipt.actual, rows_read: 0 } }),
    /IMMUTABLE/,
  )
  assert.throws(() => f.ledger.reserve(f.step()), /ALREADY_RESERVED/)
  f.db.close()
})

test("a defective bound is charged in full, trips the plan and blocks further dispatch", () => {
  const f = fixture()
  f.ledger.register(f.input)
  const permit = f.ledger.reserve(f.step())
  const result = f.ledger.settle({
    ...permit,
    actual: { rows_read: 30, rows_written: 0, requests: 1 },
  })
  assert.equal(result.status, "tripped")
  assert.equal(f.db.prepare("SELECT rows_read FROM operation_cost_days").get().rows_read, 30)
  assert.throws(() => f.ledger.reserve(f.step({ step_id: "next" })), /TRIPPED/)
  f.ledger.register({ ...f.input, id: "replacement" })
  assert.throws(() => f.ledger.reserve(f.step({ id: "replacement" })), /BOUND_INVALIDATED/)
  f.ledger.register({ ...f.input, id: "corrected", executable_sha256: "d".repeat(64) })
  f.ledger.reserve(f.step({ id: "corrected", executable_sha256: "d".repeat(64) }))
  f.db.close()
})

test("absent, stale, future or exhausted account telemetry causes zero reservations", () => {
  const f = fixture()
  f.ledger.register(f.input)
  const fresh = f.readAccountUsage()
  for (const snapshot of [
    null,
    { ...fresh, measured_at: fresh.measured_at - 60_001 },
    { ...fresh, measured_at: fresh.measured_at + 1 },
    { ...fresh, day: "2026-09-05" },
    { ...fresh, rows_read: NaN },
  ]) {
    f.ledger.readAccountUsage = () => snapshot
    assert.throws(() => f.ledger.reserve(f.step()), /ACCOUNT_USAGE_UNAVAILABLE/)
  }
  for (const snapshot of [
    { ...fresh, rows_read: 3_500_000 },
    { ...fresh, rows_written: 70_000 },
    { ...fresh, requests: 75_000 },
  ]) {
    f.ledger.readAccountUsage = () => snapshot
    assert.throws(() => f.ledger.reserve(f.step()), /ACCOUNT_HEADROOM_LIMIT/)
  }
  assert.deepEqual(f.ledger.readPlan(f.input.id).used, {
    rows_read: 0,
    rows_written: 0,
    requests: 0,
  })
  f.db.close()
})

test("different operations cannot each claim the same remaining daily allocation", () => {
  const f = fixture()
  for (let i = 0; i < 2; i++) {
    f.ledger.register({
      ...f.input,
      id: `operation-${i}`,
      prediction: { rows_read: 500_000, rows_written: 0, requests: 1 },
    })
    f.ledger.reserve(
      f.step({ id: `operation-${i}`, bound: { rows_read: 500_000, rows_written: 0, requests: 1 } }),
    )
  }
  f.ledger.register({ ...f.input, id: "operation-3" })
  assert.throws(() => f.ledger.reserve(f.step({ id: "operation-3" })), /SHARED_DAILY_LIMIT/)
  f.db.close()
})

test("earlier spending in the existing authority ledger cannot become a second allowance during cutover", () => {
  const f = fixture()
  f.ledger.register(f.input)
  f.ledger.readOtherUsage = () => ({ rows_read: 999_995, rows_written: 0, requests: 0 })
  assert.throws(() => f.ledger.reserve(f.step()), /SHARED_DAILY_LIMIT/)
  f.ledger.readOtherUsage = () => null
  assert.throws(() => f.ledger.reserve(f.step()), /SHARED_USAGE_UNAVAILABLE/)
  assert.equal(f.ledger.readPlan(f.input.id).used.requests, 0)
  f.db.close()
})

test("account usage high-water survives authority restart and never trusts a future sample", () => {
  const f = fixture()
  f.ledger.rememberAccountUsage({ ...f.readAccountUsage(), rows_read: 500 })
  const restarted = new OperationCostLedger(f.storage, () => Date.parse("2026-09-06T12:00:00Z"))
  restarted.rememberAccountUsage({ ...f.readAccountUsage(), rows_read: 100 })
  assert.equal(restarted.storedAccountUsage().rows_read, 500)
  assert.throws(
    () =>
      restarted.rememberAccountUsage({
        ...f.readAccountUsage(),
        measured_at: Date.parse("2026-09-06T12:00:01Z"),
      }),
    /UNAVAILABLE/,
  )
  f.db.close()
})

test("prediction identities are immutable and invalid numeric inputs fail closed", () => {
  const f = fixture()
  f.ledger.register(f.input)
  f.ledger.register(f.input)
  assert.throws(
    () => f.ledger.register({ ...f.input, prediction: { ...f.input.prediction, rows_read: 20 } }),
    /IMMUTABLE/,
  )
  for (const value of [undefined, null, NaN, Infinity, -1, 1.5, "10"]) {
    assert.throws(
      () => f.ledger.reserve(f.step({ bound: { rows_read: value, rows_written: 0, requests: 1 } })),
      /VECTOR_INVALID/,
    )
  }
  assert.throws(() => f.ledger.reserve(f.step({ step_id: "__proto__" })), /ID_INVALID/)
  assert.equal(f.db.prepare("SELECT registrations FROM operation_cost_days").get().registrations, 1)
  f.db.close()
})

function executorFixture(f, dispatch) {
  const adapter = {
    ...f.input,
    prepare: () => ({
      sha256: "c".repeat(64),
      bound: { rows_read: 10, rows_written: 0, requests: 1 },
    }),
    dispatch,
  }
  return new OperationCostExecutor({
    ledger: f.ledger,
    adapters: new Map([["verified-read", adapter]]),
  })
}

test("executor makes zero provider calls for missing predictions, unknown operations and caller-invented bounds", async () => {
  const f = fixture()
  let calls = 0
  const executor = executorFixture(f, async () => {
    calls++
    return {}
  })
  const input = { operation_id: f.input.id, adapter_id: "verified-read", step_id: "first" }
  await assert.rejects(executor.execute(input), /NOT_REGISTERED/)
  f.ledger.register({ ...f.input, prediction: { rows_read: 4, rows_written: 0, requests: 1 } })
  await assert.rejects(executor.execute({ ...input, adapter_id: "arbitrary-sql" }), /NOT_VERIFIED/)
  await assert.rejects(
    executor.execute({ ...input, bound: { rows_read: 0, rows_written: 0, requests: 1 } }),
    /TWICE_PREDICTION/,
  )
  assert.equal(calls, 0)
  f.db.close()
})

test("executor reserves all concurrent work before sending and reports actual cost", async () => {
  const f = fixture()
  f.ledger.register(f.input)
  const complete = []
  let calls = 0
  const executor = executorFixture(f, () => {
    calls++
    return new Promise((resolve) =>
      complete.push(() =>
        resolve({ result: "data", actual: { rows_read: 3, rows_written: 0, requests: 1 } }),
      ),
    )
  })
  const input = { operation_id: f.input.id, adapter_id: "verified-read" }
  const first = executor.execute({ ...input, step_id: "one" })
  const second = executor.execute({ ...input, step_id: "two" })
  await assert.rejects(executor.execute({ ...input, step_id: "three" }), /TWICE_PREDICTION/)
  assert.equal(calls, 2)
  complete.forEach((finish) => finish())
  await Promise.all([first, second])
  assert.equal(f.ledger.readPlan(f.input.id).used.rows_read, 6)
  f.db.close()
})

test("a transport failure or absent provider usage cannot erase the reservation or trigger a replay", async () => {
  for (const dispatch of [
    async () => {
      throw new Error("transport timeout")
    },
    async () => ({ result: "data" }),
  ]) {
    const f = fixture()
    f.ledger.register(f.input)
    const executor = executorFixture(f, dispatch)
    const input = { operation_id: f.input.id, adapter_id: "verified-read", step_id: "one" }
    await assert.rejects(executor.execute(input))
    assert.equal(f.ledger.readPlan(f.input.id).used.rows_read, 10)
    await assert.rejects(executor.execute(input), /ALREADY_RESERVED/)
    f.db.close()
  }
})
