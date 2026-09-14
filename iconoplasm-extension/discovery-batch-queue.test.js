import assert from "node:assert/strict"
import test from "node:test"
import "./discovery-batch-queue.js"

const { createDiscoveryBatchQueue, defaultStateKey } = globalThis.IconoplasmDiscoveryBatchQueue

class MemoryStorage {
  constructor(seed = {}) {
    this.state = structuredClone(seed)
    this.writes = []
  }
  async get(keys) {
    const result = {}
    for (const key of keys || []) if (key in this.state) result[key] = structuredClone(this.state[key])
    return result
  }
  async set(values) {
    Object.assign(this.state, structuredClone(values))
    this.writes.push(structuredClone(values))
  }
}

const encounter = (index) => ({
  symbol: index % 2 ? "TP53" : "BRCA1",
  at: 1000 + index,
  source: "extension_hover",
  trigger: "hover_dwell",
  dwell_ms: 900 + index,
})

function queue(storage, sendBatch, extra = {}) {
  return createDiscoveryBatchQueue({
    storage,
    sendBatch,
    makeDeviceId: () => "0123456789abcdef",
    ...extra,
  })
}

test("concurrent enqueue calls serialize through one durable queue without losing encounters", async () => {
  const storage = new MemoryStorage()
  const client = queue(storage, async () => ({ ok: true }))
  await Promise.all(Array.from({ length: 100 }, (_, index) => client.enqueue(encounter(index))))
  const stored = storage.state[defaultStateKey]
  assert.equal(stored.pending.length, 100)
  assert.equal(stored.inflight, null)
  assert.equal(stored.next_sequence, 1)
  assert.equal(new Set(stored.pending.map((item) => `${item.symbol}:${item.at}`)).size, 100)
})

test("network failure preserves exact inflight bytes and a restarted worker retries the same batch id", async () => {
  const storage = new MemoryStorage()
  const attempts = []
  const first = queue(
    storage,
    async (batch) => {
      attempts.push(structuredClone(batch))
      throw new Error("offline")
    },
    { maxBatchSize: 2 },
  )
  await first.enqueue(encounter(0))
  await first.enqueue(encounter(1))
  await first.enqueue(encounter(2))
  const failed = await first.flush()
  assert.equal(failed.ok, false)
  assert.equal(failed.batch_id, "0123456789abcdef:1")
  const durable = structuredClone(storage.state[defaultStateKey].inflight)
  assert.equal(durable.encounters.length, 2)
  assert.equal(storage.state[defaultStateKey].pending.length, 1)

  const retried = []
  const restarted = queue(
    storage,
    async (batch) => {
      retried.push(structuredClone(batch))
      return { ok: true, batch_id: batch.batch_id }
    },
    { maxBatchSize: 2 },
  )
  const result = await restarted.flush({ maxBatches: 2 })
  assert.equal(result.ok, true)
  assert.equal(result.acknowledged, 2)
  assert.deepEqual(retried[0], durable)
  assert.equal(retried[0].batch_id, "0123456789abcdef:1")
  assert.equal(retried[1].batch_id, "0123456789abcdef:2")
  assert.equal(retried[1].encounters.length, 1)
  assert.equal(storage.state[defaultStateKey].inflight, null)
  assert.equal(storage.state[defaultStateKey].pending.length, 0)
  assert.equal(storage.state[defaultStateKey].next_sequence, 3)
})

test("receipt identity mismatch leaves the durable inflight batch intact", async () => {
  const storage = new MemoryStorage()
  const client = queue(storage, async () => ({ ok: true, batch_id: "other:1" }))
  await client.enqueue(encounter(0))
  const result = await client.flush()
  assert.equal(result.ok, false)
  assert.equal(storage.state[defaultStateKey].inflight.batch_id, "0123456789abcdef:1")
  assert.equal(storage.state[defaultStateKey].next_sequence, 2)
})

test("an acknowledgement clears only the exact inflight batch after the network result", async () => {
  const storage = new MemoryStorage()
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let observed
  const client = queue(storage, async (batch) => {
    observed = structuredClone(batch)
    await gate
    return { ok: true, batch_id: batch.batch_id }
  })
  await client.enqueue(encounter(0))
  const flushing = client.flush()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(storage.state[defaultStateKey].inflight.batch_id, "0123456789abcdef:1")
  assert.deepEqual(storage.state[defaultStateKey].inflight, observed)
  release()
  assert.equal((await flushing).ok, true)
  assert.equal(storage.state[defaultStateKey].inflight, null)
})

test("pending capacity fails closed before dropping an existing durable encounter", async () => {
  const storage = new MemoryStorage()
  const client = queue(storage, async () => ({ ok: true }), { maxBatchSize: 1, maxPending: 2 })
  await client.enqueue(encounter(0))
  await client.enqueue(encounter(1))
  await assert.rejects(client.enqueue(encounter(2)), { code: "DISCOVERY_QUEUE_FULL" })
  assert.equal(storage.state[defaultStateKey].pending.length, 2)
})
