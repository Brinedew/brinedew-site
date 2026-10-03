import assert from "node:assert/strict"
import test from "node:test"

import {
  isD1DailyRowReadLimitError,
  secondsUntilCloudflareDailyReset,
} from "./lib/cloudflare-availability.js"

test("recognizes Cloudflare's daily D1 row-read exhaustion through wrapped errors", () => {
  const cause = new Error(
    "D1_ERROR: Your account has exceeded D1's free tier daily row read limit.",
  )
  assert.equal(isD1DailyRowReadLimitError(new Error("query failed", { cause })), true)
  assert.equal(isD1DailyRowReadLimitError(new Error("D1 database unavailable")), false)
})

test("retry-after targets five seconds after the next midnight UTC reset", () => {
  const now = Date.parse("2026-09-01T18:04:31.000Z")
  assert.equal(secondsUntilCloudflareDailyReset(now), 21_334)
})

// The one "seconds until the UTC day rolls over" function. Callers whose day rolls over exactly
// at 00:00:00 UTC (the vote budget, the browser-render budget) pass a margin of 0.
test("the seconds to midnight UTC are exact with no margin and round up", () => {
  const at = (iso) => secondsUntilCloudflareDailyReset(Date.parse(iso), 0)
  assert.equal(at("2026-10-03T18:04:31.000Z"), 21_329)
  assert.equal(at("2026-10-03T12:00:00.000Z"), 43_200)
  assert.equal(at("2026-10-03T23:59:59.999Z"), 1, "a fraction of a second left is a second")
  assert.equal(at("2026-10-03T23:59:59.000Z"), 1)
  assert.equal(at("2026-10-04T00:00:00.000Z"), 86_400, "at midnight the next reset is a day away")
  assert.equal(at("2026-10-04T00:00:00.001Z"), 86_400)
  assert.equal(at("2026-12-31T23:59:30.000Z"), 30, "across a year end")
  assert.equal(at("2028-02-29T12:00:00.000Z"), 43_200, "on a leap day")
})

test("the default margin is the same table plus five seconds", () => {
  const at = (iso) => secondsUntilCloudflareDailyReset(Date.parse(iso))
  assert.equal(at("2026-10-03T12:00:00.000Z"), 43_205)
  assert.equal(at("2026-10-03T23:59:59.999Z"), 6)
  assert.equal(at("2026-10-04T00:00:00.000Z"), 86_405)
})
