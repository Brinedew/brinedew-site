import assert from "node:assert/strict"
import test from "node:test"
import { IDBFactory, IDBObjectStore } from "fake-indexeddb"
import "./immutable-response-cache.js"

const { createImmutableResponseCache } = globalThis.IconoplasmImmutableResponseCache
const bytes = (value) => new TextEncoder().encode(value)
function fixture(extra = {}) {
  const indexedDB = new IDBFactory()
  const options = {
    name: "test",
    indexedDB,
    legacyStorage: null,
    maxEntries: 10,
    maxBytes: 60,
    maxEntryBytes: 20,
    memoryEntries: 3,
    ...extra,
  }
  return { indexedDB, options, create: () => createImmutableResponseCache(options) }
}
async function inspect(indexedDB) {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open("iconoplasm-immutable:test", 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(["entries", "state"], "readonly")
      const entries = tx.objectStore("entries").getAll()
      const totals = tx.objectStore("state").get("totals")
      tx.oncomplete = () => resolve({ entries: entries.result, totals: totals.result })
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

test("immutable bytes survive a new background runtime and an unrelated website", async () => {
  const disk = fixture()
  const wikipediaWorker = disk.create()
  const key = "https://iconoplasm.brinedew.bio/portraits/v1/hash/medium.webp"
  await wikipediaWorker.put(key, bytes("same portrait"), "image/webp")
  const paperWorker = disk.create()
  const cached = await paperWorker.get(key)
  assert.equal(await cached.text(), "same portrait")
  assert.equal(cached.headers.get("Content-Type"), "image/webp")
  assert.equal(await paperWorker.get(key + "changed"), null)
})

test("memory and disk reads durably refresh recency without rewriting image payloads", async (t) => {
  const disk = fixture({ maxBytes: 6, maxEntryBytes: 4 })
  const cache = disk.create()
  for (const key of ["a", "b", "c"]) await cache.put(key, bytes(key + key), "text/plain")
  const originalPut = IDBObjectStore.prototype.put
  let payloadWrites = 0
  t.mock.method(IDBObjectStore.prototype, "put", function (...args) {
    if (this.name === "payloads") payloadWrites++
    return originalPut.apply(this, args)
  })
  await cache.get("a") // RAM hit must protect a across a runtime restart.
  const restarted = disk.create()
  await restarted.put("d", bytes("dd"), "text/plain")
  assert.equal(await restarted.get("b"), null)
  assert.equal(await (await restarted.get("a")).text(), "aa")
  assert.equal(await (await restarted.get("c")).text(), "cc") // disk hit also touches recency
  await restarted.put("e", bytes("ee"), "text/plain")
  assert.equal(await disk.create().get("d"), null)
  assert.equal(payloadWrites, 2, "only the two new payloads were written, never the reads")
  const state = await inspect(disk.indexedDB)
  assert.equal(state.totals.bytes, 6)
  assert.equal(state.totals.count, 3)
})

test("the image budget retains more than 128 normal portraits without premature count eviction", async () => {
  const disk = fixture({
    maxEntries: 8192,
    maxBytes: 64 * 1024 * 1024,
    maxEntryBytes: 512 * 1024,
    memoryEntries: 1,
  })
  const cache = disk.create()
  const body = new Uint8Array(40 * 1024)
  await Promise.all(
    Array.from({ length: 160 }, (_, i) => cache.put("image:" + i, body, "image/webp")),
  )
  const restarted = disk.create()
  assert.equal((await (await restarted.get("image:0")).arrayBuffer()).byteLength, body.length)
  const state = await inspect(disk.indexedDB)
  assert.equal(state.totals.bytes, 160 * body.length)
  assert.equal(state.totals.count, 160)
})

test("concurrent fills and replacements obey both total bytes and the metadata safety bound", async () => {
  const disk = fixture({ maxEntries: 3, maxBytes: 8, maxEntryBytes: 6, memoryEntries: 1 })
  const cache = disk.create()
  await Promise.all(
    ["a", "b", "c", "d"].map((key) => cache.put(key, bytes(key + key), "text/plain")),
  )
  assert.equal(await disk.create().get("a"), null)
  await cache.put("b", bytes("bbbbbb"), "text/plain")
  const state = await inspect(disk.indexedDB)
  assert.equal(state.totals.bytes, 8)
  assert.equal(state.totals.count, 2)
  assert.deepEqual(state.entries.map((entry) => entry.key).sort(), ["b", "d"])
  assert.equal(await cache.put("large", bytes("too many bytes"), "text/plain"), false)
  assert.equal(await cache.put("empty", bytes(""), "text/plain"), false)
})

test("an aborted write cannot evict old data or corrupt accounting, and keeps the RAM copy", async (t) => {
  const disk = fixture({ maxEntries: 2, maxBytes: 3, maxEntryBytes: 3 })
  const cache = disk.create()
  await cache.put("a", bytes("aa"), "text/plain")
  const originalPut = IDBObjectStore.prototype.put
  const abort = t.mock.method(IDBObjectStore.prototype, "put", function (...args) {
    const request = originalPut.apply(this, args)
    if (this.name === "state") this.transaction.abort()
    return request
  })
  assert.equal(await cache.put("b", bytes("bb"), "text/plain"), false)
  abort.mock.restore()
  assert.equal(await (await cache.get("b")).text(), "bb")
  const restarted = disk.create()
  assert.equal(await restarted.get("b"), null)
  assert.equal(await (await restarted.get("a")).text(), "aa")
  const state = await inspect(disk.indexedDB)
  assert.equal(state.totals.bytes, 2)
  assert.equal(state.totals.count, 1)
})

test("legacy saved bytes migrate by exact key without redownloading or bulk hydration", async () => {
  const key = "https://test/old-image"
  const entries = new Map([
    [key, new Response("old pixels", { headers: { "Content-Type": "image/webp" } })],
  ])
  const matched = []
  const disk = fixture({
    legacyStorage: {
      open: async () => ({
        match: async (name) => {
          matched.push(name)
          return entries.get(name)?.clone()
        },
        delete: async (name) => entries.delete(name),
      }),
    },
  })
  const responseworker = disk.create()
  assert.equal(await (await responseworker.get(key)).text(), "old pixels")
  for (let attempt = 0; entries.size && attempt < 40; attempt++)
    await new Promise((resolve) => setImmediate(resolve))
  assert.equal(entries.size, 0, "legacy bytes are removed only after the new transaction commits")
  assert.deepEqual(matched, [key], "migration did not enumerate or hydrate unrelated records")
  assert.equal(await (await disk.create().get(key)).text(), "old pixels")
})

test("unavailable storage retains usable bytes in memory and never caches failures", async () => {
  const cache = createImmutableResponseCache({
    name: "test",
    maxEntries: 2,
    maxEntryBytes: 20,
    indexedDB: null,
    legacyStorage: null,
  })
  assert.equal(await cache.put("image", bytes("pixels"), "image/webp"), false)
  assert.equal(await (await cache.get("image")).text(), "pixels")
  cache.clearMemory()
  assert.equal(await cache.get("image"), null)
})

test("cache budgets must be finite positive integers and admit no over-budget entry", () => {
  for (const invalid of [{ maxEntries: 0 }, { maxBytes: Infinity }, { maxEntryBytes: 61 }])
    assert.throws(() => fixture(invalid).create(), /Invalid immutable cache budget/)
})
