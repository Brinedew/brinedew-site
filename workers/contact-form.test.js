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
