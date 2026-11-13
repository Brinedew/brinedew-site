import assert from "node:assert/strict"

import test from "node:test"

import { handleContactSubmission } from "./contact-form.js"
import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

function contactRequest(
  payload = { email: "reader@example.com", message: "Hello from the site." },
  extraHeaders = {},
) {
  return new Request("https://brinedew.bio/api/contact", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.42",
      Origin: "https://brinedew.bio",
      "Sec-Fetch-Site": "same-origin",
      ...extraHeaders,
    },
    body: JSON.stringify(payload),
  })
}

function contactFormRequest(
  payload = { email: "reader@example.com", message: "Hello from the site." },
) {
  return new Request("https://brinedew.bio/api/contact", {
    method: "POST",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": "203.0.113.42",
      Origin: "https://brinedew.bio",
      "Sec-Fetch-Site": "same-origin",
    },
    body: new URLSearchParams(payload),
  })
}

function contactEnv({ success = true, fail = false } = {}) {
  const keys = []
  const messages = []
  return {
    keys,
    messages,
    env: {
      PUBLIC_RATE_LIMIT_5: {
        async limit({ key }) {
          keys.push(key)
          if (fail) throw new Error("binding unavailable")
          return { success }
        },
      },
      CONTACT_EMAIL: {
        async send(message) {
          messages.push(message)
          return { messageId: "message-1" }
        },
      },
    },
  }
}

const corsHeaders = { "Access-Control-Allow-Origin": "https://brinedew.bio" }

test("an allowed contact submission uses the native binding and truthful policy headers", async () => {
  const { env, keys, messages } = contactEnv()
  const response = await handleContactSubmission(contactRequest(), env, {}, corsHeaders)
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(payload, { ok: true, queued: true, messageId: "message-1" })
  assert.equal(keys.length, 1)
  assert.match(keys[0], /^[a-f0-9]{64}$/)
  assert.equal(keys[0].includes("203.0.113.42"), false)
  assert.equal(messages.length, 1)
  assert.match(messages[0].text, /From: reader@example\.com/)
  assert.match(messages[0].text, /Hello from the site\./)
  assert.equal(response.headers.get("RateLimit-Policy"), '"contact";q=5;w=60')
  assert.equal(response.headers.get("X-RateLimit-Limit"), "5")
  assert.equal(response.headers.get("X-RateLimit-Period"), "60")
  assert.equal(response.headers.has("RateLimit"), false)
  assert.equal(response.headers.has("X-RateLimit-Remaining"), false)
  assert.equal(response.headers.has("X-RateLimit-Reset"), false)
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://brinedew.bio")
})

test("the production Worker routes contact submissions through the shared native binding", async () => {
  const { env, keys, messages } = contactEnv()
  const response = await worker.fetch(contactRequest(), env, {})

  assert.equal(response.status, 200)
  assert.equal(keys.length, 1)
  assert.equal(messages.length, 1)
})

test("a denied contact submission returns 429 before sending email", async () => {
  const { env, messages } = contactEnv({ success: false })
  const response = await handleContactSubmission(contactRequest(), env, {}, corsHeaders)
  const payload = await response.json()

  assert.equal(response.status, 429)
  assert.equal(payload.error, "Too many submissions. Try again in a minute.")
  assert.equal(messages.length, 0)
  assert.equal(response.headers.get("RateLimit"), '"contact";r=0;t=60')
  assert.equal(response.headers.get("Retry-After"), "60")
})

test("the API rejects unsupported request bodies instead of guessing their shape", async () => {
  const { env, keys, messages } = contactEnv()
  const response = await handleContactSubmission(
    new Request("https://brinedew.bio/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "CF-Connecting-IP": "203.0.113.42",
      },
      body: "email=reader@example.com&message=Hello",
    }),
    env,
    {},
    corsHeaders,
  )

  assert.equal(response.status, 415)
  assert.deepEqual(await response.json(), { ok: false, error: "Unsupported content type" })
  assert.equal(keys.length, 0)
  assert.equal(messages.length, 0)
})

test("cross-origin browser forms are rejected before they can consume quota", async () => {
  const { env, keys, messages } = contactEnv()
  const request = contactFormRequest()
  request.headers.set("Origin", "https://attacker.example")
  request.headers.set("Sec-Fetch-Site", "cross-site")

  const response = await handleContactSubmission(request, env, {}, corsHeaders)

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Cross-origin form submissions are not allowed.",
  })
  assert.equal(keys.length, 0)
  assert.equal(messages.length, 0)
})

test("cross-origin URL-encoded fetches cannot bypass the origin check with Accept */*", async () => {
  const { env, keys, messages } = contactEnv()
  const request = contactFormRequest()
  request.headers.set("Accept", "*/*")
  request.headers.set("Origin", "https://attacker.example")
  request.headers.set("Sec-Fetch-Site", "cross-site")

  const response = await handleContactSubmission(request, env, {}, corsHeaders)

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), {
    ok: false,
    error: "Cross-origin form submissions are not allowed.",
  })
  assert.equal(keys.length, 0)
  assert.equal(messages.length, 0)
})

test("unknown-length contact bodies are cancelled as soon as the byte limit is crossed", async () => {
  const { env, keys, messages } = contactEnv()
  let chunksSent = 0
  let cancelled = false
  const body = new ReadableStream({
    pull(controller) {
      chunksSent += 1
      controller.enqueue(new Uint8Array(40 * 1024).fill(120))
    },
    cancel() {
      cancelled = true
    },
  })
  const request = new Request("https://brinedew.bio/api/contact", {
    method: "POST",
    headers: {
      Accept: "*/*",
      "Content-Type": "application/x-www-form-urlencoded",
      "CF-Connecting-IP": "203.0.113.42",
      Origin: "https://brinedew.bio",
      "Sec-Fetch-Site": "same-origin",
    },
    body,
    duplex: "half",
  })

  const response = await handleContactSubmission(request, env, {}, corsHeaders)

  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { ok: false, error: "Request body too large" })
  assert.ok(chunksSent < 10, `stream should stop early, but produced ${chunksSent} chunks`)
  assert.equal(cancelled, true)
  assert.equal(keys.length, 1)
  assert.equal(messages.length, 0)
})

test("a missing, failed, or malformed native binding fails closed", async () => {
  const missing = await handleContactSubmission(
    contactRequest(),
    { CONTACT_EMAIL: { async send() {} } },
    {},
    corsHeaders,
  )
  assert.equal(missing.status, 503)

  const failedEnv = contactEnv({ fail: true }).env
  const failed = await handleContactSubmission(contactRequest(), failedEnv, {}, corsHeaders)
  assert.equal(failed.status, 503)

  const malformed = await handleContactSubmission(
    contactRequest(),
    {
      PUBLIC_RATE_LIMIT_5: { async limit() {} },
      CONTACT_EMAIL: { async send() {} },
    },
    {},
    corsHeaders,
  )
  assert.equal(malformed.status, 503)
})

test("cross-origin and missing-origin JSON requests are rejected before rate limiting or email", async () => {
  const cases = [
    {
      name: "missing Origin (TeardownBriefs/1.0)",
      headers: { Origin: undefined, "Sec-Fetch-Site": undefined },
    },
    { name: "null Origin", headers: { Origin: "null", "Sec-Fetch-Site": "cross-site" } },
    {
      name: "foreign Origin",
      headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
    },
  ]

  for (const { headers } of cases) {
    const { env, keys, messages } = contactEnv()
    const reqHeaders = new Headers({
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.42",
      "User-Agent":
        "Mozilla/5.0 (compatible; TeardownBriefs/1.0; +https://whop.com/48-hour-teardown)",
    })
    if (headers.Origin) reqHeaders.set("Origin", headers.Origin)
    if (headers["Sec-Fetch-Site"]) reqHeaders.set("Sec-Fetch-Site", headers["Sec-Fetch-Site"])

    const response = await handleContactSubmission(
      new Request("https://brinedew.bio/api/contact", {
        method: "POST",
        headers: reqHeaders,
        body: JSON.stringify({
          email: "teardownbriefs@gmail.com",
          message: "Check out our $9 DIY checklist on whop.com",
        }),
      }),
      env,
      {},
      corsHeaders,
    )

    assert.equal(response.status, 403)
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Cross-origin form submissions are not allowed.",
    })
    assert.equal(keys.length, 0)
    assert.equal(messages.length, 0)
  }
})

test("honeypots, fast timing, bot user-agents, probe messages, and spam pitches are silently ignored", async () => {
  const botCases = [
    {
      name: "website honeypot filled",
      payload: {
        email: "reader@example.com",
        message: "Real looking message text",
        website: "https://spam.test",
      },
      headers: {},
    },
    {
      name: "affiliation honeypot filled",
      payload: {
        email: "reader@example.com",
        message: "Real looking message text",
        affiliation: "Acme Bots",
      },
      headers: {},
    },
    {
      name: "submitted faster than minimum elapsed time",
      payload: {
        email: "reader@example.com",
        message: "Real looking message text",
        elapsedMs: 100,
      },
      headers: {},
    },
    {
      name: "crawler User-Agent",
      payload: {
        email: "reader@example.com",
        message: "Hello, quick question about your project.",
      },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; TeardownBriefs/1.0; +https://whop.com/48-hour-teardown)",
      },
    },
    {
      name: "outdated Chrome/124 bot probe User-Agent",
      payload: { email: "hellenvfvonruedqqj28@gmail.com", message: "Test" },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    },
    {
      name: "bare Test probe even with clean browser UA",
      payload: { email: "reader@example.com", message: "Test" },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
      },
    },
    {
      name: "generated bot email pattern with legitimate text",
      payload: {
        email: "johannabqhoegervlz550@gmail.com",
        message: "I wanted to ask about your recent blog post.",
      },
      headers: {},
    },
    {
      name: "whop.com cold pitch",
      payload: {
        email: "alex@example.com",
        message: "I put together a $9 DIY checklist PDF over at whop.com/48-hour-teardown",
      },
      headers: {},
    },
  ]

  for (const { name, payload, headers } of botCases) {
    const kvWrites = []
    const { env, messages } = contactEnv()
    env.KV = {
      async put(key, value) {
        kvWrites.push({ key, value })
      },
    }
    const response = await handleContactSubmission(
      contactRequest(payload, headers),
      env,
      {},
      corsHeaders,
    )
    assert.equal(response.status, 200, `${name}: status`)
    assert.deepEqual(
      await response.json(),
      { ok: true, queued: false, ignored: true },
      `${name}: body`,
    )
    assert.equal(messages.length, 0, `${name}: should send no email`)
    assert.equal(kvWrites.length, 0, `${name}: should write no KV entry`)
  }
})

test("short non-probe messages and single-word inputs fail validation cleanly", async () => {
  for (const message of ["Hiya!", "Greetings!", "Too short"]) {
    const { env, messages } = contactEnv()
    const response = await handleContactSubmission(
      contactRequest({ email: "reader@example.com", message, elapsedMs: 5000 }),
      env,
      {},
      corsHeaders,
    )
    assert.equal(response.status, 422)
    assert.deepEqual(await response.json(), {
      ok: false,
      error: "Write a message of at least 10 characters (two or more words).",
    })
    assert.equal(messages.length, 0)
  }
})
