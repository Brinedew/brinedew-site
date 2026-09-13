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

function enableKv(f, overrides = {}) {
  f.ledger.readAccountUsage = () => ({
    ...f.readAccountUsage(),
    kv_measured_at: f.readAccountUsage().measured_at,
    kv_reads: 0,
    kv_writes: 0,
    kv_deletes: 0,
    kv_lists: 0,
    ...overrides,
  })
}

function durableSqlOperation(f, id = "durable-sql", writes = 100) {
  const input = {
    ...f.input,
    id,
    prediction: {
      rows_read: 0,
      rows_written: 0,
      requests: 2,
      do_rows_read: 100,
      do_rows_written: writes,
    },
  }
  const bound = {
    rows_read: 0,
    rows_written: 0,
    requests: 1,
    do_rows_read: 100,
    do_rows_written: writes,
  }
  return { input, bound, step: { ...f.step({ id, bound }), id } }
}

function enableDurableSql(f, overrides = {}) {
  f.ledger.readAccountUsage = () => ({
    ...f.readAccountUsage(),
    do_sql_measured_at: f.readAccountUsage().measured_at,
    do_rows_read: 0,
    do_rows_written: 0,
    ...overrides,
  })
}

test("concurrent Durable Object work shares the original authority and retains an uncertain dispatch", async () => {
  const f = fixture()
  try {
    enableDurableSql(f)
    const operations = [
      durableSqlOperation(f, "first", 12000),
      durableSqlOperation(f, "second", 12000),
    ]
    for (const operation of operations) f.ledger.register(operation.input)
    let dispatched = 0
    const executor = new OperationCostExecutor({
      ledger: f.ledger,
      adapters: new Map([
        [
          f.input.adapter_id,
          {
            ...f.input,
            prepare: async () => ({ bound: operations[0].bound, sha256: "c".repeat(64) }),
            dispatch: async () => {
              dispatched++
              throw new Error("response lost after actual work")
            },
          },
        ],
      ]),
    })
    const outcomes = await Promise.allSettled(
      operations.map(({ input }) =>
        executor.execute({
          operation_id: input.id,
          adapter_id: input.adapter_id,
          step_id: "seed-page-1",
          arguments: {},
        }),
      ),
    )
    assert.equal(dispatched, 1)
    assert.match(outcomes[0].reason.message, /response lost/)
    assert.match(outcomes[1].reason.message, /COST_SHARED_DAILY_LIMIT/)
    assert.equal(f.ledger.durableSqlDayUsage(f.ledger.day()).do_rows_written, 12000)
    const retained = f.ledger.readPlan("first")
    const restarted = new OperationCostLedger(f.storage, f.ledger.now, f.ledger.readAccountUsage)
    restarted.initialize()
    assert.deepEqual(restarted.readPlan("first"), retained)
    assert.throws(() => restarted.reserve(operations[0].step), /COST_SHARED_DAILY_LIMIT/)
    assert.equal(restarted.durableSqlDayUsage(restarted.day()).do_rows_written, 12000)
    assert.throws(
      () => restarted.reserve({ ...operations[0].step, step_id: "seed-page-1" }),
      /COST_STEP_ALREADY_RESERVED/,
    )
    assert.equal(restarted.capacitySnapshot().durable_sql.remaining.do_rows_written, 8000)
  } finally {
    f.db.close()
  }
})

test("Durable SQL admission fails before dispatch for missing predictions or invalid telemetry", async () => {
  const f = fixture()
  try {
    const op = durableSqlOperation(f)
    let refreshes = 0
    let dispatches = 0
    const executor = new OperationCostExecutor({
      ledger: f.ledger,
      beforeReserve: async () => {
        refreshes++
      },
      adapters: new Map([
        [
          f.input.adapter_id,
          {
            ...f.input,
            prepare: async () => ({ bound: op.bound, sha256: "c".repeat(64) }),
            dispatch: async () => {
              dispatches++
              return { actual: op.bound, result: "complete" }
            },
          },
        ],
      ]),
    })
    f.ledger.register(f.input)
    await assert.rejects(
      executor.execute({
        operation_id: f.input.id,
        adapter_id: f.input.adapter_id,
        step_id: "first",
        arguments: {},
      }),
      /COST_TWICE_PREDICTION_LIMIT/,
    )
    assert.equal(refreshes, 0)
    f.ledger.register(op.input)
    for (const invalid of [
      { do_sql_measured_at: undefined },
      { do_rows_written: undefined },
      { do_rows_read: -1 },
      { do_sql_measured_at: f.readAccountUsage().measured_at - 60001 },
      { do_sql_measured_at: f.readAccountUsage().measured_at + 1 },
      { do_rows_written: 80000 },
    ]) {
      enableDurableSql(f, invalid)
      await assert.rejects(
        executor.execute({
          operation_id: op.input.id,
          adapter_id: op.input.adapter_id,
          step_id: "first",
          arguments: {},
        }),
        /COST_ACCOUNT_(USAGE_UNAVAILABLE|HEADROOM_LIMIT)/,
      )
      assert.deepEqual(f.ledger.readPlan(op.input.id).steps, {})
    }
    assert.equal(dispatches, 0)
    // A D1 write outage must not block a proven zero-D1 capability's repair path.
    enableDurableSql(f, { rows_written: 100000 })
    const completed = await executor.execute({
      operation_id: op.input.id,
      adapter_id: op.input.adapter_id,
      step_id: "first",
      arguments: {},
    })
    assert.equal(completed.result, "complete")
    assert.equal(dispatches, 1)
    assert.equal(completed.usage.do_rows_written, 100)
  } finally {
    f.db.close()
  }
})

test("Durable SQL receipts cannot omit a dimension, refund uncertainty or conceal an invalid bound", () => {
  const f = fixture()
  try {
    enableDurableSql(f)
    const op = durableSqlOperation(f)
    f.ledger.register(op.input)
    const permit = f.ledger.reserve(op.step)
    assert.throws(
      () => f.ledger.settle({ ...permit, actual: { rows_read: 0, rows_written: 0, requests: 1 } }),
      /COST_RECEIPT_REQUIRED/,
    )
    assert.equal(f.ledger.durableSqlDayUsage(f.ledger.day()).do_rows_written, 100)
    const actual = { ...op.bound, do_rows_written: 101 }
    const tripped = f.ledger.settle({ ...permit, actual })
    assert.equal(tripped.status, "tripped")
    assert.equal(f.ledger.durableSqlDayUsage(f.ledger.day()).do_rows_written, 101)
    assert.deepEqual(f.ledger.settle({ ...permit, actual }), tripped)
    assert.throws(() => f.ledger.settle({ ...permit, actual: op.bound }), /COST_RECEIPT_IMMUTABLE/)
    const other = durableSqlOperation(f, "same-bad-code")
    f.ledger.register(other.input)
    assert.throws(() => f.ledger.reserve(other.step), /COST_VERIFIED_BOUND_INVALIDATED/)
  } finally {
    f.db.close()
  }
})

test("Durable SQL reservation and plan ceiling survive reset, restart and a linked continuation", () => {
  const f = fixture()
  try {
    enableDurableSql(f)
    const op = durableSqlOperation(f)
    f.ledger.register(op.input)
    f.ledger.reserve(op.step)
    const original = f.ledger.readPlan(op.input.id)
    const priorDay = f.ledger.day()
    f.advance(86400000)
    const continuation = f.ledger.register({
      ...op.input,
      id: "continued",
      predecessor_id: op.input.id,
      expires_at: f.readAccountUsage().measured_at + 60000,
    })
    assert.deepEqual(continuation.used, original.used)
    assert.deepEqual(continuation.ceiling, original.ceiling)
    assert.equal(f.ledger.durableSqlDayUsage(priorDay).do_rows_written, 100)
    assert.equal(f.ledger.durableSqlDayUsage(f.ledger.day()).do_rows_written, 0)
    f.ledger.reserve({ ...op.step, id: "continued", step_id: "next" })
    assert.throws(
      () => f.ledger.reserve({ ...op.step, id: "continued", step_id: "extra" }),
      /COST_TWICE_PREDICTION_LIMIT/,
    )
  } finally {
    f.db.close()
  }
})

test("Durable SQL telemetry retains high water across restart without rewriting existing plans", () => {
  const f = fixture()
  try {
    f.ledger.register(f.input)
    f.ledger.reserve(f.step())
    const original = f.db
      .prepare("SELECT document FROM operation_cost_plans WHERE id=?")
      .get(f.input.id).document
    f.db.exec(
      "DROP TABLE operation_cost_do_sql_days; DROP TABLE operation_cost_do_sql_account_usage",
    )
    f.ledger.initialize()
    assert.equal(
      f.db.prepare("SELECT document FROM operation_cost_plans WHERE id=?").get(f.input.id).document,
      original,
    )
    const sample = {
      ...f.readAccountUsage(),
      do_sql_measured_at: f.readAccountUsage().measured_at,
      do_rows_read: 4000000,
      do_rows_written: 70000,
    }
    f.ledger.rememberAccountUsage(sample)
    const changes = f.db.prepare("SELECT total_changes() AS n").get().n
    f.ledger.rememberAccountUsage({ ...sample, do_rows_read: 10, do_rows_written: 5 })
    assert.equal(f.db.prepare("SELECT total_changes() AS n").get().n, changes)
    const restarted = new OperationCostLedger(f.storage, f.ledger.now)
    restarted.initialize()
    assert.equal(restarted.storedAccountUsage().do_rows_read, 4000000)
    assert.equal(restarted.storedAccountUsage().do_rows_written, 70000)
    assert.equal(
      f.db.prepare("SELECT document FROM operation_cost_plans WHERE id=?").get(f.input.id).document,
      original,
    )
  } finally {
    f.db.close()
  }
})

test("capacity includes retained uncertain reservations and legacy usage without refunding either", () => {
  const f = fixture()
  try {
    f.ledger.register(f.input)
    f.ledger.reserve(f.step())
    f.ledger.readOtherUsage = () => ({ rows_read: 123, rows_written: 7, requests: 5 })
    const before = f.ledger.readPlan(f.input.id)
    const snapshot = f.ledger.capacitySnapshot()
    assert.equal(snapshot.used.rows_read, 133)
    assert.equal(snapshot.used.rows_written, 9)
    assert.equal(snapshot.remaining.rows_read, 1_000_000 - 133)
    assert.equal(snapshot.remaining.rows_written, 20_000 - 9)
    assert.equal(snapshot.limits.requests, 2400)
    assert.deepEqual(f.ledger.readPlan(f.input.id), before)
    f.ledger.readOtherUsage = () => ({ rows_read: NaN, rows_written: 0, requests: 0 })
    assert.throws(() => f.ledger.capacitySnapshot(), /COST_SHARED_USAGE_UNAVAILABLE/)
  } finally {
    f.db.close()
  }
})

test("capacity breakdown separates settled receipts, retained reservations, legacy usage and unreceipted control work", () => {
  const f = fixture()
  try {
    f.ledger.register(f.input)
    const settled = f.ledger.reserve(f.step())
    f.ledger.settle({
      ...settled,
      actual: { rows_read: 3, rows_written: 1, requests: 1 },
    })
    f.ledger.register({ ...f.input, id: "operation-2" })
    f.ledger.reserve(
      f.step({
        id: "operation-2",
        step_id: "step-2",
        step_sha256: "d".repeat(64),
        bound: { rows_read: 5, rows_written: 0, requests: 1 },
      }),
    )
    f.ledger.recordControlRequest()
    f.ledger.readOtherUsage = () => ({ rows_read: 7, rows_written: 4, requests: 9 })

    const snapshot = f.ledger.capacitySnapshot()
    assert.deepEqual(snapshot.breakdown, {
      operation_charged: { rows_read: 8, rows_written: 1, requests: 3 },
      settled_actual: { rows_read: 3, rows_written: 1, requests: 1 },
      outstanding_reservations: { rows_read: 5, rows_written: 0, requests: 1 },
      operator_unattributed: { rows_read: 0, rows_written: 0, requests: 1 },
      legacy_usage: { rows_read: 7, rows_written: 4, requests: 9 },
      unknown_remainder: { rows_read: 0, rows_written: 0, requests: 1 },
      invalid_plan_steps: 0,
    })
    assert.deepEqual(snapshot.used, { rows_read: 15, rows_written: 5, requests: 12 })
  } finally {
    f.db.close()
  }
})

test("capacity breakdown does not re-charge inherited predecessor spending", () => {
  const f = fixture()
  try {
    const predecessor = f.ledger.register(f.input)
    const reserved = f.ledger.reserve(f.step())
    f.ledger.settle({
      ...reserved,
      actual: { rows_read: 4, rows_written: 1, requests: 1 },
    })
    f.advance(24 * 60 * 60 * 1000)
    const continuation = f.ledger.register({
      ...f.input,
      id: "operation-2",
      predecessor_id: predecessor.id,
      expires_at: Date.parse("2026-09-07T12:01:00Z"),
    })
    assert.equal(continuation.used.rows_read, 4)
    assert.deepEqual(f.ledger.capacitySnapshot().breakdown, {
      operation_charged: { rows_read: 0, rows_written: 0, requests: 0 },
      settled_actual: { rows_read: 0, rows_written: 0, requests: 0 },
      outstanding_reservations: { rows_read: 0, rows_written: 0, requests: 0 },
      operator_unattributed: { rows_read: 0, rows_written: 0, requests: 0 },
      legacy_usage: { rows_read: 0, rows_written: 0, requests: 0 },
      unknown_remainder: { rows_read: 0, rows_written: 0, requests: 0 },
      invalid_plan_steps: 0,
    })
  } finally {
    f.db.close()
  }
})

test("KV operations share one atomic allowance and failures cannot spend the D1 request counter", () => {
  const f = fixture()
  try {
    enableKv(f)
    for (let i = 0; i < 2; i++) {
      f.ledger.register({
        ...f.input,
        id: `kv-${i}`,
        prediction: { ...f.input.prediction, kv_writes: 50 },
      })
      f.ledger.reserve(
        f.step({
          id: `kv-${i}`,
          bound: { rows_read: 0, rows_written: 0, requests: 1, kv_writes: 100 },
        }),
      )
    }
    f.ledger.register({
      ...f.input,
      id: "kv-full",
      prediction: { ...f.input.prediction, kv_writes: 1 },
    })
    const before = f.db.prepare("SELECT requests FROM operation_cost_days").get().requests
    assert.throws(
      () =>
        f.ledger.reserve(
          f.step({
            id: "kv-full",
            bound: { rows_read: 0, rows_written: 0, requests: 1, kv_writes: 1 },
          }),
        ),
      /SHARED_DAILY_LIMIT/,
    )
    assert.equal(f.ledger.kvDayUsage("2026-09-06").kv_writes, 200)
    assert.equal(f.db.prepare("SELECT requests FROM operation_cost_days").get().requests, before)
    assert.equal(f.ledger.readPlan("kv-full").used.requests, 0)
  } finally {
    f.db.close()
  }
})

test("KV admission rejects stale, missing, exhausted and underestimated dimensions before reservation", () => {
  const f = fixture()
  try {
    f.ledger.register({ ...f.input, prediction: { ...f.input.prediction, kv_writes: 1 } })
    const step = f.step({ bound: { rows_read: 0, rows_written: 0, requests: 1, kv_writes: 1 } })
    assert.throws(() => f.ledger.reserve(step), /ACCOUNT_USAGE_UNAVAILABLE/)
    enableKv(f, { kv_measured_at: f.readAccountUsage().measured_at - 60001 })
    assert.throws(() => f.ledger.reserve(step), /ACCOUNT_USAGE_UNAVAILABLE/)
    enableKv(f, { kv_writes: 700 })
    assert.throws(() => f.ledger.reserve(step), /ACCOUNT_HEADROOM_LIMIT/)
    enableKv(f)
    assert.throws(
      () => f.ledger.reserve({ ...step, bound: { ...step.bound, kv_writes: 3 } }),
      /TWICE_PREDICTION_LIMIT/,
    )
    assert.equal(f.ledger.kvDayUsage("2026-09-06").kv_writes, 0)
    assert.equal(f.ledger.readPlan(f.input.id).used.requests, 0)
  } finally {
    f.db.close()
  }
})

test("KV unknown spending and account high-water survive restart; only complete receipts settle", () => {
  const f = fixture()
  try {
    enableKv(f)
    f.ledger.register({ ...f.input, prediction: { ...f.input.prediction, kv_writes: 50 } })
    const permit = f.ledger.reserve(
      f.step({ bound: { rows_read: 0, rows_written: 0, requests: 1, kv_writes: 100 } }),
    )
    const actual = { rows_read: 0, rows_written: 0, requests: 1 }
    assert.throws(() => f.ledger.settle({ ...permit, actual }), /RECEIPT_REQUIRED/)
    const restarted = new OperationCostLedger(f.storage, () => f.readAccountUsage().measured_at)
    restarted.initialize()
    assert.equal(restarted.kvDayUsage("2026-09-06").kv_writes, 100)
    restarted.settle({ ...permit, actual: { ...actual, kv_writes: 60 } })
    assert.equal(restarted.kvDayUsage("2026-09-06").kv_writes, 60)
    assert.throws(
      () => restarted.settle({ ...permit, actual: { ...actual, kv_writes: 0 } }),
      /RECEIPT_IMMUTABLE/,
    )
    const sample = {
      ...f.readAccountUsage(),
      kv_reads: 0,
      kv_writes: 400,
      kv_deletes: 0,
      kv_lists: 0,
    }
    restarted.rememberAccountUsage(sample)
    restarted.rememberAccountUsage({ ...sample, kv_writes: 10 })
    assert.equal(restarted.storedAccountUsage().kv_writes, 400)
  } finally {
    f.db.close()
  }
})

test("cached KV telemetry adds no storage writes and auxiliary days share receipt retention", () => {
  const f = fixture()
  try {
    const sample = {
      ...f.readAccountUsage(),
      kv_measured_at: f.readAccountUsage().measured_at,
      kv_reads: 100,
      kv_writes: 10,
      kv_deletes: 0,
      kv_lists: 0,
    }
    f.ledger.rememberAccountUsage(sample)
    const writes = () => f.db.prepare("SELECT total_changes() AS n").get().n
    const before = writes()
    f.ledger.rememberAccountUsage(sample)
    f.ledger.rememberAccountUsage({ ...sample, kv_reads: 50 })
    assert.equal(writes(), before)
    assert.equal(f.ledger.storedAccountUsage().kv_reads, 100)
    f.db.prepare("INSERT INTO operation_cost_kv_days VALUES (?,?)").run("2026-08-20", "{}")
    f.db
      .prepare("INSERT INTO operation_cost_kv_account_usage VALUES (?,?,?)")
      .run("2026-08-20", 0, "{}")
    f.ledger.register(f.input)
    assert.equal(
      f.db.prepare("SELECT COUNT(*) AS n FROM operation_cost_kv_days WHERE day='2026-08-20'").get()
        .n,
      0,
    )
    assert.equal(
      f.db
        .prepare("SELECT COUNT(*) AS n FROM operation_cost_kv_account_usage WHERE day='2026-08-20'")
        .get().n,
      0,
    )
    assert.equal(f.ledger.storedAccountUsage().kv_reads, 100)
  } finally {
    f.db.close()
  }
})

test("adding KV tables preserves existing D1 plan bytes and spending", () => {
  const f = fixture()
  try {
    f.ledger.register(f.input)
    f.ledger.reserve(f.step())
    const before = f.db.prepare("SELECT document FROM operation_cost_plans").get().document
    f.db.exec("DROP TABLE operation_cost_kv_days; DROP TABLE operation_cost_kv_account_usage")
    f.ledger.initialize()
    assert.equal(f.db.prepare("SELECT document FROM operation_cost_plans").get().document, before)
    assert.equal(f.db.prepare("SELECT rows_read FROM operation_cost_days").get().rows_read, 10)
  } finally {
    f.db.close()
  }
})

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
