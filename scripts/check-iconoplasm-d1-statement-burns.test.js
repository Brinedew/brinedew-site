import assert from "node:assert/strict"
import test from "node:test"
import {
  statementBurnViolations,
  statementBurnWindow,
} from "./check-iconoplasm-d1-statement-burns.mjs"

const row = (reads, returned, query = "SELECT 1") => ({
  dimensions: { databaseId: "e7b2e2ca-8fa4-4a0a-bae1-9917912aa7ff", query },
  sum: { rowsRead: reads, rowsReturned: returned },
})

test("flags any statement at or above the absolute cap", () => {
  const violations = statementBurnViolations([row(700000, 0), row(100, 100)], { cap: 500000 })
  assert.equal(violations.length, 1)
  assert.equal(violations[0].reads, 700000)
  assert.equal(violations[0].returned, 0)
})

test("case-21: an unseen shape is flagged by measurement alone", () => {
  const novel = row(890000, 12, "SELECT weird FROM some_new_table WHERE something_new = ?")
  const violations = statementBurnViolations([novel], { cap: 500000 })
  assert.equal(violations.length, 1)
  assert.match(violations[0].query, /some_new_table/)
})

test("tolerates empty and invalid results", () => {
  assert.deepEqual(statementBurnViolations([], { cap: 500000 }), [])
  assert.deepEqual(statementBurnViolations(null, { cap: 500000 }), [])
  assert.throws(() => statementBurnViolations([], { cap: 0 }), /D1_STATEMENT_BURN_CAP_INVALID/)
})

// 2026-09-24: #264 fixed a 1.63M-read picker query at 05:32Z, but the watch
// summed the whole UTC day, so it stayed red for 18 more hours and hid any new
// burn behind the old one. The watch now reads a trailing window.
test("the window trails now, so a fixed burn ages out", () => {
  const now = Date.parse("2026-09-24T17:30:00Z")
  const window = statementBurnWindow({ now, hours: 6 })
  assert.equal(window.until, "2026-09-24T17:30:00Z")
  assert.equal(window.since, "2026-09-24T11:30:00Z")
  assert.ok(Date.parse("2026-09-24T05:32:00Z") < Date.parse(window.since))
})

test("the window cap still trips a steady 500k/day leak and any burst", () => {
  const window = statementBurnWindow({ now: Date.now(), hours: 6, dailyCap: 500000 })
  assert.equal(window.cap, 125000)
  const steadyLeakInWindow = (500000 / 24) * 6
  assert.equal(statementBurnViolations([row(steadyLeakInWindow, 0)], window).length, 1)
  assert.equal(statementBurnViolations([row(1631585, 180)], window).length, 1)
  assert.equal(statementBurnViolations([row(124999, 180)], window).length, 0)
})

test("an invalid window fails closed instead of watching nothing", () => {
  assert.throws(() => statementBurnWindow({ now: Date.now(), hours: 0 }), /WINDOW_INVALID/)
  assert.throws(() => statementBurnWindow({ now: Date.now(), hours: 25 }), /WINDOW_INVALID/)
  assert.throws(() => statementBurnWindow({ now: Number.NaN, hours: 6 }), /WINDOW_INVALID/)
})
