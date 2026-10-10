// B-1069: Brinedew sign-in end to end through the real handlers. The OAuth handshake and the
// session are sealed cookies; the accounts are the real identity schema in SQLite, the sign-out
// list is the Iconoplasm migration, and Discord is a fake that refuses a reused code.
import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"

import {
  SHARED_SESSION_PRESENCE_COOKIE,
  handleCallback,
  handleLogin,
  handleLogout,
  handleMe,
} from "./auth.js"
import { ACCOUNT_RECHECK_MS, readSession } from "./lib/sealed-session.js"
import { TEST_SESSION_SECRET } from "./test-helpers/sealed-session-cookie.js"
import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

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

// The Iconoplasm database's sign-out list, built from its real migration.
function revocationDb() {
  const database = new DatabaseSync(":memory:")
  database.exec(
    readFileSync(
      new URL("../migrations-iconoplasm/0118_auth_session_revocations.sql", import.meta.url),
      "utf8",
    ),
  )
  return {
    database,
    prepare: (sql) => new D1Statement(database, sql),
    async batch(statements) {
      return Promise.all(statements.map((statement) => statement.run()))
    },
  }
}

const SUPPORTER_ROLE = "role-supporter"

function createEnv() {
  return {
    DISCORD_CLIENT_ID: "test-client",
    DISCORD_BOT_TOKEN: "bot-token",
    DISCORD_GUILD_ID: "guild-1",
    DISCORD_SUPPORTER_ROLE_ID: SUPPORTER_ROLE,
    SESSION_SECRET: TEST_SESSION_SECRET,
    DB: new FakeIdentityDb(),
    ICONOPLASM_DB: revocationDb(),
  }
}

// Discord as the Worker sees it: each authorization code works once, the user's
// token reads the profile and guild membership, and the bot reads roles.
function fakeDiscord(t, { profiles = [], roles = [] } = {}) {
  const originalFetch = globalThis.fetch
  const used = new Set()
  const calls = []
  let exchanges = 0
  let profileReads = 0
  const state = { roles }
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, auth: new Headers(init.headers).get("Authorization") })
    if (url === "https://discord.com/api/v10/oauth2/token") {
      const code = new URLSearchParams(String(init.body)).get("code")
      if (used.has(code)) return Response.json({ error: "invalid_grant" }, { status: 400 })
      used.add(code)
      exchanges += 1
      return Response.json({
        access_token: `access-${exchanges}`,
        refresh_token: `refresh-${exchanges}`,
        expires_in: 3600,
      })
    }
    if (url === "https://discord.com/api/v10/users/@me") {
      profileReads += 1
      return Response.json(profiles[profileReads - 1] || profiles.at(-1))
    }
    if (url === "https://discord.com/api/v10/users/@me/guilds/guild-1/member") {
      return Response.json({ roles: state.roles })
    }
    if (url.startsWith("https://discord.com/api/v10/guilds/guild-1/members/")) {
      return Response.json({ roles: state.roles })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  return {
    calls,
    state,
    get exchanges() {
      return exchanges
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

function callback(host, code, attempt, cookieHeader = attempt.browserCookie) {
  return new Request(
    `https://${host}/api/auth/callback?code=${code}&state=${encodeURIComponent(attempt.state)}`,
    { headers: { Cookie: cookieHeader } },
  )
}

function sessionCookieOf(response) {
  const cookie = response.headers.getSetCookie().find((value) => value.startsWith("session="))
  return cookie ? cookie.split(";", 1)[0] : null
}

function withCookie(url, cookie, init = {}) {
  return new Request(url, { ...init, headers: { ...(init.headers || {}), Cookie: cookie } })
}

async function signIn(t, env, { roles = [] } = {}) {
  const discord = fakeDiscord(t, {
    profiles: [{ id: "discord-user", username: "reader", avatar: null }],
    roles,
  })
  const attempt = oauthAttempt(
    await handleLogin(new Request("https://iconoplasm.brinedew.bio/api/auth/login"), env),
  )
  const response = await handleCallback(callback("iconoplasm.brinedew.bio", "code-1", attempt), env)
  assert.equal(response.status, 302)
  return { discord, cookie: sessionCookieOf(response) }
}

test("overlapping app logins keep independent browser-bound OAuth attempts", async (t) => {
  const discord = fakeDiscord(t, {
    profiles: [
      { id: "discord-user", username: "original-name", avatar: null },
      { id: "discord-user", username: "renamed-user", avatar: null },
    ],
  })
  const env = createEnv()
  const first = oauthAttempt(
    await handleLogin(
      new Request(
        "https://iconoplasm.brinedew.bio/api/auth/login?return_to=https%3A%2F%2Ficonoplasm.brinedew.bio%2F%3Fflow%3Done",
      ),
      env,
    ),
  )
  const second = oauthAttempt(
    await handleLogin(
      new Request(
        "https://geneguessr.brinedew.bio/api/auth/login?return_to=https%3A%2F%2Fgeneguessr.brinedew.bio%2F%3Fflow%3Dtwo",
      ),
      env,
    ),
  )
  assert.notEqual(first.cookieName, second.cookieName)

  const cookieHeader = `${first.browserCookie}; ${second.browserCookie}`
  const firstCallback = await handleCallback(
    callback("geneguessr.brinedew.bio", "first-code", first, cookieHeader),
    env,
  )
  assert.equal(firstCallback.status, 302)
  assert.equal(firstCallback.headers.get("location"), "https://iconoplasm.brinedew.bio/?flow=one")
  assert.match(firstCallback.headers.get("set-cookie"), new RegExp(`^${first.cookieName}=;`))
  // The credential is HttpOnly. The presence marker is the opposite on purpose: page script
  // reads it to skip the identity probe for anonymous visitors, so it must be readable,
  // shared across the sites, and carry no identity.
  const callbackCookies = firstCallback.headers.getSetCookie()
  assert.ok(callbackCookies.some((cookie) => /^session=[^;]+;.* HttpOnly;/.test(cookie)))
  const presence = callbackCookies.find((cookie) => cookie.startsWith("brinedew_session_present="))
  assert.match(
    presence,
    /^brinedew_session_present=1; Path=\/; Secure; SameSite=Lax; Max-Age=\d+; Domain=\.brinedew\.bio$/,
  )

  // A replayed callback is refused: Discord accepts each authorization code once.
  const replay = await handleCallback(
    callback("geneguessr.brinedew.bio", "first-code", first, cookieHeader),
    env,
  )
  assert.equal(replay.status, 500)
  assert.equal(sessionCookieOf(replay), null)

  const secondCallback = await handleCallback(
    callback("geneguessr.brinedew.bio", "second-code", second, cookieHeader),
    env,
  )
  assert.equal(secondCallback.status, 302)
  assert.equal(secondCallback.headers.get("location"), "https://geneguessr.brinedew.bio/?flow=two")
  assert.equal(discord.exchanges, 2)

  const sessions = await Promise.all(
    [firstCallback, secondCallback].map(async (response) => {
      const read = await readSession(
        withCookie("https://iconoplasm.brinedew.bio/", sessionCookieOf(response)),
        env,
      )
      assert.equal(read.status, "signed_in")
      return read.session
    }),
  )
  assert.match(sessions[0].account_id, /^acct_[0-9a-f]{32}$/)
  assert.equal(sessions[1].account_id, sessions[0].account_id)
  assert.notEqual(sessions[1].sid, sessions[0].sid)
  assert.deepEqual(
    sessions.map((session) => session.username),
    ["original-name", "renamed-user"],
  )
  // The person's Discord tokens are used once, at sign-in, and kept nowhere.
  for (const session of sessions) {
    for (const field of ["access_token", "refresh_token", "expires_at"])
      assert.equal(field in session, false, `${field} is in the session`)
  }
  assert.equal(
    env.DB.database.prepare(`SELECT account_id FROM users WHERE discord_id = 'discord-user'`).get()
      .account_id,
    sessions[0].account_id,
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
  fakeDiscord(t, { profiles: [{ id: "quota-discord", username: "quota-user", avatar: null }] })
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
  const response = await handleCallback(callback("geneguessr.brinedew.bio", "quota", login), env)

  assert.equal(response.status, 503)
  assert.ok(Number(response.headers.get("retry-after")) > 0)
  assert.match(response.headers.get("set-cookie"), new RegExp(`^${login.cookieName}=;`))
  assert.deepEqual(await response.json(), {
    error: "Sign-in is temporarily unavailable while account storage resets.",
    code: "AUTHORITY_STORAGE_DAILY_LIMIT",
    retry_after_seconds: Number(response.headers.get("retry-after")),
  })
  assert.equal(sessionCookieOf(response), null)
})

test("OAuth refuses a disabled account before creating a session", async (t) => {
  fakeDiscord(t, {
    profiles: [{ id: "disabled-discord", username: "renamed-disabled", avatar: null }],
  })
  const env = createEnv()
  const accountId = "acct_22222222222222222222222222222222"
  env.DB.database
    .prepare(
      `INSERT INTO brinedew_accounts (account_id, status, created_at, updated_at, account_version)
       VALUES (?, 'disabled', 1, 1, 2)`,
    )
    .run(accountId)
  env.DB.database
    .prepare(
      `INSERT INTO brinedew_account_identities (
         provider, provider_subject, account_id, created_at, last_seen_at, link_version, unlinked_at
       ) VALUES ('discord', 'disabled-discord', ?, 1, 1, 1, NULL)`,
    )
    .run(accountId)
  const login = oauthAttempt(
    await handleLogin(new Request("https://iconoplasm.brinedew.bio/api/auth/login"), env),
  )
  const response = await handleCallback(callback("iconoplasm.brinedew.bio", "disabled", login), env)

  assert.equal(response.status, 403)
  assert.deepEqual(await response.json(), {
    error: "This Brinedew account is not active.",
    code: "ACCOUNT_NOT_ACTIVE",
    account_status: "disabled",
  })
  assert.equal(sessionCookieOf(response), null)
})

test("a session reads with no storage, picks up a role change by the bot, and logout revokes its copies", async (t) => {
  const env = createEnv()
  const { discord, cookie } = await signIn(t, env)

  const me = await handleMe(withCookie("https://iconoplasm.brinedew.bio/api/auth/me", cookie), env)
  assert.equal(me.status, 200)
  const user = (await me.json()).user
  assert.equal(user.id, "discord-user")
  assert.equal(user.tier, "registered")
  const resealed = sessionCookieOf(me)
  assert.ok(resealed)

  // Five minutes on, the supporter role was granted: the bot's check finds it.
  discord.state.roles = [SUPPORTER_ROLE]
  const later = Date.now() + ACCOUNT_RECHECK_MS + 1000
  t.mock.timers.enable({ apis: ["Date"], now: later })
  const upgraded = await handleMe(
    withCookie("https://iconoplasm.brinedew.bio/api/auth/me", resealed),
    env,
  )
  assert.equal((await upgraded.json()).user.tier, "supporter")
  assert.ok(
    discord.calls.some(
      (call) =>
        call.url.endsWith("/guilds/guild-1/members/discord-user") && call.auth === "Bot bot-token",
    ),
  )
  assert.equal(
    env.DB.database.prepare(`SELECT tier FROM users WHERE discord_id = 'discord-user'`).get().tier,
    "supporter",
  )
  const copy = sessionCookieOf(upgraded)

  const logout = await handleLogout(
    withCookie("https://iconoplasm.brinedew.bio/api/auth/logout", copy, { method: "POST" }),
    env,
  )
  assert.equal(logout.status, 204)
  const cleared = logout.headers.getSetCookie()
  assert.ok(cleared.some((value) => /^session=;.*Max-Age=0/.test(value)))
  assert.ok(cleared.some((value) => value.startsWith(`${SHARED_SESSION_PRESENCE_COOKIE}=;`)))

  // A copy of the cookie works until its account check is due, then it is refused.
  const page = withCookie("https://iconoplasm.brinedew.bio/", copy)
  assert.equal((await readSession(page, env, { now: later + 1000 })).status, "signed_in")
  assert.equal(
    (await readSession(page, env, { now: later + ACCOUNT_RECHECK_MS + 2000 })).status,
    "invalid",
  )
  // So is every older copy: they share the session id.
  assert.equal(
    (
      await readSession(withCookie("https://iconoplasm.brinedew.bio/", cookie), env, {
        now: later + ACCOUNT_RECHECK_MS + 2000,
      })
    ).status,
    "invalid",
  )
})

test("an account disabled after sign-in is refused at its next check, and its cookie cleared", async (t) => {
  const env = createEnv()
  const { cookie } = await signIn(t, env)
  env.DB.database.prepare(`UPDATE brinedew_accounts SET status = 'disabled'`).run()

  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + ACCOUNT_RECHECK_MS + 1000 })
  const response = await handleMe(
    withCookie("https://iconoplasm.brinedew.bio/api/auth/me", cookie),
    env,
  )
  assert.equal(response.status, 401)
  assert.deepEqual(await response.json(), {
    authenticated: false,
    code: "ACCOUNT_NOT_ACTIVE",
    account_status: "disabled",
  })
  assert.match(response.headers.get("set-cookie"), /^session=;.*Max-Age=0/)
})

test("an account check D1 can't answer keeps the cookie and gives the reset time, not a logout", async (t) => {
  const env = createEnv()
  const { cookie } = await signIn(t, env)
  env.ICONOPLASM_DB = {
    prepare() {
      throw new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit.")
    },
  }
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + ACCOUNT_RECHECK_MS + 1000 })
  const response = await handleMe(
    withCookie("https://iconoplasm.brinedew.bio/api/auth/me", cookie),
    env,
  )

  assert.equal(response.status, 503)
  assert.equal(response.headers.get("set-cookie"), null)
  const payload = await response.json()
  assert.equal(payload.code, "SESSION_AUTHORITY_DAILY_LIMIT")
  assert.equal("authenticated" in payload, false, "unavailable is not a logged-out verdict")
  assert.equal(Number(response.headers.get("retry-after")), payload.retry_after_seconds)
})

test("a cookie this site didn't seal is refused and cleared", async () => {
  const env = createEnv()
  const response = await handleMe(
    withCookie("https://iconoplasm.brinedew.bio/api/auth/me", "session=forged.value.here"),
    env,
  )
  assert.equal(response.status, 401)
  assert.match(response.headers.get("set-cookie"), /^session=;.*Max-Age=0/)
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

// B-832: a failed request is reported to Sentry from the Worker. The reader's cookie,
// tokens and address, and the query string, must never leave with it.
test("a failed auth request is reported to Sentry without cookies, tokens, addresses or the query string", async (t) => {
  const env = {
    ...createEnv(),
    SENTRY_DSN: "https://publickey@o1.ingest.us.sentry.io/42",
  }
  const { cookie } = await signIn(t, env)
  env.ICONOPLASM_DB = {
    prepare() {
      throw new Error("D1_ERROR: storage is temporarily unavailable")
    },
  }
  const originalFetch = globalThis.fetch
  const envelopes = []
  globalThis.fetch = async (url, init) => {
    envelopes.push({ url: String(url), body: String(init?.body) })
    return new Response(null, { status: 200 })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })
  const pending = []
  const ctx = { waitUntil: (promise) => pending.push(promise) }
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() + ACCOUNT_RECHECK_MS + 1000 })

  const failed = await worker.fetch(
    new Request("https://brinedew.bio/api/auth/me?token=query-secret", {
      headers: {
        Cookie: cookie,
        Authorization: "Bearer bearer-secret",
        "x-iconoplasm-admin-token": "admin-secret",
        "cf-connecting-ip": "203.0.113.9",
        "user-agent": "test-agent",
      },
    }),
    env,
    ctx,
  )
  assert.equal(failed.status, 503)
  await Promise.all(pending)
  assert.equal(envelopes.length, 1)
  assert.equal(envelopes[0].url, "https://o1.ingest.us.sentry.io/api/42/envelope/")
  const sealed = cookie.slice("session=".length)
  for (const secret of ["query-secret", sealed, "bearer-secret", "admin-secret", "203.0.113.9"]) {
    assert.equal(
      envelopes[0].body.includes(secret),
      false,
      `${secret.slice(0, 12)} left the Worker`,
    )
  }
  const event = JSON.parse(envelopes[0].body.split("\n")[2])
  assert.equal(event.request.url, "https://brinedew.bio/api/auth/me")
})
