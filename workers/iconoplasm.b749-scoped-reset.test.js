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
