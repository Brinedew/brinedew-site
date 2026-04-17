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

test("iconoplasm admin exposes the observability snapshot as a first-class tab", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /data-tab="costs">Observability<\/button>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="panel-costs"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Cloudflare snapshot, baked out of band/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Budget answer right now/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-budget-answer"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /cost-section-grid/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Capacity against real ceilings/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Exact D1 denominators/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Durable Objects traffic/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-cycle-source-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /real 100,000 rows_written\/day ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Snapshot integrity/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-daily-route-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Cloudflare drilldown/)
  assert.match(ICONOPLASM_ADMIN_HTML, /var OBSERVABILITY_SNAPSHOT = /)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /\/cost\/usage/)
  assert.match(ICONOPLASM_ADMIN_HTML, /refreshOverviewSummary\(\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /refreshOverviewCoverage\(\)/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /refreshOverview\(\)/)
})

test("iconoplasm admin trend chart explains the baked budget pace guide", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /row && row\.rows_read_daily_smart_limit/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Smart daily allowance/)
  assert.match(ICONOPLASM_ADMIN_HTML, /row && row\.rowsWrittenDailyLimit/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Fast answer from the baked Cloudflare snapshot/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Account-wide DO rows_written today/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Real daily rows_written headroom/)
  assert.match(ICONOPLASM_ADMIN_HTML, /not a count of uploads bought by one sync/)
  assert.match(ICONOPLASM_ADMIN_HTML, /not a per-sync upload meter/)
  assert.match(ICONOPLASM_ADMIN_HTML, /platform headroom view, not a per-sync accounting report/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Billing page is still the final bill\./)
  assert.match(ICONOPLASM_ADMIN_HTML, /request path untouched/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /No fake invocation ceiling here/)
})

test("iconoplasm admin keeps the observability chesterton fence comment", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /Chesterton's fence:/)
  assert.match(ICONOPLASM_ADMIN_HTML, /do not generate observability load from the admin page itself/)
  assert.match(ICONOPLASM_ADMIN_HTML, /just links/)
  assert.match(ICONOPLASM_ADMIN_HTML, /just a runbook/)
})
