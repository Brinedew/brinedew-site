import assert from "node:assert/strict"
import test from "node:test"

import { handleGetStats, handleMigrateStats } from "./stats.js"
import { TEST_SESSION_SECRET, sessionCookieFor } from "./test-helpers/sealed-session-cookie.js"

test("stats preserves session unavailability instead of inventing logout", async () => {
  // The cookie's account check is due, and D1 cannot answer it.
  const cookie = await sessionCookieFor({ user_id: "player-1", account_checked_at: 0 })
  const statements = []
  const response = await handleGetStats(
    new Request("https://geneguessr.brinedew.bio/api/stats", { headers: { Cookie: cookie } }),
    {
      SESSION_SECRET: TEST_SESSION_SECRET,
      DB: {
        prepare(sql) {
          statements.push(sql)
          throw new Error("D1_ERROR: storage is temporarily unavailable")
        },
      },
    },
  )

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("Retry-After"), "60")
  assert.deepEqual(await response.json(), {
    error: "Session verification is temporarily unavailable. Try again later.",
    code: "SESSION_AUTHORITY_UNAVAILABLE",
    retry_after_seconds: 60,
  })
  // Only the account check reached D1; no stats statement ran.
  assert.equal(statements.length, 1)
  assert.doesNotMatch(statements[0], /stats|games/i)
})

test("legacy import never overwrites games already saved on the account", async () => {
  const response = await handleMigrateStats(
    new Request("https://geneguessr.brinedew.bio/api/migrate-stats", {
      method: "POST",
      headers: {
        Cookie: await sessionCookieFor({ user_id: "player-1" }),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ played: 2, won: 2, currentStreak: 2, maxStreak: 2 }),
    }),
    {
      SESSION_SECRET: TEST_SESSION_SECRET,
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
