// B-1069: the Iconoplasm session reader over the real sealed session cookie
// (workers/lib/sealed-session.js). Nothing here fakes a session store: a browser
// is signed in by a real sealed cookie, and the only stand-ins are the two D1
// databases the account check reads when it is due.
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { DatabaseSync } from "node:sqlite"
import test from "node:test"
import { iconoplasmSessionUser, IconoplasmSessionUnavailableError } from "./session-user.js"
import {
  requireBrowserSession,
  safeErrorResponse,
} from "./caretaker/manifestation-authority-http-security.js"
import {
  SESSION_MAX_AGE_SECONDS,
  SessionSecretMissingError,
  seal,
  sealSession,
} from "../lib/sealed-session.js"
import { TEST_SESSION_SECRET, sessionCookieFor } from "../test-helpers/sealed-session-cookie.js"

const ENV = { SESSION_SECRET: TEST_SESSION_SECRET }

function request(cookie) {
  return new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/caretaker/genes/TRIM28", {
    headers: cookie ? { Cookie: cookie } : {},
  })
}

// A D1 database that counts the statements prepared against it and fails each.
function failingDb(error, counter) {
  return {
    prepare() {
      counter.calls += 1
      return {
        bind: () => ({
          first: async () => {
            throw error
          },
        }),
      }
    },
    batch: async () => {
      throw error
    },
  }
}

// The Iconoplasm database's sign-out list, built from its real migration.
function signOutList(revokedSessionIds = []) {
  const database = new DatabaseSync(":memory:")
  database.exec(
    readFileSync(
      new URL("../../migrations-iconoplasm/0118_auth_session_revocations.sql", import.meta.url),
      "utf8",
    ),
  )
  for (const id of revokedSessionIds) {
    database
      .prepare("INSERT INTO auth_session_revocations (session_id, expires_at) VALUES (?, ?)")
      .run(id, Date.now() + 86_400_000)
  }
  return {
    prepare: (sql) => ({
      bind: (...args) => ({ first: async () => database.prepare(sql).get(...args) || null }),
    }),
  }
}

// A cookie whose account check is due (never done), so reading it asks D1.
const dueCookie = (extra = {}) =>
  sessionCookieFor({ user_id: "discord-user", sid: "session-1", account_checked_at: 0, ...extra })

test("guests need no lookup; a cookie this site did not seal remains a guest", async () => {
  const counter = { calls: 0 }
  const env = {
    ...ENV,
    DB: failingDb(new Error("a guest must not reach D1"), counter),
    ICONOPLASM_DB: failingDb(new Error("a guest must not reach D1"), counter),
  }
  assert.equal(await iconoplasmSessionUser(request(""), env), null)
  assert.equal(counter.calls, 0)

  const otherSite = await sessionCookieFor(
    { user_id: "discord-user" },
    { SESSION_SECRET: "another-site-secret-0000000000000000000" },
  )
  const handshake = `session=${await seal(ENV, { user_id: "discord-user" }, { purpose: "oauth", maxAgeSeconds: 600 })}`
  const longAgo = Date.now() - (SESSION_MAX_AGE_SECONDS + 86_400) * 1000
  const expired = `session=${await sealSession(
    ENV,
    { user_id: "discord-user", account_checked_at: longAgo },
    { now: longAgo },
  )}`
  const noUser = await sessionCookieFor({ username: "nobody" })
  for (const [why, cookie] of [
    ["plain text", "session=synthetic-session"],
    ["sealed with another secret", otherSite],
    ["a sealed value with another purpose", handshake],
    ["expired", expired],
    ["sealed without a user", noUser],
  ]) {
    assert.equal(await iconoplasmSessionUser(request(cookie), env), null, why)
  }
  assert.equal(counter.calls, 0, "none of them reached D1")
})

test("a signed-out session remains a guest once its account check is due", async () => {
  const env = { ...ENV, ICONOPLASM_DB: signOutList(["session-1"]) }
  assert.equal(await iconoplasmSessionUser(request(await dueCookie()), env), null)
})

test("valid sessions expose only account identity, never provider credentials", async () => {
  const counter = { calls: 0 }
  const env = {
    ...ENV,
    DB: failingDb(new Error("a fresh session needs no D1"), counter),
    ICONOPLASM_DB: failingDb(new Error("a fresh session needs no D1"), counter),
  }
  const cookie = await sessionCookieFor({
    user_id: "discord-user",
    account_id: "account_active",
    username: "specimen",
    avatar_url: "/api/avatar/example",
    access_token: "synthetic-private-value",
  })
  assert.deepEqual(await iconoplasmSessionUser(request(cookie), env), {
    user_id: "discord-user",
    account_id: "account_active",
    username: "specimen",
    avatar_url: "/api/avatar/example",
  })
  assert.equal(counter.calls, 0, "an account checked within five minutes is trusted without D1")
})

test("a session outage is a retryable caretaker service failure, never a sign-in verdict", async () => {
  const outages = [
    [
      "the sign-out list throws",
      (counter) => ({
        ICONOPLASM_DB: {
          prepare() {
            counter.calls += 1
            throw new Error("private transport detail")
          },
        },
      }),
    ],
    [
      "the sign-out list rejects",
      (counter) => ({
        ICONOPLASM_DB: failingDb(new Error("D1_ERROR: private detail"), counter),
      }),
    ],
    [
      "the account lookup rejects",
      (counter) => ({
        ICONOPLASM_DB: signOutList(),
        DB: failingDb(new Error("D1_ERROR: private detail"), counter),
      }),
    ],
  ]
  for (const [outage, bindings] of outages) {
    const counter = { calls: 0 }
    let error
    try {
      await requireBrowserSession(
        request(await dueCookie()),
        { ...ENV, ...bindings(counter) },
        iconoplasmSessionUser,
      )
    } catch (caught) {
      error = caught
    }
    assert.ok(error instanceof IconoplasmSessionUnavailableError, outage)
    const response = safeErrorResponse(error)
    assert.equal(response.status, 503, outage)
    assert.equal(response.headers.get("set-cookie"), null, outage)
    assert.equal(response.headers.get("cache-control"), "private, no-store", outage)
    assert.ok(Number(response.headers.get("retry-after")) > 0, outage)
    assert.deepEqual(await response.json(), { error: { code: "SESSION_AUTHORITY_UNAVAILABLE" } })
    assert.ok(counter.calls <= 1, `${outage}: no automatic retry fan-out during a service outage`)
  }
})

test("missing infrastructure cannot masquerade as an expired browser session", async () => {
  // The account check is due and there is no database to answer it.
  await assert.rejects(
    iconoplasmSessionUser(request(await dueCookie()), ENV),
    IconoplasmSessionUnavailableError,
  )
  // Without the secret no cookie can be read at all: a loud failure, not a guest.
  await assert.rejects(
    iconoplasmSessionUser(request(await dueCookie()), {}),
    SessionSecretMissingError,
  )
})

test("daily D1 limit keeps its bounded retry deadline", async () => {
  const counter = { calls: 0 }
  await assert.rejects(
    iconoplasmSessionUser(request(await dueCookie()), {
      ...ENV,
      ICONOPLASM_DB: failingDb(
        new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit"),
        counter,
      ),
    }),
    (error) => {
      assert.ok(error instanceof IconoplasmSessionUnavailableError)
      assert.equal(error.code, "SESSION_AUTHORITY_DAILY_LIMIT")
      assert.ok(error.retryAfter >= 1 && error.retryAfter <= 86405)
      return true
    },
  )
  assert.equal(counter.calls, 1)
})
