import assert from "node:assert/strict"
import test from "node:test"

import worker from "./index.js"

test("public edge proxies apex iconoplasm admin me to the only allowed stateful worker", async () => {
  const calls = []
  const response = await worker.fetch(
    new Request("https://brinedew.bio/api/iconoplasm/admin/me", { method: "GET" }),
    {
      THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
        async fetch(request) {
          calls.push({ url: request.url, method: request.method })
          return Response.json({ ok: true, authenticated: false, is_admin: false })
        },
      },
    },
    {},
  )

  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.authenticated, false)
  assert.equal(payload?.is_admin, false)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, "https://brinedew.bio/api/iconoplasm/admin/me")
  assert.equal(calls[0]?.method, "GET")
})

test("public edge routes public iconoplasm traffic through the only allowed stateful worker", async () => {
  const calls = []
  const env = {
    THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
      async fetch(request) {
        calls.push({
          url: request.url,
          method: request.method,
        })
        return Response.json({ ok: true, items: [] })
      },
    },
  }

  const response = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=votes"),
    env,
    {},
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.url, "https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=votes")
  assert.equal(calls[0]?.method, "GET")
})
