import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { Script } from "node:vm"
import { parseHTML } from "linkedom"

import { ICONOPLASM_ADMIN_HTML as ICONOPLASM_ADMIN_SHELL } from "./iconoplasm-admin-html.js"
import { ICONOPLASM_DEFAULT_PUBLICATION_ALIASES } from "./iconoplasm-publication-aliases.js"

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
  assert.match(ICONOPLASM_ADMIN_HTML, /d1Storage\.databaseLimitBytes/)
  assert.doesNotMatch(
    ICONOPLASM_ADMIN_HTML,
    /d1Storage\.databaseSizeBytes,\s*5 \* 1024 \* 1024 \* 1024/,
  )
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

test("factory selector activates accepted immutable recipes without exposing internal IDs", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /data-tab="factory">Factory<\/button>/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="panel-factory"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="factory-pipeline"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="factory-vision"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Activate for future jobs/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Queued jobs are unchanged/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_HTML, /candidate UUID|job UUID|#ID|@A/)
})

test("factory admin runs and displays a diagnostic matrix without leaving the panel", () => {
  assert.match(ICONOPLASM_ADMIN_HTML, /Diagnostic Matrix/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="diagnostic-gene"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="diagnostic-pipeline-options"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="diagnostic-emulsion-input"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="diagnostic-run"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /id="diagnostic-matrix"/)
  assert.match(ICONOPLASM_ADMIN_HTML, /Download PNG/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /\/diagnostic-matrices/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /run_id:\s*runId/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /recoverDiagnosticRun\(runId\)/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /latest:\s*true/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /\[30593, 255, 343, 21329, 24210\]/)
  assert.match(ICONOPLASM_ADMIN_CSS, /\.diagnostic-cell\s*\{[^}]*display:\s*table-cell/s)
  assert.doesNotMatch(ICONOPLASM_ADMIN_CSS, /\.diagnostic-cell\s*\{[^}]*display:\s*grid/s)
  assert.match(ICONOPLASM_ADMIN_CSS, /\.diagnostic-table tbody th\s*\{[^}]*left:\s*0/s)
  assert.match(ICONOPLASM_ADMIN_CSS, /object-fit:\s*contain/)
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
  assert.match(STATEFUL_RUNTIME_SOURCE, /allowInlineStyles = !isIconoplasmAdminSurface\(url\)/)
  assert.match(
    STATEFUL_RUNTIME_SOURCE,
    /if \(allowInlineScripts\) scriptTokens\.push\("'unsafe-inline'"\)/,
  )
  assert.match(
    STATEFUL_RUNTIME_SOURCE,
    /allowInlineStyles \? "style-src 'self' 'unsafe-inline'" : "style-src 'self'"/,
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

test("iconoplasm admin keeps the shared blocklist inside the Recognition workspace", () => {
  assert.match(ICONOPLASM_ADMIN_SHELL, /data-tab="extension">Recognition<\/button>/)
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /id="panel-extension" role="tabpanel" aria-labelledby="admin-tab-extension"/,
  )
  assert.match(ICONOPLASM_ADMIN_SHELL, /id="recognition-tab-aliases"[\s\S]*aria-selected="true"/)
  assert.match(ICONOPLASM_ADMIN_SHELL, /id="recognition-tab-blocklist"[\s\S]*aria-selected="false"/)
  assert.match(ICONOPLASM_ADMIN_SHELL, /Shared text blocklist/)
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /76 packaged terms are only the first-run and offline fallback\. A loaded policy replaces the complete shared list/,
  )
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /Use an existing non-canonical catalog alias, or protect a larger phrase that contains a recognized gene label \(for example, APC\/C\)/,
  )
  assert.match(ICONOPLASM_ADMIN_SHELL, /id="extension-blocklist-input"[\s\S]*disabled/)
  assert.match(ICONOPLASM_ADMIN_SHELL, /id="extension-blocklist-terms"[\s\S]*aria-live="polite"/)
  assert.match(ICONOPLASM_ADMIN_SHELL, /id="extension-blocklist-publish" disabled/)

  assert.match(ICONOPLASM_ADMIN_RUNTIME, /EXTENSION_BLOCKLIST_MAX_TERMS = 500/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /EXTENSION_BLOCKLIST_MAX_TERM_LENGTH = 64/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /replace\(\/\[\\u2010-\\u2015\\u2212\]\/g, "-"\)/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /EXTENSION_BLOCKLIST_CONTROL_CHAR_PATTERN\.test\(term\)/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /split\(\/\[\\s,\]\+\/\)/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /terms\.sort\(\)/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_RUNTIME, /extensionBlocklistInput\.maxLength/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /apiJson\("\/extension-blocklist", \{ method: "GET" \}\)/)
  assert.match(
    ICONOPLASM_ADMIN_RUNTIME,
    /body: JSON\.stringify\(\{ terms: draftTerms, expected_revision: expectedRevision \}\)/,
  )
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /Number\(err\?\.status \|\| 0\) === 409/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /preserveDraft: true/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /extensionBlocklistNeedsPublicationRetry\(\)/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /"Retry publication"/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /Number\(err\?\.status \|\| 0\) === 503/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /extensionBlocklistErrorCarriesSavedPolicy\(err\)/)
  assert.match(
    ICONOPLASM_ADMIN_RUNTIME,
    /EXTENSION_BLOCKLIST_PUBLICATION_RETRY_DELAYS_MS = \[2000, 5000, 10000, 20000, 30000\]/,
  )
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /extension_blocklist_projection_not_visible/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /extension_blocklist_alias_dependency_not_published/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /Automatic publication retries ended/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /applyExtensionBlocklistPayload\(err\.response\)/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /state\.extensionBlocklistDraft = preservedDraft/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /schema_version:/)
  assert.match(
    ICONOPLASM_ADMIN_RUNTIME,
    /Published; extensions pick it up on a later page load or browser restart; the manifest cache may last up to five minutes\./,
  )
  assert.doesNotMatch(
    ICONOPLASM_ADMIN_RUNTIME,
    /next manifest refresh|normally within five minutes/,
  )
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /A newer revision was saved elsewhere/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_RUNTIME, /A newer revision was published elsewhere/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_RUNTIME, /published and live|now live|make it live/i)
  assert.match(
    ICONOPLASM_ADMIN_RUNTIME,
    /Discard this unpublished draft and reload the shared policy/,
  )
  assert.match(
    ICONOPLASM_ADMIN_RUNTIME,
    /extensionBlocklistPublish\.addEventListener\("click", publishExtensionBlocklist\)/,
  )
  assert.match(ICONOPLASM_ADMIN_CSS, /\.extension-blocklist-remove \{[\s\S]*min-width: 44px/)
  assert.match(ICONOPLASM_ADMIN_CSS, /@media \(max-width: 600px\)[\s\S]*extension-blocklist-ledger/)
})

test("Recognition defaults to an accessible alias-mapping draft workspace", () => {
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /class="recognition-panel active" id="recognition-panel-aliases"/,
  )
  assert.match(ICONOPLASM_ADMIN_SHELL, /id="publication-alias-form"/)
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /id="publication-alias-gene-query"[\s\S]*role="combobox"[\s\S]*aria-autocomplete="list"[\s\S]*aria-controls="publication-alias-gene-results"/,
  )
  assert.match(ICONOPLASM_ADMIN_SHELL, /id="publication-alias-gene-results" role="listbox"/)
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /id="publication-alias-target-preview" role="status" aria-live="polite" hidden/,
  )
  assert.match(ICONOPLASM_ADMIN_SHELL, /id="publication-alias-conflict" role="alert" hidden/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /PUBLICATION_ALIAS_SEARCH_MIN_LENGTH = 2/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /PUBLICATION_ALIAS_SEARCH_DEBOUNCE_MS = 200/)
  assert.match(
    ICONOPLASM_ADMIN_RUNTIME,
    /\/api\/public\/v1\/genes\/search\?scope=catalog&limit=8&q=/,
  )
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /state\.publicationAliasSearchRequestId/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /state\.publicationAliasSearchController\.abort\(\)/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /ev\.key === "ArrowDown"/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /ev\.key === "ArrowUp"/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /ev\.key === "Enter"/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /ev\.key === "Escape"/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /Choose a canonical gene from the search results\./)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /publicationAliasTargetPreview\.innerHTML/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /apiJson\("\/publication-aliases", \{ method: "GET" \}\)/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /validate_only: true/)
  assert.match(
    ICONOPLASM_ADMIN_RUNTIME,
    /await apiJson\("\/publication-aliases", \{[\s\S]*validate_only: true[\s\S]*state\.publicationAliasDraftBySymbol = next/,
  )
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /Not added — unsafe alias/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /same exact label two owners/)
  assert.match(
    ICONOPLASM_ADMIN_RUNTIME,
    /Nothing from this rejected mapping was saved or published/,
  )
  assert.match(
    ICONOPLASM_ADMIN_CSS,
    /\.publication-alias-conflict \{[\s\S]*border: 1px solid color-mix\(in srgb, var\(--danger\)/,
  )
  assert.match(
    ICONOPLASM_ADMIN_RUNTIME,
    /body: JSON\.stringify\(\{[\s\S]*expected_revision: expectedRevision,[\s\S]*by_symbol: draftBySymbol,[\s\S]*remove_by_symbol: removeBySymbol/,
  )
  assert.match(
    ICONOPLASM_ADMIN_RUNTIME,
    /PUBLICATION_ALIAS_PUBLICATION_RETRY_DELAYS_MS = \[2000, 5000, 10000, 20000, 30000\]/,
  )
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /publication_alias_blocklist_dependency_not_published/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /recognition_pair_not_visible/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /recognition_pair_dependencies_not_published/)
  assert.match(ICONOPLASM_ADMIN_RUNTIME, /window\.addEventListener\("beforeunload"/)
  assert.match(
    ICONOPLASM_ADMIN_CSS,
    /@media \(max-width: 600px\)[\s\S]*\.publication-alias-fields,[\s\S]*grid-template-columns: 1fr/,
  )
  assert.match(
    ICONOPLASM_ADMIN_CSS,
    /\.publication-alias-mapping-actions button \{[\s\S]*min-height: 44px/,
  )
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /class="recognition-editor"[\s\S]*class="recognition-command-rail"[\s\S]*id="publication-alias-form"[\s\S]*id="publication-alias-publish"[\s\S]*class="recognition-draft-pane" aria-labelledby="publication-alias-draft-heading"[\s\S]*id="publication-alias-mappings"/,
  )
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /class="recognition-editor"[\s\S]*class="recognition-command-rail"[\s\S]*id="extension-blocklist-input"[\s\S]*id="extension-blocklist-publish"[\s\S]*class="recognition-draft-pane" aria-labelledby="extension-blocklist-draft-heading"[\s\S]*id="extension-blocklist-terms"/,
  )
  assert.match(
    ICONOPLASM_ADMIN_CSS,
    /\.recognition-editor \{[\s\S]*grid-template-columns: minmax\(320px, 0\.82fr\) minmax\(440px, 1\.18fr\)/,
  )
  assert.match(
    ICONOPLASM_ADMIN_CSS,
    /\.recognition-draft-pane \{[\s\S]*max-height: clamp\(460px, 62vh, 700px\)[\s\S]*overflow: hidden/,
  )
  assert.match(
    ICONOPLASM_ADMIN_CSS,
    /\.publication-alias-mappings \{[\s\S]*overflow-y: auto[\s\S]*overscroll-behavior: contain/,
  )
  assert.match(
    ICONOPLASM_ADMIN_CSS,
    /\.recognition-command-rail \.publication-alias-fields \{[\s\S]*grid-template-columns: minmax\(0, 1fr\)/,
  )
  assert.match(
    ICONOPLASM_ADMIN_CSS,
    /\.publication-alias-list-head \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto[\s\S]*align-items: start/,
  )
  assert.match(
    ICONOPLASM_ADMIN_CSS,
    /\.publication-alias-filter \{[\s\S]*grid-row: 2[\s\S]*grid-column: 1 \/ -1/,
  )
  assert.match(
    ICONOPLASM_ADMIN_CSS,
    /@media \(max-width: 900px\)[\s\S]*\.recognition-editor \{[\s\S]*grid-template-columns: 1fr[\s\S]*\.publication-alias-mappings,[\s\S]*\.extension-blocklist-terms \{[\s\S]*max-height: min\(52vh, 520px\)/,
  )
})

test("the 45-addition alias policy publishes without collapsing or reordering case variants", async () => {
  assert.equal(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.alias_count, 45)
  assert.equal(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.removal_count, 1)

  const constantsStart = ICONOPLASM_ADMIN_RUNTIME.indexOf("var PUBLICATION_ALIAS_MAX_OPERATIONS")
  const constantsEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function defaultVisionPageSize",
    constantsStart,
  )
  const helpersStart = ICONOPLASM_ADMIN_RUNTIME.indexOf("function normalizePublicationAlias")
  const helpersEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function normalizeExtensionBlocklistTerm",
    helpersStart,
  )
  assert.notEqual(constantsStart, -1)
  assert.notEqual(constantsEnd, -1)
  assert.notEqual(helpersStart, -1)
  assert.notEqual(helpersEnd, -1)

  const seededBySymbol = JSON.parse(
    JSON.stringify(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.by_symbol),
  )
  const seededRemovals = JSON.parse(
    JSON.stringify(ICONOPLASM_DEFAULT_PUBLICATION_ALIASES.remove_by_symbol),
  )
  const seededCdh1Aliases = seededBySymbol.CDH1.slice()
  let publishedRequest = null
  const sandbox = {
    state: {
      activeTab: "extension",
      recognitionSection: "aliases",
      publicationAliasPolicy: null,
      publicationAliasPublication: null,
      publicationAliasLimits: { max_aliases: 500, max_alias_length: 64 },
      publicationAliasDraftBySymbol: {},
      publicationAliasLoaded: false,
      publicationAliasBusy: false,
      publicationAliasEditing: null,
      publicationAliasSelectedGene: null,
      publicationAliasSearchResults: [],
      publicationAliasSearchActiveIndex: -1,
      publicationAliasSearchError: "",
      publicationAliasSearchTimer: null,
      publicationAliasSearchController: null,
      publicationAliasSearchRequestId: 0,
      publicationAliasPublicationRetry: null,
      publicationAliasPublicationRetryTimer: null,
      publicationAliasPublicationRetryRunId: 0,
    },
    els: {},
    window: {
      clearTimeout() {},
      setTimeout() {
        return 1
      },
    },
    formatTimestampShort(value) {
      return String(value || "")
    },
    esc(value) {
      return String(value || "")
    },
    isRequestCanceled() {
      return false
    },
    requestErrorMessage(error, fallback) {
      return String(error?.message || fallback)
    },
    setLog() {},
    async apiJson(path, options) {
      assert.equal(path, "/publication-aliases")
      assert.equal(options.method, "POST")
      publishedRequest = JSON.parse(options.body)
      const aliasCount = Object.values(publishedRequest.by_symbol).reduce(
        (count, aliases) => count + aliases.length,
        0,
      )
      return {
        policy: {
          schema_version: 1,
          revision: 2,
          version: "v1-published",
          alias_count: aliasCount,
          removal_count: 1,
          by_symbol: publishedRequest.by_symbol,
          remove_by_symbol: publishedRequest.remove_by_symbol,
          updated_at: "2026-08-11T00:00:00.000Z",
          updated_by: "test@example.com",
        },
        publication: {
          version: "v1-published",
          revision: 2,
          in_sync: true,
          published_at: "2026-08-11T00:00:00.000Z",
          last_error: "",
        },
        limits: { max_operations: 500, max_alias_length: 64 },
      }
    },
  }
  new Script(
    `${ICONOPLASM_ADMIN_RUNTIME.slice(constantsStart, constantsEnd)}\n${ICONOPLASM_ADMIN_RUNTIME.slice(helpersStart, helpersEnd)}\nthis.contract = { applyPublicationAliasPayload, clonePublicationAliasMap, publicationAliasErrorCanAutoRetry, publicationAliasMapRestoringBaseline, publicationAliasMapWith, publicationAliasMapWithout, publicationAliasMapRows, publicationAliasSearchIndexAfter, publishPublicationAliases }`,
    { filename: "iconoplasm-admin-publication-aliases.js" },
  ).runInNewContext(sandbox)

  assert.equal(
    sandbox.contract.publicationAliasErrorCanAutoRetry({
      response: { code: "publication_alias_blocklist_dependency_not_published" },
    }),
    true,
  )
  assert.equal(
    sandbox.contract.publicationAliasErrorCanAutoRetry({
      response: { code: "recognition_pair_not_visible" },
    }),
    true,
  )
  assert.equal(
    sandbox.contract.publicationAliasErrorCanAutoRetry({
      response: { code: "recognition_pair_dependencies_not_published" },
    }),
    true,
  )
  assert.equal(sandbox.contract.publicationAliasSearchIndexAfter(-1, "next", 3), 0)
  assert.equal(sandbox.contract.publicationAliasSearchIndexAfter(0, "next", 3), 1)
  assert.equal(sandbox.contract.publicationAliasSearchIndexAfter(1, "previous", 3), 0)

  sandbox.contract.applyPublicationAliasPayload({
    policy: {
      schema_version: 1,
      revision: 1,
      version: "v1-seeded",
      alias_count: 45,
      removal_count: 1,
      by_symbol: seededBySymbol,
      remove_by_symbol: seededRemovals,
      updated_at: "2026-08-10T00:00:00.000Z",
      updated_by: "seed@example.com",
    },
    publication: {
      version: "v1-seeded",
      revision: 1,
      in_sync: true,
      published_at: "2026-08-10T00:00:00.000Z",
      last_error: "",
    },
    limits: { max_operations: 500, max_alias_length: 64 },
  })
  sandbox.state.publicationAliasDraftBySymbol = sandbox.contract.clonePublicationAliasMap(
    sandbox.state.publicationAliasPolicy.by_symbol,
  )
  assert.deepEqual(Array.from(sandbox.state.publicationAliasDraftBySymbol.CDH1), seededCdh1Aliases)

  const oneVariantRemoved = sandbox.contract.publicationAliasMapWithout(
    sandbox.state.publicationAliasDraftBySymbol,
    "E-cadherin",
  )
  assert.equal(oneVariantRemoved.CDH1.includes("E-cadherin"), false)
  assert.equal(oneVariantRemoved.CDH1.includes("E-Cadherin"), true)
  assert.equal(oneVariantRemoved.CDH1.includes("E cadherin"), true)
  const oneVariantMoved = sandbox.contract.publicationAliasMapWith(
    sandbox.state.publicationAliasDraftBySymbol,
    "E-cadherin",
    "TEST",
  )
  assert.equal(oneVariantMoved.CDH1.includes("E-cadherin"), false)
  assert.equal(oneVariantMoved.CDH1.includes("E-Cadherin"), true)
  assert.deepEqual(Array.from(oneVariantMoved.TEST), ["E-cadherin"])
  const variantRestored = sandbox.contract.publicationAliasMapRestoringBaseline(
    oneVariantRemoved,
    "E-cadherin",
    sandbox.state.publicationAliasPolicy.by_symbol,
  )
  assert.deepEqual(Array.from(variantRestored.CDH1), seededCdh1Aliases)

  sandbox.state.publicationAliasDraftBySymbol = sandbox.contract.publicationAliasMapWith(
    sandbox.state.publicationAliasDraftBySymbol,
    "IL8",
    "CXCL8",
  )
  await sandbox.contract.publishPublicationAliases()

  assert.ok(publishedRequest)
  assert.deepEqual(Array.from(publishedRequest.by_symbol.CDH1), seededCdh1Aliases)
  assert.deepEqual(JSON.parse(JSON.stringify(publishedRequest.remove_by_symbol)), seededRemovals)
  assert.deepEqual(Array.from(publishedRequest.by_symbol.CXCL8), ["IL8"])
})

test("publication aliases adopt a saved rev2 baseline and retry it without changing dictionaries", async () => {
  const helpersStart = ICONOPLASM_ADMIN_RUNTIME.indexOf("function normalizePublicationAlias")
  const statusStart = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function setPublicationAliasStatus",
    helpersStart,
  )
  const payloadStart = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function applyPublicationAliasPayload",
    statusStart,
  )
  const payloadEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function publicationAliasMappingMarkup",
    payloadStart,
  )
  const retryStart = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function publicationAliasErrorCarriesSavedPolicy",
    payloadEnd,
  )
  const retryEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function normalizeExtensionBlocklistTerm",
    retryStart,
  )
  assert.notEqual(helpersStart, -1)
  assert.notEqual(statusStart, -1)
  assert.notEqual(payloadStart, -1)
  assert.notEqual(payloadEnd, -1)
  assert.notEqual(retryStart, -1)
  assert.notEqual(retryEnd, -1)

  const source = `${ICONOPLASM_ADMIN_RUNTIME.slice(helpersStart, statusStart)}\n${ICONOPLASM_ADMIN_RUNTIME.slice(payloadStart, payloadEnd)}\n${ICONOPLASM_ADMIN_RUNTIME.slice(retryStart, retryEnd)}\nthis.contract = { publishPublicationAliases }`
  const desiredBySymbol = {
    CDH1: ["E-cadherin", "E-Cadherin"],
    CXCL8: ["IL8"],
  }
  const removals = { CDH17: ["cadherin"] }

  function fakeTimers() {
    let nextId = 1
    const pending = new Map()
    return {
      window: {
        setTimeout(callback, delayMs) {
          const id = nextId
          nextId += 1
          pending.set(id, { callback, delayMs })
          return id
        },
        clearTimeout(id) {
          pending.delete(id)
        },
      },
      count() {
        return pending.size
      },
      async runNext() {
        const next = Array.from(pending.entries()).sort(
          (left, right) => left[1].delayMs - right[1].delayMs || left[0] - right[0],
        )[0]
        assert.ok(next, "expected an automatic alias publication retry timer")
        pending.delete(next[0])
        next[1].callback()
        await new Promise((resolve) => setImmediate(resolve))
      },
    }
  }

  function savedProjectionNotVisible() {
    const error = new Error("projection not visible")
    error.status = 503
    error.response = {
      saved: true,
      code: "publication_alias_projection_not_visible",
      error: "Saved projection is not visible yet",
      policy: {
        schema_version: 1,
        revision: 2,
        version: "pa1-rev2",
        by_symbol: desiredBySymbol,
        remove_by_symbol: removals,
      },
      publication: { version: "", revision: 2, in_sync: false },
    }
    return error
  }

  function harness() {
    const timers = fakeTimers()
    const requests = []
    const statuses = []
    const state = {
      activeTab: "extension",
      recognitionSection: "aliases",
      publicationAliasLoaded: true,
      publicationAliasPolicy: {
        schema_version: 1,
        revision: 1,
        version: "pa1-rev1",
        by_symbol: { CDH1: desiredBySymbol.CDH1 },
        remove_by_symbol: removals,
      },
      publicationAliasPublication: { version: "pa1-rev1", revision: 1, in_sync: true },
      publicationAliasLimits: { max_aliases: 500, max_alias_length: 64 },
      publicationAliasDraftBySymbol: desiredBySymbol,
      publicationAliasBusy: false,
      publicationAliasPublicationRetry: null,
      publicationAliasPublicationRetryTimer: null,
      publicationAliasPublicationRetryRunId: 0,
    }
    const sandbox = {
      state,
      window: timers.window,
      PUBLICATION_ALIAS_MAX_OPERATIONS: 500,
      PUBLICATION_ALIAS_MAX_LENGTH: 64,
      PUBLICATION_ALIAS_PUBLICATION_RETRY_DELAYS_MS: [1, 2, 3],
      setPublicationAliasStatus: (message, tone) => statuses.push({ message, tone }),
      renderPublicationAliases: () => {},
      cancelPublicationAliasSearch: () => {},
      resetPublicationAliasComposer: () => {},
      refreshPublicationAliases: async () => {},
      setLog: () => {},
      requestErrorMessage: (error, fallback) =>
        String(error?.response?.error || error?.message || fallback),
      publicationAliasConflictOperations: () => [],
      isRequestCanceled: () => false,
      apiJson: async (path, options) => {
        requests.push({ path, body: JSON.parse(options.body) })
        if (requests.length === 1) throw savedProjectionNotVisible()
        return {
          policy: {
            schema_version: 1,
            revision: 2,
            version: "pa1-rev2",
            by_symbol: desiredBySymbol,
            remove_by_symbol: removals,
          },
          publication: { version: "pa1-rev2", revision: 2, in_sync: true },
        }
      },
    }
    new Script(source, {
      filename: "iconoplasm-admin-publication-alias-automatic-retry.js",
    }).runInNewContext(sandbox)
    return { requests, sandbox, state, statuses, timers }
  }

  const eventuallyVisible = harness()
  await eventuallyVisible.sandbox.contract.publishPublicationAliases()
  assert.equal(eventuallyVisible.requests.length, 1)
  assert.equal(eventuallyVisible.requests[0].body.expected_revision, 1)
  assert.equal(eventuallyVisible.state.publicationAliasPolicy.revision, 2)
  assert.equal(eventuallyVisible.state.publicationAliasPolicy.version, "pa1-rev2")
  assert.equal(eventuallyVisible.timers.count(), 1)
  await eventuallyVisible.timers.runNext()
  assert.equal(eventuallyVisible.requests.length, 2, "saved publication should converge unaided")
  assert.deepEqual(eventuallyVisible.requests[1].body, {
    expected_revision: 2,
    by_symbol: desiredBySymbol,
    remove_by_symbol: removals,
  })
  assert.equal(eventuallyVisible.state.publicationAliasPublication.in_sync, true)
  assert.equal(eventuallyVisible.state.publicationAliasPublicationRetry, null)
  assert.equal(eventuallyVisible.timers.count(), 0, "success must leave no retry timer behind")
  assert.match(eventuallyVisible.statuses.at(-1).message, /^Published;/)

  const editedDraft = harness()
  await editedDraft.sandbox.contract.publishPublicationAliases()
  editedDraft.state.publicationAliasDraftBySymbol = {
    ...desiredBySymbol,
    CXCL8: ["IL8", "IL-8"],
  }
  await editedDraft.timers.runNext()
  assert.equal(editedDraft.requests.length, 1, "a changed draft must cancel the scheduled POST")
  assert.equal(editedDraft.state.publicationAliasPublicationRetry, null)
  assert.equal(editedDraft.timers.count(), 0)

  const switchedTab = harness()
  await switchedTab.sandbox.contract.publishPublicationAliases()
  switchedTab.state.activeTab = "styles"
  await switchedTab.timers.runNext()
  assert.equal(switchedTab.requests.length, 1, "leaving the tab must cancel the scheduled POST")
  assert.equal(switchedTab.state.publicationAliasPublicationRetry, null)
  assert.equal(switchedTab.timers.count(), 0)
})

test("extension blocklist draft normalization matches the worker contract", () => {
  const constantsStart = ICONOPLASM_ADMIN_RUNTIME.indexOf("var EXTENSION_BLOCKLIST_MAX_TERMS")
  const constantsEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function defaultVisionPageSize",
    constantsStart,
  )
  const helpersStart = ICONOPLASM_ADMIN_RUNTIME.indexOf("function normalizeExtensionBlocklistTerm")
  const helpersEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function applyExtensionBlocklistPayload",
    helpersStart,
  )
  assert.notEqual(constantsStart, -1)
  assert.notEqual(constantsEnd, -1)
  assert.notEqual(helpersStart, -1)
  assert.notEqual(helpersEnd, -1)

  const sandbox = {}
  new Script(
    `${ICONOPLASM_ADMIN_RUNTIME.slice(constantsStart, constantsEnd)}\n${ICONOPLASM_ADMIN_RUNTIME.slice(helpersStart, helpersEnd)}\nthis.contract = { normalizeExtensionBlocklistTerm, parseExtensionBlocklistPaste, extensionBlocklistTermValidationMessage, maxTerms: EXTENSION_BLOCKLIST_MAX_TERMS, maxTermLength: EXTENSION_BLOCKLIST_MAX_TERM_LENGTH }`,
    { filename: "iconoplasm-admin-extension-blocklist.js" },
  ).runInNewContext(sandbox)

  assert.equal(sandbox.contract.maxTerms, 500)
  assert.equal(sandbox.contract.maxTermLength, 64)
  assert.equal(sandbox.contract.normalizeExtensionBlocklistTerm("  a\u2013b  "), "A-B")
  assert.deepEqual(
    Array.from(sandbox.contract.parseExtensionBlocklistPaste("task, amid\nTASK\tbank")),
    ["AMID", "BANK", "TASK"],
  )
  assert.match(
    sandbox.contract.extensionBlocklistTermValidationMessage("A\u0000B", 64),
    /control character/,
  )
  assert.equal(
    sandbox.contract.extensionBlocklistTermValidationMessage("A\u0085B", 64),
    "",
    "the browser shape check must match the worker's C0/U+007F control-character contract",
  )
  assert.match(
    sandbox.contract.extensionBlocklistTermValidationMessage("A".repeat(65), 64),
    /64 character limit/,
  )
})

test("pending extension publication can be retried without manufacturing a draft edit", async () => {
  const decisionStart = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function extensionBlocklistErrorCarriesSavedPolicy",
  )
  const publishStart = ICONOPLASM_ADMIN_RUNTIME.indexOf("async function publishExtensionBlocklist")
  const publishEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf("function attentionMarkup", publishStart)
  assert.notEqual(decisionStart, -1)
  assert.notEqual(publishStart, -1)
  assert.notEqual(publishEnd, -1)

  const requests = []
  const statuses = []
  const state = {
    extensionBlocklistLoaded: true,
    extensionBlocklistPolicy: { revision: 7, terms: ["AMID"] },
    extensionBlocklistPublication: { version: "ebl1-old", in_sync: false },
    extensionBlocklistLimits: { max_term_length: 64 },
    extensionBlocklistDraft: ["AMID"],
    extensionBlocklistBusy: false,
  }
  const sandbox = {
    state,
    EXTENSION_BLOCKLIST_MAX_TERM_LENGTH: 64,
    extensionBlocklistIsDirty: () => false,
    extensionBlocklistNeedsPublicationRetry: () =>
      state.extensionBlocklistLoaded && state.extensionBlocklistPublication?.in_sync === false,
    normalizeExtensionBlocklistTerms: (terms) => Array.from(terms || []),
    extensionBlocklistTermValidationMessage: () => "",
    setExtensionBlocklistStatus: (message, tone) => statuses.push({ message, tone }),
    renderExtensionBlocklist: () => {},
    apiJson: async (path, options) => {
      requests.push({ path, options })
      const error = new Error("publication pending")
      error.status = 503
      error.response = {
        code: "extension_blocklist_projection_failed",
        policy: {
          schema_version: 1,
          revision: 8,
          version: "ebl1-new",
          terms: ["AMID"],
        },
        publication: { version: "ebl1-old", in_sync: false },
      }
      throw error
    },
    applyExtensionBlocklistPayload: (data) => {
      state.extensionBlocklistPolicy = { ...data.policy }
      state.extensionBlocklistPublication = { ...data.publication }
    },
    setLog: () => {},
    requestErrorMessage: () => "publish failed",
    isRequestCanceled: () => false,
  }
  new Script(
    `${ICONOPLASM_ADMIN_RUNTIME.slice(decisionStart, publishEnd)}\nthis.publishExtensionBlocklist = publishExtensionBlocklist`,
    { filename: "iconoplasm-admin-extension-publication.js" },
  ).runInNewContext(sandbox)

  await sandbox.publishExtensionBlocklist()
  assert.equal(requests.length, 1)
  assert.equal(requests[0].path, "/extension-blocklist")
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    terms: ["AMID"],
    expected_revision: 7,
  })
  assert.equal(state.extensionBlocklistPolicy.revision, 8)
  assert.equal(state.extensionBlocklistPolicy.schema_version, 1)
  assert.deepEqual(state.extensionBlocklistDraft, ["AMID"])
  assert.match(statuses.at(-1).message, /publication is still pending/)

  state.extensionBlocklistPublication.in_sync = true
  await sandbox.publishExtensionBlocklist()
  assert.equal(requests.length, 1, "a clean, published policy should not post again")
})

test("extension blocklist automatically retries transient saved publication lag with bounded timers", async () => {
  const decisionStart = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function extensionBlocklistErrorCarriesSavedPolicy",
  )
  const publishStart = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "async function publishExtensionBlocklist",
    decisionStart,
  )
  const publishEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf("function attentionMarkup", publishStart)
  assert.notEqual(decisionStart, -1)
  assert.notEqual(publishStart, -1)
  assert.notEqual(publishEnd, -1)
  const source = `${ICONOPLASM_ADMIN_RUNTIME.slice(decisionStart, publishEnd)}\nthis.publishExtensionBlocklist = publishExtensionBlocklist; this.cancelExtensionBlocklistPublicationRetry = cancelExtensionBlocklistPublicationRetry; this.extensionBlocklistErrorCanAutoRetry = extensionBlocklistErrorCanAutoRetry`

  function fakeTimers() {
    let nextId = 1
    const pending = new Map()
    return {
      window: {
        setTimeout(callback, delayMs) {
          const id = nextId
          nextId += 1
          pending.set(id, { callback, delayMs })
          return id
        },
        clearTimeout(id) {
          pending.delete(id)
        },
      },
      count() {
        return pending.size
      },
      async runNext() {
        const next = Array.from(pending.entries()).sort(
          (left, right) => left[1].delayMs - right[1].delayMs || left[0] - right[0],
        )[0]
        assert.ok(next, "expected an automatic retry timer")
        pending.delete(next[0])
        await next[1].callback()
      },
    }
  }

  function projectionNotVisible() {
    const error = new Error("projection not visible")
    error.status = 503
    error.response = {
      code: "extension_blocklist_projection_not_visible",
      error: "Saved projection is not visible yet",
      policy: {
        schema_version: 1,
        revision: 1,
        version: "ebl1-seed",
        terms: ["AMID"],
      },
      publication: { version: "", in_sync: false },
    }
    return error
  }

  function harness(apiBehavior, delays = [1, 2, 3]) {
    const timers = fakeTimers()
    const requests = []
    const statuses = []
    const state = {
      activeTab: "extension",
      recognitionSection: "blocklist",
      extensionBlocklistLoaded: true,
      extensionBlocklistPolicy: { revision: 1, version: "ebl1-seed", terms: ["AMID"] },
      extensionBlocklistPublication: { version: "", in_sync: false },
      extensionBlocklistLimits: { max_term_length: 64 },
      extensionBlocklistDraft: ["AMID"],
      extensionBlocklistInvalidTerms: [],
      extensionBlocklistBusy: false,
      extensionBlocklistPublicationRetry: null,
      extensionBlocklistPublicationRetryTimer: null,
      extensionBlocklistPublicationRetryRunId: 0,
    }
    const normalizeTerms = (terms) =>
      Array.from(new Set(Array.from(terms || []).map(String))).sort()
    const termsMatch = (left, right) =>
      JSON.stringify(normalizeTerms(left)) === JSON.stringify(normalizeTerms(right))
    const sandbox = {
      state,
      window: timers.window,
      EXTENSION_BLOCKLIST_MAX_TERM_LENGTH: 64,
      EXTENSION_BLOCKLIST_PUBLICATION_RETRY_DELAYS_MS: delays,
      extensionBlocklistTermsMatch: termsMatch,
      extensionBlocklistIsDirty: () =>
        !termsMatch(state.extensionBlocklistDraft, state.extensionBlocklistPolicy?.terms),
      extensionBlocklistNeedsPublicationRetry: () =>
        state.extensionBlocklistLoaded && state.extensionBlocklistPublication?.in_sync === false,
      normalizeExtensionBlocklistTerms: normalizeTerms,
      extensionBlocklistTermValidationMessage: () => "",
      normalizeExtensionBlocklistInvalidTerms: () => [],
      extensionBlocklistInvalidTermsSummary: () => "",
      setExtensionBlocklistStatus: (message, tone) => statuses.push({ message, tone }),
      renderExtensionBlocklist: () => {},
      apiJson: async (path, options) => {
        requests.push({ path, body: JSON.parse(options.body) })
        return apiBehavior(requests.length)
      },
      applyExtensionBlocklistPayload: (data) => {
        state.extensionBlocklistPolicy = {
          ...data.policy,
          terms: normalizeTerms(data.policy.terms),
        }
        state.extensionBlocklistPublication = { ...data.publication }
        state.extensionBlocklistLoaded = true
      },
      refreshExtensionBlocklist: async () => {},
      setLog: () => {},
      requestErrorMessage: (error, fallback) =>
        String(error?.response?.error || error?.message || fallback),
      isRequestCanceled: () => false,
    }
    new Script(source, {
      filename: "iconoplasm-admin-extension-automatic-retry.js",
    }).runInNewContext(sandbox)
    return { requests, sandbox, state, statuses, timers, termsMatch }
  }

  const eventuallyVisible = harness(async (requestNumber) => {
    if (requestNumber === 1) throw projectionNotVisible()
    return {
      policy: { revision: 1, version: "ebl1-seed", terms: ["AMID"] },
      publication: { version: "ebl1-seed", in_sync: true },
    }
  })
  assert.equal(
    eventuallyVisible.sandbox.extensionBlocklistErrorCanAutoRetry({
      response: { code: "extension_blocklist_alias_dependency_not_published" },
    }),
    true,
  )
  assert.equal(
    eventuallyVisible.sandbox.extensionBlocklistErrorCanAutoRetry({
      response: { code: "recognition_pair_not_visible" },
    }),
    true,
  )
  assert.equal(
    eventuallyVisible.sandbox.extensionBlocklistErrorCanAutoRetry({
      response: { code: "recognition_pair_dependencies_not_published" },
    }),
    true,
  )
  await eventuallyVisible.sandbox.publishExtensionBlocklist()
  assert.equal(eventuallyVisible.requests.length, 1)
  assert.equal(eventuallyVisible.timers.count(), 1)
  assert.match(eventuallyVisible.statuses.at(-1).message, /Automatic retry 1 of 3 starts/)
  await eventuallyVisible.timers.runNext()
  assert.equal(eventuallyVisible.requests.length, 2, "visibility success should not need a click")
  assert.equal(eventuallyVisible.state.extensionBlocklistPublication.in_sync, true)
  assert.equal(eventuallyVisible.timers.count(), 0)
  assert.match(eventuallyVisible.statuses.at(-1).message, /^Published;/)
  assert.deepEqual(eventuallyVisible.requests[1].body, {
    terms: ["AMID"],
    expected_revision: 1,
  })

  const leftTab = harness(async () => {
    throw projectionNotVisible()
  })
  await leftTab.sandbox.publishExtensionBlocklist()
  assert.equal(leftTab.timers.count(), 1)
  leftTab.sandbox.cancelExtensionBlocklistPublicationRetry(
    "Automatic publication retry stopped because you left this tab. Use Retry publication to try again.",
  )
  assert.equal(leftTab.timers.count(), 0, "leaving the tab must clear the pending timer")
  assert.equal(leftTab.state.extensionBlocklistPublicationRetry, null)
  assert.match(leftTab.statuses.at(-1).message, /stopped because you left this tab/)
  assert.doesNotMatch(leftTab.statuses.at(-1).message, /starts in/)

  const switchedSection = harness(async () => {
    throw projectionNotVisible()
  })
  await switchedSection.sandbox.publishExtensionBlocklist()
  assert.equal(switchedSection.timers.count(), 1)
  switchedSection.state.recognitionSection = "aliases"
  await switchedSection.timers.runNext()
  assert.equal(
    switchedSection.requests.length,
    1,
    "a subsection switch must prevent the scheduled blocklist POST",
  )
  assert.equal(switchedSection.timers.count(), 0)
  assert.equal(switchedSection.state.extensionBlocklistPublicationRetry, null)

  const edited = harness(async () => {
    throw projectionNotVisible()
  })
  await edited.sandbox.publishExtensionBlocklist()
  assert.equal(edited.timers.count(), 1)
  edited.state.extensionBlocklistDraft = ["ARCH"]
  await edited.timers.runNext()
  assert.equal(edited.requests.length, 1, "a dirty draft must prevent the scheduled POST")
  assert.equal(edited.timers.count(), 0)
  assert.equal(edited.state.extensionBlocklistPublicationRetry, null)

  const exhausted = harness(async () => {
    throw projectionNotVisible()
  })
  await exhausted.sandbox.publishExtensionBlocklist()
  while (exhausted.timers.count()) await exhausted.timers.runNext()
  assert.equal(exhausted.requests.length, 4, "one manual POST plus three bounded retries")
  assert.equal(exhausted.state.extensionBlocklistPublication.in_sync, false)
  assert.equal(exhausted.state.extensionBlocklistPublicationRetry, null)
  assert.equal(
    exhausted.termsMatch(
      exhausted.state.extensionBlocklistDraft,
      exhausted.state.extensionBlocklistPolicy.terms,
    ),
    true,
    "the clean saved policy remains eligible for the manual Retry publication button",
  )
  assert.match(exhausted.statuses.at(-1).message, /Use Retry publication to try again/)
})

test("extension blocklist distinguishes unsaved failures, conflicts, and client refresh timing", async () => {
  const decisionStart = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function extensionBlocklistErrorCarriesSavedPolicy",
  )
  const publishStart = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "async function publishExtensionBlocklist",
    decisionStart,
  )
  const publishEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf("function attentionMarkup", publishStart)
  assert.notEqual(decisionStart, -1)
  assert.notEqual(publishStart, -1)
  assert.notEqual(publishEnd, -1)
  const source = `${ICONOPLASM_ADMIN_RUNTIME.slice(decisionStart, publishEnd)}\nthis.publishExtensionBlocklist = publishExtensionBlocklist`

  function scenario(apiJson) {
    const statuses = []
    const refreshes = []
    let applied = 0
    const state = {
      extensionBlocklistLoaded: true,
      extensionBlocklistPolicy: { revision: 7, version: "ebl1-old", terms: ["AMID"] },
      extensionBlocklistPublication: { version: "ebl1-old", in_sync: true },
      extensionBlocklistLimits: { max_term_length: 64 },
      extensionBlocklistDraft: ["ARCH"],
      extensionBlocklistInvalidTerms: [],
      extensionBlocklistBusy: false,
    }
    const sandbox = {
      state,
      EXTENSION_BLOCKLIST_MAX_TERM_LENGTH: 64,
      extensionBlocklistIsDirty: () => true,
      extensionBlocklistNeedsPublicationRetry: () =>
        state.extensionBlocklistLoaded && state.extensionBlocklistPublication?.in_sync === false,
      normalizeExtensionBlocklistTerms: (terms) => Array.from(terms || []),
      extensionBlocklistTermValidationMessage: () => "",
      normalizeExtensionBlocklistInvalidTerms: () => [],
      extensionBlocklistInvalidTermsSummary: () => "",
      setExtensionBlocklistStatus: (message, tone) => statuses.push({ message, tone }),
      renderExtensionBlocklist: () => {},
      apiJson,
      applyExtensionBlocklistPayload: (data) => {
        applied += 1
        state.extensionBlocklistPolicy = { ...data.policy }
        state.extensionBlocklistPublication = { ...data.publication }
      },
      refreshExtensionBlocklist: async (options) => refreshes.push(options || {}),
      setLog: () => {},
      requestErrorMessage: (error, fallback) =>
        String(error?.response?.error || error?.message || fallback),
      isRequestCanceled: () => false,
    }
    new Script(source, {
      filename: "iconoplasm-admin-extension-publication-outcomes.js",
    }).runInNewContext(sandbox)
    return { applied: () => applied, refreshes, sandbox, state, statuses }
  }

  const unsaved = scenario(async () => {
    const error = new Error("scanner unavailable")
    error.status = 503
    error.response = {
      code: "published_scanner_unavailable",
      error:
        "Published scanner catalog is unavailable; publish the catalog before editing this policy",
      policy: { revision: 8, version: "ebl1-server", terms: ["AMID"] },
      publication: { version: "ebl1-server", in_sync: true },
    }
    throw error
  })
  await unsaved.sandbox.publishExtensionBlocklist()
  assert.equal(unsaved.applied(), 0, "a pre-save 503 must not replace the editor baseline")
  assert.equal(unsaved.state.extensionBlocklistPolicy.revision, 7)
  assert.deepEqual(unsaved.state.extensionBlocklistDraft, ["ARCH"])
  assert.equal(unsaved.statuses.at(-1).tone, "error")
  assert.match(unsaved.statuses.at(-1).message, /scanner catalog is unavailable/i)
  assert.doesNotMatch(unsaved.statuses.at(-1).message, /policy is saved|policy is published/i)

  const conflict = scenario(async () => {
    const error = new Error("revision conflict")
    error.status = 409
    error.response = { code: "extension_blocklist_revision_conflict" }
    throw error
  })
  await conflict.sandbox.publishExtensionBlocklist()
  assert.equal(conflict.refreshes.length, 1)
  assert.match(conflict.refreshes[0].message, /newer revision was saved elsewhere/i)
  assert.doesNotMatch(conflict.refreshes[0].message, /published elsewhere/i)

  const published = scenario(async () => ({
    policy: { revision: 8, version: "ebl1-new", terms: ["ARCH"] },
    publication: { version: "ebl1-new", in_sync: true },
  }))
  await published.sandbox.publishExtensionBlocklist()
  assert.equal(published.applied(), 1)
  assert.equal(published.statuses.at(-1).tone, "success")
  assert.match(published.statuses.at(-1).message, /later page load or browser restart/i)
  assert.match(published.statuses.at(-1).message, /manifest cache may last up to five minutes/i)
  assert.doesNotMatch(published.statuses.at(-1).message, /next manifest refresh|normally within/i)
})

test("extension blocklist renders every rejected term with an actionable reason", async () => {
  const helpersStart = ICONOPLASM_ADMIN_RUNTIME.indexOf("function normalizeExtensionBlocklistTerm")
  const helpersEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function applyExtensionBlocklistPayload",
    helpersStart,
  )
  const markupStart = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function extensionBlocklistTermMarkup",
    helpersEnd,
  )
  const markupEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function renderExtensionBlocklist",
    markupStart,
  )
  const decisionStart = ICONOPLASM_ADMIN_RUNTIME.indexOf(
    "function extensionBlocklistErrorCarriesSavedPolicy",
  )
  const publishStart = ICONOPLASM_ADMIN_RUNTIME.indexOf("async function publishExtensionBlocklist")
  const publishEnd = ICONOPLASM_ADMIN_RUNTIME.indexOf("function attentionMarkup", publishStart)
  assert.notEqual(helpersStart, -1)
  assert.notEqual(helpersEnd, -1)
  assert.notEqual(markupStart, -1)
  assert.notEqual(markupEnd, -1)
  assert.notEqual(decisionStart, -1)
  assert.notEqual(publishStart, -1)
  assert.notEqual(publishEnd, -1)

  const status = { textContent: "", dataset: {} }
  const state = {
    extensionBlocklistLoaded: true,
    extensionBlocklistPolicy: { revision: 7, terms: ["AMID"] },
    extensionBlocklistPublication: { version: "ebl1-old", in_sync: true },
    extensionBlocklistLimits: { max_term_length: 64 },
    extensionBlocklistDraft: ["DUPE", "TP53", "X"],
    extensionBlocklistInvalidTerms: [],
    extensionBlocklistBusy: false,
  }
  const sandbox = {
    state,
    els: { extensionBlocklistStatus: status },
    EXTENSION_BLOCKLIST_MAX_TERM_LENGTH: 64,
    EXTENSION_BLOCKLIST_CONTROL_CHAR_PATTERN: /[\u0000-\u001f\u007f]/,
    apiJson: async () => {
      const error = new Error("terms rejected")
      error.status = 422
      error.response = {
        error: "Every shared blocklist term must be an unambiguous alias",
        invalid_terms: [
          { term: "TP53", reason: "canonical_symbol" },
          { term: "X", reason: "not_recognition_target" },
          { term: "DUPE", reason: "ambiguous_alias" },
        ],
      }
      throw error
    },
    applyExtensionBlocklistPayload: () => {},
    renderExtensionBlocklist: () => {},
    setLog: () => {},
    requestErrorMessage: () => "generic validation failure",
    isRequestCanceled: () => false,
    esc: (value) => String(value),
  }
  new Script(
    `${ICONOPLASM_ADMIN_RUNTIME.slice(helpersStart, helpersEnd)}\n${ICONOPLASM_ADMIN_RUNTIME.slice(markupStart, markupEnd)}\n${ICONOPLASM_ADMIN_RUNTIME.slice(decisionStart, publishEnd)}\nthis.publishExtensionBlocklist = publishExtensionBlocklist; this.termMarkup = extensionBlocklistTermMarkup`,
    { filename: "iconoplasm-admin-extension-validation.js" },
  ).runInNewContext(sandbox)

  await sandbox.publishExtensionBlocklist()
  assert.deepEqual(JSON.parse(JSON.stringify(state.extensionBlocklistInvalidTerms)), [
    { term: "TP53", reason: "canonical_symbol", label: "Canonical symbol" },
    {
      term: "X",
      reason: "not_recognition_target",
      label: "No recognized gene label inside",
    },
    {
      term: "DUPE",
      reason: "ambiguous_alias",
      label: "Alias belongs to multiple genes",
    },
  ])
  assert.match(status.textContent, /TP53 — canonical symbol/)
  assert.match(status.textContent, /X — no recognized gene label inside/)
  assert.match(status.textContent, /DUPE — alias belongs to multiple genes/)
  assert.doesNotMatch(status.textContent, /generic validation failure/)

  const canonicalMarkup = sandbox.termMarkup("TP53", state.extensionBlocklistInvalidTerms[0].label)
  assert.match(canonicalMarkup, /extension-blocklist-term-invalid/)
  assert.match(canonicalMarkup, /data-invalid="true"/)
  assert.match(canonicalMarkup, /TP53/)
  assert.match(canonicalMarkup, /Canonical symbol/)
  const aliasMarkup = sandbox.termMarkup("X", state.extensionBlocklistInvalidTerms[1].label)
  assert.match(aliasMarkup, /X/)
  assert.match(aliasMarkup, /No recognized gene label inside/)
  const ambiguousMarkup = sandbox.termMarkup("DUPE", state.extensionBlocklistInvalidTerms[2].label)
  assert.match(ambiguousMarkup, /DUPE/)
  assert.match(ambiguousMarkup, /Alias belongs to multiple genes/)
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
    /<link rel="stylesheet" href="\/static\/iconoplasm\/admin\.css\?v=__ICONOPLASM_ADMIN_ASSET_VERSION__" \/>/,
  )
  assert.match(
    ICONOPLASM_ADMIN_SHELL,
    /<script src="\/static\/iconoplasm\/admin\.js\?v=__ICONOPLASM_ADMIN_ASSET_VERSION__" defer><\/script>/,
  )
  assert.doesNotMatch(ICONOPLASM_ADMIN_SHELL, /<style>/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_SHELL, /<script>/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_SHELL, /style="/)
  assert.doesNotMatch(ICONOPLASM_ADMIN_RUNTIME, /style="|\.style\./)
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

  const tabs = [
    "overview",
    "costs",
    "requests",
    "prompts",
    "extension",
    "archive",
    "styles",
    "activity",
  ]
  const markup = [
    '<nav id="admin-tabs">',
    ...tabs.map((tab) => `<button role="tab" data-tab="${tab}">${tab}</button>`),
    "</nav>",
    ...tabs.map(
      (tab) =>
        `<div class="panel" id="panel-${tab}" hidden><div id="${tab === "overview" ? "overview-events" : tab === "extension" ? "extension-blocklist-terms" : tab === "styles" ? "vision-stats-list" : tab === "activity" ? "activity-list" : `root-${tab}`}"><img alt="retained" /></div></div>`,
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
    recognitionSection: "aliases",
    publicationAliasLoaded: false,
    extensionBlocklistLoaded: false,
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
    renderPublicationAliases: () => calls.push("render-aliases"),
    refreshPublicationAliases: () => calls.push("refresh-aliases"),
    cancelPublicationAliasPublicationRetry: (message) =>
      calls.push(["cancel-alias-retry", message]),
    cancelPublicationAliasSearch: () => calls.push("cancel-alias-search"),
    renderExtensionBlocklist: () => calls.push("render-extension"),
    refreshExtensionBlocklist: () => calls.push("refresh-extension"),
    cancelExtensionBlocklistPublicationRetry: (message) =>
      calls.push(["cancel-extension-retry", message]),
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
  sandbox.setActiveTab("extension")
  assert.equal(document.querySelector("#panel-extension").hidden, false)
  assert.equal(document.querySelector("#vision-stats-list").children.length, 0)
  assert.ok(calls.includes("refresh-aliases"))

  sandbox.setActiveTab("activity")
  assert.equal(document.querySelector("#vision-stats-list").children.length, 0)
  assert.equal(state.visionPreviewRequestId, 1)
  assert.equal(state.visionDetailRequestId, 1)
  const cancelCall = calls.find(
    (call) => Array.isArray(call) && call[0] === "cancel-extension-retry",
  )
  assert.ok(cancelCall)
  assert.match(cancelCall[1], /stopped because you left this tab/)
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
