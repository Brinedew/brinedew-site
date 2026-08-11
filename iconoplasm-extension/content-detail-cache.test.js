import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"
import vm from "node:vm"

// ARCHITECTURE FENCE [IPD-008]: hover detail is persistent, revision-keyed published data.

const source = await readFile(new URL("./content-detail-cache.js", import.meta.url), "utf8")

function loadFactory() {
  const sandbox = {
    console,
    setTimeout,
    clearTimeout,
  }
  sandbox.globalThis = sandbox
  vm.runInNewContext(source, sandbox)
  return sandbox.IconoplasmContentDetailCache.createGeneDetailStore
}

function createStorage(initial = {}) {
  const values = structuredClone(initial)
  return {
    values,
    async get(keys) {
      const result = {}
      for (const key of keys) {
        if (Object.hasOwn(values, key)) result[key] = structuredClone(values[key])
      }
      return result
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) {
        values[key] = structuredClone(value)
      }
    },
    async remove(keys) {
      for (const key of keys) delete values[key]
    },
  }
}

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return structuredClone(payload)
    },
  }
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

test("published gene details survive navigation without another batch request", async () => {
  const createGeneDetailStore = loadFactory()
  const storage = createStorage()
  let fetchCount = 0
  const first = createGeneDetailStore({
    windowRef: globalThis,
    storageApi: storage,
    getRevision: async () => "card-v1",
    batchUrl: "https://example.test/batch",
    fetchImpl: async () => {
      fetchCount += 1
      return response({
        snapshot_version: "card-v1",
        genes: [{ symbol: "TP53", full_name: "tumor protein p53" }],
        missing: [],
      })
    },
  })

  assert.equal((await first.fetchBatch(["TP53"])).get("TP53")?.full_name, "tumor protein p53")
  assert.equal(fetchCount, 1)
  await first.flushPersistence()

  const second = createGeneDetailStore({
    windowRef: globalThis,
    storageApi: storage,
    getRevision: async () => "card-v1",
    batchUrl: "https://example.test/batch",
    fetchImpl: async () => {
      fetchCount += 1
      throw new Error("persistent cache was not reused")
    },
  })

  assert.equal((await second.fetchBatch(["TP53"])).get("TP53")?.full_name, "tumor protein p53")
  assert.equal(fetchCount, 1)
})

test("a new card snapshot invalidates persisted details before reuse", async () => {
  const createGeneDetailStore = loadFactory()
  const storage = createStorage({
    iconoplasm_published_gene_detail_cache_v1: {
      schema_version: 1,
      revision: "card-v1",
      entries: [["TP53", { symbol: "TP53", color: "#111111" }]],
    },
  })
  let fetchCount = 0
  const store = createGeneDetailStore({
    windowRef: globalThis,
    storageApi: storage,
    getRevision: async () => "card-v2",
    batchUrl: "https://example.test/batch",
    fetchImpl: async () => {
      fetchCount += 1
      return response({
        snapshot_version: "card-v2",
        genes: [{ symbol: "TP53", color: "#abcdef" }],
        missing: [],
      })
    },
  })

  assert.equal((await store.fetchBatch(["TP53"])).get("TP53")?.color, "#abcdef")
  assert.equal(fetchCount, 1)
  await store.flushPersistence()
  assert.equal(storage.values.iconoplasm_published_gene_detail_cache_v1.revision, "card-v2")
})

test("persistent detail storage obeys a byte budget as well as an entry count", async () => {
  const createGeneDetailStore = loadFactory()
  const storage = createStorage()
  const store = createGeneDetailStore({
    windowRef: globalThis,
    storageApi: storage,
    persistentLimit: 512,
    persistentByteLimit: 1400,
    getRevision: async () => "card-v1",
    batchUrl: "https://example.test/batch",
    fetchImpl: async (_url, options) => {
      const symbols = JSON.parse(options.body).symbols
      return response({
        snapshot_version: "card-v1",
        genes: symbols.map((symbol) => ({
          symbol,
          essence: "x".repeat(480),
          portrait: { medium_url: `https://example.test/${symbol}.webp` },
        })),
        missing: [],
      })
    },
  })

  await store.fetchBatch(["TP53", "BRCA1", "EGFR", "KRAS"])
  await store.flushPersistence()

  const persisted = storage.values.iconoplasm_published_gene_detail_cache_v1
  const persistedBytes = Buffer.byteLength(JSON.stringify(persisted), "utf8")
  assert.ok(persistedBytes <= 1400)
  assert.ok(persisted.entries.length < 4)
  assert.ok(store.cache.size >= persisted.entries.length)
})

test("transient batch failures remain retryable instead of becoming missing genes", async () => {
  const createGeneDetailStore = loadFactory()
  let fetchCount = 0
  const store = createGeneDetailStore({
    windowRef: globalThis,
    getRevision: async () => "card-v1",
    batchUrl: "https://example.test/batch",
    fetchImpl: async () => {
      fetchCount += 1
      if (fetchCount === 1) throw new Error("temporary timeout")
      return response({
        snapshot_version: "card-v1",
        genes: [{ symbol: "PRL", full_name: "prolactin" }],
        missing: [],
      })
    },
  })

  assert.equal((await store.fetchBatch(["PRL"])).get("PRL"), null)
  assert.equal((await store.fetchBatch(["PRL"])).get("PRL")?.full_name, "prolactin")
  assert.equal(fetchCount, 2)
})

test("visible detail resolves before the bounded cache finishes persisting", async () => {
  const createGeneDetailStore = loadFactory()
  let releasePersistence
  let persistenceStarted = false
  const persistenceGate = new Promise((resolve) => {
    releasePersistence = resolve
  })
  const storage = createStorage()
  const originalSet = storage.set.bind(storage)
  storage.set = async (entries) => {
    persistenceStarted = true
    await persistenceGate
    return originalSet(entries)
  }
  const store = createGeneDetailStore({
    windowRef: globalThis,
    storageApi: storage,
    getRevision: async () => "card-v1",
    batchUrl: "https://example.test/batch",
    fetchImpl: async () =>
      response({
        snapshot_version: "card-v1",
        genes: [{ symbol: "TP53", full_name: "tumor protein p53" }],
        missing: [],
      }),
  })

  const records = await store.fetchBatch(["TP53"])
  assert.equal(records.get("TP53")?.full_name, "tumor protein p53")
  assert.equal(persistenceStarted, false)

  const flushPromise = store.flushPersistence()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(persistenceStarted, true)

  releasePersistence()
  await flushPromise
  assert.equal(storage.values.iconoplasm_published_gene_detail_cache_v1.entries[0][0], "TP53")
})

test("a delayed old-revision persistence write cannot roll current detail state backward", async () => {
  const createGeneDetailStore = loadFactory()
  const values = {}
  let storageGetCount = 0
  let releaseOldWrite
  let markOldWriteStarted
  const oldWriteGate = new Promise((resolve) => {
    releaseOldWrite = resolve
  })
  const oldWriteStarted = new Promise((resolve) => {
    markOldWriteStarted = resolve
  })
  const storage = {
    async get(keys) {
      storageGetCount += 1
      if (storageGetCount === 2) {
        markOldWriteStarted()
        await oldWriteGate
      }
      return Object.fromEntries(
        keys.filter((key) => Object.hasOwn(values, key)).map((key) => [key, values[key]]),
      )
    },
    async set(entries) {
      Object.assign(values, structuredClone(entries))
    },
  }
  const store = createGeneDetailStore({
    windowRef: globalThis,
    storageApi: storage,
    getRevision: async () => "card-v1",
    batchUrl: "https://example.test/batch",
    fetchImpl: async (_url, options) => {
      const [symbol] = JSON.parse(options.body).symbols
      const revision = symbol === "TP53" ? "card-v1" : "card-v2"
      return response({
        snapshot_version: revision,
        genes: [{ symbol, full_name: symbol + " name" }],
        missing: [],
      })
    },
  })

  await store.fetchBatch(["TP53"])
  await oldWriteStarted
  await store.fetchBatch(["BRCA1"])
  assert.equal(store.cache.has("TP53"), false)
  assert.equal(store.cache.get("BRCA1")?.full_name, "BRCA1 name")

  releaseOldWrite()
  await store.flushPersistence()
  assert.equal(store.cache.get("BRCA1")?.full_name, "BRCA1 name")
  assert.equal(values.iconoplasm_published_gene_detail_cache_v1.revision, "card-v2")
  assert.deepEqual(
    values.iconoplasm_published_gene_detail_cache_v1.entries.map((entry) => entry[0]),
    ["BRCA1"],
  )
})

test("an older-started response cannot roll back a newer adopted snapshot", async () => {
  const createGeneDetailStore = loadFactory()
  const storage = createStorage()
  const oldResponse = deferred()
  const newResponse = deferred()
  const oldStarted = deferred()
  const newStarted = deferred()
  const store = createGeneDetailStore({
    windowRef: globalThis,
    storageApi: storage,
    getRevision: async () => "card-v1",
    batchUrl: "https://example.test/batch",
    fetchImpl: async (_url, options) => {
      const [symbol] = JSON.parse(options.body).symbols
      if (symbol === "TP53") {
        oldStarted.resolve()
        return oldResponse.promise
      }
      newStarted.resolve()
      return newResponse.promise
    },
  })

  const oldBatch = store.fetchBatch(["TP53"])
  await oldStarted.promise
  const newBatch = store.fetchBatch(["BRCA1"])
  await newStarted.promise

  newResponse.resolve(
    response({
      snapshot_version: "card-v2",
      genes: [{ symbol: "BRCA1", full_name: "BRCA1 v2" }],
      missing: [],
    }),
  )
  assert.equal((await newBatch).get("BRCA1")?.full_name, "BRCA1 v2")

  oldResponse.resolve(
    response({
      snapshot_version: "card-v1",
      genes: [{ symbol: "TP53", full_name: "TP53 v1" }],
      missing: [],
    }),
  )
  assert.equal((await oldBatch).get("TP53"), null)
  await store.flushPersistence()

  assert.equal(store.has("TP53"), false, "stale detail remains retryable")
  assert.equal(store.promiseCache.has("TP53"), false)
  assert.equal(store.get("BRCA1")?.full_name, "BRCA1 v2")
  assert.equal(storage.values.iconoplasm_published_gene_detail_cache_v1.revision, "card-v2")
  assert.deepEqual(
    storage.values.iconoplasm_published_gene_detail_cache_v1.entries.map((entry) => entry[0]),
    ["BRCA1"],
  )
})

test("an older-started response may still merge into the same adopted snapshot", async () => {
  const createGeneDetailStore = loadFactory()
  const storage = createStorage()
  const firstResponse = deferred()
  const secondResponse = deferred()
  const firstStarted = deferred()
  const secondStarted = deferred()
  const store = createGeneDetailStore({
    windowRef: globalThis,
    storageApi: storage,
    getRevision: async () => "card-v2",
    batchUrl: "https://example.test/batch",
    fetchImpl: async (_url, options) => {
      const [symbol] = JSON.parse(options.body).symbols
      if (symbol === "TP53") {
        firstStarted.resolve()
        return firstResponse.promise
      }
      secondStarted.resolve()
      return secondResponse.promise
    },
  })

  const firstBatch = store.fetchBatch(["TP53"])
  await firstStarted.promise
  const secondBatch = store.fetchBatch(["BRCA1"])
  await secondStarted.promise
  secondResponse.resolve(
    response({
      snapshot_version: "card-v2",
      genes: [{ symbol: "BRCA1", full_name: "BRCA1 v2" }],
      missing: [],
    }),
  )
  await secondBatch
  firstResponse.resolve(
    response({
      snapshot_version: "card-v2",
      genes: [{ symbol: "TP53", full_name: "TP53 v2" }],
      missing: [],
    }),
  )
  await firstBatch
  await store.flushPersistence()

  assert.equal(store.get("BRCA1")?.full_name, "BRCA1 v2")
  assert.equal(store.get("TP53")?.full_name, "TP53 v2")
  assert.equal(storage.values.iconoplasm_published_gene_detail_cache_v1.revision, "card-v2")
  assert.deepEqual(
    new Set(
      storage.values.iconoplasm_published_gene_detail_cache_v1.entries.map((entry) => entry[0]),
    ),
    new Set(["BRCA1", "TP53"]),
  )
})
