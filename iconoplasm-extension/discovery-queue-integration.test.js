import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"

// Executes the real discovery batch queue and the real content-script sender
// together: durable enqueue, bounded batch identity, restart replay and guest
// convergence, without a browser.

const queueSource = readFileSync(new URL("./discovery-batch-queue.js", import.meta.url), "utf8")
const contentSource = readFileSync(new URL("./content.js", import.meta.url), "utf8")

const senderStart = contentSource.indexOf("  async function sendDiscoveryBatch(")
const senderEnd = contentSource.indexOf("  function rememberDiscoveryAuthState(")
assert.ok(senderStart > 0 && senderEnd > senderStart)
const senderSource = contentSource.slice(senderStart, senderEnd)

function createStorage() {
  const values = new Map()
  return {
    values,
    async get(keys) {
      const wanted = Array.isArray(keys) ? keys : [keys]
      const out = {}
      for (const key of wanted) if (values.has(key)) out[key] = JSON.parse(values.get(key))
      return out
    },
    async set(entries) {
      for (const [key, value] of Object.entries(entries)) {
        values.set(key, JSON.stringify(value))
      }
    },
  }
}

function buildHarness({ storage = createStorage(), responses = [] } = {}) {
  const posts = []
  const guests = []
  const context = {
    runtimeDisconnected: false,
    console: { warn() {}, error() {} },
    chrome: { storage: { local: storage } },
    ICONOPLASM_DISCOVERY_BATCH_URL:
      "https://iconoplasm.brinedew.io/api/iconoplasm/discoveries/batch",
    async extensionApiFetch(url, options) {
      const body = JSON.parse(options.body)
      posts.push({ url, body })
      const scripted = responses.shift()
      if (scripted === "network") throw new Error("offline")
      if (scripted === "guest") {
        return {
          ok: true,
          async json() {
            return { ok: true, authenticated: false, persisted: false, batch_id: body.batch_id }
          },
        }
      }
      return {
        ok: true,
        async json() {
          return { ok: true, authenticated: true, batch_id: body.batch_id, replay: false }
        },
      }
    },
    async rememberGuestDiscovery(symbol) {
      guests.push(symbol)
    },
    rememberDiscoveryAuthState() {},
    crypto: globalThis.crypto,
    structuredClone,
  }
  context.globalThis = context
  vm.createContext(context)
  vm.runInContext(queueSource, context)
  context.IconoDiscoveryBatchQueue = context.IconoplasmDiscoveryBatchQueue
  vm.runInContext(
    senderSource + "\nglobalThis.discoveryBatchQueueRef = discoveryBatchQueue\n",
    context,
  )
  assert.equal(typeof context.discoveryBatchQueueRef?.enqueue, "function")
  return { context, storage, posts, guests }
}

test("hover encounters are durable before the send and travel as one device-sequenced batch", async () => {
  const harness = buildHarness()
  const { context } = harness
  await context.discoveryBatchQueueRef.enqueue({
    symbol: "TP53",
    at: 1000,
    source: "extension_hover",
    trigger: "hover_dwell",
    dwell_ms: 900,
  })
  await context.discoveryBatchQueueRef.enqueue({
    symbol: "BRCA1",
    at: 1001,
    source: "extension_hover",
    trigger: "hover_dwell",
    dwell_ms: 900,
  })
  const persistedBeforeFlush = JSON.parse(
    harness.storage.values.get(context.IconoplasmDiscoveryBatchQueue.defaultStateKey),
  )
  assert.equal(persistedBeforeFlush.pending.length, 2)

  const result = await context.flushDiscoveryBatchQueue()
  assert.equal(result.acknowledged, 1)
  assert.equal(harness.posts.length, 1)
  assert.match(harness.posts[0].body.batch_id, /^[A-Za-z0-9_-]{8,64}:1$/)
  assert.deepEqual(
    harness.posts[0].body.encounters.map((encounter) => encounter.symbol),
    ["TP53", "BRCA1"],
  )
  const persistedAfter = JSON.parse(
    harness.storage.values.get(context.IconoplasmDiscoveryBatchQueue.defaultStateKey),
  )
  assert.equal(persistedAfter.pending.length, 0)
  assert.equal(persistedAfter.inflight, null)
  assert.equal(persistedAfter.next_sequence, 2)
})

test("a failed flush keeps the exact batch identity and a restart replays it", async () => {
  const storage = createStorage()
  const first = buildHarness({ storage, responses: ["network"] })
  await first.context.discoveryBatchQueueRef.enqueue({
    symbol: "TP53",
    at: 1000,
    source: "extension_hover",
    trigger: "hover_dwell",
    dwell_ms: 900,
  })
  const failed = await first.context.flushDiscoveryBatchQueue()
  assert.equal(failed.ok, false)
  const inflightId = JSON.parse(
    storage.values.get(first.context.IconoplasmDiscoveryBatchQueue.defaultStateKey),
  ).inflight.batch_id

  // A restart constructs a fresh queue over the same extension storage.
  const second = buildHarness({ storage })
  const replay = await second.context.flushDiscoveryBatchQueue()
  assert.equal(replay.acknowledged, 1)
  assert.equal(second.posts.length, 1)
  assert.equal(second.posts[0].body.batch_id, inflightId)
  const persisted = JSON.parse(
    storage.values.get(second.context.IconoplasmDiscoveryBatchQueue.defaultStateKey),
  )
  assert.equal(persisted.inflight, null)
})

test("a signed-out response moves encounters to the durable guest shelf and acknowledges the batch", async () => {
  const harness = buildHarness({ responses: ["guest"] })
  await harness.context.discoveryBatchQueueRef.enqueue({
    symbol: "RHO",
    at: 1000,
    source: "extension_hover",
    trigger: "hover_dwell",
    dwell_ms: 900,
  })
  const result = await harness.context.flushDiscoveryBatchQueue()
  assert.equal(result.acknowledged, 1)
  assert.deepEqual(harness.guests, ["RHO"])
  const persisted = JSON.parse(
    harness.storage.values.get(harness.context.IconoplasmDiscoveryBatchQueue.defaultStateKey),
  )
  assert.equal(persisted.pending.length, 0)
  assert.equal(persisted.inflight, null)
})

test("a receipt identity mismatch never acknowledges the durable batch", async () => {
  const harness = buildHarness()
  harness.context.extensionApiFetch = async () => ({
    ok: true,
    async json() {
      return { ok: true, authenticated: true, batch_id: "different:1" }
    },
  })
  await harness.context.discoveryBatchQueueRef.enqueue({
    symbol: "EGFR",
    at: 1000,
    source: "extension_hover",
    trigger: "hover_dwell",
    dwell_ms: 900,
  })
  const result = await harness.context.flushDiscoveryBatchQueue()
  assert.equal(result.ok, false)
  const persisted = JSON.parse(
    harness.storage.values.get(harness.context.IconoplasmDiscoveryBatchQueue.defaultStateKey),
  )
  assert.ok(persisted.inflight)
})
