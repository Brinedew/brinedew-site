import assert from "node:assert/strict"

import test from "node:test"

import { pagesHeadersFile, pagesRedirectsFile } from "./write-pages-edge-files.mjs"

// B-834: brinedew.bio and geneguessr.brinedew.bio documents and assets are
// served by Pages directly. These files replace what the edge Worker did on
// every request, so a missing header or redirect is a real regression.

test("every static response carries the security headers and the default CSP", () => {
  const headers = pagesHeadersFile()
  const global = headers.slice(headers.indexOf("/*\n"), headers.indexOf("/apps/geneguessr/*"))
  for (const name of [
    "X-Content-Type-Options: nosniff",
    "X-Frame-Options: DENY",
    "Strict-Transport-Security:",
    "Cross-Origin-Opener-Policy: same-origin",
    "Content-Security-Policy: default-src 'self'",
  ]) {
    assert.ok(global.includes(name), name)
  }
  assert.doesNotMatch(global, /unsafe-eval/)
})

test("only the GeneGuessr game document gets the Mol* CSP", () => {
  const headers = pagesHeadersFile()
  const game = headers.slice(headers.indexOf("/apps/geneguessr/*"))
  assert.match(game, /! Content-Security-Policy/)
  assert.match(game, /script-src [^;]*'unsafe-eval'/)
  assert.match(game, /connect-src 'self' data: blob:/)
})

test("no redirect is issued for the GeneGuessr game document path", () => {
  // A redirect for the GeneGuessr document path would loop with the zone
  // rewrite that maps geneguessr.brinedew.bio/ onto it.
  assert.doesNotMatch(pagesRedirectsFile(), /^\/apps\/geneguessr/m)
})
