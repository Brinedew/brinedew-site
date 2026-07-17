import assert from "node:assert/strict"
import test from "node:test"
import { Script } from "node:vm"

import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"

test("admin styles sidebar stays focused on the blocklist request pipeline", () => {
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /pendingLocalRemovals/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /\/local-removals\/pending\?limit=100/)
  assert.match(ICONOPLASM_ADMIN_HTML, /<h2>Artist-tag queue<\/h2>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /<h2>Applied blocklist<\/h2>/)
  assert.match(
    ICONOPLASM_ADMIN_HTML,
    /Use the public blocklist form to block this artist tag across the site\. Use gene review for one-off image cleanup\./,
  )
})

test("iconoplasm admin exposes the observability snapshot as a first-class tab", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /data-tab="costs">Observability<\/button>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="panel-costs"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Cloudflare snapshot, baked out of band/)
  assert.match(ICONOPLASM_ADMIN_HTML, /cost-cockpit/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /id="cost-budget-answer"/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /Budget answer right now/)
  assert.match(ICONOPLASM_ADMIN_HTML, /D1 read ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /D1 write ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Worker mutation ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Durable Object ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Workers request ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /KV read ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /KV write ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /KV delete ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /KV list ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Queue operation ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /D1 storage ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Pages Functions ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Workers observability ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /R2 Class B ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /KV storage ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /R2 storage ceiling/)
  assert.match(ICONOPLASM_ADMIN_HTML, /R2 Class A ceiling/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /<h2>Limit heatmap<\/h2>/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /<h2>Sensor coverage<\/h2>/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /<h2>Overage magnitude<\/h2>/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /<h2>Daily burn calendar<\/h2>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-d1-write-adaptive-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-worker-limiter-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-do-traffic-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-d1-query-volume-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-do-activity-mix-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-queue-backlog-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-snapshot-integrity-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-limit-ratio-heatmap"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-sensor-coverage-matrix"/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /id="cost-request-distribution-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /quotaCeilingSeries\(snapshot\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /buildQuotaCeilingTimelineSvg/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Cloudflare drilldown/)
  assert.match(ICONOPLASM_ADMIN_HTML, /var OBSERVABILITY_SNAPSHOT = /)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /\/cost\/usage/)
  assert.match(ICONOPLASM_ADMIN_HTML, /apiJson\('\/cost\/snapshot\?ts='/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Reloading baked Cloudflare snapshot…/)
  assert.match(ICONOPLASM_ADMIN_HTML, /refreshOverviewSummary\(\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /refreshOverviewCoverage\(\)/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /refreshOverview\(\)/)
})

test("iconoplasm admin exposes individual generation requests for debugging", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /data-tab="requests">Requests<\/button>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="panel-requests"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Generation requests/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="requests-search"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="requests-kind"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="requests-mode"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="requests-status"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="requests-list"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="requests-detail"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /refreshGenerationRequests/)
  assert.match(ICONOPLASM_ADMIN_HTML, /apiJson\('\/requests\/history\?limit='/)
  assert.match(ICONOPLASM_ADMIN_HTML, /requestResultMarkup/)
  assert.match(ICONOPLASM_ADMIN_HTML, /requestResultDetailMarkup/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Result image/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /open total/)
  assert.match(ICONOPLASM_ADMIN_HTML, /requestKindLabel/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Copy request JSON/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Raw request row/)
})

test("iconoplasm admin exposes image edit checkmark prompt editing as its own tab", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /data-tab="prompts">Prompts<\/button>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="panel-prompts"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Image edit prompts/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Shared suffix/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="prompt-suffix-text"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /data-prompt-suffix-save/)
  assert.match(ICONOPLASM_ADMIN_HTML, /saveImageEditPromptSuffix/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="prompt-template-editor"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /data-prompt-save/)
  assert.match(ICONOPLASM_ADMIN_HTML, /refreshImageEditPrompts/)
  assert.match(ICONOPLASM_ADMIN_HTML, /apiJson\('\/image-edit-prompts'/)
  assert.match(ICONOPLASM_ADMIN_HTML, /apiJson\('\/image-edit-prompts',\s*\{/)
})

test("iconoplasm admin trend chart explains the baked budget pace guide", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /row && row\.rows_read_daily_smart_limit/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Smart daily allowance/)
  assert.match(ICONOPLASM_ADMIN_HTML, /getWorkerLimiterSnapshot\(report\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Worker-side mutation headroom/)
  assert.match(ICONOPLASM_ADMIN_HTML, /refusing to invent one from other fields/)
  assert.match(
    ICONOPLASM_ADMIN_HTML,
    /can we still mutate, or is today(?:\\)?'s worker gate already shut\?/,
  )
  assert.match(ICONOPLASM_ADMIN_HTML, /row && row\.rowsWrittenDailyLimit/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Fast answer from the baked Cloudflare snapshot/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Account-wide DO rows_written today/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Real daily rows_written headroom/)
  assert.match(ICONOPLASM_ADMIN_HTML, /not a count of uploads bought by one sync/)
  assert.match(ICONOPLASM_ADMIN_HTML, /not a per-sync upload meter/)
  assert.match(ICONOPLASM_ADMIN_HTML, /platform headroom view, not a per-sync accounting report/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Free-plan daily walls live in the pressure map above\./)
  assert.match(ICONOPLASM_ADMIN_HTML, /Cloudflare Billing can be blank on a zero-dollar account/)
  assert.match(ICONOPLASM_ADMIN_HTML, /D1 rows read today/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Workers observability events today/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Queues billable operations today/)
  assert.match(ICONOPLASM_ADMIN_HTML, /R2 storage and operations/)
  assert.match(ICONOPLASM_ADMIN_HTML, /request path untouched/)
  assert.doesNotMatch(
    ICONOPLASM_ADMIN_HTML,
    /baked from D1 analytics and the configured smart daily write guardrails/,
  )
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /No fake invocation ceiling here/)
})

test("iconoplasm admin keeps the observability chesterton fence comment", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /Chesterton's fence:/)
  assert.match(
    ICONOPLASM_ADMIN_HTML,
    /do not generate observability load from the admin page itself/,
  )
  assert.match(ICONOPLASM_ADMIN_HTML, /just links/)
  assert.match(ICONOPLASM_ADMIN_HTML, /just a runbook/)
})

test("iconoplasm admin inline script parses", () => {
  const match = ICONOPLASM_ADMIN_HTML.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(match, "expected inline admin script in emitted HTML")
  assert.doesNotThrow(() => new Script(match[1], { filename: "iconoplasm-admin-inline.js" }))
})
