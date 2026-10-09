import assert from "node:assert/strict"
import test from "node:test"
import { createPublishedCardObjectStore } from "./lib/iconoplasm-published-card-objects.js"

const env = {
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "test-zone",
  ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
}
function fixture({ alterRead, status = 200 } = {}) {
  const objects = new Map()
  const calls = []
  const store = createPublishedCardObjectStore(env, {
    request: async (url, init, key) => {
      calls.push({ method: init.method, key })
      if (init.method === "PUT") {
        if (status === 200) objects.set(key, init.body.slice())
        return new Response(null, { status })
      }
      const bytes = alterRead ? alterRead(objects.get(key)) : objects.get(key)
      return bytes ? new Response(bytes) : new Response(null, { status: 404 })
    },
  })
  return { store, calls, objects }
}

test("a stable read miss is null and never writes or consults a relational database", async () => {
  const { store, calls } = fixture()
  assert.equal(await store.readStable("genes/v3/TP53.json"), null)
  assert.deepEqual(
    calls.map((x) => x.method),
    ["GET"],
  )
})

test("a stalled response body has a deadline", async () => {
  let cancelled = false
  const store = createPublishedCardObjectStore(env, {
    bodyTimeoutMs: 15,
    request: async () =>
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
      ),
  })
  await assert.rejects(store.readStable("genes/v3/TP53.json"), /timed out/)
  assert.equal(cancelled, true)
})

test("a transient storage timeout is retried and the stable object commits (B-753)", async () => {
  const timeoutEnv = {
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_ZONE: "test-zone",
    ICONOPLASM_EXTERNAL_PORTRAIT_STORAGE_PASSWORD: "test-only",
    // Short timeout and no retry delay so the abort fires quickly.
    ICONOPLASM_PORTRAIT_STORAGE_TIMEOUT_MS: "20",
    ICONOPLASM_PORTRAIT_STORAGE_RETRY_BASE_MS: "0",
  }
  const store = createPublishedCardObjectStore(timeoutEnv)
  const originalFetch = globalThis.fetch
  let putAttempts = 0
  let stored = null
  globalThis.fetch = async (_url, init = {}) => {
    const method = init.method || "GET"
    if (method === "PUT") {
      putAttempts += 1
      if (putAttempts === 1) {
        // First attempt stalls until portraitStorageRequestTimeout aborts it.
        return await new Promise((_resolve, reject) => {
          const signal = init.signal
          if (!signal) return
          const fail = () => reject(new DOMException("The operation was aborted", "AbortError"))
          if (signal.aborted) return fail()
          signal.addEventListener("abort", fail, { once: true })
        })
      }
      stored = init.body
      return new Response(null, { status: 201 })
    }
    return stored ? new Response(stored, { status: 200 }) : new Response(null, { status: 404 })
  }
  try {
    const receipt = await store.writeStable("genes/v3/EZH2.json", { symbol: "EZH2", name: "retry" })
    assert.equal(putAttempts, 2)
    assert.ok(receipt.key)
  } finally {
    globalThis.fetch = originalFetch
  }
})

// 2026-10-09: Bunny stored two genes' objects but answered their PUTs after every
// deadline, and the publication failed on objects already in place.
test("a PUT stored but answered too late is a committed write, judged by its read-back", async () => {
  const objects = new Map()
  const calls = []
  const store = createPublishedCardObjectStore(env, {
    request: async (url, init, key) => {
      calls.push(init.method)
      if (init.method === "PUT") {
        objects.set(key, init.body.slice())
        throw new DOMException("The operation was aborted", "AbortError")
      }
      return new Response(objects.get(key))
    },
  })
  const receipt = await store.writeStable("genes/v3/ATP2A2.json", { symbol: "ATP2A2" })
  assert.equal(receipt.symbol, "ATP2A2")
  assert.deepEqual(calls, ["PUT", "GET"])
})

test("a PUT that never landed fails with its own error, whatever the read-back finds", async () => {
  const previous = new TextEncoder().encode('{"symbol":"C4B","old":true}')
  for (const stored of [previous, null]) {
    const store = createPublishedCardObjectStore(env, {
      request: async (url, init) => {
        if (init.method === "PUT") throw new DOMException("The operation was aborted", "AbortError")
        return stored ? new Response(stored) : new Response(null, { status: 404 })
      },
    })
    await assert.rejects(
      store.writeStable("genes/v3/C4B.json", { symbol: "C4B" }),
      /The operation was aborted/,
    )
  }
  const unreachable = createPublishedCardObjectStore(env, {
    request: async (url, init) => {
      if (init.method === "PUT") throw new Error("Stable gene object PUT failed (503)")
      throw new Error("read-back unreachable")
    },
  })
  await assert.rejects(
    unreachable.writeStable("genes/v3/C4B.json", { symbol: "C4B" }),
    /PUT failed \(503\)/,
  )
})

// B-898 Stage 1: the stable gene object writer.
test("the stable gene object is written to a fixed key with a short TTL and verified by read-back", async () => {
  const { store, calls, objects } = fixture()
  const headers = []
  const seen = createPublishedCardObjectStore(env, {
    request: async (url, init, key) => {
      if (init.method === "PUT") headers.push(init.headers)
      calls.push({ method: init.method, key, url })
      if (init.method === "PUT") {
        objects.set(key, init.body.slice())
        return new Response(null, { status: 201 })
      }
      return objects.has(key) ? new Response(objects.get(key)) : new Response(null, { status: 404 })
    },
  })
  const first = await seen.writeStable("genes/v3/TP53.json", { symbol: "TP53", n: 1 })
  const second = await seen.writeStable("genes/v3/TP53.json", { symbol: "TP53", n: 2 })
  assert.equal(first.key, "genes/v3/TP53.json")
  assert.equal(second.key, first.key)
  assert.notEqual(second.hash, first.hash)
  assert.equal(headers[0]["Cache-Control"], "public, max-age=300, stale-while-revalidate=86400")
  assert.equal(headers[0]["Content-Type"], "application/json")
  assert.deepEqual(
    calls.map((c) => c.method),
    ["PUT", "GET", "PUT", "GET"],
  )
  assert.ok(calls[0].url.endsWith("/test-zone/genes/v3/TP53.json"))
  void store
})

test("the stable gene object rejects foreign keys, oversized bodies and unreadable writes", async () => {
  const { store } = fixture()
  await assert.rejects(store.writeStable("private/user.json", {}), /Invalid stable gene object key/)
  await assert.rejects(
    store.writeStable("genes/v3/tp53.json", {}),
    /Invalid stable gene object key/,
  )
  await assert.rejects(
    store.writeStable("genes/v3/TP53.json", { blob: "x".repeat(1024 * 1024) }),
    (error) => error.code === "PUBLISHED_OBJECT_OVERSIZED" && error.permanent === true,
  )
  const unreadable = fixture({ alterRead: () => null })
  await assert.rejects(
    unreadable.store.writeStable("genes/v3/TP53.json", { symbol: "TP53" }),
    /not yet readable/,
  )
  const corrupt = fixture({ alterRead: () => new TextEncoder().encode("{}") })
  await assert.rejects(
    corrupt.store.writeStable("genes/v3/TP53.json", { symbol: "TP53" }),
    /hash mismatch/,
  )
})

// A rewrite talks to storage only: the PUT and its verifying read. Bunny's purge
// API answered 429 for 19 of the first 80 genes of a bulk republish (2026-10-03),
// and the pull zone's 60 s edge rule already bounds staleness, so even with an
// account key configured nothing is purged.
test("a stable object rewrite sends only the PUT and its verifying GET, never a purge", async () => {
  const objects = new Map()
  const calls = []
  const store = createPublishedCardObjectStore(
    { ...env, BUNNY_ACCOUNT_API_KEY: "account-key" },
    {
      request: async (url, init, key) => {
        calls.push({ method: init.method, url })
        if (init.method === "PUT") {
          objects.set(key, init.body.slice())
          return new Response(null, { status: 201 })
        }
        return objects.has(key)
          ? new Response(objects.get(key))
          : new Response(null, { status: 404 })
      },
    },
  )
  await store.writeStable("genes/v3/TP53.json", { symbol: "TP53" })
  assert.deepEqual(
    calls.map((c) => c.method),
    ["PUT", "GET"],
  )
  assert.equal(
    calls.some((c) => c.url.includes("api.bunny.net")),
    false,
  )
})

// B-1055: a gene the catalogue no longer carries loses its page. The delete's
// outcome is "no object", so a missing object is success; a storage fault is not.
test("a stable delete removes the object, treats a missing one as done, and throws on a fault", async () => {
  const objects = new Map([["genes/v3/ADGRE4P.json", new Uint8Array([1])]])
  const calls = []
  let fault = false
  const store = createPublishedCardObjectStore(env, {
    request: async (url, init, key) => {
      calls.push({ method: init.method, key, url: String(url) })
      if (fault) return new Response(null, { status: 500 })
      return new Response(null, { status: objects.delete(key) ? 200 : 404 })
    },
  })
  assert.deepEqual(await store.deleteStable("genes/v3/ADGRE4P.json"), {
    key: "genes/v3/ADGRE4P.json",
    symbol: "ADGRE4P",
    deleted: true,
  })
  assert.equal(objects.size, 0)
  assert.equal((await store.deleteStable("genes/v3/ADGRE4P.json")).deleted, false)
  fault = true
  await assert.rejects(store.deleteStable("genes/v3/ADGRE4P.json"), /DELETE failed \(500\)/)
  assert.deepEqual(
    calls.map((call) => call.method),
    ["DELETE", "DELETE", "DELETE"],
  )
  assert.match(calls[0].url, /\/test-zone\/genes\/v3\/ADGRE4P\.json$/)
})

test("a stable delete refuses the catalog object and every non-gene key", async () => {
  const store = createPublishedCardObjectStore(env, {
    request: async () => assert.fail("a refused delete must not reach storage"),
  })
  await assert.rejects(store.deleteStable("catalog/v3/index.json"), /Only a stable gene object/)
  await assert.rejects(
    store.deleteStable("genes/v3/../index.json"),
    /Invalid stable gene object key/,
  )
})
