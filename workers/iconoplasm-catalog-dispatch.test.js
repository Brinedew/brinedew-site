import assert from "node:assert/strict"
import test from "node:test"

import {
  CATALOG_DISPATCH_WATERMARK_KEY,
  dispatchIconoplasmCatalogPublication,
} from "./iconoplasm-catalog-dispatch.js"

// B-898 Stage 1: the Worker tells GitHub Actions to rebuild the catalog object
// when a canonical-affecting publish event has landed since the last dispatch.
// Failure modes written before the code:
// 1. no GitHub token configured -> skipped, no D1 read, no KV write;
// 2. no new events since the KV watermark -> no dispatch, no KV write;
// 3. new events -> exactly one repository_dispatch with the event type the
//    workflow listens for, then the KV watermark advances to the new high water;
// 4. GitHub refuses (4xx/5xx) -> reported, KV watermark untouched so the next
//    tick retries;
// 5. first run ever (no KV value) with events present -> dispatches.
function harness({ token = "ghp_test", highWater = 320077, stored = "320000", github = 204 } = {}) {
  const kv = { reads: 0, writes: [] }
  const calls = []
  const env = {
    GITHUB_RECAP_DISPATCH_TOKEN: token,
    KV: {
      async get(key) {
        kv.reads += 1
        return key === CATALOG_DISPATCH_WATERMARK_KEY ? stored : null
      },
      async put(key, value) {
        kv.writes.push({ key, value })
      },
    },
    ICONOPLASM_DB: {
      prepare: () => ({
        bind: () => ({ first: async () => ({ id: highWater }) }),
        first: async () => ({ id: highWater }),
      }),
    },
  }
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return new Response(null, { status: github })
  }
  return { env, kv, calls, run: () => dispatchIconoplasmCatalogPublication(env, { fetchImpl }) }
}

test("no GitHub token: skipped without touching D1 or KV", async () => {
  const h = harness({ token: "" })
  const result = await h.run()
  assert.equal(result.dispatched, false)
  assert.equal(result.reason, "no_token")
  assert.equal(h.kv.reads, 0)
  assert.equal(h.calls.length, 0)
})

test("no new events since the watermark: no dispatch, no KV write", async () => {
  const h = harness({ highWater: 320000, stored: "320000" })
  const result = await h.run()
  assert.equal(result.dispatched, false)
  assert.equal(result.reason, "unchanged")
  assert.equal(h.calls.length, 0)
  assert.equal(h.kv.writes.length, 0)
})

test("new events: one repository_dispatch, then the watermark advances", async () => {
  const h = harness()
  const result = await h.run()
  assert.equal(result.dispatched, true)
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].url, "https://api.github.com/repos/Brinedew/brinedew-site/dispatches")
  assert.equal(h.calls[0].init.method, "POST")
  assert.equal(h.calls[0].init.headers.Authorization, "Bearer ghp_test")
  assert.deepEqual(JSON.parse(h.calls[0].init.body), {
    event_type: "iconoplasm-catalog",
    client_payload: { watermark_event_id: 320077 },
  })
  assert.deepEqual(h.kv.writes, [{ key: CATALOG_DISPATCH_WATERMARK_KEY, value: "320077" }])
})

test("GitHub refuses: reported, watermark untouched so the next tick retries", async () => {
  const h = harness({ github: 403 })
  const result = await h.run()
  assert.equal(result.dispatched, false)
  assert.equal(result.reason, "github_403")
  assert.equal(h.kv.writes.length, 0)
})

test("first run with events and no stored watermark dispatches", async () => {
  const h = harness({ stored: null })
  const result = await h.run()
  assert.equal(result.dispatched, true)
  assert.equal(h.calls.length, 1)
})
