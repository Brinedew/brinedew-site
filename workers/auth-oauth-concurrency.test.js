import assert from "node:assert/strict"
import test from "node:test"
import { DatabaseSync } from "node:sqlite"

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

class D1Statement {
  constructor(database, sql, args = []) {
    this.database = database
    this.sql = sql
    this.args = args
  }

  bind(...args) {
    return new D1Statement(this.database, this.sql, args)
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.args) || null
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.args)
    return { success: true, meta: { changes: Number(result.changes || 0) } }
  }
}

class FakeIdentityDb {
  constructor() {
    this.database = new DatabaseSync(":memory:")
    this.database.exec("PRAGMA foreign_keys = ON")
    this.database.exec(`
      CREATE TABLE brinedew_accounts (
        account_id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        account_version INTEGER NOT NULL DEFAULT 1,
        author_label TEXT,
        anonymized_at INTEGER
      );
      CREATE TABLE brinedew_account_identities (
        provider TEXT NOT NULL,
        provider_subject TEXT NOT NULL,
        account_id TEXT NOT NULL REFERENCES brinedew_accounts(account_id),
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        link_version INTEGER NOT NULL DEFAULT 1,
        unlinked_at INTEGER,
        PRIMARY KEY (provider, provider_subject)
      );
      CREATE TABLE brinedew_account_lifecycle_events (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        command_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        from_status TEXT,
        to_status TEXT NOT NULL,
        account_version INTEGER NOT NULL,
        author_label TEXT,
        reason_code TEXT NOT NULL DEFAULT '',
        actor_account_id TEXT,
        occurred_at INTEGER NOT NULL,
        UNIQUE (account_id, account_version),
        UNIQUE (account_id, command_id)
      );
      CREATE TABLE brinedew_account_identity_events (
        event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        command_id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        provider_subject_fingerprint TEXT NOT NULL,
        event_type TEXT NOT NULL,
        link_version INTEGER NOT NULL,
        actor_account_id TEXT,
        occurred_at INTEGER NOT NULL,
        UNIQUE (account_id, provider, provider_subject_fingerprint, link_version),
        UNIQUE (account_id, command_id, provider, provider_subject_fingerprint)
      );
      CREATE TABLE users (
        discord_id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        avatar_url TEXT,
        tier TEXT NOT NULL,
        leaderboard_opt_in INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        account_id TEXT
      );
      CREATE TABLE game_session_write_observations_do_not_delete (
        observed_day TEXT NOT NULL,
        minute_bucket TEXT NOT NULL,
        operation TEXT NOT NULL,
        session_kind TEXT NOT NULL,
        outcome TEXT NOT NULL,
        error_fingerprint TEXT NOT NULL DEFAULT '',
        count INTEGER NOT NULL DEFAULT 0,
        first_seen_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        PRIMARY KEY (
          observed_day,
          minute_bucket,
          operation,
          session_kind,
          outcome,
          error_fingerprint
        )
      );
      CREATE TABLE game_session_write_failure_samples_do_not_delete (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        observed_day TEXT NOT NULL,
        occurred_at INTEGER NOT NULL,
        operation TEXT NOT NULL,
        session_kind TEXT NOT NULL,
        request_path TEXT,
        error_message TEXT NOT NULL
      );
    `)
    this.serialized = Promise.resolve()
  }

  prepare(sql) {
    return new D1Statement(this.database, sql)
  }

  async batch(statements) {
    const operation = this.serialized.then(async () => {
      this.database.exec("BEGIN IMMEDIATE")
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        this.database.exec("COMMIT")
        return results
      } catch (error) {
        this.database.exec("ROLLBACK")
        throw error
      }
    })
    this.serialized = operation.catch(() => undefined)
    return operation
  }
}

function createEnv() {
  const gameSessions = new FakeGameSessions()
  return {
    DISCORD_CLIENT_ID: "test-client",
    GAME_SESSIONS: gameSessions,
    DB: new FakeIdentityDb(),
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
  let profileReads = 0
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
      profileReads += 1
      return Response.json({
        id: "discord-user",
        username: profileReads === 1 ? "original-name" : "renamed-user",
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

  const persistentSessions = [...env.GAME_SESSIONS.records.entries()]
    .filter(([key]) => key.startsWith("session:"))
    .map(([, value]) => value)
  assert.equal(persistentSessions.length, 2)
  assert.match(persistentSessions[0].account_id, /^acct_[0-9a-f]{32}$/)
  assert.equal(persistentSessions[1].account_id, persistentSessions[0].account_id)
  assert.deepEqual(
    persistentSessions.map((session) => session.username),
    ["original-name", "renamed-user"],
  )
  assert.equal(
    env.DB.database.prepare(`SELECT account_id FROM users WHERE discord_id = 'discord-user'`).get()
      .account_id,
    persistentSessions[0].account_id,
  )
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

test("D1 daily read exhaustion returns retryable auth downtime instead of throwing 1101", async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === "https://discord.com/api/v10/oauth2/token") {
      return Response.json({
        access_token: "quota-access",
        refresh_token: "quota-refresh",
        expires_in: 3600,
      })
    }
    if (url === "https://discord.com/api/v10/users/@me") {
      return Response.json({ id: "quota-discord", username: "quota-user", avatar: null })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const env = createEnv()
  const login = oauthAttempt(
    await handleLogin(new Request("https://geneguessr.brinedew.bio/api/auth/login"), env),
  )
  env.DB = {
    prepare() {
      throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.")
    },
    batch() {
      throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.")
    },
  }

  const response = await handleCallback(
    new Request(
      `https://geneguessr.brinedew.bio/api/auth/callback?code=quota&state=${encodeURIComponent(login.state)}`,
      { headers: { Cookie: login.browserCookie } },
    ),
    env,
  )

  assert.equal(response.status, 503)
  assert.ok(Number(response.headers.get("retry-after")) > 0)
  assert.match(response.headers.get("set-cookie"), new RegExp(`^${login.cookieName}=;`))
  assert.deepEqual(await response.json(), {
    error: "Sign-in is temporarily unavailable while account storage resets.",
    code: "AUTHORITY_STORAGE_DAILY_LIMIT",
    retry_after_seconds: Number(response.headers.get("retry-after")),
  })
  assert.equal(
    [...env.GAME_SESSIONS.records.keys()].filter((key) => key.startsWith("session:")).length,
    0,
  )
})

test("OAuth refuses a disabled account before creating a persistent session", async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url === "https://discord.com/api/v10/oauth2/token") {
      return Response.json({
        access_token: "disabled-access",
        refresh_token: "disabled-refresh",
        expires_in: 3600,
      })
    }
    if (url === "https://discord.com/api/v10/users/@me") {
      return Response.json({ id: "disabled-discord", username: "renamed-disabled", avatar: null })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const env = createEnv()
  const accountId = "acct_22222222222222222222222222222222"
  env.DB.database
    .prepare(
      `INSERT INTO brinedew_accounts (
         account_id, status, created_at, updated_at, account_version
       ) VALUES (?, 'disabled', 1, 1, 2)`,
    )
    .run(accountId)
  env.DB.database
    .prepare(
      `INSERT INTO brinedew_account_identities (
         provider, provider_subject, account_id, created_at, last_seen_at,
         link_version, unlinked_at
       ) VALUES ('discord', 'disabled-discord', ?, 1, 1, 1, NULL)`,
    )
    .run(accountId)

  const login = oauthAttempt(
    await handleLogin(new Request("https://iconoplasm.brinedew.bio/api/auth/login"), env),
  )
  const response = await handleCallback(
    new Request(
      `https://iconoplasm.brinedew.bio/api/auth/callback?code=disabled&state=${encodeURIComponent(login.state)}`,
      { headers: { Cookie: login.browserCookie } },
    ),
    env,
  )

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), {
    error: "This Brinedew account is not active.",
    code: "ACCOUNT_NOT_ACTIVE",
    account_status: "disabled",
  })
  assert.equal(
    [...env.GAME_SESSIONS.records.keys()].filter((key) => key.startsWith("session:")).length,
    0,
  )
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
