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
  assert.equal(storage.values.iconoplasm_published_gene_detail_cache_v1.revision, "card-v2")
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
