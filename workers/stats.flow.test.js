import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

import { handleGetStats, handleUpdateStats } from "./stats.js"

function createFixture({ completedDates, failWrites = false, failAck = false }) {
  const sql = new DatabaseSync(":memory:")
  sql.exec(`CREATE TABLE stats (
    user_id TEXT PRIMARY KEY,
    total_played INTEGER DEFAULT 0,
    total_wins INTEGER DEFAULT 0,
    current_streak INTEGER DEFAULT 0,
    best_streak INTEGER DEFAULT 0,
    last_played_date TEXT,
    migrated_at INTEGER
  )`)
  let writesUnavailable = failWrites
  let ackUnavailable = failAck
  let pending = completedDates.map(([date, won]) => ({ date, won }))
  const env = {
    GAME_SESSIONS: {
      idFromName: (name) => name,
      get: (name) => ({
        fetch: async (input, init = {}) => {
          const request = input instanceof Request ? input : new Request(input, init)
          const path = new URL(request.url).pathname
          if (name === "session:player-cookie" && path === "/auth/resolve") {
            return Response.json({ user_id: "player-1" })
          }
          assert.equal(name, "user_player-1")
          if (path === "/game/results" && request.method === "GET") {
            return Response.json(pending)
          }
          if (path === "/game/results/ack" && request.method === "POST") {
            if (ackUnavailable) throw new Error("simulated lost acknowledgement")
            const { date } = await request.json()
            pending = pending.filter((result) => result.date !== date)
            return Response.json({ success: true })
          }
          throw new Error(`Unexpected DO request: ${request.method} ${path}`)
        },
      }),
    },
    DB: {
      prepare: (statement) => ({
        bind: (...values) => ({
          first: async () => sql.prepare(statement).get(...values) || null,
          run: async () => {
            if (writesUnavailable) throw new Error("simulated D1 write exhaustion")
            return { meta: sql.prepare(statement).run(...values) }
          },
        }),
      }),
    },
  }
  const request = (method, path) =>
    new Request(`https://geneguessr.brinedew.bio${path}`, {
      method,
      headers: { Cookie: "session=player-cookie" },
      ...(method === "POST" ? { body: "{}" } : {}),
    })
  return {
    env,
    request,
    sql,
    pending: () => pending,
    allowWrites: () => {
      writesUnavailable = false
    },
    allowAck: () => {
      ackUnavailable = false
    },
  }
}

test("a completed game survives a D1 refusal and appears in stats after the next day", async () => {
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const fixture = createFixture({ completedDates: [[yesterday, true]], failWrites: true })

  const unavailable = await handleGetStats(fixture.request("GET", "/api/stats"), fixture.env)
  assert.equal(unavailable.status, 200)
  assert.deepEqual(await unavailable.json(), {
    played: 0,
    won: 0,
    winRate: 0,
    currentStreak: 0,
    maxStreak: 0,
    lastPlayedDate: null,
    migratedAt: null,
    pendingResults: 1,
  })
  assert.equal(fixture.pending().length, 1)

  fixture.allowWrites()
  const recovered = await handleGetStats(fixture.request("GET", "/api/stats"), fixture.env)
  assert.equal(recovered.status, 200)
  const stats = await recovered.json()
  assert.equal(stats.played, 1)
  assert.equal(stats.won, 1)
  assert.equal(stats.lastPlayedDate, yesterday)
  assert.equal(stats.pendingResults, 0)
  assert.deepEqual(fixture.pending(), [])
})

test("lost acknowledgement cannot count one game twice and delayed days keep their streak", async () => {
  const first = new Date(Date.now() - 172_800_000).toISOString().slice(0, 10)
  const second = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)
  const fixture = createFixture({
    completedDates: [
      [second, true],
      [first, true],
    ],
    failAck: true,
  })

  const firstRead = await handleGetStats(fixture.request("GET", "/api/stats"), fixture.env)
  assert.equal(firstRead.status, 200)
  assert.equal((await firstRead.json()).played, 2)
  assert.equal(fixture.pending().length, 2)

  fixture.allowAck()
  const secondRead = await handleGetStats(fixture.request("GET", "/api/stats"), fixture.env)
  const stats = await secondRead.json()
  assert.equal(stats.played, 2)
  assert.equal(stats.won, 2)
  assert.equal(stats.currentStreak, 2)
  assert.equal(stats.maxStreak, 2)
  assert.equal(stats.pendingResults, 0)
  assert.deepEqual(fixture.pending(), [])

  const duplicatePost = await handleUpdateStats(
    fixture.request("POST", "/api/stats/update"),
    fixture.env,
  )
  assert.equal(duplicatePost.status, 200)
  assert.equal((await duplicatePost.json()).stats.played, 2)
})
