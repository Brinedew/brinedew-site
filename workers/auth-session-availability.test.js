import assert from "node:assert/strict"
import test from "node:test"
import { handleMe } from "./auth.js"
import {
  isDurableObjectDailyDurationLimitError,
  secondsUntilCloudflareDailyReset,
} from "./lib/cloudflare-availability.js"

function environment(fetch) {
  return { GAME_SESSIONS: { idFromName: (value) => value, get: () => ({ fetch }) } }
}
function request() {
  return new Request("https://iconoplasm.brinedew.bio/api/auth/me", {
    headers: { Cookie: "session=synthetic-test-session" },
  })
}

test("daily duration errors are recognized narrowly through wrapped causes", () => {
  const error = new Error("Exceeded allowed duration in Durable Objects free tier.")
  assert.equal(
    isDurableObjectDailyDurationLimitError(new Error("upstream", { cause: error })),
    true,
  )
  assert.equal(isDurableObjectDailyDurationLimitError(new Error("Exceeded CPU time limit")), false)
  assert.equal(
    isDurableObjectDailyDurationLimitError(new Error("Durable Object unavailable")),
    false,
  )
  const cycle = new Error("unrelated")
  cycle.cause = cycle
  assert.equal(isDurableObjectDailyDurationLimitError(cycle), false)
})

test("auth/me returns the UTC reset deadline without clearing a valid cookie or retrying", async () => {
  let calls = 0
  const before = secondsUntilCloudflareDailyReset()
  const response = await handleMe(
    request(),
    environment(async () => {
      calls++
      throw new Error("Exceeded allowed duration in Durable Objects free tier.")
    }),
  )
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("set-cookie"), null)
  assert.equal(response.headers.get("cache-control"), "no-store")
  const payload = await response.json()
  assert.equal(payload.code, "SESSION_AUTHORITY_DAILY_LIMIT")
  assert.equal("authenticated" in payload, false, "unavailable is not a logged-out verdict")
  assert.equal(Number(response.headers.get("retry-after")), payload.retry_after_seconds)
  assert.ok(payload.retry_after_seconds <= before)
  assert.ok(payload.retry_after_seconds >= secondsUntilCloudflareDailyReset())
  assert.equal(calls, 1)
})

test("temporary upstream responses preserve cookies and bounded retry hints", async () => {
  for (const [status, hint, expected] of [
    [500, "120", 120],
    [503, "invalid", 60],
    [429, "999999", 86405],
  ]) {
    const response = await handleMe(
      request(),
      environment(
        async () =>
          new Response("private upstream detail", {
            status,
            headers: { "Retry-After": hint },
          }),
      ),
    )
    assert.equal(response.status, 503)
    assert.equal(response.headers.get("set-cookie"), null)
    const payload = await response.json()
    assert.equal(payload.code, "SESSION_AUTHORITY_UNAVAILABLE")
    assert.equal(payload.retry_after_seconds, expected)
    assert.equal(JSON.stringify(payload).includes("private upstream detail"), false)
  }
})

test("legacy resolution errors are temporary and do not invalidate the session", async () => {
  let calls = 0
  const response = await handleMe(
    request(),
    environment(async () => {
      if (++calls === 1) return new Response("", { status: 404 })
      throw new Error("temporary transport failure with private detail")
    }),
  )
  assert.equal(calls, 2)
  assert.equal(response.status, 503)
  assert.equal(response.headers.get("set-cookie"), null)
  const payload = await response.json()
  assert.equal(payload.retry_after_seconds, 60)
  assert.equal(JSON.stringify(payload).includes("private detail"), false)
})

test("actual invalid sessions still expire cookies", async () => {
  const response = await handleMe(
    request(),
    environment(async () => new Response("", { status: 401 })),
  )
  assert.equal(response.status, 401)
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/)
})
