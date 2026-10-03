import assert from "node:assert/strict"
import test from "node:test"
import { handleMe } from "./auth.js"
import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { secondsUntilCloudflareDailyReset } from "./lib/cloudflare-availability.js"

function environment(fetch) {
  return { GAME_SESSIONS: { idFromName: (value) => value, get: () => ({ fetch }) } }
}
function request() {
  return new Request("https://iconoplasm.brinedew.bio/api/auth/me", {
    headers: { Cookie: "session=synthetic-test-session" },
  })
}

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

// B-832: a failed request is reported to Sentry from the Worker. The reader's cookie,
// tokens and address, and the query string, must never leave with it.
test("a failed auth request is reported to Sentry without cookies, tokens, addresses or the query string", async (t) => {
  const originalFetch = globalThis.fetch
  const envelopes = []
  globalThis.fetch = async (url, init) => {
    envelopes.push({ url: String(url), body: String(init?.body) })
    return new Response(null, { status: 200 })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const pending = []
  const ctx = { waitUntil: (promise) => pending.push(promise) }
  const env = {
    ...environment(async () => new Response("", { status: 500 })),
    SENTRY_DSN: "https://publickey@o1.ingest.us.sentry.io/42",
  }

  const failed = await worker.fetch(
    new Request("https://brinedew.bio/api/auth/me?token=query-secret", {
      headers: {
        Cookie: "session=cookie-secret",
        Authorization: "Bearer bearer-secret",
        "x-iconoplasm-admin-token": "admin-secret",
        "cf-connecting-ip": "203.0.113.9",
        "user-agent": "test-agent",
      },
    }),
    env,
    ctx,
  )
  assert.equal(failed.status, 503)
  await Promise.all(pending)
  assert.equal(envelopes.length, 1)
  assert.equal(envelopes[0].url, "https://o1.ingest.us.sentry.io/api/42/envelope/")
  for (const secret of [
    "query-secret",
    "cookie-secret",
    "bearer-secret",
    "admin-secret",
    "203.0.113.9",
  ]) {
    assert.equal(envelopes[0].body.includes(secret), false, `${secret} left the Worker`)
  }
  const event = JSON.parse(envelopes[0].body.split("\n")[2])
  assert.equal(event.request.url, "https://brinedew.bio/api/auth/me")

  const anonymous = await worker.fetch(new Request("https://brinedew.bio/api/auth/me"), env, ctx)
  assert.equal(anonymous.status, 401)
  await Promise.all(pending)
  assert.equal(envelopes.length, 1, "a response below 500 reports nothing")
})
