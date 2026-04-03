import assert from "node:assert/strict"
import test from "node:test"

import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"

test("admin styles sidebar stays focused on the artist-styles request pipeline", () => {
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /pendingLocalRemovals/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /\/local-removals\/pending\?limit=100/)
  assert.match(ICONOPLASM_ADMIN_HTML, /<h2>Artist-tag queue<\/h2>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /<h2>Applied blocklist<\/h2>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Use the public artist-tag form to block this style across the site\. Use gene review for one-off image cleanup\./)
})