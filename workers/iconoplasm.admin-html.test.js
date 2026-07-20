import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { Script } from "node:vm"
import { parseHTML } from "linkedom"

import { ICONOPLASM_ADMIN_HTML as ICONOPLASM_ADMIN_SHELL } from "./iconoplasm-admin-html.js"

const ICONOPLASM_ADMIN_CSS = readFileSync(
  new URL("../quartz/static/iconoplasm/admin.css", import.meta.url),
  "utf8",
)
const ICONOPLASM_ADMIN_RUNTIME = readFileSync(
  new URL("../quartz/static/iconoplasm/admin.js", import.meta.url),
  "utf8",
)
const ICONOPLASM_ADMIN_HTML = `${ICONOPLASM_ADMIN_SHELL}\n<style>${ICONOPLASM_ADMIN_CSS}</style>\n<script>${ICONOPLASM_ADMIN_RUNTIME}</script>`

const STATEFUL_RUNTIME_SOURCE = readFileSync(
  new URL(
    "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)

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
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /var OBSERVABILITY_SNAPSHOT = /)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /\/cost\/usage/)
  assert.match(ICONOPLASM_ADMIN_HTML, /apiJson\(["']\/cost\/snapshot\?ts=["']/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Snapshot freshness/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Publication path/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Retired metrics/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-snapshot-trust-chart"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="cost-snapshot-trust-details"/)
  assert.match(
    ICONOPLASM_ADMIN_HTML,
    /costSnapshotTrustDetails: document\.getElementById\(["']cost-snapshot-trust-details["']\)/,
  )
  assert.match(ICONOPLASM_ADMIN_HTML, /renderObservabilityRunbook\(snapshot\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Snapshot unavailable · publication endpoint failed/)
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
  assert.match(ICONOPLASM_ADMIN_HTML, /apiJson\(["']\/requests\/history\?limit=["']/)
  assert.match(ICONOPLASM_ADMIN_HTML, /requestResultMarkup/)
  assert.match(ICONOPLASM_ADMIN_HTML, /requestResultDetailMarkup/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Result image/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /open total/)
  assert.match(ICONOPLASM_ADMIN_HTML, /requestKindLabel/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Copy request JSON/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Raw request row/)
})

test("request history renders a bounded, keyboard-operable page", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /requestPageSize: defaultRequestPageSize\(\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="requests-page-size"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="requests-page-label">Page 1 of 1/)
  assert.match(ICONOPLASM_ADMIN_HTML, /rows\.slice\(pageStart, pageStart \+ pageSize\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /visibleRows\.map\(requestRowMarkup\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /data-request-id="[\s\S]*tabindex="0" aria-selected=/)
  assert.match(ICONOPLASM_ADMIN_HTML, /ev\.key !== ["']Enter["'] && ev\.key !== ["'] ["']/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Math\.min\(\s*500,[\s\S]*requestsLimit/)
  assert.match(ICONOPLASM_ADMIN_HTML, /loading="lazy" decoding="async"/)
})

test("iconoplasm admin never inherits the Molstar unsafe-eval exemption", () => {
  assert.match(
    STATEFUL_RUNTIME_SOURCE,
    /host !== ICONOPLASM_HOST && \(path === "\/admin" \|\| path === "\/admin-v2"\)/,
  )
  assert.match(STATEFUL_RUNTIME_SOURCE, /allowInlineScripts = !isIconoplasmAdminSurface\(url\)/)
  assert.match(
    STATEFUL_RUNTIME_SOURCE,
    /if \(allowInlineScripts\) scriptTokens\.push\("'unsafe-inline'"\)/,
  )
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
  assert.match(ICONOPLASM_ADMIN_HTML, /apiJson\(["']\/image-edit-prompts["']/)
  assert.match(ICONOPLASM_ADMIN_HTML, /apiJson\(["']\/image-edit-prompts["'],\s*\{/)
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

test("iconoplasm admin shell loads external assets and its runtime parses", () => {
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /<link rel="stylesheet" href="\/static\/iconoplasm\/admin\.css" \/>/,
  )
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /<script src="\/static\/iconoplasm\/admin\.js" defer><\/script>/,
  )
  assert.doesNotMatch(ICONOPLASM_ADMIN_SHELL, /<style>/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_SHELL, /<script>/)
  assert.doesNotThrow(
    () => new Script(ICONOPLASM_ADMIN_RUNTIME, { filename: "iconoplasm-admin.js" }),
  )
})

test("admin tabs expose a responsive keyboard tab contract", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /id="admin-tabs" aria-label="Admin sections" role="tablist"/)
  assert.match(
    ICONOPLASM_ADMIN_HTML,
    /id="admin-tab-overview" role="tab" aria-selected="true" aria-controls="panel-overview"/,
  )
  assert.match(
    ICONOPLASM_ADMIN_HTML,
    /id="panel-overview" role="tabpanel" aria-labelledby="admin-tab-overview"/,
  )
  assert.match(ICONOPLASM_ADMIN_HTML, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /\.tab-btn \{[\s\S]*min-height: 44px/)
  assert.match(
    ICONOPLASM_ADMIN_HTML,
    /\[["']ArrowLeft["'], ["']ArrowRight["'], ["']Home["'], ["']End["']\]\.includes\(ev\.key\)/,
  )
  assert.match(ICONOPLASM_ADMIN_HTML, /nextTab\.focus\(\)/)
})

test("admin tab lifecycle unmounts inactive render roots and aborts their reads", () => {
  const scriptMatch = ICONOPLASM_ADMIN_HTML.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(scriptMatch)
  const script = scriptMatch[1]
  const start = script.indexOf('var mountedAdminTab = ""')
  const end = script.indexOf("function esc(v)", start)
  assert.notEqual(start, -1)
  assert.notEqual(end, -1)

  const tabs = ["overview", "costs", "requests", "prompts", "archive", "styles", "activity"]
  const markup = [
    '<nav id="admin-tabs">',
    ...tabs.map((tab) => `<button role="tab" data-tab="${tab}">${tab}</button>`),
    "</nav>",
    ...tabs.map(
      (tab) =>
        `<div class="panel" id="panel-${tab}" hidden><div id="${tab === "overview" ? "overview-events" : tab === "styles" ? "vision-stats-list" : tab === "activity" ? "activity-list" : `root-${tab}`}"><img alt="retained" /></div></div>`,
    ),
  ].join("")
  const { document } = parseHTML(markup)
  const adminWindow = { location: { hash: "" } }
  const calls = []
  const state = {
    activeTab: "",
    overviewSummary: {},
    overviewCoverage: {},
    costReport: null,
    requestsLoaded: false,
    promptsLoaded: false,
    archiveLoaded: false,
    visionStats: [],
    selectedGeneDetail: null,
    visionPreviewRequestId: 0,
    visionDetailRequestId: 0,
  }
  const sandbox = {
    AbortController,
    document,
    window: adminWindow,
    history: { replaceState: (_state, _title, hash) => (adminWindow.location.hash = hash) },
    state,
    els: {
      tabs: document.querySelector("#admin-tabs"),
      panels: Object.fromEntries(tabs.map((tab) => [tab, document.querySelector(`#panel-${tab}`)])),
    },
    renderOverview: () => calls.push("render-overview"),
    refreshDerivedAdminViews: () => calls.push("refresh-overview"),
    renderCostUsage: () => calls.push("render-costs"),
    refreshCostUsage: () => calls.push("refresh-costs"),
    renderGenerationRequests: () => calls.push("render-requests"),
    refreshGenerationRequests: () => calls.push("refresh-requests"),
    renderImageEditPrompts: () => calls.push("render-prompts"),
    refreshImageEditPrompts: () => calls.push("refresh-prompts"),
    renderTable: () => calls.push("render-archive"),
    renderGeneDetail: () => calls.push("render-gene"),
    refreshAssets: () => calls.push("refresh-archive"),
    renderVisionStats: () => calls.push("render-styles"),
    refreshVisionStats: () => calls.push("refresh-styles"),
    renderVisionCleanupPanel: () => calls.push("render-vision-detail"),
    renderVisionQuickActions: () => calls.push("render-vision-actions"),
    renderActivityFeed: () => calls.push("render-activity"),
    refreshOverviewSummary: () => calls.push("refresh-activity"),
  }
  new Script(script.slice(start, end), { filename: "iconoplasm-admin-tabs.js" }).runInNewContext(
    sandbox,
  )

  sandbox.setActiveTab("overview")
  const overviewController = sandbox.activeTabReadController
  assert.equal(document.querySelector("#panel-overview").hidden, false)
  assert.equal(
    document.querySelector('[data-tab="overview"]').getAttribute("aria-selected"),
    "true",
  )

  sandbox.setActiveTab("styles")
  assert.equal(overviewController.signal.aborted, true)
  assert.equal(document.querySelector("#panel-overview").hidden, true)
  assert.equal(document.querySelector("#overview-events").children.length, 0)
  assert.equal(document.querySelector("#panel-styles").hidden, false)
  assert.equal(document.querySelector('[data-tab="styles"]').getAttribute("tabindex"), "0")
  assert.ok(calls.includes("refresh-styles"))

  document.querySelector("#vision-stats-list").innerHTML = '<img alt="vision" />'
  sandbox.setActiveTab("activity")
  assert.equal(document.querySelector("#vision-stats-list").children.length, 0)
  assert.equal(state.visionPreviewRequestId, 1)
  assert.equal(state.visionDetailRequestId, 1)
})

test("visions load a bounded summary page and reserve detail hydration for selection", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /visionPageSize: defaultVisionPageSize\(\)/)
  assert.match(ICONOPLASM_ADMIN_HTML, /<option value="8">8<\/option>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /<option value="12" selected>12<\/option>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /vision-previews\?vision_ids=[\s\S]*&limit=3/)
  assert.match(ICONOPLASM_ADMIN_HTML, /esc\(label \+ ["'] preview["']\)[\s\S]{0,80}loading="lazy"/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /warmVisionNeighborhood|warmVisionDetail/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /preloadVisionAssets/)
  assert.match(
    ICONOPLASM_ADMIN_HTML,
    /var boundedLimit = defaultVisionPageSize\(\) === 8 \? 12 : 24/,
  )
})
