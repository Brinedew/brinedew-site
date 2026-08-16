import assert from "node:assert/strict"
import test from "node:test"

import {
  handleMe,
  PERSISTENT_SESSION_MAX_AGE_SECONDS,
  resolveDiscordSessionAuthorization,
} from "./auth.js"
import { GameSession } from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

function durableState(initialData) {
  const values = new Map([["data", initialData]])
  let serialized = Promise.resolve()
  return {
    storage: {
      async get(key) {
        return values.get(key)
      },
      async put(key, value) {
        values.set(key, value)
      },
    },
    blockConcurrencyWhile(operation) {
      const result = serialized.then(operation)
      serialized = result.catch(() => undefined)
      return result
    },
  }
}

function expiredSession(overrides = {}) {
  return {
    user_id: "discord-admin",
    username: "admin",
    tier: "supporter",
    is_guild_member: true,
    access_token: "expired-access",
    refresh_token: "refresh-one",
    expires_at: 1,
    ...overrides,
  }
}

test("Discord access tokens refresh before expiry and rotate the stored refresh token", async () => {
  const now = 10_000_000
  let requestBody = ""
  const result = await resolveDiscordSessionAuthorization(
    expiredSession(),
    { DISCORD_CLIENT_ID: "client", DISCORD_CLIENT_SECRET: "secret" },
    {
      now,
      async fetchImpl(_url, init) {
        requestBody = init.body
        return Response.json({
          access_token: "access-two",
          refresh_token: "refresh-two",
          expires_in: 604800,
        })
      },
    },
  )

  const params = new URLSearchParams(requestBody)
  assert.equal(params.get("grant_type"), "refresh_token")
  assert.equal(params.get("refresh_token"), "refresh-one")
  assert.equal(params.get("client_id"), "client")
  assert.equal(params.get("client_secret"), "secret")
  assert.equal(result.outcome, "refreshed")
  assert.equal(result.session.access_token, "access-two")
  assert.equal(result.session.refresh_token, "refresh-two")
  assert.equal(result.session.expires_at, now + 604800 * 1000)
})

test("the Durable Object serializes concurrent refreshes so a rotated token is used once", async (t) => {
  const originalFetch = globalThis.fetch
  let refreshes = 0
  globalThis.fetch = async () => {
    refreshes += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    return Response.json({
      access_token: "access-two",
      refresh_token: "refresh-two",
      expires_in: 604800,
    })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const sessionObject = new GameSession(durableState(expiredSession()), {
    DISCORD_CLIENT_ID: "client",
  })
  const responses = await Promise.all([
    sessionObject.fetch(new Request("http://internal/auth/resolve", { method: "POST" })),
    sessionObject.fetch(new Request("http://internal/auth/resolve", { method: "POST" })),
  ])

  assert.equal(refreshes, 1)
  assert.deepEqual(
    await Promise.all(responses.map((response) => response.json().then((row) => row.access_token))),
    ["access-two", "access-two"],
  )
})

test("revoked Discord authorization does not log out the durable Brinedew identity", async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ error: "invalid_grant" }, { status: 400 })
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const sessionObject = new GameSession(durableState(expiredSession()), {
    DISCORD_CLIENT_ID: "client",
  })
  const env = {
    ADMIN_DISCORD_USER_ID: "discord-admin",
    GAME_SESSIONS: {
      idFromName(value) {
        return value
      },
      get() {
        return { fetch: (request) => sessionObject.fetch(request) }
      },
    },
  }

  const response = await handleMe(
    new Request("https://iconoplasm.brinedew.bio/api/auth/me", {
      headers: { Cookie: "session=durable-session" },
    }),
    env,
  )
  const payload = await response.json()
  const cookies = response.headers.get("set-cookie") || ""

  assert.equal(response.status, 200)
  assert.equal(payload.authenticated, true)
  assert.equal(payload.user.id, "discord-admin")
  assert.equal(payload.user.is_admin, true)
  assert.equal(payload.user.tier, "registered")
  assert.equal(payload.user.discord_authorization_status, "reauthorization_required")
  assert.match(cookies, new RegExp(`Max-Age=${PERSISTENT_SESSION_MAX_AGE_SECONDS}`))
})

test("temporary Discord failures preserve the existing identity and entitlement snapshot", async () => {
  const session = expiredSession()
  const result = await resolveDiscordSessionAuthorization(
    session,
    { DISCORD_CLIENT_ID: "client" },
    {
      async fetchImpl() {
        return new Response("unavailable", { status: 503 })
      },
    },
  )

  assert.equal(result.outcome, "temporarily_unavailable")
  assert.equal(result.changed, false)
  assert.equal(result.session.user_id, "discord-admin")
  assert.equal(result.session.tier, "supporter")
})

test("a provider or application configuration error does not revoke the user session", async () => {
  const session = expiredSession()
  const result = await resolveDiscordSessionAuthorization(
    session,
    { DISCORD_CLIENT_ID: "client" },
    {
      async fetchImpl() {
        return Response.json({ error: "invalid_client" }, { status: 400 })
      },
    },
  )

  assert.equal(result.outcome, "temporarily_unavailable")
  assert.equal(result.changed, false)
  assert.equal(result.session.refresh_token, "refresh-one")
  assert.equal(result.session.tier, "supporter")
})
