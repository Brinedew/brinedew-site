import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")
const css = readFileSync(new URL("../quartz/static/iconoplasm/styles.css", import.meta.url), "utf8")
const internalWorker = readFileSync(
  new URL(
    "./the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
    import.meta.url,
  ),
  "utf8",
)
const deployWorkflow = readFileSync(
  new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
  "utf8",
)
const slotContract = readFileSync(
  new URL("./generated/iconoplasm-anima-emulsion-slot-contract.js", import.meta.url),
  "utf8",
)

test("Iconoplasm request picker uses a searchable list with sibling favorite controls", () => {
  assert.match(
    app,
    /class="icono-search-input icono-request-picker-input"/,
    "request picker should reuse the shared Iconoplasm search input styling",
  )
  assert.doesNotMatch(
    app,
    /data-icono-request-inline-submit/,
    "the Free queue action should not compete with the search field",
  )
  assert.match(
    app,
    /String\(config\.placeholder \|\| "pick an emulsion"\)/,
    "request picker should keep the short placeholder copy",
  )
  assert.doesNotMatch(
    app,
    /Search emulsion code or vision ID\. Leave blank for random\./,
    "request picker should not ship the old verbose placeholder copy",
  )
  const queueMarkupStart = app.indexOf("function renderRequestFormMarkup")
  const queueMarkupEnd = app.indexOf("function renderRequestDirectGenerationMarkup")
  const queueMarkup = app.slice(queueMarkupStart, queueMarkupEnd)
  assert.match(queueMarkup, /role="searchbox"/)
  assert.match(queueMarkup, /role="list" aria-label="Emulsions"/)
  assert.match(
    css,
    /\.icono-request-results\[hidden\]\s*\{\s*display:\s*none;/,
    "request picker popup must honor [hidden] so it cannot cover the Image API lane after selection",
  )
  assert.match(
    css,
    /\.icono-request-dialog \.icono-request-results\s*\{[\s\S]*position:\s*static;[\s\S]*contain:\s*layout paint;/,
    "modal picker rows must stay inside the dialog panel without expanding its scroll surface",
  )
  assert.match(
    css,
    /\.icono-request-dialog::part\(body\)\s*\{[\s\S]*overflow:\s*hidden;/,
    "the dialog body must not become a second scroll container around the picker",
  )
  assert.match(
    css,
    /\.icono-request-dialog \.icono-request-results\s*\{[\s\S]*height:\s*22rem;[\s\S]*max-height:\s*calc\(100dvh - 15rem\);/,
    "the Free queue picker should reserve its final height before options load",
  )
  assert.match(
    css,
    /\.icono-request-dialog \.icono-request-results\s*\{[\s\S]*align-content:\s*start;/,
    "one result row must stay content-height instead of stretching across the reserved list area",
  )
  assert.match(
    app,
    /class="icono-request-option-row'[\s\S]{0,120}'" role="listitem"/,
    "every selectable emulsion should be wrapped in a non-interactive list row",
  )
  assert.match(app, /data-icono-emulsion-favorite=/)
  assert.match(
    app,
    /function wireEmulsionFavoriteButtons\(container\)[\s\S]*wireEmulsionFavoriteButtons\(document\)[\s\S]*emulsionFavorites\.subscribe/,
    "favorite controls should install one persistent delegated listener before route initialization",
  )
  assert.equal(
    Array.from(app.matchAll(/wireEmulsionFavoriteButtons\(container\)/g)).length,
    1,
    "favorite handling must not be called on a replaceable gene-page island",
  )
  assert.match(
    app,
    /favoriteOptions\.length[\s\S]*>Favorites<[\s\S]*otherOptions\.length[\s\S]*>Other emulsions</,
  )
  assert.match(
    app,
    /var selectButton =[\s\S]*if \(!favoriteEnabled\) return selectButton[\s\S]*class="icono-request-option-row[\s\S]*selectButton \+[\s\S]*renderEmulsionFavoriteButtonMarkup/,
    "favorite controls must be composed beside the completed selection button",
  )
  assert.match(
    app,
    /Random emulsion/,
    "request picker should present Random emulsion as the default first option",
  )
  assert.match(
    app,
    /var hasQuery = !!String\(renderQuery \|\| ""\)\.trim\(\)[\s\S]*var html = hasQuery[\s\S]*\? ""[\s\S]*: renderRequestOptionButtonMarkup/,
    "a typed search should show matching emulsions rather than keeping Random above them",
  )
  assert.doesNotMatch(
    app,
    /No examples yet/,
    "options without previews should stay compact instead of rendering useless placeholder copy",
  )
  assert.match(
    app,
    /function displayEmulsionCode\(rawEmulsionId\)/,
    "the site must render the one canonical emulsion identity",
  )
  assert.doesNotMatch(app, /public_emulsion_code/)
  assert.match(
    app,
    /event\.detail\.tab === "free"\) void renderResultsList\(\)/,
    "opening the Free queue tab should reveal its list without another search-field click",
  )
  assert.match(
    app,
    /var selectedRequestVisionIds = new Set\(\[""\]\)[\s\S]*function setSelection\(option\)[\s\S]*selectedRequestVisionIds\.add\(visionId\)[\s\S]*openResults\(\)/,
    "each emulsion click should add to a persistent batch while keeping the list open",
  )
  assert.match(
    app,
    /queueLabel = "Queue " \+ selectedVisionIds\.length \+ " candidates"/,
    "the footer action should expose the exact batch size",
  )
  assert.match(
    app,
    /data-icono-request-select-all-favorites hidden>Select all 0 favorites/,
    "the footer should reserve one unobtrusive bulk-favorite action",
  )
  assert.match(
    app,
    /buttons\[i\]\.textContent = "Select all " \+ favoriteCount \+ " favorites"/,
    "the bulk-favorite action should expose the user's current favorite count",
  )
  assert.match(
    app,
    /function selectAllFavoriteRequestOptions\(\)[\s\S]*selectedRequestVisionIds\.clear\(\)[\s\S]*selectedRequestVisionIds\.add\(selectable\[i\]\.vision_id\)[\s\S]*updateQueueSelectionControls\(\)/,
    "one footer click should replace the batch with every selectable favorite",
  )
  assert.match(app, /requested_vision_ids: requestedVisionIds/)
  assert.match(app, /client_batch_id: crypto\.randomUUID\(\)/)
  assert.match(
    app,
    /failedVisionIds[\s\S]*could not be queued and remain selected/,
    "partial failures should preserve only the selections that still need attention",
  )
  assert.match(
    app,
    /favoriteEnabled \? ' aria-pressed="' : ' aria-selected="'/,
    "multi-select row buttons should expose toggle state without misusing option semantics",
  )
  assert.match(
    css,
    /\.icono-request-option\.is-selected\s*\{[\s\S]*box-shadow:\s*inset 0 0 0 1px/,
    "selected emulsions need a persistent visual state distinct from hover",
  )
  assert.match(
    css,
    /\.icono-request-free-submit,[\s\S]*width:\s*max-content;[\s\S]*white-space:\s*nowrap;/,
    "the counted batch action must stay on one line at mobile width",
  )
  assert.doesNotMatch(
    css,
    /\.icono-emulsion-favorite-button\.is-favorite\s*\{[^}]*background:/,
    "favorite state should be carried by the star itself, not a circular chip",
  )
  assert.match(
    css,
    /\.icono-emulsion-favorite-button:hover svg path,[\s\S]*stroke-width:\s*2\.15;/,
    "hover and keyboard focus should strengthen the star outline itself",
  )
  assert.match(
    app,
    /function compareRequestOptionStrength\(left, right\)/,
    "request picker should preserve vote-strength ordering after filtering",
  )
  assert.match(
    app,
    /return compareRequestOptionStrength\(a, b\)/,
    "request picker should not fall back to alphabetical option ordering",
  )
  assert.match(
    app,
    /return String\(item\.medium_url \|\| item\.thumb_url \|\| ""\)\.trim\(\)/,
    "request picker should prefer the less aggressively cropped medium rendition",
  )
  assert.match(
    app,
    /function renderRequestShellMarkup\(symbol\)/,
    "request picker should render an immediate shell instead of waiting for full request state bootstrap",
  )
  assert.doesNotMatch(
    app,
    /Loading request state\.\.\./,
    "request picker should not ship the old blocking loading placeholder",
  )
  assert.match(
    app,
    /var path = "\/api\/iconoplasm\/requests\/gene\/" \+ encodeURIComponent\(key\) \+ "\/summary"/,
    "gene page should fetch summary from the split summary endpoint",
  )
  assert.match(
    app,
    /var requestOptionsUrl = "\/api\/iconoplasm\/requests\/options"/,
    "gene page should fetch options from the split options endpoint",
  )
  assert.match(
    app,
    /requestOptionsUrl \+= "\?query=" \+ encodeURIComponent\(queryKey\)/,
    "request picker should ask the split options endpoint for query-specific rollup matches",
  )
  assert.match(
    app,
    /function requestOptionFromImmediateNumericQuery\(query\)[\s\S]*ICONOPLASM_ANIMA_EMULSION_SLOT_CONTRACT\.callable_slot_intervals[\s\S]*primary_label: String\(slot\)/,
    "numeric searches should render their plain number immediately from the canonical allocation contract",
  )
  assert.match(
    app,
    /var match = \/\^\(\?:\(\?:\[a-z\]\[1-9\]\[0-9\]\*\|anima-v1\)-\)\?\(\[1-9\]\[0-9\]\*\)\(\?:-e\)\?\$\/i/,
    "numeric lookup should accept public factory aliases such as A1-10 and edited aliases such as A1-10-E",
  )
  assert.match(
    app,
    /if \(immediateOption\) \{[\s\S]*paintRequestResults\(requestOptionPrimaryLabel\(immediateOption\), \[immediateOption\]\)[\s\S]*scheduleNumericRequestHydration\(renderQuery, immediateOption\)[\s\S]*return/,
    "numeric search rendering must not wait for preview hydration",
  )
  assert.match(
    app,
    /if \(isNumericRequestQuery\(renderQuery\)\) \{[\s\S]*paintRequestResults\(renderQuery, \[\]\)[\s\S]*return/,
    "unallocated numbers should show the empty result immediately instead of entering the network path",
  )
  assert.match(
    app,
    /scheduleNumericRequestHydration[\s\S]*window\.setTimeout[\s\S]*ensureRequestOptionsLoaded\(renderQuery\)/,
    "numeric preview hydration should be debounced behind the immediate result",
  )
  assert.match(
    app,
    /paintRequestResults\(\s*requestOptionPrimaryLabel\(immediateOption\),/,
    "preview hydration should keep filtering by the normalized number so an A1-10 result cannot disappear",
  )
  assert.match(slotContract, /"callable_slot_intervals"/)
  assert.doesNotMatch(
    app,
    /slot\s*>=\s*1[\s\S]*slot\s*<=\s*4563|slot\s*>=\s*20001[\s\S]*slot\s*<=\s*58250/,
    "the picker must not duplicate slot allocation ranges",
  )
  assert.doesNotMatch(
    app,
    /fetchJSON\("\/api\/iconoplasm\/requests\/gene\/" \+ encodeURIComponent\(symbol\),/,
    "gene page should not call the removed one-shot request-state route",
  )
})

test("production deploys invalidate cached Iconoplasm HTML shells by commit", () => {
  assert.match(
    internalWorker,
    /env\?\.ICONOPLASM_HTML_SHELL_CACHE_VERSION[\s\S]*iconoplasmHtmlShellCacheVersion\(env\)/,
  )
  assert.match(
    deployWorkflow,
    /Deploy the only allowed internal stateful worker \(production\)[\s\S]*ICONOPLASM_HTML_SHELL_CACHE_VERSION:\$CACHE_BUST-backend[\s\S]*Deploy production static site to Cloudflare Pages[\s\S]*Activate current Iconoplasm HTML shell cache version[\s\S]*ICONOPLASM_HTML_SHELL_CACHE_VERSION:\$CACHE_BUST"/,
    "production should expose the final HTML cache key only after matching static assets are live",
  )
})

test("canonical blot toolbar keeps picker behind a modal trigger", () => {
  assert.match(
    app,
    /function renderCanonicalToolbarMarkup\(genePayload\)/,
    "canonical toolbar should have one renderer instead of assembling unrelated cells inline",
  )
  assert.match(app, /data-icono-canonical-rail/, "gene page should keep a canonical toolbar rail")
  assert.match(
    app,
    /class="icono-candidate-action-btn icono-canonical-edit-btn icono-image-edit-open"/,
    "canonical edit should use the same compact icon-button grammar as candidate edit",
  )
  assert.match(
    app,
    /data-icono-request-dialog-open/,
    "canonical toolbar should expose New candidate as a dialog trigger",
  )
  assert.match(
    app,
    /function renderRequestDialogTriggerMarkup\(symbol\)/,
    "canonical rail should render only the New candidate trigger",
  )
  assert.match(
    app,
    /<sl-dialog class="icono-request-dialog"/,
    "request picker should render inside a modal dialog instead of the visible toolbar rail",
  )
  assert.match(
    app,
    /renderRequestDialogTriggerMarkup\(g\.symbol\) \+[\s\S]*"<\/div>" \+[\s\S]*renderRequestDialogMarkup\(g\.symbol\)/,
    "request picker dialog should be outside the visible canonical toolbar rail",
  )
  assert.match(
    app,
    /function openRequestDialog\(\)/,
    "request panel wiring should open the modal from the toolbar trigger",
  )
  assert.match(css, /\.icono-request-dialog\b/, "request dialog should have dedicated styling")
  assert.match(
    css,
    /\.icono-canonical-new-candidate-btn\b/,
    "New candidate should be styled as the expanded canonical toolbar action",
  )
})

test("new candidate modal tabs separate free queue and configured image API generation paths", () => {
  assert.match(
    app,
    /role="tablist" aria-label="Generation method"[\s\S]*data-icono-request-tab="free">Free queue[\s\S]*data-icono-request-tab="api">Image API/,
    "request modal should expose the two workflows as tabs",
  )
  assert.match(
    app,
    /data-icono-request-lane="free"[\s\S]*Queue random/,
    "request modal should expose the free generation queue lane",
  )
  assert.match(
    app,
    /data-icono-request-lane="api"[\s\S]*data-icono-request-direct-panel[\s\S]*data-icono-request-image-generate[\s\S]*Generate candidate/,
    "request modal should expose a separate direct Image API lane",
  )
  assert.match(app, /ICONO_REQUEST_TAB_STORAGE_KEY = "iconoplasm\.new-candidate-tab"/)
  assert.match(app, /localStorage\.setItem\(ICONO_REQUEST_TAB_STORAGE_KEY, nextTab\)/)
  assert.match(app, /event\.key === "ArrowRight"/)
  assert.match(app, /requestLanes\[j\]\.hidden =/)
  const requestPanelStart = app.indexOf("function wireGeneRequestPanel")
  const requestPanelEnd = app.indexOf("/* ─── Client-side router ─── */")
  const requestPanel = app.slice(requestPanelStart, requestPanelEnd)
  assert.ok(
    requestPanel.indexOf("body.innerHTML = renderRequestShellMarkup(symbol)") <
      requestPanel.indexOf('body.querySelectorAll("[data-icono-request-tab]")'),
    "the shell must exist before tab listeners are attached so rendering cannot discard them",
  )
  assert.match(
    requestPanel,
    /function initializeFreeTab\(\)[\s\S]*loadSummary\(\)[\s\S]*event\.detail\.tab === "free"/,
    "free queue data should load only when its tab is first activated",
  )
  assert.match(
    requestPanel,
    /function initializeDirectTab\(\)[\s\S]*loadDirectProviders\(\)[\s\S]*event\.detail\.tab === "api"/,
    "Image API provider data should load only when its tab is first activated",
  )
  assert.match(
    css,
    /\.icono-request-lanes\b[\s\S]*\.icono-request-lane\b/,
    "request lanes should be styled with existing Iconoplasm modal primitives",
  )
  assert.match(
    app,
    /data-icono-request-direct-status[\s\S]*No saved image provider[\s\S]*Generate candidate/,
    "direct generation should explain the no-provider disabled state",
  )
  assert.match(
    app,
    /data-icono-request-image-publish hidden disabled/,
    "direct generation should not show publish until a candidate exists",
  )
  assert.match(
    app,
    /class="icono-request-footer" slot="footer"[\s\S]*data-icono-request-free-footer[\s\S]*data-icono-request-free-submit[\s\S]*data-icono-request-direct-footer hidden[\s\S]*data-icono-request-image-generate[\s\S]*data-icono-request-image-publish/,
    "both workflows should use the same persistent dialog footer position",
  )
  assert.match(app, /freeFooter\.hidden = nextTab !== "free"/)
  assert.match(app, /directFooter\.hidden = nextTab !== "api"/)
  assert.match(
    app,
    /data-icono-request-direct-result[\s\S]*class="icono-request-direct-controls"[\s\S]*data-icono-request-direct-preview/,
    "direct generation should have explicit viewer and controls regions instead of a pseudo-side column",
  )
  assert.match(
    app,
    /\/api\/iconoplasm\/candidate-generation\/jobs/,
    "direct generation should use its own candidate-generation job endpoint",
  )
  assert.match(
    app,
    /\/api\/iconoplasm\/candidate-generation\/jobs\/"\s*\+\s*encodeURIComponent\(requestDirectState\.job\.id\)\s*\+\s*"\/publish/,
    "direct generation should require an explicit publish action after the image API returns",
  )
  assert.match(
    app,
    /\/api\/iconoplasm\/image-edit\/providers/,
    "direct generation should reuse the saved image provider settings instead of adding a second key path",
  )
  assert.match(
    app,
    /request_mode:\s*"novel"/,
    "direct generation should identify API candidates as novel jobs",
  )
  assert.doesNotMatch(app, /data-icono-request-prompt-body-mode/)
  assert.doesNotMatch(app, /<fieldset class="icono-request-mode-field">/)
  assert.doesNotMatch(app, /The active factory Vision supplies the prompt structure\./)
  assert.doesNotMatch(app, /prompt_body_mode:/)
  assert.match(
    app,
    /request_mode:\s*"random"[\s\S]{0,200}requested_vision_id:\s*null/,
    "the free random queue should leave the numbered factory Vision in charge of prompt policy",
  )
  assert.doesNotMatch(
    app,
    /Request body sent to Iconoplasm|Prompt recipe|data-icono-request-payload-preview/,
    "direct generation should not expose internal transport details in the modal",
  )
  assert.doesNotMatch(
    app,
    /data-icono-request-backend-query|data-icono-request-backend-picker/,
    "request modal should not add a grab-bag backend picker",
  )
})

test("direct Image API generation has its own user-emulsion picker separate from the queue picker", () => {
  const directMarkupStart = app.indexOf("function renderRequestDirectGenerationMarkup")
  const directMarkupEnd = app.indexOf("function renderRequestShellMarkup", directMarkupStart)
  const wireStart = app.indexOf("function wireAuthenticatedRequestForm")
  const wireEnd = app.indexOf("function loadSummary", wireStart)
  const submitStart = app.indexOf("function submitDirectCandidateGeneration")
  const submitEnd = app.indexOf("function publishDirectCandidateGeneration", submitStart)
  assert.notEqual(directMarkupStart, -1)
  assert.notEqual(directMarkupEnd, -1)
  assert.notEqual(wireStart, -1)
  assert.notEqual(wireEnd, -1)
  assert.notEqual(submitStart, -1)
  assert.notEqual(submitEnd, -1)
  const directMarkup = app.slice(directMarkupStart, directMarkupEnd)
  const wireAuthenticatedRequestForm = app.slice(wireStart, wireEnd)
  const submitDirectCandidateGeneration = app.slice(submitStart, submitEnd)

  assert.match(directMarkup, /data-icono-request-direct-emulsion-picker/)
  assert.match(directMarkup, /data-icono-request-direct-emulsion-query/)
  assert.match(directMarkup, /data-icono-request-direct-emulsion-results/)
  assert.match(wireAuthenticatedRequestForm, /directEmulsionQuery/)
  assert.match(wireAuthenticatedRequestForm, /directUserEmulsionOptions/)
  assert.match(wireAuthenticatedRequestForm, /\/api\/iconoplasm\/user-emulsion/)
  assert.doesNotMatch(
    wireAuthenticatedRequestForm,
    /filterRequestOptions\([^)]*isDirectUserEmulsionOption/,
    "direct generation must not populate the private emulsion picker from the shared public request options",
  )
  assert.match(submitDirectCandidateGeneration, /selectedDirectUserEmulsionId\(\)/)
  assert.match(
    submitDirectCandidateGeneration,
    /user_emulsion_id:\s*selectedDirectUserEmulsionId\(\)/,
  )
  assert.doesNotMatch(submitDirectCandidateGeneration, /selectedUserEmulsionIdForDirectGeneration/)
})

test("direct user-emulsion options carry option_type so the click handler can read the user_emulsion_id", () => {
  const fromSavedStart = app.indexOf("function directUserEmulsionOptionFromSaved")
  assert.notEqual(fromSavedStart, -1, "directUserEmulsionOptionFromSaved must exist")
  const fromSavedEnd = app.indexOf("\n      function", fromSavedStart + 1)
  const fromSaved = app.slice(fromSavedStart, fromSavedEnd)
  assert.match(
    fromSaved,
    /option_type:\s*"user_emulsion"/,
    'direct user-emulsion options must mark option_type="user_emulsion" so renderRequestOptionButtonMarkup resolves user_emulsion_id (not the empty vision_id fallback)',
  )
  const wireStart = app.indexOf("function wireAuthenticatedRequestForm")
  const wireEnd = app.indexOf("function loadSummary", wireStart)
  const wire = app.slice(wireStart, wireEnd)
  assert.match(wire, /data-icono-request-direct-emulsion-option/)
  const clickHandlerMatch = wire.match(
    /directEmulsionResults\.addEventListener\(\s*"click"[\s\S]*?\}\)\s*\n\s*\}\s*\n/,
  )
  assert.ok(clickHandlerMatch, "direct emulsion click handler must exist")
  assert.match(
    clickHandlerMatch[0],
    /button\.getAttribute\(\s*"data-icono-request-direct-emulsion-option"\s*\)/,
    "click handler must read the rendered user_emulsion_id attribute",
  )
})

test("new and edit image modal previews use candidate masonry-sized medium previews", () => {
  assert.match(
    css,
    /--icono-image-tile-width:\s*384px/,
    "candidate image masonry should expose the canonical tile width",
  )
  assert.match(
    css,
    /\.icono-request-direct-result\s*\{[^}]*width:\s*min\(var\(--icono-image-tile-width\),\s*100%\)/,
    "direct generation result should use the candidate image masonry tile width",
  )
  const directResultCss = css.match(/(?:^|\n)\.icono-request-direct-result\s*\{[^}]*\}/)?.[0] || ""
  const directResultImageCss =
    css.match(/(?:^|\n)\.icono-request-direct-result img\s*\{[^}]*\}/)?.[0] || ""
  assert.match(directResultCss, /aspect-ratio:\s*4\s*\/\s*5/)
  assert.match(directResultImageCss, /position:\s*absolute/)
  assert.match(directResultImageCss, /object-fit:\s*cover/)
  assert.match(
    css,
    /\.icono-image-edit-before-after\s*\{[^}]*width:\s*min\(var\(--icono-image-tile-width\),\s*100%\)/,
    "edit comparison result should use the candidate image masonry tile width",
  )
  assert.match(
    app,
    /function directResultUrl\(job\)[^]*portraitAssetRefUrl\(job && job\.result_asset, "medium"\)/,
    "direct generation result should prefer the same medium rendition used by candidate masonry",
  )
  assert.match(
    app,
    /if \(after\) portraitDelivery\.bind\(after, portraitAssetRefUrl\(job && job\.result_asset, "medium"\)\)/,
    "edit comparison result should bind the schema-1 asset reference through shared delivery",
  )
})

test("direct generation result uses edit-modal geometry instead of a handmade side column", () => {
  assert.match(
    css,
    /\.icono-request-dialog\s*\{[^}]*--width:\s*min\(68rem,\s*calc\(100vw - 2rem\)\)/,
    "new candidate dialog should use the same desktop modal width class as the edit dialog",
  )
  assert.match(
    css,
    /\.icono-request-direct-controls\s*\{[^}]*display:\s*grid[^}]*align-content:\s*start/,
    "direct generation controls should be a coherent controls stack like the edit modal controls",
  )
  assert.match(
    css,
    /@media\s*\(min-width:\s*760px\)\s*\{[^]*\.icono-request-direct-controls\s*\{[^}]*grid-template-columns:\s*1fr/,
    "desktop direct generation controls should stack as a single column instead of side-by-side with the action row",
  )
  assert.match(
    css,
    /\.icono-request-direct-controls\s*\{[^}]*grid-template-areas:\s*"provider"\s*"picker"\s*"preview"\s*"status"/,
    "desktop direct generation controls should keep sample and prompt controls in a clean control stack",
  )
  assert.match(
    css,
    /\.icono-request-footer,[\s\S]*\.icono-request-direct-actions,[\s\S]*display:\s*flex[\s\S]*\.icono-request-footer,[\s\S]*\.icono-request-direct-actions\s*\{[^}]*justify-content:\s*space-between/,
    "Free queue, generate, and publish actions should share the dialog footer geometry",
  )
  assert.match(
    css,
    /@media\s*\(min-width:\s*760px\)\s*\{[^]*\.icono-request-direct-panel\s*\{[^}]*grid-template-columns:\s*minmax\(18rem,\s*var\(--icono-image-tile-width\)\)\s*minmax\(22rem,\s*1fr\)/,
    "the direct generation panel should reserve a fixed viewer-plus-controls layout from the start so the result does not shift the form on arrival",
  )
  assert.match(
    css,
    /@media\s*\(min-width:\s*760px\)\s*\{[^]*\.icono-request-direct-controls\s*\{[^}]*grid-template-columns:\s*1fr[^}]*"provider"[^}]*"picker"/,
    "the direct generation controls should sit beside the viewer in a fixed stack so the form does not reorganize when the result arrives",
  )
  assert.doesNotMatch(
    css,
    /\.icono-request-direct-side/,
    "direct generation should not keep the old pseudo-side column",
  )
  assert.match(
    css,
    /--icono-action-primary-bg:\s*color-mix\(in srgb,\s*oklch\(24% 0\.035 50\) 88%,\s*var\(--accent\) 12%\)/,
    "primary action color should live in a shared Iconoplasm action token that does not invert in dark mode",
  )
  assert.match(
    css,
    /--icono-action-font:\s*"IBM Plex Mono", monospace/,
    "modal and toolbar action buttons should not inherit the page's display fonts",
  )
  assert.match(
    css,
    /\.icono-request-direct-publish\s*\{[^}]*background:\s*var\(--icono-action-primary-bg\)/,
    "publish candidate should be the primary action token; generate is the secondary token when no image is ready",
  )
  assert.match(
    css,
    /\.icono-canonical-new-candidate-btn\s*\{[^}]*background:\s*var\(--icono-action-primary-bg\)[^}]*font-family:\s*var\(--icono-action-font\)\s*!important/,
    "canonical toolbar action should use the same font and primary action token as direct generation and beat global button typography",
  )
  assert.match(
    css,
    /\.icono-request-provider-select\s*\{[^}]*background-color:\s*color-mix\(in srgb,\s*var\(--light\) 94%,\s*var\(--dark\) 6%\)/,
    "request modal provider select should use Iconoplasm theme tokens instead of default white controls",
  )
  assert.match(
    app,
    /<select class="icono-request-provider-select" data-icono-request-provider><\/select>/,
    "direct generation provider should be a native select so the selected provider is visibly rendered",
  )
  assert.match(
    app,
    /var selectedValue = lastUsedValue \|\| \(options\.length \? options\[0\]\.value : ""\)/,
    "direct generation should restore the last compound provider_id:model option and otherwise use the first available option",
  )
  assert.match(
    app,
    /if \(\s*selectedValue\s*&&\s*!options\.some\(function \(opt\) \{\s*return opt\.value === selectedValue\s*\}\)\s*\) \{\s*selectedValue = options\.length \? options\[0\]\.value : ""/,
    "a removed last-used provider should fall back to the first currently available compound option",
  )
  assert.match(
    css,
    /\.icono-request-direct-generate:disabled,\s*\.icono-request-direct-publish:disabled\s*\{[^}]*background:\s*transparent[^}]*opacity:\s*1/,
    "disabled direct actions should become neutral outline controls instead of translucent green pills",
  )
  assert.match(
    app,
    /function hasDirectGeneratedImage\(\)[^]*return Boolean\([^)]*directResultUrl\(requestDirectState\.job\)[^]*\)/,
    "publish availability should be based on a generated image URL, not a fragile status string alone",
  )
})
