import assert from "node:assert/strict"
import test from "node:test"
import { reconcileFinalizationQueue } from "./reconcile-iconoplasm-finalization-queue.mjs"

function fixture() {
  const queues = [
    {
      queue_id: "a".repeat(32),
      queue_name: "iconoplasm-sync-finalization",
      settings: { delivery_delay: 0, delivery_paused: false, message_retention_period: 60 },
      consumers: [
        {
          type: "worker",
          script: "geneguessr-api",
          dead_letter_queue: "iconoplasm-sync-dlq",
          settings: {
            batch_size: 1,
            max_concurrency: 1,
            max_retries: 5,
            max_wait_time_ms: 1000,
            retry_delay: 30,
          },
        },
      ],
    },
    {
      queue_id: "b".repeat(32),
      queue_name: "iconoplasm-sync-dlq",
      settings: { delivery_delay: 0, message_retention_period: 60 },
      consumers: [],
    },
  ]
  const calls = []
  const options = {
    accountId: "c".repeat(32),
    token: "fixture-token",
    apply: true,
    async fetchImpl(url, init) {
      calls.push({ url, ...init })
      const parsed = new URL(url)
      assert.equal(parsed.origin, "https://api.cloudflare.com")
      assert.ok(init.signal instanceof AbortSignal)
      if (parsed.search)
        return Response.json({
          success: true,
          result: structuredClone(queues),
          result_info: { total_pages: 1 },
        })
      const queue = queues.find((q) => parsed.pathname.endsWith(q.queue_id))
      assert.ok(queue)
      if (init.method === "PATCH") Object.assign(queue.settings, JSON.parse(init.body).settings)
      return Response.json({ success: true, result: structuredClone(queue) })
    },
  }
  return { queues, calls, options }
}

test("finalization release corrects retention once, preserves pauses/delay and verifies the existing consumer", async () => {
  const { queues, calls, options } = fixture()
  const first = await reconcileFinalizationQueue(options)
  assert.equal(first.ok, true)
  assert.equal(calls.length, 5, "one inventory and one PATCH/readback per existing queue")
  assert.equal(calls.filter((c) => c.method === "PATCH").length, 2)
  assert.deepEqual(
    queues.map((q) => q.settings.message_retention_period),
    [86400, 86400],
  )
  assert.equal(queues[0].settings.delivery_paused, false)
  assert.equal(queues[0].consumers[0].settings.batch_size, 1)
  calls.length = 0
  const again = await reconcileFinalizationQueue(options)
  assert.deepEqual(
    again.queues.map((q) => q.changed),
    [false, false],
  )
  assert.equal(calls.length, 1, "a repeated release makes no configuration writes")
})

test("old consumer batches, a paused queue and missing inventory fail before mutation", async () => {
  for (const change of [
    (q) => {
      q[0].consumers[0].settings.batch_size = 100
    },
    (q) => {
      q[0].settings.delivery_paused = true
    },
    (q) => {
      q.pop()
    },
  ]) {
    const { queues, calls, options } = fixture()
    change(queues)
    await assert.rejects(reconcileFinalizationQueue(options))
    assert.equal(calls.filter((c) => c.method !== "GET").length, 0)
  }
})

test("read-only verification reports the short retention and failed PATCH is not retried", async () => {
  const { options, calls } = fixture()
  await assert.rejects(reconcileFinalizationQueue({ ...options, apply: false }), /24 hours/)
  assert.equal(calls.length, 1)
  let patches = 0
  await assert.rejects(
    reconcileFinalizationQueue({
      ...options,
      fetchImpl: async (url, init) => {
        if (init.method === "PATCH") {
          patches++
          throw new Error("lost response")
        }
        return options.fetchImpl(url, init)
      },
    }),
    /lost response/,
  )
  assert.equal(patches, 1)
})

test("a success response without persisted retention is refused", async () => {
  const { options } = fixture()
  await assert.rejects(
    reconcileFinalizationQueue({
      ...options,
      fetchImpl: async (url, init) => {
        if (init.method === "PATCH") return Response.json({ success: true, result: {} })
        return options.fetchImpl(url, init)
      },
    }),
    /did not persist/,
  )
})
