import assert from "node:assert/strict"
import test from "node:test"

import { handleLogout, SHARED_SESSION_PRESENCE_COOKIE } from "./auth.js"
import worker, {
  GameSession,
} from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

function durableState(initialData) {
  const values = new Map([["data", initialData]])
  return {
    storage: {
      async get(key) {
        return values.get(key)
      },
      async put(key, value) {
        values.set(key, value)
      },
      async deleteAll() {
        values.clear()
      },
    },
  }
}

test("logout destroys the server-side session as well as the browser cookies", async () => {
  const sessionObject = new GameSession(
    durableState({ user_id: "discord-user", username: "reader", access_token: "token" }),
    {},
  )
  const env = {
    GAME_SESSIONS: {
      idFromName: (name) => name,
      get: () => ({ fetch: (request) => sessionObject.fetch(request) }),
    },
  }
  const stored = () =>
    sessionObject.fetch(new Request("http://internal/get")).then((response) => response.json())
  assert.equal((await stored()).user_id, "discord-user")

  const response = await handleLogout(
    new Request("https://iconoplasm.brinedew.bio/api/auth/logout", {
      method: "POST",
      headers: { Cookie: "session=live-session" },
    }),
    env,
  )

  assert.equal(response.status, 204)
  assert.deepEqual(await stored(), {}, "a copied session cookie must stop working at logout")
  const cookies = response.headers.getSetCookie()
  assert.ok(cookies.some((cookie) => /^session=;.*Max-Age=0/.test(cookie)))
  assert.ok(cookies.some((cookie) => cookie.startsWith(`${SHARED_SESSION_PRESENCE_COOKIE}=;`)))
})

test("the stateful security boundary makes every auth response non-cacheable", async () => {
  const response = await worker.fetch(
    new Request("https://brinedew.bio/api/auth/me"),
    {},
    { waitUntil() {} },
  )

  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), { authenticated: false })
  assert.equal(response.headers.get("Cache-Control"), "no-store")
})
