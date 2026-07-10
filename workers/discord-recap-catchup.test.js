import { test } from "node:test"
import assert from "node:assert/strict"

import { handlePostCatchupRecaps } from "./discord.js"

function makeFakeEnv({ posted = new Set(), puzzles = new Set() } = {}) {
  const kvStore = new Map()

  for (const day of posted) {
    kvStore.set(`discord_summary_posted:${day}`, JSON.stringify({ message_id: "old_msg", posted_at: Date.now() }))
  }

  for (const day of puzzles) {
    kvStore.set(`puzzle_actual:${day}`, JSON.stringify({ uniprot_id: "P12345", date: day }))
  }

  // Minimal D1 mock that satisfies ensureGuessAggregateSchema + protein fetch
  const stmt = {
    run: async () => ({}),
    first: async () => ({ gene: "TP53", full_name: "Tumor protein p53", uniprot: "P12345" }),
    all: async () => ({ results: [] }),
    bind: function () { return this },
  }
  const db = { prepare: () => stmt }

  return {
    KV: {
      get: async (key) => kvStore.get(key) ?? null,
      put: async (key, value) => { kvStore.set(key, value) },
      delete: async (key) => { kvStore.delete(key) },
    },
    DB: db,
    DISCORD_BOT_TOKEN: "test-token",
    DISCORD_GENEGUESSR_CHANNEL_ID: "123",
    _kvStore: kvStore,
  }
}

function withMockedFetch(handler, fn) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    return handler(String(url), init)
  }
  return Promise.resolve(fn(calls)).finally(() => {
    globalThis.fetch = original
  })
}

// Helper to freeze Date for deterministic "today"
function withFixedDate(isoString, fn) {
  const origDate = globalThis.Date
  const fixedNow = new Date(isoString)
  class FixedDate extends Date {
    constructor(...args) {
      if (args.length === 0) return new origDate(fixedNow)
      return new origDate(...args)
    }
    static now() { return fixedNow.getTime() }
  }
  globalThis.Date = FixedDate
  return Promise.resolve(fn()).finally(() => { globalThis.Date = origDate })
}

test("catchup skips already-posted days", async () => {
  await withFixedDate("2026-07-10T12:00:00Z", async () => {
    const env = makeFakeEnv({
      posted: new Set(["2026-07-09", "2026-07-08"]),
      puzzles: new Set(["2026-07-09", "2026-07-08", "2026-07-07"]),
    })

    await withMockedFetch(
      () => new Response(JSON.stringify({ id: "msg" }), { status: 200 }),
      async () => {
        const result = await handlePostCatchupRecaps(env, 3)
        assert.equal(result.ok, true)
        assert.equal(result.results[0].day, "2026-07-09")
        assert.equal(result.results[0].skipped, "already_posted")
        assert.equal(result.results[1].day, "2026-07-08")
        assert.equal(result.results[1].skipped, "already_posted")
        // Day 7 has puzzle data and is NOT posted — should be attempted
        assert.equal(result.results[2].day, "2026-07-07")
        assert.equal(result.results[2].ok, true)
        assert.equal(result.results[2].message_id, "msg")
      },
    )
  })
})

test("catchup stops at first day with no puzzle data", async () => {
  await withFixedDate("2026-07-10T12:00:00Z", async () => {
    const env = makeFakeEnv({
      posted: new Set(),
      puzzles: new Set(["2026-07-09"]),
    })

    await withMockedFetch(
      () => new Response(JSON.stringify({ id: "new_msg" }), { status: 200 }),
      async () => {
        const result = await handlePostCatchupRecaps(env, 3)
        assert.equal(result.ok, true)
        assert.equal(result.results.length, 2)
        assert.equal(result.results[0].day, "2026-07-09")
        assert.equal(result.results[0].ok, true)
        assert.equal(result.results[0].message_id, "new_msg")
        assert.equal(result.results[1].day, "2026-07-08")
        assert.equal(result.results[1].skipped, "no_puzzle_data")
      },
    )
  })
})

test("catchup posts text-only recap for missed day", async () => {
  await withFixedDate("2026-07-10T12:00:00Z", async () => {
    const env = makeFakeEnv({
      posted: new Set(),
      puzzles: new Set(["2026-07-09"]),
    })

    await withMockedFetch(
      () => new Response(JSON.stringify({ id: "catchup_msg" }), { status: 200 }),
      async (calls) => {
        const result = await handlePostCatchupRecaps(env, 3)
        assert.equal(result.ok, true)
        assert.equal(result.results[0].day, "2026-07-09")
        assert.equal(result.results[0].ok, true)
        assert.equal(result.results[0].message_id, "catchup_msg")
        assert.equal(calls.length, 1)
      },
    )
  })
})
