import assert from "node:assert/strict"
import test from "node:test"

import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"

test("admin styles sidebar stays focused on the blocklist request pipeline", () => {
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /pendingLocalRemovals/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /\/local-removals\/pending\?limit=100/)
  assert.match(ICONOPLASM_ADMIN_HTML, /<h2>Artist-tag queue<\/h2>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /<h2>Applied blocklist<\/h2>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Use the public blocklist form to block this artist tag across the site\. Use gene review for one-off image cleanup\./)
})

test("iconoplasm admin exposes the cost dashboard as a first-class tab", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /data-tab="costs">Costs<\/button>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="panel-costs"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Iconoplasm Cost Control/)
  assert.match(ICONOPLASM_ADMIN_HTML, /\/cost\/usage/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Cycle mix by budget class/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Cycle mix by source/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Top cycle spenders/)
  assert.match(ICONOPLASM_ADMIN_HTML, /refreshOverviewSummary\(\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /refreshOverviewCoverage\(\)/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /refreshOverview\(\)/)
})
