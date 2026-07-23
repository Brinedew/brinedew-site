import assert from "node:assert/strict"
import test from "node:test"

import {
  handleLogout,
  sharedSessionPresenceCookie,
  SHARED_SESSION_PRESENCE_COOKIE,
} from "./auth.js"

test("the readable session marker carries presence only, never identity or authority", () => {
  const cookie = sharedSessionPresenceCookie({
    present: true,
    cookieDomain: ".brinedew.bio",
  })

  assert.match(cookie, new RegExp(`^${SHARED_SESSION_PRESENCE_COOKIE}=1;`))
  assert.match(cookie, /Path=\//)
  assert.match(cookie, /Secure/)
  assert.match(cookie, /SameSite=Lax/)
  assert.match(cookie, /Domain=\.brinedew\.bio/)
  assert.doesNotMatch(cookie, /HttpOnly/)
  assert.doesNotMatch(cookie, /user|discord|admin|tier/i)
})

test("logout clears both the credential and the anonymous-startup presence hint", async () => {
  const response = await handleLogout(
    new Request("https://iconoplasm.brinedew.bio/api/auth/logout", {
      method: "POST",
    }),
    {},
  )
  const cookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") || ""]
  const combined = cookies.join("\n")

  assert.equal(response.status, 204)
  assert.match(combined, /session=;[^ \n]*|session=;/)
  assert.match(combined, new RegExp(`${SHARED_SESSION_PRESENCE_COOKIE}=;`))
  assert.match(combined, /Max-Age=0/)
})
