import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

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
      async deleteAll() {
        values.clear()
      },
    },
    blockConcurrencyWhile(operation) {
      const result = serialized.then(operation)
      serialized = result.catch(() => undefined)
      return result
    },
  }
}

class StatusStatement {
  constructor(database, sql, args = []) {
    this.database = database
    this.sql = sql
    this.args = args
  }

  bind(...args) {
    return new StatusStatement(this.database, this.sql, args)
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.args) || null
  }

  async run() {
    return { meta: this.database.prepare(this.sql).run(...this.args) }
  }
}

function accountStatusDb(status) {
  const database = new DatabaseSync(":memory:")
  database.exec(`
    CREATE TABLE brinedew_accounts (
      account_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      account_version INTEGER NOT NULL,
      author_label TEXT,
      anonymized_at INTEGER
    );
    CREATE TABLE brinedew_account_identities (
      provider TEXT NOT NULL,
      provider_subject TEXT NOT NULL,
      account_id TEXT NOT NULL,
      link_version INTEGER NOT NULL,
      unlinked_at INTEGER,
      last_seen_at INTEGER NOT NULL,
      PRIMARY KEY (provider, provider_subject)
    );
    INSERT INTO brinedew_accounts (
      account_id, status, account_version, author_label, anonymized_at
    ) VALUES (
      'acct_11111111111111111111111111111111', '${status}', 2, NULL, NULL
    );
    INSERT INTO brinedew_account_identities (
      provider, provider_subject, account_id, link_version, unlinked_at, last_seen_at
    ) VALUES (
      'discord', 'discord-admin', 'acct_11111111111111111111111111111111', 1, NULL, 1
    );
  `)
  return {
    prepare(sql) {
      return new StatusStatement(database, sql)
    },
    async batch() {
      throw new Error("Unexpected account-status write")
    },
  }
}

function expiredSession(overrides = {}) {
  return {
    user_id: "discord-admin",
    account_id: "acct_11111111111111111111111111111111",
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
  assert.equal(result.session.account_id, "acct_11111111111111111111111111111111")
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
  assert.equal(payload.user.account_id, "acct_11111111111111111111111111111111")
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
  assert.equal(result.session.account_id, "acct_11111111111111111111111111111111")
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

test("a disabled account invalidates an existing session before token refresh or caretaker reads", async (t) => {
  const originalFetch = globalThis.fetch
  let providerFetches = 0
  globalThis.fetch = async () => {
    providerFetches += 1
    return Response.json({ access_token: "should-not-run", expires_in: 3600 })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const sessionObject = new GameSession(durableState(expiredSession()), {
    DB: accountStatusDb("disabled"),
    DISCORD_CLIENT_ID: "client",
  })
  const response = await sessionObject.fetch(
    new Request("http://internal/auth/resolve", { method: "POST" }),
  )
  assert.equal(response.status, 401)
  assert.equal(response.headers.get("X-Brinedew-Account-Status"), "disabled")
  assert.equal(providerFetches, 0)

  const caretakerRead = await sessionObject.fetch(new Request("http://internal/get"))
  assert.equal(caretakerRead.status, 200)
  assert.deepEqual(await caretakerRead.json(), {})
})

test("auth/me expires browser cookies when account status invalidates a durable session", async () => {
  const sessionObject = new GameSession(
    durableState(expiredSession({ expires_at: Date.now() + 60_000 })),
    {
      DB: accountStatusDb("erasure_pending"),
    },
  )
  const response = await handleMe(
    new Request("https://iconoplasm.brinedew.bio/api/auth/me", {
      headers: { Cookie: "session=disabled-session" },
    }),
    {
      GAME_SESSIONS: {
        idFromName(value) {
          return value
        },
        get() {
          return { fetch: (request) => sessionObject.fetch(request) }
        },
      },
    },
  )
  const payload = await response.json()
  const cookies = response.headers.get("set-cookie") || ""
  assert.equal(response.status, 401)
  assert.deepEqual(payload, {
    authenticated: false,
    code: "ACCOUNT_NOT_ACTIVE",
    account_status: "erasure_pending",
  })
  assert.match(cookies, /session=;/)
  assert.match(cookies, /Max-Age=0/)
  assert.match(cookies, /brinedew_session_present=/)
})
