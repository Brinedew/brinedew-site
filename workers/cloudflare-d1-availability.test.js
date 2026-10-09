import assert from "node:assert/strict"
import test from "node:test"

import {
  d1DailyRowLimitKind,
  d1DailyRowLimitResponse,
  secondsUntilCloudflareDailyReset,
} from "./lib/cloudflare-availability.js"

test("recognizes Cloudflare's daily D1 row-read exhaustion through wrapped errors", () => {
  const cause = new Error(
    "D1_ERROR: Your account has exceeded D1's free tier daily row read limit.",
  )
  assert.equal(d1DailyRowLimitKind(new Error("query failed", { cause })), "read")
  assert.equal(d1DailyRowLimitKind(new Error("D1 database unavailable")), null)
})

// 2026-10-09, about 21:00 UTC: the write wall, worded as Cloudflare logged it.
// The factory waits for the reset only when the answer is a 503 with reset_at.
test("Cloudflare's daily D1 write wall answers 503 with the reset, like the read wall", async () => {
  const wall = new Error(
    "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. See https://developers.cloudflare.com/d1/platform/limits/ for more details.",
  )
  assert.equal(d1DailyRowLimitKind(wall), "write")
  const response = d1DailyRowLimitResponse(wall, Date.parse("2026-10-09T21:02:47.000Z"))
  assert.equal(response.status, 503)
  const body = await response.json()
  assert.equal(body.code, "D1_ACCOUNT_WRITE_LIMIT")
  assert.equal(body.reset_at, "2026-10-10T00:00:05.000Z")
  assert.equal(Number(response.headers.get("Retry-After")), body.retry_after_seconds)
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
