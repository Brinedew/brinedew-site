import assert from "node:assert/strict"
import test from "node:test"
import {
  createPublishedCardObjectStore,
  publishedCardObjectKey,
} from "./lib/iconoplasm-published-card-objects.js"

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

test("immutable object identity ignores property order and changes with actual content", async () => {
  const { store, calls } = fixture()
  const first = await store.write("genes", { symbol: "EZH2", name: "first" })
  const same = await store.write("genes", { name: "first", symbol: "EZH2" })
  const next = await store.write("genes", { symbol: "EZH2", name: "next" })
  assert.equal(first.key, same.key)
  assert.notEqual(first.key, next.key)
  assert.deepEqual((await store.read(first.key)).value, { name: "first", symbol: "EZH2" })
  assert.deepEqual(
    calls.slice(0, 2).map((x) => x.method),
    ["PUT", "GET"],
  )
})

test("a rematerialization can reuse exact immutable bytes and uploads a genuine miss", async () => {
  const { store, calls } = fixture()
  const value = { symbol: "EZH2", name: "same" }
  const first = await store.write("genes", value, { reuseExisting: true })
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET", "PUT", "GET"],
  )

  calls.length = 0
  const second = await store.write(
    "genes",
    { name: "same", symbol: "EZH2" },
    { reuseExisting: true },
  )
  assert.equal(second.key, first.key)
  assert.equal(second.skipped, true)
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET"],
  )
})

test("a corrupt immutable object is not accepted or overwritten as a cache hit", async () => {
  const { store, calls, objects } = fixture()
  const value = { symbol: "EZH2", name: "same" }
  const receipt = await store.write("genes", value)
  objects.set(receipt.key, new TextEncoder().encode("{}"))
  calls.length = 0

  await assert.rejects(store.write("genes", value, { reuseExisting: true }), /hash mismatch/)
  assert.deepEqual(
    calls.map((call) => call.method),
    ["GET"],
  )
})

test("PUT success without readable bytes cannot acknowledge publication", async () => {
  const { store } = fixture({ alterRead: () => null })
  await assert.rejects(store.write("genes", { symbol: "EZH2" }), /not yet readable/)
})

test("corrupt bytes and failed uploads cannot acknowledge publication", async () => {
  const corrupt = fixture({ alterRead: () => new TextEncoder().encode("{}") })
  await assert.rejects(corrupt.store.write("genes", { symbol: "EZH2" }), /hash mismatch/)
  await assert.rejects(fixture({ status: 503 }).store.write("genes", {}), /PUT failed/)
})

test("read misses never write or consult a relational database", async () => {
  const { store, calls } = fixture()
  assert.equal(await store.read(publishedCardObjectKey("genes", "a".repeat(64))), null)
  assert.deepEqual(
    calls.map((x) => x.method),
    ["GET"],
  )
})

test("namespace and byte limits fail before an unsafe storage write", async () => {
  const { store, calls } = fixture()
  await assert.rejects(store.read("private/user.json"), /namespace/)
  await assert.rejects(
    store.write("portraits", { value: "x".repeat(8192) }),
    /byte limit: kind=portraits, bytes=8204, limit=8192/,
  )
  assert.equal(calls.length, 0)
})

test("cards and genes accept a complete candidate pool up to 256 KiB (B-792)", async () => {
  const { store } = fixture()
  // A document between the old 64 KiB bound and the new one is a legitimate
  // published pool, not an error.
  const written = await store.write("genes", { value: "x".repeat(100 * 1024) })
  assert.equal(written.size > 64 * 1024, true)
  const read = await store.read(written.key)
  assert.equal(read.value.value.length, 100 * 1024)
})

test("an oversized document is a permanent failure that names its input (B-792)", async () => {
  const { store, calls } = fixture()
  await assert.rejects(store.write("genes", { value: "x".repeat(256 * 1024) }), (error) => {
    assert.match(error.message, /byte limit: kind=genes/)
    assert.equal(error.code, "PUBLISHED_OBJECT_OVERSIZED")
    assert.equal(error.permanent, true)
    assert.deepEqual(error.details, {
      object_kind: "genes",
      bytes: error.details.bytes,
      limit: 262144,
    })
    assert.ok(error.details.bytes > 262144)
    return true
  })
  // The rejected document never reached storage.
  assert.equal(calls.length, 0)
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
  await assert.rejects(store.read(publishedCardObjectKey("genes", "a".repeat(64))), /timed out/)
  assert.equal(cancelled, true)
})

test("a transient storage timeout is retried and the publication commits (B-753)", async () => {
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
    const receipt = await store.write("genes", { symbol: "EZH2", name: "retry" })
    assert.equal(putAttempts, 2)
    assert.ok(receipt.key)
  } finally {
    globalThis.fetch = originalFetch
  }
})

async function blotFixture(symbol, bytes) {
  const fingerprint = "b".repeat(64)
  const assetSha = await crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    )
  const objectKey = `blots/v1/${symbol[0]}/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`
  return {
    key: objectKey,
    blot: {
      status: "ready",
      blot_fingerprint: fingerprint,
      asset_sha256: assetSha,
      object_key: objectKey,
    },
  }
}

test("publication verifies the exact immutable blot without writing a mutable alias", async () => {
  const { store, objects, calls } = fixture()
  const bytes = new TextEncoder().encode("webp-fixture")
  const { key, blot } = await blotFixture("TP53", bytes)
  objects.set(key, bytes)

  const receipt = await store.verifyBlot("TP53", blot)

  assert.equal(receipt.key, key)
  assert.equal(receipt.hash, blot.asset_sha256)
  assert.deepEqual(
    calls.map((call) => [call.method, call.key]),
    [["GET", key]],
  )
  assert.equal(objects.has("blot/TP53.webp"), false)
})

test("exact immutable CDN bytes repair a divergent origin before publication", async () => {
  const repairEnv = {
    ...env,
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://cdn.example.test",
  }
  const canonical = new TextEncoder().encode("canonical-webp")
  const divergent = new TextEncoder().encode("divergent-origin-webp")
  const { key, blot } = await blotFixture("TP53", canonical)
  const origin = new Map([[key, divergent]])
  const cdn = new Map([[key, canonical]])
  const calls = []
  const store = createPublishedCardObjectStore(repairEnv, {
    request: async (url, init, objectKey) => {
      const source = String(url).startsWith("https://cdn.example.test") ? "cdn" : "origin"
      calls.push({ method: init.method, key: objectKey, source })
      if (init.method === "PUT") {
        origin.set(objectKey, init.body.slice())
        return new Response(null, { status: 201 })
      }
      const bytes = source === "cdn" ? cdn.get(objectKey) : origin.get(objectKey)
      return bytes ? new Response(bytes) : new Response(null, { status: 404 })
    },
  })

  const receipt = await store.verifyBlot("TP53", blot)

  assert.deepEqual(origin.get(key), canonical)
  assert.deepEqual(receipt.sources, { authenticated_storage: true, public_cdn: true })
  assert.deepEqual(
    calls.map(({ method, key: objectKey }) => [method, objectKey]),
    [
      ["GET", key],
      ["GET", key],
      ["PUT", key],
      ["GET", key],
    ],
  )
  assert.equal(origin.has("blot/TP53.webp"), false)
})

test("missing and mismatched immutable blots cannot advance ordinary publication", async () => {
  const { store, objects } = fixture()
  const { key, blot } = await blotFixture("TP53", new TextEncoder().encode("exact-webp"))
  await assert.rejects(store.verifyBlot("TP53", blot), /GET failed \(404\)/)
  objects.set(key, new TextEncoder().encode("wrong-webp"))
  await assert.rejects(store.verifyBlot("TP53", blot), /hash mismatch/)
})

test("a card without a blot needs no image verification", async () => {
  const { store } = fixture()
  assert.deepEqual(await store.verifyBlot("ADAP1", null), { skipped: true })
})
