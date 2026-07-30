import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import toml from "toml"

import { handleContactSubmission } from "./contact-form.js"
import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

function contactRequest(
  payload = { email: "reader@example.com", message: "Hello from the site." },
) {
  return new Request("https://brinedew.bio/api/contact", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "CF-Connecting-IP": "203.0.113.42",
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

test("the no-JavaScript form posts privately and redirects to an on-page success message", async () => {
  const { env, messages } = contactEnv()
  const response = await handleContactSubmission(contactFormRequest(), env, {}, corsHeaders)

  assert.equal(response.status, 303)
  assert.equal(response.headers.get("Location"), "/About.html#contact-sent")
  assert.equal(response.headers.get("Content-Type"), null)
  assert.equal(response.headers.get("RateLimit-Policy"), '"contact";q=5;w=60')
  assert.equal(messages.length, 1)
  assert.match(messages[0].text, /From: reader@example\.com/)
  assert.match(messages[0].text, /Hello from the site\./)
  assert.equal(response.headers.get("Location").includes("reader@example.com"), false)
  assert.equal(response.headers.get("Location").includes("Hello"), false)
})

test("the no-JavaScript form redirects validation and rate-limit failures without echoing input", async () => {
  const invalidEnv = contactEnv()
  const invalid = await handleContactSubmission(
    contactFormRequest({ email: "private@example.com", message: " " }),
    invalidEnv.env,
    {},
    corsHeaders,
  )
  assert.equal(invalid.status, 303)
  assert.equal(invalid.headers.get("Location"), "/About.html#contact-invalid")
  assert.equal(invalidEnv.messages.length, 0)

  const limitedEnv = contactEnv({ success: false })
  const limited = await handleContactSubmission(
    contactFormRequest({ email: "private@example.com", message: "Private message" }),
    limitedEnv.env,
    {},
    corsHeaders,
  )
  assert.equal(limited.status, 303)
  assert.equal(limited.headers.get("Location"), "/About.html#contact-limited")
  assert.equal(limited.headers.get("Retry-After"), "60")
  assert.equal(limitedEnv.messages.length, 0)
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

test("oversized contact bodies are rejected without parsing or sending them", async () => {
  const { env, keys, messages } = contactEnv()
  const response = await handleContactSubmission(
    contactRequest({
      email: "reader@example.com",
      message: "x".repeat(70 * 1024),
    }),
    env,
    {},
    corsHeaders,
  )

  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { ok: false, error: "Request body too large" })
  assert.equal(keys.length, 1)
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

test("production and staging expose the shared five-per-minute binding", () => {
  const config = toml.parse(
    readFileSync(
      new URL(
        "../wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
        import.meta.url,
      ),
      "utf8",
    ),
  )
  const production = config.ratelimits.find(({ name }) => name === "PUBLIC_RATE_LIMIT_5")
  const staging = config.env.staging.ratelimits.find(({ name }) => name === "PUBLIC_RATE_LIMIT_5")

  assert.deepEqual([production?.simple.limit, production?.simple.period], [5, 60])
  assert.deepEqual([staging?.simple.limit, staging?.simple.period], [5, 60])
  assert.notEqual(production?.namespace_id, staging?.namespace_id)
})
