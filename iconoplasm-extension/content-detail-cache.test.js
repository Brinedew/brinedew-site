import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

// B-898 stage 1: hover detail is one stable, mutable object per gene on the
// free CDN (genes/v3/<SYMBOL>.json). The page store is a small bounded
// in-memory cache with a 5-minute TTL in front of the service worker's fetch.
//
// Failure modes this file pins down, written before the store was rewritten:
// 1. Stable object served -> exactly one fetch; the record is returned as-is.
// 2. Second request within the TTL -> no second fetch (cache hit).
// 3. CDN 404 ("missing") -> null is cached for the TTL; repeated hovers do not
//    turn into a retry storm.
// 4. Malformed result (found without an object record) -> treated as missing.
// 5. Transport error -> onError, nothing cached, the next request retries.
// 6. Concurrent callers for the same symbol share one in-flight request.
// 7. TTL expiry -> the next request refetches.
// 8. Caller abort -> that caller resolves null without caching, while the
//    shared request still lands in the cache for everyone else.
// 9. The cache is bounded: the oldest entry is evicted past maxEntries.
// 10. Symbols are normalized and de-duplicated before any fetch.

const source = await readFile(new URL("./content-detail-cache.js", import.meta.url), "utf8")

function loadFactory() {
  const sandbox = { console, setTimeout, clearTimeout }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  return sandbox.IconoplasmContentDetailCache.createGeneDetailStore
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function stableGene(symbol) {
  return {
    symbol,
    canonical_symbol: symbol,
    full_name: `${symbol} full name`,
    color: "#35353c",
    essence: { name: `${symbol} full name` },
    stable_object_version: 3,
    portrait: { asset_sha256: "e".repeat(64), medium_url: "https://x/medium.webp" },
    portrait_candidates: [],
  }
}

function harness(overrides = {}) {
  const createGeneDetailStore = loadFactory()
  const calls = []
  const errors = []
  let now = 1_000_000
  const results = overrides.results || {}
  const store = createGeneDetailStore({
    now: () => now,
    ttlMs: 300_000,
    maxEntries: overrides.maxEntries || 512,
    onError: (error) => errors.push(error),
    fetchGene: async (symbol) => {
      calls.push(symbol)
      const result = results[symbol]
      if (typeof result === "function") return result()
      if (result === undefined) return { status: "missing" }
      return result
    },
    ...overrides.options,
  })
  return { store, calls, errors, advance: (ms) => (now += ms) }
}

test("a served stable object is fetched once and returned as the gene record", async () => {
  const { store, calls } = harness({
    results: { TP53: { status: "found", gene: stableGene("TP53") } },
  })
  const resolved = await store.fetchBatch(["TP53"], { priority: "foreground" })
  assert.deepEqual(calls, ["TP53"])
  assert.equal(resolved.get("TP53").full_name, "TP53 full name")
  assert.equal(store.has("TP53"), true)
  assert.equal(store.get("TP53").portrait.asset_sha256, "e".repeat(64))
})

test("a cache hit within the TTL never fetches again", async () => {
  const { store, calls } = harness({
    results: { TP53: { status: "found", gene: stableGene("TP53") } },
  })
  await store.fetchBatch(["TP53"], { priority: "foreground" })
  await store.fetchBatch(["TP53"], { priority: "background" })
  await store.fetchBatch(["tp53 "], { priority: "foreground" })
  assert.deepEqual(calls, ["TP53"])
})

test("a CDN 404 is a missing card for the TTL, not a retry storm", async () => {
  const { store, calls, errors } = harness({ results: { NOTAGENE: { status: "missing" } } })
  for (let hover = 0; hover < 25; hover += 1) {
    const resolved = await store.fetchBatch(["NOTAGENE"], { priority: "foreground" })
    assert.equal(resolved.get("NOTAGENE"), null)
  }
  assert.deepEqual(calls, ["NOTAGENE"])
  assert.equal(store.has("NOTAGENE"), true, "a missing card is a cached answer")
  assert.equal(store.get("NOTAGENE"), null)
  assert.equal(errors.length, 0)
})

test("a malformed found result is treated as a missing card", async () => {
  const { store, calls } = harness({
    results: {
      BAD1: { status: "found", gene: "not an object" },
      BAD2: { status: "found" },
      BAD3: { status: "found", gene: { symbol: "OTHER" } },
    },
  })
  const resolved = await store.fetchBatch(["BAD1", "BAD2", "BAD3"], { priority: "foreground" })
  assert.equal(resolved.get("BAD1"), null)
  assert.equal(resolved.get("BAD2"), null)
  assert.equal(resolved.get("BAD3"), null)
  assert.deepEqual(calls.sort(), ["BAD1", "BAD2", "BAD3"])
  await store.fetchBatch(["BAD1", "BAD2", "BAD3"], { priority: "foreground" })
  assert.equal(calls.length, 3, "malformed objects are cached as missing for the TTL")
})

test("a transport error reports, caches nothing, and the next request retries", async () => {
  let attempts = 0
  const { store, calls, errors } = harness({
    results: {
      TP53: () => {
        attempts += 1
        if (attempts === 1) throw new Error("network down")
        if (attempts === 2) return { status: "error", error: "HTTP 503" }
        return { status: "found", gene: stableGene("TP53") }
      },
    },
  })
  assert.equal((await store.fetchBatch(["TP53"], { priority: "foreground" })).get("TP53"), null)
  assert.equal(store.has("TP53"), false, "an error is not a cached absence")
  assert.equal((await store.fetchBatch(["TP53"], { priority: "foreground" })).get("TP53"), null)
  assert.equal(store.has("TP53"), false)
  const third = await store.fetchBatch(["TP53"], { priority: "foreground" })
  assert.equal(third.get("TP53").symbol, "TP53")
  assert.deepEqual(calls, ["TP53", "TP53", "TP53"])
  assert.equal(errors.length, 2)
})

test("concurrent callers share one in-flight request per symbol", async () => {
  const gate = deferred()
  const { store, calls } = harness({ results: { TP53: () => gate.promise } })
  const background = store.fetchBatch(["TP53"], { priority: "background" })
  const foreground = store.fetchBatch(["TP53"], { priority: "foreground" })
  assert.deepEqual(calls, ["TP53"])
  gate.resolve({ status: "found", gene: stableGene("TP53") })
  const [first, second] = await Promise.all([background, foreground])
  assert.equal(first.get("TP53").symbol, "TP53")
  assert.equal(second.get("TP53").symbol, "TP53")
  assert.deepEqual(calls, ["TP53"])
})

test("an expired entry is refetched after the TTL", async () => {
  const { store, calls, advance } = harness({
    results: { TP53: { status: "found", gene: stableGene("TP53") } },
  })
  await store.fetchBatch(["TP53"], { priority: "foreground" })
  advance(299_000)
  await store.fetchBatch(["TP53"], { priority: "foreground" })
  assert.deepEqual(calls, ["TP53"])
  assert.equal(store.has("TP53"), true)
  advance(2_000)
  assert.equal(store.has("TP53"), false, "an expired entry is not a cache hit")
  await store.fetchBatch(["TP53"], { priority: "foreground" })
  assert.deepEqual(calls, ["TP53", "TP53"])
})

test("an aborted caller resolves null while the shared request still fills the cache", async () => {
  const gate = deferred()
  const { store, calls } = harness({ results: { TP53: () => gate.promise } })
  const controller = new AbortController()
  const aborted = store.fetchBatch(["TP53"], { priority: "foreground", signal: controller.signal })
  const patient = store.fetchBatch(["TP53"], { priority: "background" })
  controller.abort()
  assert.equal((await aborted).get("TP53"), null)
  assert.equal(store.has("TP53"), false)
  gate.resolve({ status: "found", gene: stableGene("TP53") })
  assert.equal((await patient).get("TP53").symbol, "TP53")
  assert.equal(store.has("TP53"), true)
  assert.deepEqual(calls, ["TP53"])
})

test("the cache is bounded and evicts the oldest entry", async () => {
  const results = {}
  for (const symbol of ["A", "B", "C", "D"])
    results[symbol] = { status: "found", gene: stableGene(symbol) }
  const { store } = harness({ results, maxEntries: 3 })
  await store.fetchBatch(["A", "B", "C"], { priority: "background" })
  assert.equal(store.has("A"), true)
  await store.fetchBatch(["D"], { priority: "background" })
  assert.equal(store.has("A"), false)
  assert.equal(store.has("B"), true)
  assert.equal(store.has("D"), true)
})

test("symbols are normalized and de-duplicated before any fetch", async () => {
  const { store, calls } = harness({
    results: { TP53: { status: "found", gene: stableGene("TP53") } },
  })
  const resolved = await store.fetchBatch([" tp53", "TP53", "", null, "Tp53"], {
    priority: "foreground",
  })
  assert.deepEqual(calls, ["TP53"])
  assert.equal(resolved.size, 1)
  assert.equal(resolved.get("TP53").symbol, "TP53")
})
