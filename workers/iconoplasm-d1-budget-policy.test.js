import assert from "node:assert/strict"
import test from "node:test"
import {
  accountUsage,
  criticalityShareLimit,
  d1CriticalityShedBy,
} from "../shared/iconoplasm-d1-budget-policy.js"
import { IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

// B-1026, 2026-10-09: one wall per meter, Cloudflare's daily allowance, measured on
// the whole account. The private operator slice (1M reads, 70k writes) and the
// paid-plan monthly smoothing are gone.

function governor(today, sample = null) {
  const owner = Object.create(IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate.prototype)
  owner.usageRow = () => today
  owner.cycleUsageRow = () => today
  owner.mutationReservations = { snapshot: () => ({}) }
  owner.providerObservationCache = sample
  return owner
}

test("the governor's wall is Cloudflare's daily allowance, not a private slice", () => {
  const full = governor({ rows_read: 0, rows_written: 100_000 }).snapshot(
    "2026-10-09",
    "2026-10-09",
    {},
    1,
  )
  assert.equal(full.rows_written_daily_limit, 100_000)
  assert.equal(full.rows_read_daily_limit, 5_000_000)
  assert.equal(full.rows_written_daily_remaining, 0)
  assert.equal(full.exhausted, true)
  assert.equal(full.exhausted_by, "rows_written_daily")

  // 1.2M of our own reads used to be past the 1M slice; it is a quarter of the day.
  const busy = governor({ rows_read: 1_200_000, rows_written: 0 }).snapshot(
    "2026-10-09",
    "2026-10-09",
    {},
    1,
  )
  assert.equal(busy.exhausted, false)
  assert.equal(busy.rows_read_daily_remaining, 3_800_000)
})

test("the account's use is Cloudflare's sample plus our own tally since it", () => {
  const sample = {
    ok: true,
    day_key: "2026-10-09",
    rows_read: 3_000_000,
    rows_written: 50_000,
    local_rows_read: 100_000,
    local_rows_written: 10_000,
    observed_at: "2026-10-09T12:00:00.000Z",
  }
  const snapshot = governor({ rows_read: 150_000, rows_written: 12_000 }, sample).snapshot(
    "2026-10-09",
    "2026-10-09",
    {},
    1,
  )
  assert.equal(snapshot.account_rows_read, 3_050_000)
  assert.equal(snapshot.account_rows_written, 52_000)
  assert.equal(snapshot.rows_read_daily_remaining, 1_950_000)
  // Readers took the account past 60%: diagnostics shed, batch and deliveries run.
  assert.equal(d1CriticalityShedBy(snapshot, "sheddable"), "rows_read_sheddable")
  assert.equal(d1CriticalityShedBy(snapshot, "sheddable_plus"), null)
  assert.equal(d1CriticalityShedBy(snapshot, "critical"), null)

  // Yesterday's sample is not today's.
  const stale = governor(
    { rows_read: 150_000, rows_written: 0 },
    { ...sample, day_key: "2026-10-08" },
  )
  assert.equal(stale.snapshot("2026-10-09", "2026-10-09", {}, 1).account_rows_read, 150_000)
})

test("account usage never falls below our own tally, and without a sample it is our tally", () => {
  assert.equal(accountUsage(500, undefined, 0), 500)
  assert.equal(accountUsage(500, Number.NaN, 0), 500)
  assert.equal(accountUsage(500, 100, 400), 500)
  assert.equal(accountUsage(500, 2_000, 400), 2_100)
})

test("tier shares are shares of Cloudflare's daily allowance", () => {
  assert.equal(criticalityShareLimit(5_000_000, "sheddable"), 3_000_000)
  assert.equal(criticalityShareLimit(5_000_000, "sheddable_plus"), 4_250_000)
  assert.equal(criticalityShareLimit(5_000_000, "critical"), 5_000_000)
})
