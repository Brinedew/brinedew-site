import assert from "node:assert/strict"
import test from "node:test"
import {
  createPublishedCardObjectStore,
  publishedGeneBlotAliasKey,
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

test("the publisher advances a verified stable blot alias from exact immutable bytes", async () => {
  const { store, objects, calls } = fixture()
  const symbol = "TP53"
  const fingerprint = "b".repeat(64)
  const bytes = new TextEncoder().encode("webp-fixture")
  const assetSha = await crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    )
  const objectKey = `blots/v1/T/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`
  objects.set(objectKey, bytes)

  const receipt = await store.publishBlotAlias(symbol, {
    status: "ready",
    blot_fingerprint: fingerprint,
    asset_sha256: assetSha,
    object_key: objectKey,
  })

  assert.equal(receipt.key, publishedGeneBlotAliasKey(symbol))
  assert.deepEqual(objects.get(receipt.key), bytes)
  assert.deepEqual(
    calls.slice(-3).map((call) => [call.method, call.key]),
    [
      ["GET", objectKey],
      ["PUT", "blot/TP53.webp"],
      ["GET", "blot/TP53.webp"],
    ],
  )
})

test("a canonical CDN copy repairs a divergent blot origin before alias publication", async () => {
  const repairEnv = {
    ...env,
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://cdn.example.test",
  }
  const symbol = "TP53"
  const fingerprint = "b".repeat(64)
  const canonical = new TextEncoder().encode("canonical-webp")
  const divergent = new TextEncoder().encode("divergent-origin-webp")
  const assetSha = await crypto.subtle
    .digest("SHA-256", canonical)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    )
  const objectKey = `blots/v1/T/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`
  const origin = new Map([[objectKey, divergent]])
  const cdn = new Map([[objectKey, canonical]])
  const calls = []
  const store = createPublishedCardObjectStore(repairEnv, {
    request: async (url, init, key) => {
      const source = String(url).startsWith("https://cdn.example.test") ? "cdn" : "origin"
      calls.push({ method: init.method, key, source })
      if (init.method === "PUT") {
        origin.set(key, init.body.slice())
        return new Response(null, { status: 201 })
      }
      const bytes = source === "cdn" ? cdn.get(key) : origin.get(key)
      return bytes ? new Response(bytes) : new Response(null, { status: 404 })
    },
  })

  const receipt = await store.publishBlotAlias(symbol, {
    status: "ready",
    blot_fingerprint: fingerprint,
    asset_sha256: assetSha,
    object_key: objectKey,
  })

  assert.deepEqual(origin.get(objectKey), canonical)
  assert.deepEqual(origin.get(receipt.key), canonical)
  assert.equal(
    cdn.has(receipt.key),
    false,
    "the mutable CDN alias may remain stale after origin PUT",
  )
  assert.deepEqual(receipt.sources, { authenticated_storage: true })
  // calls[0..1] are the alias pre-check across both sources; the immutable
  // repair sequence follows.
  assert.deepEqual(
    calls.slice(2, 6).map(({ method, key, source }) => [method, key, source]),
    [
      ["GET", objectKey, "origin"],
      ["GET", objectKey, "cdn"],
      ["PUT", objectKey, "origin"],
      ["GET", objectKey, "origin"],
    ],
  )
})

test("a stale storage alias is skipped when the public copy already serves the exact bytes", async () => {
  const repairEnv = {
    ...env,
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://cdn.example.test",
  }
  const symbol = "TP53"
  const fingerprint = "b".repeat(64)
  const exact = new TextEncoder().encode("webp-fixture")
  const stale = new TextEncoder().encode("stale-placeholder")
  const assetSha = await crypto.subtle
    .digest("SHA-256", exact)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    )
  const objectKey = `blots/v1/T/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`
  const aliasKey = publishedGeneBlotAliasKey(symbol)
  const calls = []
  const store = createPublishedCardObjectStore(repairEnv, {
    request: async (url, init, key) => {
      const source = String(url).startsWith("https://cdn.example.test") ? "cdn" : "origin"
      calls.push({ method: init.method, key, source })
      if (init.method === "PUT") return new Response(null, { status: 201 })
      if (key === objectKey && source === "origin") return new Response(exact)
      if (key === aliasKey) return new Response(source === "cdn" ? exact : stale)
      return new Response(null, { status: 404 })
    },
  })

  const receipt = await store.publishBlotAlias(symbol, {
    status: "ready",
    blot_fingerprint: fingerprint,
    asset_sha256: assetSha,
    object_key: objectKey,
  })

  assert.equal(receipt.skipped, true)
  assert.deepEqual(receipt.sources, { public_cdn: true })
  assert.equal(
    calls.some((call) => call.method === "PUT"),
    false,
    "an alias correct on any configured source never pays a storage write",
  )
})

test("a lagging storage read-back verifies through another configured source", async () => {
  const repairEnv = {
    ...env,
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://cdn.example.test",
  }
  const symbol = "TP53"
  const fingerprint = "b".repeat(64)
  const bytes = new TextEncoder().encode("webp-fixture")
  const assetSha = await crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    )
  const objectKey = `blots/v1/T/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`
  const aliasKey = publishedGeneBlotAliasKey(symbol)
  let aliasPut = false
  const calls = []
  const store = createPublishedCardObjectStore(repairEnv, {
    request: async (url, init, key) => {
      const source = String(url).startsWith("https://cdn.example.test") ? "cdn" : "origin"
      calls.push({ method: init.method, key, source })
      if (init.method === "PUT") {
        if (key === aliasKey) aliasPut = true
        return new Response(null, { status: 201 })
      }
      if (key === objectKey && source === "origin") return new Response(bytes)
      if (key === aliasKey && source === "cdn" && aliasPut) return new Response(bytes)
      return new Response(null, { status: 404 })
    },
  })

  const receipt = await store.publishBlotAlias(symbol, {
    status: "ready",
    blot_fingerprint: fingerprint,
    asset_sha256: assetSha,
    object_key: objectKey,
  })

  assert.deepEqual(receipt.sources, { public_cdn: true })
  assert.equal(calls.filter((call) => call.method === "PUT").length, 1)
})

test("an alias already serving the exact immutable bytes skips the idempotent PUT", async () => {
  const { store, objects, calls } = fixture()
  const symbol = "TP53"
  const fingerprint = "b".repeat(64)
  const bytes = new TextEncoder().encode("webp-fixture")
  const assetSha = await crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    )
  const objectKey = `blots/v1/T/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`
  const aliasKey = publishedGeneBlotAliasKey(symbol)
  objects.set(objectKey, bytes)
  objects.set(aliasKey, bytes)

  const receipt = await store.publishBlotAlias(symbol, {
    status: "ready",
    blot_fingerprint: fingerprint,
    asset_sha256: assetSha,
    object_key: objectKey,
  })

  assert.equal(receipt.skipped, true)
  assert.equal(receipt.key, aliasKey)
  assert.equal(receipt.hash, assetSha)
  assert.equal(
    calls.some((call) => call.method === "PUT"),
    false,
    "an exact existing alias never pays a storage write",
  )
})

test("divergent origin is not repaired from CDN bytes that fail the canonical hash", async () => {
  const repairEnv = {
    ...env,
    ICONOPLASM_EXTERNAL_PORTRAIT_CDN_BASE_URL: "https://cdn.example.test",
  }
  const symbol = "TP53"
  const fingerprint = "b".repeat(64)
  const expected = new TextEncoder().encode("expected-webp")
  const divergent = new TextEncoder().encode("divergent-origin-webp")
  const staleCdn = new TextEncoder().encode("wrong-cdn-webp")
  const assetSha = await crypto.subtle
    .digest("SHA-256", expected)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    )
  const objectKey = `blots/v1/T/${symbol}/${fingerprint}/${symbol}-iconoplasm-gene-blot.webp`
  const calls = []
  const store = createPublishedCardObjectStore(repairEnv, {
    request: async (url, init, key) => {
      const source = String(url).startsWith("https://cdn.example.test") ? "cdn" : "origin"
      calls.push({ method: init.method, key, source })
      const bytes = source === "cdn" ? staleCdn : divergent
      return new Response(bytes)
    },
  })

  await assert.rejects(
    store.publishBlotAlias(symbol, {
      status: "ready",
      blot_fingerprint: fingerprint,
      asset_sha256: assetSha,
      object_key: objectKey,
    }),
    /hash mismatch/,
  )
  assert.equal(
    calls.some(({ method }) => method === "PUT"),
    false,
  )
})

test("a published gene without a blot receives verified placeholder image bytes", async () => {
  const { store, objects } = fixture()
  const receipt = await store.publishBlotAlias("RB1", null)
  const bytes = objects.get(receipt.key)
  assert.equal(receipt.key, "blot/RB1.webp")
  assert.match(new TextDecoder().decode(bytes), /^<svg/)
  assert.equal(receipt.contentType, "image/svg+xml")
})

test("alias backfill may replace a genuinely missing immutable blot with the placeholder", async () => {
  const { store, objects } = fixture()
  const missing = {
    status: "ready",
    blot_fingerprint: "b".repeat(64),
    asset_sha256: "c".repeat(64),
    object_key: `blots/v1/A/ADAP1/${"b".repeat(64)}/ADAP1-iconoplasm-gene-blot.webp`,
  }

  await assert.rejects(store.publishBlotAlias("ADAP1", missing), /GET failed \(404\)/)
  const receipt = await store.publishBlotAlias("ADAP1", missing, {
    allowMissingImmutablePlaceholder: true,
  })

  assert.equal(receipt.key, "blot/ADAP1.webp")
  assert.equal(receipt.contentType, "image/svg+xml")
  assert.match(new TextDecoder().decode(objects.get(receipt.key)), /^<svg/)
})
