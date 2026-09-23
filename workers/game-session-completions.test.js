import assert from "node:assert/strict"
import test from "node:test"

function createStorage() {
  let values = new Map()
  let failPendingWrite = false
  const interfaceFor = (data) => ({
    get: async (key) => data.get(key),
    put: async (key, value) => {
      if (key === "pending_results" && failPendingWrite) throw new Error("storage write failed")
      data.set(key, structuredClone(value))
    },
  })
  return {
    get: async (key) => values.get(key),
    put: async (key, value) => interfaceFor(values).put(key, value),
    transaction: async (callback) => {
      const next = new Map(values)
      const result = await callback(interfaceFor(next))
      values = next
      return result
    },
    failPendingWrite: () => {
      failPendingWrite = true
    },
    snapshot: () => Object.fromEntries(values),
  }
}

test("the existing game session retains a finished daily result after the next day starts", async () => {
  const { storeGameState, getPendingResults, ackCompletedResult } =
    await import("./lib/the-only-geneguessr-completed-result-ledger-do-not-duplicate.js")
  const storage = createStorage()
  await storeGameState(storage, {
    date: "2026-09-21",
    practiceMode: false,
    won: true,
    guesses: [{ correct: true }],
  })
  await storeGameState(storage, {
    date: "2026-09-22",
    practiceMode: false,
    won: false,
    guesses: [],
  })

  assert.equal((await storage.get("game_state")).date, "2026-09-22")
  assert.deepEqual(await getPendingResults(storage), [{ date: "2026-09-21", won: true }])
  await ackCompletedResult(storage, "2026-09-21")
  assert.deepEqual(await getPendingResults(storage), [])
  await storeGameState(storage, {
    date: "2026-09-21",
    practiceMode: false,
    won: true,
    guesses: [{ correct: true }],
  })
  assert.deepEqual(await getPendingResults(storage), [])
})

test("a result is archived only once and a storage failure cannot save it halfway", async () => {
  const { storeGameState, getPendingResults } =
    await import("./lib/the-only-geneguessr-completed-result-ledger-do-not-duplicate.js")
  const storage = createStorage()
  const completed = {
    date: "2026-09-21",
    practiceMode: false,
    won: false,
    guesses: Array(10).fill({ correct: false }),
  }
  await storeGameState(storage, completed)
  await storeGameState(storage, completed)
  assert.deepEqual(await getPendingResults(storage), [{ date: "2026-09-21", won: false }])

  const brokenStorage = createStorage()
  brokenStorage.failPendingWrite()
  await assert.rejects(storeGameState(brokenStorage, completed), /storage write failed/)
  assert.deepEqual(brokenStorage.snapshot(), {})
})
