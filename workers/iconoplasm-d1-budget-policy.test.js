import assert from "node:assert/strict"
import test from "node:test"
import { d1DailyAllowance } from "../shared/iconoplasm-d1-budget-policy.js"
import { IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

test("historical paid-sized monthly budgets cannot raise the current Free daily wall", () => {
  assert.equal(
    d1DailyAllowance({
      resource: "reads",
      monthlyLimit: 24_000_000_000,
      daysRemaining: 1,
      burstMultiplier: 3,
    }),
    5_000_000,
  )
  assert.equal(
    d1DailyAllowance({
      resource: "writes",
      monthlyLimit: 40_000_000,
      daysRemaining: 1,
      burstMultiplier: 3,
    }),
    100_000,
  )
})

test("missing monthly allocation is still subject to Free daily quotas", () => {
  assert.equal(d1DailyAllowance({ resource: "reads" }), 5_000_000)
  assert.equal(d1DailyAllowance({ resource: "writes" }), 100_000)
  assert.throws(() => d1DailyAllowance({ resource: "requests" }), /Unknown D1/)
})

test("a smaller or exhausted product allocation remains binding", () => {
  assert.equal(
    d1DailyAllowance({
      resource: "writes",
      monthlyLimit: 1000,
      usedBeforeDay: 900,
      daysRemaining: 10,
      burstMultiplier: 3,
    }),
    30,
  )
  assert.equal(d1DailyAllowance({ resource: "writes", monthlyLimit: 1000, usedBeforeDay: 1000 }), 0)
})

test("the actual governor exposes and exhausts the capped allowance, not just the cost model", () => {
  const governor = Object.create(IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate.prototype)
  let today = { rows_read: 0, rows_written: 100_000 }
  governor.usageRow = () => today
  governor.cycleUsageRow = () => ({ rows_read: 20_000_000, rows_written: 1_000_000 })
  const budgets = {
    rowsReadMonthlyLimit: 24_000_000_000,
    rowsWrittenMonthlyLimit: 40_000_000,
    dailyBurstMultiplier: 3,
  }
  const exhausted = governor.snapshot("2026-08-27", "2026-08-07", budgets, 11)
  assert.equal(exhausted.rows_written_daily_smart_limit, 100_000)
  assert.equal(exhausted.rows_read_daily_smart_limit, 5_000_000)
  assert.equal(exhausted.rows_written_daily_remaining, 0)
  assert.equal(exhausted.exhausted, true)
  today = { rows_read: 0, rows_written: 0 }
  const nextDay = governor.snapshot("2026-08-28", "2026-08-07", budgets, 10)
  assert.equal(nextDay.rows_written_daily_remaining, 100_000)
  assert.equal(nextDay.exhausted, false)
})
