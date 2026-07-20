import assert from "node:assert/strict"
import test from "node:test"

import worker from "./the-only-allowed-public-edge-worker-that-must-not-touch-state.js"

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
  const rateLimitKeys = []
  const env = {
    ICONOPLASM_RATE_LIMIT_60: {
      async limit({ key }) {
        rateLimitKeys.push(key)
        return { success: true }
      },
    },
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
  assert.equal(rateLimitKeys.length, 1)
  assert.match(rateLimitKeys[0], /^[a-f0-9]{64}$/)
  assert.equal(calls[0]?.url, "https://iconoplasm.brinedew.bio/api/public/v1/gallery?order=votes")
  assert.equal(calls[0]?.method, "GET")
})

test("public edge does not symbol-cache Iconoplasm card artifacts", async (t) => {
  const hadCaches = Object.prototype.hasOwnProperty.call(globalThis, "caches")
  const previousCaches = globalThis.caches
  let cacheMatchCalls = 0
  globalThis.caches = {
    default: {
      async match() {
        cacheMatchCalls += 1
        return Response.json({
          ok: true,
          card: { payload: { symbol: "PRL", portrait: { asset_sha256: "stale-edge-cache" } } },
        })
      },
      async put() {
        throw new Error("public edge must not write symbol-only card cache entries")
      },
    },
  }
  t.after(() => {
    if (hadCaches) globalThis.caches = previousCaches
    else delete globalThis.caches
  })

  let calls = 0
  const env = {
    THE_ONLY_ALLOWED_STATEFUL_WORKER_DO_NOT_DUPLICATE: {
      async fetch() {
        calls += 1
        return Response.json({
          ok: true,
          snapshot_version: `version-${calls}`,
          card: {
            payload: {
              symbol: "PRL",
              portrait: { asset_sha256: calls === 1 ? "first-stateful" : "second-stateful" },
            },
          },
        })
      },
    },
  }

  const first = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/cards/PRL"),
    env,
    {},
  )
  const second = await worker.fetch(
    new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/cards/PRL"),
    env,
    {},
  )
  const firstPayload = await first.json()
  const secondPayload = await second.json()

  assert.equal(cacheMatchCalls, 0)
  assert.equal(calls, 2)
  assert.equal(firstPayload?.card?.payload?.portrait?.asset_sha256, "first-stateful")
  assert.equal(secondPayload?.card?.payload?.portrait?.asset_sha256, "second-stateful")
})
