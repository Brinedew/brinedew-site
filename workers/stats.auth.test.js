import assert from "node:assert/strict"
import test from "node:test"

import { handleGetStats } from "./stats.js"

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
