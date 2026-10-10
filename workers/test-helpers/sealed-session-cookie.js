// A signed-in browser for tests: the real sealed session cookie (B-1069), read by
// the real lib/sealed-session.js. Its account was checked just now, so readers
// trust it without D1 unless a test passes an older `account_checked_at`.
import { sealSession } from "../lib/sealed-session.js"

export const TEST_SESSION_SECRET = "test-session-secret-000000000000000000000"

export async function sessionCookieFor(session, env = { SESSION_SECRET: TEST_SESSION_SECRET }) {
  return `session=${await sealSession(env, { account_checked_at: Date.now(), ...session })}`
}

/**
 * Many tests name a browser by a short id (`Cookie: session=abc`) and say who is
 * signed in on it (`{ abc: { user_id: "user-123" } }`). This returns the request
 * with that browser's real sealed cookie in place of the short id.
 */
export async function signInRequest(
  request,
  people,
  env = { SESSION_SECRET: TEST_SESSION_SECRET },
) {
  const header = request.headers.get("Cookie") || ""
  const match = /(?:^|;\s*)session=([^;]+)/.exec(header)
  const person = match ? people?.[match[1]] : null
  if (!person) return request
  const sealed = await sessionCookieFor(person, env)
  const headers = new Headers(request.headers)
  headers.set("Cookie", header.replace(`session=${match[1]}`, sealed))
  return new Request(request, { headers })
}
