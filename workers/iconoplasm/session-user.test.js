import assert from "node:assert/strict"
import test from "node:test"
import { iconoplasmSessionUser, IconoplasmSessionUnavailableError } from "./session-user.js"
import {
  requireBrowserSession,
  safeErrorResponse,
} from "./caretaker/manifestation-authority-http-security.js"

function request(cookie = "session=synthetic-session") {
  return new Request("https://iconoplasm.brinedew.bio/api/iconoplasm/caretaker/genes/TRIM28", {
    headers: cookie ? { Cookie: cookie } : {},
  })
}

function environment(fetch) {
  return { GAME_SESSIONS: { idFromName: (name) => name, get: () => ({ fetch }) } }
}

test("guests need no session lookup; an invalid credential remains a guest", async () => {
  let calls = 0
  const env = environment(async () => {
    calls++
    return new Response(null, { status: 401 })
  })
  assert.equal(await iconoplasmSessionUser(request(""), env), null)
  assert.equal(calls, 0)
  assert.equal(
    await iconoplasmSessionUser(
      request(),
      environment(async () => Response.json({})),
    ),
    null,
  )
  for (const status of [401, 403, 404]) {
    assert.equal(
      await iconoplasmSessionUser(
        request(),
        environment(async () => new Response(null, { status })),
      ),
      null,
    )
  }
})

test("valid sessions expose only account identity, never provider credentials", async () => {
  const user = await iconoplasmSessionUser(
    request(),
    environment(async () =>
      Response.json({
        user_id: "discord-user",
        account_id: "account_active",
        username: "specimen",
        avatar_url: "/api/avatar/example",
        access_token: "synthetic-private-value",
      }),
    ),
  )
  assert.deepEqual(user, {
    user_id: "discord-user",
    account_id: "account_active",
    username: "specimen",
    avatar_url: "/api/avatar/example",
  })
})

test("a session outage is a retryable caretaker service failure, never a sign-in verdict", async () => {
  for (const fetch of [
    async () => {
      throw new Error("private transport detail")
    },
    async () => new Response("private detail", { status: 500 }),
    async () => new Response("private detail", { status: 503, headers: { "Retry-After": "120" } }),
    async () => new Response("private detail", { status: 429 }),
    async () => new Response("not JSON", { status: 200 }),
    async () => Response.json({ error: "unexpected payload" }),
  ]) {
    let calls = 0
    const env = environment(async (...args) => {
      calls++
      return fetch(...args)
    })
    let error
    try {
      await requireBrowserSession(request(), env, iconoplasmSessionUser)
    } catch (caught) {
      error = caught
    }
    assert.ok(error instanceof IconoplasmSessionUnavailableError)
    const response = safeErrorResponse(error)
    assert.equal(response.status, 503)
    assert.equal(response.headers.get("set-cookie"), null)
    assert.equal(response.headers.get("cache-control"), "private, no-store")
    assert.ok(Number(response.headers.get("retry-after")) > 0)
    assert.deepEqual(await response.json(), { error: { code: "SESSION_AUTHORITY_UNAVAILABLE" } })
    assert.equal(calls, 1, "no automatic retry fan-out during a service outage")
  }
})

test("missing infrastructure cannot masquerade as an expired browser session", async () => {
  await assert.rejects(iconoplasmSessionUser(request(), {}), IconoplasmSessionUnavailableError)
})

test("daily session outage keeps its bounded retry deadline", async () => {
  await assert.rejects(
    iconoplasmSessionUser(
      request(),
      environment(async () => {
        throw new Error("Exceeded allowed duration in Durable Objects free tier.")
      }),
    ),
    (error) => {
      assert.equal(error.code, "SESSION_AUTHORITY_DAILY_LIMIT")
      assert.ok(error.retryAfter >= 1 && error.retryAfter <= 86405)
      return true
    },
  )
})
