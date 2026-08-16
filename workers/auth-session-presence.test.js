import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

import {
  handleLogout,
  sharedSessionPresenceCookie,
  SHARED_SESSION_PRESENCE_COOKIE,
} from "./auth.js"
import worker from "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"

const statefulRuntimeSource = readFileSync(
  new URL(
    "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)

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

test("dynamic HTML repairs only the presence hint and never caches that personalized header", () => {
  const cacheWrite = statefulRuntimeSource.indexOf("caches.default.put(")
  const hintRepair = statefulRuntimeSource.indexOf(
    'sharedSessionPresenceCookie({ present: true, cookieDomain: ".brinedew.bio" })',
  )
  const finalResponse = statefulRuntimeSource.indexOf("return new Response(body", hintRepair)

  assert.notEqual(cacheWrite, -1)
  assert.ok(hintRepair > cacheWrite)
  assert.ok(finalResponse > hintRepair)
  assert.match(
    statefulRuntimeSource.slice(cacheWrite, hintRepair),
    /body = injectAnalyticsConsentBootstrap\(body, request\)/,
  )
  assert.doesNotMatch(
    statefulRuntimeSource.slice(cacheWrite, hintRepair),
    /sharedSessionPresenceCookie/,
  )
})
