import assert from "node:assert/strict"
import test from "node:test"

import { IconoplasmSyncGovernor } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

function governorHarness() {
  const values = new Map()
  const alarms = []
  const storage = {
    async get(key) {
      return values.get(key)
    },
    async put(key, value) {
      values.set(key, structuredClone(value))
    },
    async delete(key) {
      return values.delete(key)
    },
    async setAlarm(value) {
      alarms.push(value)
    },
    async transaction(callback) {
      const before = structuredClone(values)
      const alarmCount = alarms.length
      try {
        return await callback(this)
      } catch (error) {
        values.clear()
        for (const [key, value] of before) values.set(key, value)
        alarms.length = alarmCount
        throw error
      }
    },
  }
  const queue = {
    sent: [],
    async send(message) {
      this.sent.push(structuredClone(message))
    },
  }
  const governor = new IconoplasmSyncGovernor(
    { storage },
    { ICONOPLASM_SYNC_FINALIZATION_QUEUE: queue },
  )
  return { values, queue, governor }
}

test("deferred finalization reset replays the exact run and symbol scope", async () => {
  const { values, queue, governor } = governorHarness()
  const response = await governor.fetch(
    new Request("https://iconoplasm-sync-governor/defer-finalization", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ run_id: "scope-reset", symbols: ["TP53", "BRCA1"] }),
    }),
  )
  assert.equal(response.status, 200)
  const wake = values.get("finalization_reset_wake")
  values.set("finalization_reset_wake", { ...wake, due_at: Date.now() - 1 })

  const result = await governor.alarm()

  assert.equal(result.ok, true)
  assert.equal(queue.sent.length, 1)
  assert.equal(queue.sent[0].run_id, "scope-reset")
  assert.deepEqual(queue.sent[0].symbols, ["TP53", "BRCA1"])
})

test("reset delivery preserves a new scope accepted while the queue send is in flight", async () => {
  const { values, queue, governor } = governorHarness()
  await governor.deferFinalizationToReset({ runId: "first-run", symbols: ["TP53"] })
  const wake = values.get("finalization_reset_wake")
  values.set("finalization_reset_wake", { ...wake, due_at: Date.now() - 1 })
  queue.send = async (message) => {
    queue.sent.push(structuredClone(message))
    await governor.deferFinalizationToReset({ runId: "second-run", symbols: ["BRCA1"] })
  }

  const result = await governor.alarm()

  assert.equal(result.queue_message_sent, true)
  assert.equal(result.pending, true)
  assert.deepEqual(
    values
      .get("finalization_reset_wake")
      ?.messages.map(({ run_id, symbols }) => ({ run_id, symbols })),
    [{ run_id: "second-run", symbols: ["BRCA1"] }],
    "acknowledging the sent snapshot must not delete a later accepted operation",
  )
  queue.send = async (message) => queue.sent.push(structuredClone(message))
  const remaining = values.get("finalization_reset_wake")
  values.set("finalization_reset_wake", { ...remaining, due_at: Date.now() - 1 })
  await governor.alarm()
  assert.deepEqual(
    queue.sent.map((message) => message.run_id),
    ["first-run", "second-run"],
  )
  assert.equal(values.has("finalization_reset_wake"), false)
})

test("partial queue failure retains concurrently accepted scopes and only removes sent messages", async () => {
  const { values, queue, governor } = governorHarness()
  await governor.deferFinalizationToReset({ runId: "first-run", symbols: ["TP53"] })
  await governor.deferFinalizationToReset({ runId: "retry-run", symbols: ["SOD1"] })
  const wake = values.get("finalization_reset_wake")
  values.set("finalization_reset_wake", { ...wake, due_at: Date.now() - 1 })
  queue.send = async (message) => {
    if (message.run_id === "retry-run") {
      await governor.deferFinalizationToReset({ runId: "new-run", symbols: ["BRCA1"] })
      throw new Error("Queue transport unavailable")
    }
    queue.sent.push(structuredClone(message))
  }

  const result = await governor.alarm()

  assert.equal(result.ok, false)
  assert.equal(result.deferred, true)
  assert.deepEqual(
    values.get("finalization_reset_wake")?.messages.map((message) => message.run_id),
    ["retry-run", "new-run"],
  )
  assert.deepEqual(
    queue.sent.map((message) => message.run_id),
    ["first-run"],
  )
})

test("a later capacity day retains undelivered scopes from the previous day", async (t) => {
  let now = Date.parse("2026-09-17T18:00:00.000Z")
  t.mock.method(Date, "now", () => now)
  const { values, governor } = governorHarness()
  await governor.deferFinalizationToReset({ runId: "saved-run", symbols: ["TP53"] })
  now += 86400000
  await governor.deferFinalizationToReset({ runId: "new-day-run", symbols: ["BRCA1"] })

  assert.deepEqual(
    values.get("finalization_reset_wake").messages.map((message) => message.run_id),
    ["saved-run", "new-day-run"],
    "a new reset date cannot replace the retained obligation ledger",
  )
})

test("reset scope capacity refuses a new operation without discarding existing days", async (t) => {
  let now = Date.parse("2026-09-17T18:00:00.000Z")
  t.mock.method(Date, "now", () => now)
  const { values, governor } = governorHarness()
  for (let index = 0; index < 8; index += 1) {
    await governor.deferFinalizationToReset({ runId: `saved-${index}`, symbols: ["TP53"] })
  }
  const retained = structuredClone(values.get("finalization_reset_wake"))
  now += 86400000
  await assert.rejects(
    governor.deferFinalizationToReset({ runId: "overflow", symbols: ["BRCA1"] }),
    { code: "FINALIZATION_RESET_SCOPE_CAPACITY" },
  )
  assert.deepEqual(values.get("finalization_reset_wake"), retained)
})

test("reset delivery preserves a new scope arriving during the queue send", async () => {
  const { values, queue, governor } = governorHarness()
  await governor.deferFinalizationToReset({ runId: "original", symbols: ["TP53"] })
  const wake = values.get("finalization_reset_wake")
  values.set("finalization_reset_wake", { ...wake, due_at: Date.now() - 1 })
  const send = queue.send.bind(queue)
  let injected = false
  queue.send = async (message) => {
    await send(message)
    if (!injected) {
      injected = true
      await governor.deferFinalizationToReset({ runId: "arrived-during-send", symbols: ["BRCA1"] })
    }
  }
  await governor.alarm()
  const remaining = values.get("finalization_reset_wake")
  assert.deepEqual(
    remaining?.messages?.map((message) => message.run_id),
    ["arrived-during-send"],
  )
  values.set("finalization_reset_wake", { ...remaining, due_at: Date.now() - 1 })
  await governor.alarm()
  assert.deepEqual(
    queue.sent.map((message) => message.run_id),
    ["original", "arrived-during-send"],
  )
  assert.equal(values.has("finalization_reset_wake"), false)
})

test("reset deferral preserves new arrivals when a later queue send fails", async () => {
  const { values, queue, governor } = governorHarness()
  await governor.deferFinalizationToReset({ runId: "first", symbols: ["TP53"] })
  await governor.deferFinalizationToReset({ runId: "second", symbols: ["BRCA1"] })
  const wake = values.get("finalization_reset_wake")
  values.set("finalization_reset_wake", { ...wake, due_at: Date.now() - 1 })
  const send = queue.send.bind(queue)
  queue.send = async (message) => {
    if (message.run_id === "second") {
      await governor.deferFinalizationToReset({ runId: "new-arrival", symbols: ["LMNA"] })
      throw new Error("queue send failed")
    }
    await send(message)
  }
  const result = await governor.alarm()
  assert.equal(result.ok, false)
  assert.deepEqual(
    values.get("finalization_reset_wake")?.messages?.map((message) => message.run_id),
    ["second", "new-arrival"],
  )
})
