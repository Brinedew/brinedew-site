import assert from "node:assert/strict"
import test from "node:test"

import { fetchCloudflareJson } from "./cloudflare-json.mjs"

function jsonResponse(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status || 200,
    headers: { "Content-Type": "application/json", ...init.headers },
  })
}

test("Cloudflare JSON client retries an empty success response", async () => {
  const responses = [new Response("", { status: 200 }), jsonResponse({ data: { ok: true } })]
  const delays = []
  const payload = await fetchCloudflareJson(
    "https://api.cloudflare.test/graphql",
    {},
    {
      fetchImpl: async () => responses.shift(),
      sleep: async (milliseconds) => delays.push(milliseconds),
      random: () => 0,
    },
  )

  assert.deepEqual(payload, { data: { ok: true } })
  assert.deepEqual(delays, [750])
})

test("Cloudflare JSON client honors Retry-After for transient statuses", async () => {
  const responses = [
    jsonResponse({ error: "slow down" }, { status: 429, headers: { "Retry-After": "2" } }),
    jsonResponse({ success: true }),
  ]
  const delays = []
  const payload = await fetchCloudflareJson(
    "https://api.cloudflare.test/telemetry",
    {},
    {
      fetchImpl: async () => responses.shift(),
      sleep: async (milliseconds) => delays.push(milliseconds),
      random: () => 0,
    },
  )

  assert.deepEqual(payload, { success: true })
  assert.deepEqual(delays, [2_000])
})

test("Cloudflare JSON client retries invalid JSON from a transient edge response", async () => {
  const responses = [
    new Response("<html>bad gateway</html>", { status: 502 }),
    jsonResponse({ data: [] }),
  ]
  let sleeps = 0
  const payload = await fetchCloudflareJson(
    "https://api.cloudflare.test/graphql",
    {},
    {
      fetchImpl: async () => responses.shift(),
      sleep: async () => {
        sleeps += 1
      },
      random: () => 0,
    },
  )

  assert.deepEqual(payload, { data: [] })
  assert.equal(sleeps, 1)
})

test("Cloudflare JSON client does not retry a non-transient HTTP error", async () => {
  let calls = 0
  await assert.rejects(
    fetchCloudflareJson(
      "https://api.cloudflare.test/graphql",
      {},
      {
        operation: "Cloudflare GraphQL query",
        fetchImpl: async () => {
          calls += 1
          return new Response("invalid query", { status: 400 })
        },
        sleep: async () => assert.fail("non-transient response must not sleep"),
      },
    ),
    /Cloudflare GraphQL query returned invalid JSON \(HTTP 400, attempt 1\/3\): invalid query/,
  )
  assert.equal(calls, 1)
})

test("Cloudflare JSON client reports repeated empty bodies precisely", async () => {
  let calls = 0
  await assert.rejects(
    fetchCloudflareJson(
      "https://api.cloudflare.test/graphql",
      {},
      {
        operation: "Cloudflare GraphQL query",
        fetchImpl: async () => {
          calls += 1
          return new Response("", { status: 200 })
        },
        sleep: async () => {},
        random: () => 0,
      },
    ),
    /empty response body \(HTTP 200\) after 3 attempts/,
  )
  assert.equal(calls, 3)
})

test("Cloudflare JSON client retries a network failure", async () => {
  let calls = 0
  const payload = await fetchCloudflareJson(
    "https://api.cloudflare.test/graphql",
    {},
    {
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) throw new TypeError("connection reset")
        return jsonResponse({ data: { ok: true } })
      },
      sleep: async () => {},
      random: () => 0,
    },
  )

  assert.deepEqual(payload, { data: { ok: true } })
  assert.equal(calls, 2)
})
