import assert from "node:assert/strict"
import test from "node:test"

import { handleCallback, handleLogin } from "./auth.js"
import { GameSession } from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

class FakeGameSessions {
  constructor() {
    this.records = new Map()
  }

  idFromName(name) {
    return name
  }

  get(id) {
    return {
      fetch: async (input) => {
        const request = input instanceof Request ? input : new Request(input)
        const path = new URL(request.url).pathname

        if (path === "/store" && request.method === "POST") {
          this.records.set(id, await request.json())
          return Response.json({ success: true })
        }
        if (path === "/get" && request.method === "GET") {
          return Response.json(this.records.get(id) || {})
        }
        if (path === "/consume" && request.method === "POST") {
          const data = this.records.get(id) || {}
          this.records.delete(id)
          return Response.json(data)
        }
        if (path === "/reset" && request.method === "POST") {
          this.records.delete(id)
          return Response.json({ success: true })
        }
        return new Response("Not found", { status: 404 })
      },
    }
  }
}

function createEnv() {
  const gameSessions = new FakeGameSessions()
  return {
    DISCORD_CLIENT_ID: "test-client",
    GAME_SESSIONS: gameSessions,
    DB: {
      prepare() {
        return {
          async run() {
            return { success: true }
          },
          bind() {
            return {
              async run() {
                return { success: true }
              },
            }
          },
        }
      },
    },
  }
}

function oauthAttempt(response) {
  const location = response.headers.get("location")
  const setCookie = response.headers.get("set-cookie")
  assert.ok(location)
  assert.ok(setCookie)

  const state = new URL(location).searchParams.get("state")
  const browserCookie = setCookie.split(";", 1)[0]
  const cookieName = browserCookie.split("=", 1)[0]
  assert.ok(state)
  assert.match(cookieName, /^oauth_session_[A-Za-z0-9_-]{24}$/)

  return { state, browserCookie, cookieName }
}

test("overlapping app logins keep independent browser-bound OAuth attempts", async (t) => {
  const originalFetch = globalThis.fetch
  let tokenExchanges = 0
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === "https://discord.com/api/v10/oauth2/token") {
      tokenExchanges += 1
      return Response.json({
        access_token: `access-${tokenExchanges}`,
        refresh_token: `refresh-${tokenExchanges}`,
        expires_in: 3600,
      })
    }
    if (url === "https://discord.com/api/v10/users/@me") {
      return Response.json({
        id: "discord-user",
        username: "mobile-firefox-user",
        avatar: null,
      })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const env = createEnv()
  const firstLogin = await handleLogin(
    new Request(
      "https://iconoplasm.brinedew.bio/api/auth/login?return_to=https%3A%2F%2Ficonoplasm.brinedew.bio%2F%3Fflow%3Done",
    ),
    env,
  )
  const secondLogin = await handleLogin(
    new Request(
      "https://geneguessr.brinedew.bio/api/auth/login?return_to=https%3A%2F%2Fgeneguessr.brinedew.bio%2F%3Fflow%3Dtwo",
    ),
    env,
  )
  const first = oauthAttempt(firstLogin)
  const second = oauthAttempt(secondLogin)

  assert.notEqual(first.cookieName, second.cookieName)
  assert.doesNotMatch(first.browserCookie, /^oauth_session=/)
  assert.doesNotMatch(second.browserCookie, /^oauth_session=/)

  const cookieHeader = `${first.browserCookie}; ${second.browserCookie}`
  const firstCallback = await handleCallback(
    new Request(
      `https://geneguessr.brinedew.bio/api/auth/callback?code=first-code&state=${encodeURIComponent(first.state)}`,
      { headers: { Cookie: cookieHeader } },
    ),
    env,
  )

  assert.equal(firstCallback.status, 302)
  assert.equal(firstCallback.headers.get("location"), "https://iconoplasm.brinedew.bio/?flow=one")
  assert.match(firstCallback.headers.get("set-cookie"), new RegExp(`^${first.cookieName}=;`))

  const firstReplay = await handleCallback(
    new Request(
      `https://geneguessr.brinedew.bio/api/auth/callback?code=replayed-code&state=${encodeURIComponent(first.state)}`,
      { headers: { Cookie: cookieHeader } },
    ),
    env,
  )
  assert.equal(firstReplay.status, 400)
  assert.deepEqual(await firstReplay.json(), { error: "Invalid state parameter" })

  const secondCallback = await handleCallback(
    new Request(
      `https://geneguessr.brinedew.bio/api/auth/callback?code=second-code&state=${encodeURIComponent(second.state)}`,
      { headers: { Cookie: cookieHeader } },
    ),
    env,
  )
  assert.equal(secondCallback.status, 302)
  assert.equal(secondCallback.headers.get("location"), "https://geneguessr.brinedew.bio/?flow=two")
  assert.equal(tokenExchanges, 2)
})

test("callback state without its matching browser cookie is rejected before token exchange", async () => {
  const env = createEnv()
  const login = oauthAttempt(
    await handleLogin(new Request("https://iconoplasm.brinedew.bio/api/auth/login"), env),
  )

  const response = await handleCallback(
    new Request(
      `https://geneguessr.brinedew.bio/api/auth/callback?code=unused&state=${encodeURIComponent(login.state)}`,
    ),
    env,
  )

  assert.equal(response.status, 400)
  assert.deepEqual(await response.json(), { error: "Missing OAuth session" })
})

test("GameSession atomically consumes OAuth data and expires abandoned attempts", async () => {
  const values = new Map()
  let alarmAt = null
  const storage = {
    async put(key, value) {
      values.set(key, value)
    },
    async get(key) {
      return values.get(key)
    },
    async setAlarm(value) {
      alarmAt = value
    },
    async transaction(callback) {
      return callback({
        async get(key) {
          return values.get(key)
        },
        async delete(key) {
          values.delete(key)
        },
      })
    },
    async deleteAll() {
      values.clear()
    },
  }
  const durableObject = new GameSession({ storage }, {})
  const deleteStorageAt = Date.now() + 600_000

  const stored = await durableObject.fetch(
    new Request("http://internal/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "one-time-state", delete_storage_at: deleteStorageAt }),
    }),
  )
  assert.equal(stored.status, 200)
  assert.equal(alarmAt, deleteStorageAt)

  const consumed = await durableObject.fetch(
    new Request("http://internal/consume", { method: "POST" }),
  )
  assert.deepEqual(await consumed.json(), {
    state: "one-time-state",
    delete_storage_at: deleteStorageAt,
  })

  const replayed = await durableObject.fetch(
    new Request("http://internal/consume", { method: "POST" }),
  )
  assert.deepEqual(await replayed.json(), {})

  await durableObject.fetch(
    new Request("http://internal/store", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: "abandoned", delete_storage_at: deleteStorageAt }),
    }),
  )
  await durableObject.alarm()
  assert.equal(values.size, 0)
})
