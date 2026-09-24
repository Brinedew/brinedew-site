import assert from "node:assert/strict"
import test from "node:test"

import { routeFingerprint, withErrorReporting } from "./the-only-error-reporter.js"

// B-832 failure list, written before the reporter:
// 1. No SENTRY_DSN configured: a no-op that never fetches.
// 2. The reporter never throws and never delays the response it wraps.
// 3. No token, cookie, IP or query string leaves the Worker.
// 4. 5xx responses and thrown errors are reported; 2xx-4xx are not.
// 5. Per-gene/per-id URLs group into one issue instead of thousands.

const DSN = "https://publickey@o1.ingest.us.sentry.io/42"

function harness(env = { SENTRY_DSN: DSN, SENTRY_RELEASE: "abc123" }) {
  const sent = []
  const waits = []
  const ctx = { waitUntil: (p) => waits.push(p) }
  const fetcher = async (url, init) => {
    sent.push({ url: String(url), init })
    return new Response("{}", { status: 200 })
  }
  return { env, ctx, sent, waits, fetcher }
}

const request = () =>
  new Request("https://brinedew.bio/api/iconoplasm/site/genes/TP53?token=secret", {
    headers: {
      Authorization: "Bearer hunter2",
      Cookie: "session=abc",
      "x-iconoplasm-admin-token": "admintoken",
      "cf-connecting-ip": "203.0.113.9",
      "user-agent": "test-agent",
    },
  })

function eventOf(sent) {
  const lines = String(sent[0].init.body).split("\n")
  return JSON.parse(lines[2])
}

test("1: without a DSN nothing is sent", async () => {
  const h = harness({})
  const res = await withErrorReporting(
    h.env,
    h.ctx,
    request(),
    "edge",
    async () => new Response("x", { status: 500 }),
    { fetcher: h.fetcher },
  )
  assert.equal(res.status, 500)
  assert.equal(h.sent.length, 0)
  assert.equal(h.waits.length, 0)
})

test("2,4: a thrown error is reported in the background and rethrown", async () => {
  const h = harness()
  await assert.rejects(
    withErrorReporting(
      h.env,
      h.ctx,
      request(),
      "internal",
      async () => {
        throw new Error("D1_ERROR: exceeded daily row read limit")
      },
      { fetcher: h.fetcher },
    ),
    /exceeded daily row read limit/,
  )
  assert.equal(h.waits.length, 1)
  await Promise.all(h.waits)
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].url, "https://o1.ingest.us.sentry.io/api/42/envelope/")
  const event = eventOf(h.sent)
  assert.equal(event.exception.values[0].value, "D1_ERROR: exceeded daily row read limit")
  assert.equal(event.release, "abc123")
  assert.equal(event.tags.worker, "internal")
})

test("2: a failing Sentry endpoint never breaks the response", async () => {
  const h = harness()
  const res = await withErrorReporting(
    h.env,
    h.ctx,
    request(),
    "edge",
    async () => new Response("x", { status: 502 }),
    {
      fetcher: async () => {
        throw new Error("network down")
      },
    },
  )
  assert.equal(res.status, 502)
  await Promise.all(h.waits)
})

test("3: headers, query strings and IPs are scrubbed", async () => {
  const h = harness()
  await withErrorReporting(
    h.env,
    h.ctx,
    request(),
    "edge",
    async () => new Response("x", { status: 503 }),
    { fetcher: h.fetcher },
  )
  await Promise.all(h.waits)
  const raw = String(h.sent[0].init.body)
  for (const secret of ["hunter2", "session=abc", "admintoken", "203.0.113.9", "token=secret"]) {
    assert.ok(!raw.includes(secret), `leaked ${secret}`)
  }
  const event = eventOf(h.sent)
  assert.equal(event.request.url, "https://brinedew.bio/api/iconoplasm/site/genes/TP53")
  assert.equal(event.request.headers["user-agent"], "test-agent")
})

test("4: 2xx-4xx responses are not reported", async () => {
  const h = harness()
  for (const status of [200, 302, 404, 429]) {
    await withErrorReporting(
      h.env,
      h.ctx,
      request(),
      "edge",
      async () => new Response("x", { status }),
      { fetcher: h.fetcher },
    )
  }
  assert.equal(h.sent.length, 0)
})

test("5: per-gene and per-id paths share one fingerprint", () => {
  assert.equal(
    routeFingerprint("/api/iconoplasm/site/genes/TP53"),
    routeFingerprint("/api/iconoplasm/site/genes/BRCA1"),
  )
  assert.equal(routeFingerprint("/api/game/5f3a9c2e7b"), "/api/game/:x")
  assert.equal(routeFingerprint("/api/auth/me"), "/api/auth/me")
})
