import assert from "node:assert/strict"
import test from "node:test"

import worker from "./index.js"

test("apex settings host routes iconoplasm admin me through the iconoplasm worker", async () => {
  const response = await worker.fetch(
    new Request("https://brinedew.bio/api/iconoplasm/admin/me", { method: "GET" }),
    {},
    {},
  )

  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.authenticated, false)
  assert.equal(payload?.is_admin, false)
})

test("scheduled iconoplasm canon maintenance goes through THE_ONLY_ALLOWED_DB_GATEWAY", async () => {
  const calls = []
  const env = {
    THE_ONLY_ALLOWED_DB_GATEWAY: {
      async fetch(request) {
        const cloned = request.clone()
        calls.push({
          url: cloned.url,
          method: cloned.method,
          body: await cloned.text(),
          headers: Object.fromEntries(cloned.headers.entries()),
        })
        return Response.json({ ok: true, scanned: 3, changed: 2, unresolved: 1 })
      },
    },
  }

  await worker.scheduled({ cron: "17 * * * *" }, env, { waitUntil() {} })

  assert.equal(calls.length, 1)
  assert.equal(
    calls[0]?.url,
    "https://the-only-allowed-db-gateway/__internal/iconoplasm/repair-canon-invariants",
  )
  assert.equal(calls[0]?.method, "POST")
  assert.match(String(calls[0]?.body || ""), /"actorId":"cron"/)
  assert.match(String(calls[0]?.body || ""), /"reason":"scheduled_canon_invariant_repair"/)
})

test("index routes public iconoplasm traffic through the caller boundary and into THE_ONLY_ALLOWED_DB_GATEWAY", async () => {
  const calls = []
  const env = {
    THE_ONLY_ALLOWED_DB_GATEWAY: {
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
  assert.equal(calls[0]?.url, "https://the-only-allowed-db-gateway/api/public/v1/gallery?order=votes")
  assert.equal(calls[0]?.method, "GET")
})
