import assert from "node:assert/strict"
import test from "node:test"

import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"

test("admin styles sidebar loads local removals alongside artist-tag submissions", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /pendingLocalRemovals/)
  assert.match(ICONOPLASM_ADMIN_HTML, /\/local-removals\/pending\?limit=100/)
  assert.match(ICONOPLASM_ADMIN_HTML, /local image removal/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Recent image removals and current artist blocklist entries will show up here\./)
})