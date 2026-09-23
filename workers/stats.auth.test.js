import assert from "node:assert/strict"
import test from "node:test"

import { handleGetStats, handleMigrateStats } from "./stats.js"

test("stats preserves canonical session-authority unavailability instead of inventing logout", async () => {
  const sessionCalls = []
  const response = await handleGetStats(
    new Request("https://geneguessr.brinedew.bio/api/stats", {
      headers: { Cookie: "session=still-present" },
    }),
    {
      GAME_SESSIONS: {
        idFromName(name) {
          assert.equal(name, "session:still-present")
          return name
        },
        get() {
          return {
            async fetch(request) {
              const url = new URL(typeof request === "string" ? request : request.url)
              sessionCalls.push({ path: url.pathname, method: request.method || "GET" })
              if (url.pathname === "/auth/resolve") {
                return Response.json(
                  { error: "Account status unavailable" },
                  { status: 503, headers: { "Retry-After": "3600" } },
                )
              }
              return Response.json({})
            },
          }
        },
      },
      DB: {
        prepare() {
          throw new Error("stats D1 must not run while session authority is unavailable")
        },
      },
    },
  )

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("Retry-After"), "3600")
  assert.deepEqual(await response.json(), {
    error: "Session verification is temporarily unavailable. Try again later.",
    code: "SESSION_AUTHORITY_UNAVAILABLE",
    retry_after_seconds: 3600,
  })
  assert.deepEqual(sessionCalls, [{ path: "/auth/resolve", method: "POST" }])
})

test("legacy import never overwrites games already saved on the account", async () => {
  const response = await handleMigrateStats(
    new Request("https://geneguessr.brinedew.bio/api/migrate-stats", {
      method: "POST",
      headers: { Cookie: "session=existing", "Content-Type": "application/json" },
      body: JSON.stringify({ played: 2, won: 2, currentStreak: 2, maxStreak: 2 }),
    }),
    {
      GAME_SESSIONS: {
        idFromName: (name) => name,
        get: () => ({ fetch: async () => Response.json({ user_id: "player-1" }) }),
      },
      DB: {
        prepare: () => ({
          bind: () => ({
            first: async () => ({ migrated_at: null, total_played: 11 }),
            run: async () => {
              throw new Error("existing account totals must not be replaced")
            },
          }),
        }),
      },
    },
  )

  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /already has saved games/)
})
