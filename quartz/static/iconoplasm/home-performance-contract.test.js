import { readFile } from "node:fs/promises"
import test from "node:test"
import assert from "node:assert/strict"

const appPath = new URL("./app.js", import.meta.url)
const homeOrdersPath = new URL("./home-orders.js", import.meta.url)
const stylesPath = new URL("./styles.css", import.meta.url)
const headPath = new URL("../../components/Head.tsx", import.meta.url)
const iconoplasmIndexPath = new URL("../../../content/apps/iconoplasm/index.md", import.meta.url)
const internalWorkerPath = new URL(
  "../../../workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js",
  import.meta.url,
)
const sharedCardCssPath = new URL(
  "../../../shared/iconoplasm-card/shared-card-label.css",
  import.meta.url,
)
const sharedCardPath = new URL(
  "../../../shared/iconoplasm-card/shared-card-runtime.js",
  import.meta.url,
)
const generatedSharedCardRuntimePath = new URL(
  "./generated/shared-card-runtime.js",
  import.meta.url,
)

test("public gallery default order is newly discovered genes first", async () => {
  const homeOrders = await readFile(homeOrdersPath, "utf8")
  const head = await readFile(headPath, "utf8")

  assert.match(homeOrders, /ICONOPLASM_DISCOVERY_DEFAULT_ORDER = "newest"/)
  assert.match(homeOrders, /ICONOPLASM_GALLERY_DEFAULT_ORDER = "newest"/)
  assert.doesNotMatch(
    head,
    /\/api\/public\/v1\/gallery\?order=newest&limit=4&offset=0/,
    "HTML head must not spend first paint bandwidth on a public gallery that signed-in users throw away",
  )
  assert.doesNotMatch(
    homeOrders + "\n" + head,
    /ICONOPLASM_GALLERY_DEFAULT_ORDER = "votes"/,
    "public gallery default must not silently become vote order",
  )
  assert.doesNotMatch(
    head,
    /\/api\/public\/v1\/gallery\?order=votes&limit=4&offset=0/,
    "HTML head must not bootstrap the wrong public gallery order",
  )
})

test("Cloudflare Web Analytics automatic injection is consent-gated by worker HTML handling", async () => {
  const head = await readFile(headPath, "utf8")
  const internalWorker = await readFile(internalWorkerPath, "utf8")

  assert.match(head, /brinedew_analytics_consent/)
  assert.match(head, /__brinedewAnalyticsConsentRequired !== true/)
  assert.match(head, /Allow cookieless Cloudflare Web Analytics/)
  assert.match(internalWorker, /script-src[^"\n]*https:\/\/static\.cloudflareinsights\.com/)
  assert.match(internalWorker, /connect-src[^"\n]*https:\/\/cloudflareinsights\.com/)
  assert.match(internalWorker, /host === "iconoplasm\.brinedew\.bio"/)
  assert.match(internalWorker, /requestHasAnalyticsConsent\(request\)/)
  assert.match(internalWorker, /requestRequiresAnalyticsConsent\(request\)/)
  assert.match(internalWorker, /CF-IPCountry/)
  assert.match(internalWorker, /__brinedewAnalyticsConsentRequired=true/)
  assert.match(internalWorker, /cookies\.brinedew_analytics_consent === "accepted"/)
  assert.match(
    internalWorker,
    /appendCacheControlDirective\(headers\.get\("cache-control"\), "no-transform"\)/,
  )
  assert.doesNotMatch(
    internalWorker,
    /html = html\.replace\(\s*\/<script\\b\[\^>\]\*src=\["'\]https:\\\/\\\/static\\\.cloudflareinsights\\\.com\\\/beacon\\\.min\\\.js/,
    "the worker must not strip the site-owned Web Analytics beacon",
  )
})

test("home collection counts use inventory stats, not a gallery-order probe", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function fetchHomeCollectionCounts()")
  const end = app.indexOf("function normalizePublicInventoryStats", start)
  assert.notEqual(start, -1, "missing fetchHomeCollectionCounts")
  assert.notEqual(end, -1, "missing fetchHomeCollectionCounts boundary")
  const block = app.slice(start, end)

  assert.match(block, /fetchPublicInventoryStats\(\)/)
  assert.doesNotMatch(
    block,
    /\/api\/public\/v1\/gallery\?order=/,
    "signed-in resorting must not trigger a public gallery count probe",
  )
  assert.doesNotMatch(
    block,
    /consumeBootstrapGallery\(/,
    "collection counts should not consume or race the initial gallery bootstrap payload",
  )
})

test("home collection cards do not wait for public gallery counts before loading discoveries", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function ensureCollectionReady()")
  const end = app.indexOf("function updateSentinelObserver()", start)
  assert.notEqual(start, -1, "missing ensureCollectionReady")
  assert.notEqual(end, -1, "missing ensureCollectionReady boundary")
  const block = app.slice(start, end)

  assert.doesNotMatch(
    block,
    /Promise\.all\(\[\s*initialSharedSettingsPromise,\s*fetchHomeCollectionCounts\(\)/,
    "the first personalized collection paint must not be blocked behind the slower public gallery count/bootstrap request",
  )
  assert.doesNotMatch(
    block,
    /Promise\.all\(\[\s*fetchDiscoveryState\(galleryState\.order, galleryState\.seed\),\s*fetchHomeCollectionCounts\(\)/,
    "cards should render as soon as discovery data is available; counts may update the sidebar later",
  )
  assert.match(
    block,
    /initialSharedSettingsPromise[\s\S]*fetchHomeCollectionCounts\(\)\.then[\s\S]*return fetchDiscoveryState\(galleryState\.order, galleryState\.seed\)/,
    "after settings sync, counts should load as a side update while discovery data owns first card paint",
  )
})

test("account collection first-card path uses a bounded gallery window for supported orders", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function loadNextGalleryPage()")
  const end = app.indexOf("ensureCollectionReady()", start)
  assert.notEqual(start, -1, "missing loadNextGalleryPage")
  assert.notEqual(end, -1, "missing legacy collection branch boundary")
  const firstWindowBlock = app.slice(start, end)

  assert.match(app, /function fetchAccountGalleryWindow\(order, cursor, limit, options\)/)
  assert.match(app, /\/api\/iconoplasm\/account-gallery-window\?order=/)
  assert.match(app, /view=" \+ encodeURIComponent\(resolvedView\)/)
  assert.match(
    firstWindowBlock,
    /accountGalleryWindowAvailable\(galleryState\.order,\s*activeDiscoveryScope\(\)\)/,
  )
  assert.match(firstWindowBlock, /fetchAccountGalleryWindow\(/)
  assert.match(
    firstWindowBlock,
    /isImageOnlyCardVariant\(cardVariant\) \? \{ view: "image-only" \} : \{\}/,
  )
  assert.doesNotMatch(
    firstWindowBlock,
    /initialSharedSettingsPromise[\s\S]{0,240}fetchAccountGalleryWindow/,
    "the signed-in first window must not wait for the settings bridge before fetching newest discoveries",
  )
  assert.doesNotMatch(
    firstWindowBlock,
    /fetchHomeCollectionCounts\(\)/,
    "first account window cards must not compete with public gallery count work",
  )
  assert.doesNotMatch(
    firstWindowBlock,
    /fetchDiscoveryState\(galleryState\.order, galleryState\.seed\)/,
    "supported account-window orders should not fetch the whole discovery shelf before first cards",
  )
})

test("home collection shared toggle uses the bounded shared gallery window", async () => {
  const app = await readFile(appPath, "utf8")
  const styles = await readFile(stylesPath, "utf8")

  assert.match(app, /data-icono-shared-discoveries-toggle/)
  assert.match(app, /show discoveries made by others/)
  assert.match(
    styles,
    /\.icono-collection-summary-row\s*\{[\s\S]*grid-template-columns:\s*minmax\(0,\s*1fr\) auto/,
  )
  assert.match(styles, /\.icono-collection-shared-toggle/)

  const fetchStart = app.indexOf(
    "function fetchAccountGalleryWindow(order, cursor, limit, options)",
  )
  const fetchEnd = app.indexOf("/* ─── Utility ─── */", fetchStart)
  assert.notEqual(fetchStart, -1, "missing account gallery fetch helper")
  assert.notEqual(fetchEnd, -1, "missing account gallery fetch helper boundary")
  const fetchBlock = app.slice(fetchStart, fetchEnd)
  assert.match(fetchBlock, /resolvedScope/)
  assert.match(fetchBlock, /path \+= "&scope=shared"/)
  assert.match(fetchBlock, /resolvedScope === "personal"/)
  assert.doesNotMatch(
    app.slice(
      app.indexOf("function buildCollectionSummaryMarkup"),
      app.indexOf("function buildCollectionEmptyMarkup"),
    ),
    /!\(currentUser \|\| \(collectionState && collectionState\.authenticated\)\)/,
    "shared discoveries are public read-only browsing; guests must be able to turn the checkbox on",
  )

  const pageStart = app.indexOf("function loadNextGalleryPage()")
  const loaderStart = app.indexOf("fetchAccountGalleryWindow(", pageStart)
  const loaderBlock = app.slice(loaderStart, loaderStart + 800)
  assert.match(loaderBlock, /scope:\s*activeDiscoveryScope\(\)/)

  const searchStart = app.indexOf("function activeSearchScope()")
  const searchEnd = app.indexOf("function fetchScopedSearchResults", searchStart)
  assert.notEqual(searchStart, -1, "missing active search scope helper")
  assert.notEqual(searchEnd, -1, "missing active search scope boundary")
  const searchScopeBlock = app.slice(searchStart, searchEnd)
  assert.match(searchScopeBlock, /querySelector\("\[data-icono-shared-discoveries-toggle\]"\)/)
  assert.match(
    searchScopeBlock,
    /sharedToggle\.checked\s*\?\s*"shared"\s*:\s*"discoveries"/,
    "search scope must follow the visible shared-discoveries checkbox as the single source of truth",
  )
  assert.match(
    searchScopeBlock,
    /throw new Error\([\s\S]*"\[Iconoplasm\] shared discoveries toggle missing while resolving search scope"[\s\S]*\)/,
    "missing shared-discoveries controls should fail loudly instead of guessing a search scope",
  )
  assert.doesNotMatch(
    searchScopeBlock,
    /galleryState\.sharedDiscoveries\s*\?\s*"shared"\s*:\s*"discoveries"/,
    "search scope should not fall back to galleryState when the visible checkbox is missing",
  )

  const refreshSearchStart = app.indexOf("function refreshActiveSearchResults()")
  const inputSearchStart = app.indexOf('input.addEventListener("input"', refreshSearchStart)
  assert.notEqual(refreshSearchStart, -1, "missing active search refresh helper")
  assert.notEqual(inputSearchStart, -1, "missing search input handler boundary")
  const refreshSearchBlock = app.slice(refreshSearchStart, inputSearchStart)
  assert.match(refreshSearchBlock, /var scope = activeSearchScope\(\)/)
  assert.match(refreshSearchBlock, /var requestId = \(activeSearchRequest \+= 1\)/)
  assert.match(
    refreshSearchBlock,
    /requestId !== activeSearchRequest[\s\S]*activeSearchScope\(\) !== scope/,
    "stale personal-discovery search responses must not overwrite newer shared-discovery results",
  )

  const toggleStart = app.indexOf("function wireCollectionSummaryControls()")
  const toggleEnd = app.indexOf("function ensureCollectionReady()", toggleStart)
  assert.notEqual(toggleStart, -1, "missing shared toggle wiring")
  assert.notEqual(toggleEnd, -1, "missing shared toggle wiring boundary")
  const toggleBlock = app.slice(toggleStart, toggleEnd)
  assert.match(
    toggleBlock,
    /resetGallery\(galleryState\.order\)[\s\S]{0,80}refreshActiveSearchResults\(\)/,
    "switching personal/shared galleries must refresh any open search results into the same scope",
  )
})

test("guest collection does not call the signed-in account window before auth resolves", async () => {
  const app = await readFile(appPath, "utf8")
  const helperStart = app.indexOf("function accountGalleryWindowAvailable(order, scope)")
  const helperEnd = app.indexOf("function fetchAccountGalleryWindow", helperStart)
  assert.notEqual(helperStart, -1, "missing account window availability helper")
  assert.notEqual(helperEnd, -1, "missing account window availability boundary")
  const helperBlock = app.slice(helperStart, helperEnd)

  assert.match(helperBlock, /!!currentUser/)
  assert.match(helperBlock, /resolvedScope === "shared"/)
  assert.match(helperBlock, /accountGalleryWindowOrderSupported\(order\)/)

  const loaderStart = app.indexOf("function loadNextGalleryPage()")
  const loaderEnd = app.indexOf("ensureCollectionReady()", loaderStart)
  assert.notEqual(loaderStart, -1, "missing loadNextGalleryPage")
  assert.notEqual(loaderEnd, -1, "missing collection branch boundary")
  const firstWindowBlock = app.slice(loaderStart, loaderEnd)
  assert.doesNotMatch(
    firstWindowBlock,
    /accountGalleryWindowOrderSupported\(galleryState\.order\)/,
    "guest/unknown auth state must not enter the signed-in account window path",
  )
  assert.match(
    firstWindowBlock,
    /accountGalleryWindowAvailable\(galleryState\.order,\s*activeDiscoveryScope\(\)\)/,
  )
})

test("collection loading skeleton reserves the final summary slot above the grid", async () => {
  const app = await readFile(appPath, "utf8")
  const styles = await readFile(stylesPath, "utf8")

  assert.match(app, /function buildCollectionSummarySkeletonMarkup\(collectionState\)/)
  const chromeStart = app.indexOf("function renderCollectionChrome()")
  const chromeEnd = app.indexOf("function ensureCollectionReady()", chromeStart)
  assert.notEqual(chromeStart, -1, "missing renderCollectionChrome")
  assert.notEqual(chromeEnd, -1, "missing renderCollectionChrome boundary")
  const chromeBlock = app.slice(chromeStart, chromeEnd)
  assert.match(
    chromeBlock,
    /!galleryState\.ready[\s\S]{0,180}summaryEl\.hidden = false[\s\S]{0,180}buildCollectionSummarySkeletonMarkup\(galleryState\)/,
    "summary chrome must be reserved while cards are still loading so skeleton and final grid share vertical geometry",
  )
  assert.match(
    chromeBlock,
    /!galleryState\.ready[\s\S]{0,240}wireCollectionSummaryControls\(\)/,
    "the shared-discoveries checkbox must stay wired while the collection reloads",
  )
  assert.match(styles, /\.icono-collection-summary--skeleton\s*\{[\s\S]*min-height:\s*65px/)
  assert.match(styles, /\.icono-collection-card--skeleton\s*\{[\s\S]*min-height:/)
  const summarySkeletonStart = app.indexOf("function buildCollectionSummarySkeletonMarkup")
  const summarySkeletonEnd = app.indexOf(
    "function buildBrickSkeletonCardMarkup",
    summarySkeletonStart,
  )
  const summarySkeletonBlock = app.slice(summarySkeletonStart, summarySkeletonEnd)
  assert.doesNotMatch(
    summarySkeletonBlock,
    /skeleton-line|progress-track--skeleton/,
    "reserved summary geometry must not draw fake animated bars above the card grid",
  )
  assert.match(summarySkeletonBlock, /data-icono-shared-discoveries-toggle/)
})

test("home collection waits for auth before choosing guest discoveries or account window", async () => {
  const app = await readFile(appPath, "utf8")
  const loaderStart = app.indexOf("function loadNextGalleryPage()")
  const loaderEnd = app.indexOf("if (useClassicGallery)", loaderStart)
  assert.notEqual(loaderStart, -1, "missing loadNextGalleryPage")
  assert.notEqual(loaderEnd, -1, "missing classic gallery branch")
  const loaderPrelude = app.slice(loaderStart, loaderEnd)

  assert.match(
    loaderPrelude,
    /if \(!useClassicGallery && !hasResolvedAuthState\) return/,
    "first paint must not spend the signed-in critical path on discoveries/me before auth resolves",
  )
  assert.match(
    app,
    /void refreshSharedUserState\(\)[\s\S]{0,80}render\(\)/,
    "auth fetch should start before the first render chooses a collection data path",
  )
})

test("home scroll restore is only armed when leaving home for a gene page", async () => {
  const app = await readFile(appPath, "utf8")
  const head = await readFile(headPath, "utf8")
  const styles = await readFile(stylesPath, "utf8")

  assert.doesNotMatch(
    head,
    /iconoplasmStartupState[\s\S]{0,900}scrollTo/,
    "first-paint bootstrap must not scroll the mobile viewport just because a home snapshot exists",
  )

  const restoreStart = app.indexOf("function readHomeRestoreState()")
  const restoreEnd = app.indexOf("function captureHomeAnchor", restoreStart)
  assert.notEqual(restoreStart, -1, "missing readHomeRestoreState")
  assert.notEqual(restoreEnd, -1, "missing readHomeRestoreState boundary")
  const restoreBlock = app.slice(restoreStart, restoreEnd)
  assert.match(
    restoreBlock,
    /home\.restoreOnGeneBack !== true/,
    "saved home geometry is not enough to move the viewport; browser Back from a gene page must arm it",
  )

  const navStart = app.indexOf("function navigateTo(path, link)")
  const navEnd = app.indexOf("function render()", navStart)
  assert.notEqual(navStart, -1, "missing navigateTo")
  assert.notEqual(navEnd, -1, "missing navigateTo boundary")
  const navBlock = app.slice(navStart, navEnd)
  assert.match(navBlock, /currentRoute\.page === "home"/)
  assert.match(navBlock, /\^\\\/gene\\\/\[\^\/\?#\]\+/)
  assert.match(
    navBlock,
    /syncHomeHistoryState\(true,\s*\{\s*restoreOnGeneBack:\s*leavingHomeForGene\s*\}\)/,
    "only home-to-gene navigation should arm the back restore intent",
  )

  const buildStateStart = app.indexOf("function buildNavigationState(path)")
  const buildStateEnd = app.indexOf("function navigateTo(path, link)", buildStateStart)
  assert.notEqual(buildStateStart, -1, "missing buildNavigationState")
  assert.notEqual(buildStateEnd, -1, "missing buildNavigationState boundary")
  const buildStateBlock = app.slice(buildStateStart, buildStateEnd)
  assert.match(
    buildStateBlock,
    /homeStateWithoutGeneBackIntent\(carriedHomeState\)/,
    "the in-page All genes link must not reuse a browser-Back-only restore intent",
  )

  const resetStart = app.indexOf("function resetGallery(order)")
  const resetEnd = app.indexOf("function loadNextGalleryPage()", resetStart)
  assert.notEqual(resetStart, -1, "missing resetGallery")
  assert.notEqual(resetEnd, -1, "missing resetGallery boundary")
  const resetBlock = app.slice(resetStart, resetEnd)
  assert.doesNotMatch(
    resetBlock,
    /if \(!restoreConfig\)[\s\S]{0,120}scrollWindowInstantly\(0, 0\)/,
    "ordinary home renders and mobile rerenders must not force-scroll to the top",
  )

  assert.match(
    styles,
    /#iconoplasm-root\s*\{[\s\S]*?overflow-anchor:\s*none;/,
    "generated Iconoplasm app chrome must not become the browser's mobile scroll anchor; explicit Back restore owns that job",
  )
})

test("home account window does not wait for the admin badge probe", async () => {
  const app = await readFile(appPath, "utf8")
  const stateStart = app.indexOf("function updateSharedUserState(user)")
  const stateEnd = app.indexOf("function refreshSharedUserState()", stateStart)
  assert.notEqual(stateStart, -1, "missing shared user state updater")
  assert.notEqual(stateEnd, -1, "missing shared user state updater boundary")
  const block = app.slice(stateStart, stateEnd)
  const firstHomeRender = block.indexOf('if (getRoute().page === "home")')
  const adminProbe = block.indexOf("fetchIconoplasmAdminState()")
  assert.ok(firstHomeRender > -1, "home should render immediately after auth resolves")
  assert.ok(adminProbe > -1, "admin state still needs to be probed")
  assert.ok(
    firstHomeRender < adminProbe,
    "signed-in gallery fetch must start before the non-critical admin badge request resolves",
  )
  assert.match(
    block,
    /if \(getRoute\(\)\.page === "home" && previousAdmin !== currentUserIsIconoAdmin\)/,
    "admin-only home modes still need a second render when the admin state changes",
  )
  assert.doesNotMatch(
    block,
    /rerenderCurrentGeneRoute\(\)/,
    "auth settlement must never rebuild account-independent public gene content",
  )
  assert.match(block, /refreshCurrentGeneInteractiveIslands\(\)/)
})

test("account collection single-flights duplicate window requests", async () => {
  const app = await readFile(appPath, "utf8")

  assert.match(app, /var iconoplasmQueryInflight = new Map\(\)/)
  assert.match(app, /function singleFlightQuery\(key, producer\)/)
  assert.match(
    app,
    /var singleFlightKey = \[[\s\S]*"account-gallery-window"[\s\S]*resolvedView[\s\S]*\]\.join\(":\"\)[\s\S]*singleFlightQuery\(\s*singleFlightKey,/,
    "account window requests need a stable same-key in-flight dedupe barrier",
  )
  assert.match(
    app,
    /iconoplasmQueryInflight\.set\(singleFlightKey, bootstrapWindowPromise\)/,
    "the head-started account window must join the same in-flight barrier as app requests",
  )
  assert.match(
    app,
    /bootstrap\.accountGalleryWindowData[\s\S]*Promise\.resolve\(bootstrap\.accountGalleryWindowData\)/,
    "the head-started first account window must be reused across the auth/admin double-render",
  )
  assert.doesNotMatch(
    app,
    /accountGalleryWindowConsumed/,
    "the initial no-cursor first window is a same-key render cache, not a single-use value",
  )
})

test("account collection paints four cards first, then auto-prefills the next batch", async () => {
  const app = await readFile(appPath, "utf8")
  const resetStart = app.indexOf("function resetGallery(order)")
  const resetEnd = app.indexOf("function loadNextGalleryPage()", resetStart)
  assert.notEqual(resetStart, -1, "missing resetGallery")
  assert.notEqual(resetEnd, -1, "missing loadNextGalleryPage")
  const resetBlock = app.slice(resetStart, resetEnd)

  assert.match(resetBlock, /currentAccountGalleryPrefillTarget\(\)/)
  assert.doesNotMatch(
    resetBlock,
    /currentGalleryLimit\(\) \+ 48/,
    "account-window first load must not schedule a hidden 48-card prefetch burst",
  )
  assert.match(app, /function currentAccountGalleryWindowLimit\(\)/)
  assert.match(
    app,
    /function currentAccountGalleryWindowLimit\(\) \{[\s\S]*galleryState\.offset === 0 \? HOME_SKELETON_CARD_COUNT : HOME_COLLECTION_PAGE_SIZE/,
    "account-window first load should fetch only the visible skeleton slots, not a whole page",
  )
  assert.match(app, /function currentAccountGalleryPrefillTarget\(\)/)
  assert.match(
    app,
    /function currentAccountGalleryPrefillTarget\(\) \{[\s\S]*return HOME_COLLECTION_PAGE_SIZE/,
    "account-window first paint should still auto-prefill one bounded page after the visible skeleton slots render",
  )
  assert.match(
    app,
    /var HOME_COLLECTION_INITIAL_PAGE_SIZE = 4/,
    "first collection paint should stay capped to the visible row",
  )
  assert.match(
    await readFile(headPath, "utf8"),
    /bootstrap\.accountGalleryWindowLimit = 4/,
    "head-started account window should not preload below-fold cards",
  )
  assert.doesNotMatch(
    app,
    /galleryState\.offset < HOME_SKELETON_CARD_COUNT[\s\S]*loadNextGalleryPage\(\)/,
    "an account with four visible cards still needs an automatic second batch",
  )
  assert.match(
    app,
    /rootMargin:\s*"160px 0px 160px 0px"/,
    "infinite-scroll observation must not use a huge margin that preloads the next page during first paint",
  )
  assert.match(
    app,
    /isFirstPage[\s\S]*galleryState\.offset < galleryState\.prefillTarget[\s\S]*backgroundPrefillTimer = window\.setTimeout[\s\S]*loadNextGalleryPage\(\)/,
    "after the first visible account window, the next batch should load automatically without waiting for scroll",
  )
  assert.doesNotMatch(app, /armFirstAccountWindowScrollLoad/)
})

test("desktop home collection masonry paints discovery rows before rich detail hydration", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function loadNextGalleryPage()")
  const end = app.indexOf("if (orderEl)", start)
  assert.notEqual(start, -1, "missing loadNextGalleryPage")
  assert.notEqual(end, -1, "missing loadNextGalleryPage boundary")
  const block = app.slice(start, end)

  assert.match(
    block,
    /if \(shouldUseImmediateDiscoveryFallback\(homeLayout, cardVariant\)\) \{\s*var immediateItems = pageEntries\.map\(function \(entry\) \{\s*return fallbackDiscoveredGene\(entry\)/,
    "desktop masonry may create immediate discovery-row cards while rich gene details hydrate afterward",
  )
  assert.match(
    block,
    /void hydrateBrickCards\(newCards\)/,
    "rich card detail should still hydrate after first paint",
  )
  assert.match(
    block,
    /var appendResolvedItems = function \(resolvedItems\)[\s\S]*if \(shouldUseHomeMasonry\(homeLayout, cardVariant\)\)[\s\S]*void hydrateBrickCards\(newCards\)/,
    "desktop masonry fallback cards must hydrate after first paint",
  )
})

test("mobile home collection infocards wait for rich detail instead of fallback records", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function loadNextGalleryPage()")
  const end = app.indexOf("if (orderEl)", start)
  assert.notEqual(start, -1, "missing loadNextGalleryPage")
  assert.notEqual(end, -1, "missing loadNextGalleryPage boundary")
  const block = app.slice(start, end)
  const collectionStart = block.indexOf("ensureCollectionReady()")
  assert.notEqual(collectionStart, -1, "missing personalized collection branch")
  const collectionBlock = block.slice(collectionStart)

  assert.match(
    collectionBlock,
    /if \(shouldUseImmediateDiscoveryFallback\(homeLayout, cardVariant\)\)[\s\S]*fallbackDiscoveredGene\(entry\)[\s\S]*\} else \{\s*return loadMobileCardPageVM\(pageEntries\)/,
    "simple/lit archival non-masonry infocards must be built from the strict mobile card manifest, while image-only uses the tile path",
  )
  assert.doesNotMatch(
    collectionBlock,
    /\} else \{[\s\S]{0,900}void hydrateBrickCards\(newCards\)/,
    "mobile/non-masonry infocards should not paint partial cards and rely on later hydration to become complete",
  )
  assert.doesNotMatch(
    collectionBlock,
    /\} else \{[\s\S]{0,900}loadDiscoveredGeneCardData\(entry\)/,
    "mobile/non-masonry infocards should use one manifest request, not a per-gene detail waterfall",
  )
})

test("blot-only home collection waits for rich card payloads before masonry layout", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function loadNextGalleryPage()")
  const end = app.indexOf("if (orderEl)", start)
  assert.notEqual(start, -1, "missing loadNextGalleryPage")
  assert.notEqual(end, -1, "missing loadNextGalleryPage boundary")
  const block = app.slice(start, end)
  const collectionStart = block.indexOf("ensureCollectionReady()")
  assert.notEqual(collectionStart, -1, "missing personalized collection branch")
  const collectionBlock = block.slice(collectionStart)

  assert.match(app, /function shouldUseImmediateDiscoveryFallback\(layout, cardVariant\)/)
  assert.match(
    collectionBlock,
    /if \(shouldUseImmediateDiscoveryFallback\(homeLayout, cardVariant\)\)[\s\S]*fallbackDiscoveredGene\(entry\)[\s\S]*\} else \{\s*return loadMobileCardPageVM\(pageEntries\)/,
    "blot-only cards need rich card data before masonry; symbol-only fallback rows create empty square cards",
  )
  assert.doesNotMatch(
    collectionBlock,
    /if \(shouldUseHomeMasonry\(homeLayout, cardVariant\)\)[\s\S]{0,240}fallbackDiscoveredGene\(entry\)/,
    "masonry layout eligibility must not automatically opt blot-only into symbol-only fallback cards",
  )
})

test("image-only home cards use the blot renderer in an adaptive masonry grid", async () => {
  const app = await readFile(appPath, "utf8")

  assert.match(app, /function effectiveHomeGridLayout\(layout, cardVariant\)/)
  assert.match(app, /function shouldUseHomeMasonry\(layout, cardVariant\)/)
  assert.match(app, /function buildImageOnlyTileCardMarkup\(g, cardIndex\)/)

  const tileStart = app.indexOf("function buildImageOnlyTileCardMarkup(g, cardIndex)")
  const tileEnd = app.indexOf("function buildBrickGridMarkup", tileStart)
  assert.notEqual(tileStart, -1, "missing image-only tile renderer")
  assert.notEqual(tileEnd, -1, "missing image-only tile renderer boundary")
  const tileBlock = app.slice(tileStart, tileEnd)

  assert.match(tileBlock, /icono-card--image-tile/)
  assert.match(tileBlock, /icono-card--variant-image-only/)
  assert.match(tileBlock, /buildArchivalBodyMarkup\([\s\S]*layoutVariant:\s*"image-only"/)
  assert.doesNotMatch(
    tileBlock,
    /icono-card--masonry/,
    "blot-only site cards must not use the generic thumbnail masonry renderer",
  )

  const appendStart = app.indexOf("function appendGrid(container, genes, startIndex, layout")
  const appendEnd = app.indexOf("function renderCandidateGallery", appendStart)
  assert.notEqual(appendStart, -1, "missing appendGrid")
  assert.notEqual(appendEnd, -1, "missing appendGrid boundary")
  const appendBlock = app.slice(appendStart, appendEnd)
  assert.match(appendBlock, /isImageOnlyCardVariant\(resolvedCardVariant\)/)
  assert.match(appendBlock, /buildImageOnlyTileGridMarkup\(genes, startIndex\)/)
})

test("image-only masonry has a physical artboard cap and native adaptive columns", async () => {
  const styles = await readFile(stylesPath, "utf8")
  const sharedCardCss = await readFile(sharedCardCssPath, "utf8")
  const sharedCard = await readFile(sharedCardPath, "utf8")
  const app = await readFile(appPath, "utf8")

  assert.match(styles, /--icono-image-tile-width:\s*384px/)
  assert.match(styles, /--icono-image-tile-gutter:\s*16px/)
  assert.match(
    styles,
    /\.icono-grid\[data-layout="image-only-masonry"\]\s*\{[\s\S]*display:\s*grid[\s\S]*grid-template-columns:\s*repeat\(/,
  )
  assert.match(
    styles,
    /\.icono-grid\[data-layout="image-only-masonry"\]\s+\.icono-card--image-tile[\s\S]*width:\s*min\(100%,\s*var\(--icono-image-tile-width\)\)/,
  )
  assert.match(
    styles,
    /\.icono-grid\[data-layout="image-only-masonry"\]\s+\.icono-grid-sizer,[\s\S]*\.icono-grid\[data-layout="image-only-masonry"\]\s+\.icono-gutter-sizer\s*\{[\s\S]*display:\s*none/,
  )
  assert.match(
    app,
    /function shouldUseHomeMasonry\(layout, cardVariant\)\s*\{[\s\S]*effectiveHomeGridLayout\(layout, cardVariant\) === "masonry"/,
    "fixed-size image-only cards must not wait for JS Masonry before getting their final column geometry",
  )
  assert.match(sharedCardCss, /\.icono-card--variant-image-only\.icono-card--image-tile/)
  assert.match(
    sharedCardCss,
    /\.icono-card--variant-image-only\.icono-card--brick,[\s\S]*\.icono-card--variant-image-only\.icono-card--image-tile,[\s\S]*aspect-ratio:\s*384\s*\/\s*512/,
  )
  assert.match(
    sharedCardCss,
    /\.icono-image-only-photo,[\s\S]*\.icono-image-only-fallback\s*\{[\s\S]*margin:\s*0/,
    "blot-only media must not inherit global img margins that create a top letterbox inside the physical card frame",
  )
  const imageOnlyPhotoStart = sharedCardCss.indexOf(".icono-image-only-photo {")
  const imageOnlyPhotoEnd = sharedCardCss.indexOf(
    ".icono-image-only-photo--loaded",
    imageOnlyPhotoStart,
  )
  assert.notEqual(imageOnlyPhotoStart, -1, "missing blot-only portrait media rule")
  assert.notEqual(imageOnlyPhotoEnd, -1, "missing blot-only portrait media rule boundary")
  const imageOnlyPhotoBlock = sharedCardCss.slice(imageOnlyPhotoStart, imageOnlyPhotoEnd)
  assert.match(
    imageOnlyPhotoBlock,
    /object-fit:\s*cover;/,
    "blot-only portraits must auto-zoom to cover the fixed 384x512 card stage without letterboxing",
  )
  assert.doesNotMatch(
    imageOnlyPhotoBlock,
    /object-fit:\s*contain;/,
    "blot-only portraits must not preserve the full bitmap at the cost of visible letterboxing",
  )

  const skeletonStart = app.indexOf("function buildImageOnlySkeletonCardMarkup(index)")
  const skeletonEnd = app.indexOf("function buildHomeSkeletonGridMarkup", skeletonStart)
  assert.notEqual(skeletonStart, -1, "missing image-only skeleton renderer")
  assert.notEqual(skeletonEnd, -1, "missing image-only skeleton renderer boundary")
  const skeletonBlock = app.slice(skeletonStart, skeletonEnd)
  assert.match(skeletonBlock, /icono-card--image-tile/)
  assert.match(skeletonBlock, /icono-card--variant-image-only/)
  assert.match(skeletonBlock, /icono-image-only-link/)
  assert.match(skeletonBlock, /icono-image-only-media-stage/)
  assert.match(skeletonBlock, /icono-image-only-loading-mark/)
  assert.match(
    app + "\n" + sharedCardCss,
    /icono-image-only-loading-mark[\s\S]*\/static\/iconoplasm\/icons\/icon-512\.png/,
    "blot-only skeleton and unloaded final card must reuse the same shipped Iconoplasm extension icon layer",
  )
  assert.doesNotMatch(skeletonBlock, /icono-image-only-skeleton-figure/)
  assert.doesNotMatch(
    skeletonBlock,
    /skeleton-artboard|skeleton-icon|skeleton-wash|skeleton-caption|skeleton-line/,
    "blot-only first paint must not use a separate skeleton visual system",
  )
  assert.doesNotMatch(
    skeletonBlock,
    /icono-card-skeleton-media/,
    "blot-only first paint must not fall back to the generic gray media block",
  )
  assert.match(
    skeletonBlock,
    /--width:384;--height:512/,
    "blot-only masonry skeletons must reserve the same physical artboard geometry as final cards",
  )
  assert.match(
    styles,
    /\.icono-card--image-tile\.icono-card--skeleton\s*\{[\s\S]*border-radius:\s*0[\s\S]*background:\s*var\(--light\)/,
    "blot-only skeleton shells must use the page paper background, not an invented dark card color",
  )
  assert.match(
    sharedCardCss,
    /\.icono-image-only-link\s*\{[\s\S]*background:\s*var\(--light\)/,
    "unloaded final image-only cards must use the same page paper background as their skeletons",
  )
  assert.match(
    sharedCardCss,
    /\.icono-card--variant-image-only\.icono-card--brick,[\s\S]*background:\s*var\(--light\)/,
    "the image-only card shell itself must not flash an invented dark background before portraits paint",
  )
  assert.doesNotMatch(
    styles,
    /iconoSkeletonWash|\.icono-image-only-skeleton-artboard|\.icono-image-only-skeleton-icon|\.icono-image-only-skeleton-wash|\.icono-image-only-skeleton-caption|collection-progress-track--skeleton/,
    "image-only and collection skeletons must stay static, undecorated, and visually identical to the unloaded final card",
  )
  assert.match(
    sharedCardCss,
    /\.icono-image-only-loading-mark\s*\{[\s\S]*url\("\/static\/iconoplasm\/icons\/icon-512\.png"\)[\s\S]*transform:\s*translate\(-50%, -54%\)/,
    "final image-only cards must keep the same extension-icon placeholder under portraits until the image load event fires",
  )
  assert.match(sharedCardCss, /\.icono-image-only-photo\s*\{[\s\S]*opacity:\s*0/)
  assert.match(sharedCardCss, /\.icono-image-only-photo--loaded\s*\{[\s\S]*opacity:\s*1/)
  assert.match(
    sharedCardCss,
    /\.icono-image-only-media-stage--loaded \.icono-image-only-loading-mark\s*\{[\s\S]*opacity:\s*0/,
    "the final-card placeholder mark should hide only after the portrait is loaded",
  )
  assert.match(
    app,
    /parentElement\.classList\.add\("icono-image-only-media-stage--loaded"\)/,
    "image-only card code should flip the media stage atomically with the portrait load event",
  )
  assert.match(
    app,
    /closest\("\.icono-image-only-link"\)[\s\S]*classList\.add\("icono-image-only-link--loaded"\)/,
    "image-only captions and bottom shade should not appear before the portrait is loaded",
  )
  assert.match(
    sharedCardCss,
    /\.icono-image-only-link::after\s*\{[\s\S]*opacity:\s*0[\s\S]*\}[\s\S]*\.icono-image-only-link--loaded::after\s*\{[\s\S]*opacity:\s*1/,
    "unloaded image-only placeholders must not show the dark caption shade",
  )
  assert.match(
    sharedCardCss,
    /\.icono-image-only-overlay\s*\{[\s\S]*opacity:\s*0[\s\S]*\}[\s\S]*\.icono-image-only-link--loaded \.icono-image-only-overlay\s*\{[\s\S]*opacity:\s*1/,
    "unloaded image-only placeholders must not show labels over blank paper",
  )
})

test("Iconoplasm middle column uses card fonts instead of inherited Crimson Pro", async () => {
  const styles = await readFile(stylesPath, "utf8")
  const app = await readFile(appPath, "utf8")

  const titleStart = styles.indexOf(".icono-hero-title {")
  const titleEnd = styles.indexOf("}", titleStart)
  const taglineStart = styles.indexOf(".icono-hero .tagline {")
  const taglineEnd = styles.indexOf("}", taglineStart)
  const statStart = styles.indexOf(".icono-hero .stat {")
  const statEnd = styles.indexOf("}", statStart)
  assert.notEqual(titleStart, -1, "missing hero title styles")
  assert.notEqual(taglineStart, -1, "missing hero tagline styles")
  assert.notEqual(statStart, -1, "missing hero stat styles")

  assert.match(styles.slice(titleStart, titleEnd), /font-family:\s*"League Spartan"/)
  assert.match(styles.slice(taglineStart, taglineEnd), /font-family:\s*"Special Elite"/)
  assert.match(styles.slice(statStart, statEnd), /font-family:\s*"IBM Plex Mono"/)
  assert.match(styles, /#iconoplasm-root\s*\{[\s\S]*font-family:\s*"Special Elite"/)
  assert.match(app, /<div class="icono-hero-title">ICONOPLASM<\/div>/)
  assert.doesNotMatch(styles, /Crimson Pro/)
  assert.doesNotMatch(styles, /Monaspace/)
  assert.doesNotMatch(
    styles,
    /var\(--(?:bodyFont|headerFont|codeFont)\)/,
    "Iconoplasm-owned surfaces must not inherit Quartz Crimson Pro or Monaspace font variables",
  )
  assert.doesNotMatch(styles, /font-family:\s*inherit/)
})

test("Iconoplasm first visit defaults to light theme instead of system dark", async () => {
  const head = await readFile(headPath, "utf8")

  // The first-paint theme bootstrap in Head.tsx defaults Iconoplasm
  // visitors to light before CSS paints. This is the only place the
  // default lives; a separate dark-mode controller no longer exists
  // (the darkmode.inline.ts script was inlined into Head.tsx and the
  // post-paint dark-mode controller was removed). Subsequent theme
  // changes after first paint go through quartz/static/site-preferences.js.
  assert.match(
    head,
    /var e=t\|\|\(ip\?'light':\(window\.matchMedia\('\(prefers-color-scheme: light\)'\)\.matches\?'light':'dark'\)\)/,
    "head first-paint theme bootstrap must default Iconoplasm visitors to light before CSS paints",
  )
})

test("gene lab-label symbol uses the same tight League Spartan voice as blot-only cards", async () => {
  const sharedCardCss = await readFile(sharedCardCssPath, "utf8")
  const head = await readFile(headPath, "utf8")

  const imageOnlyStart = sharedCardCss.indexOf(
    ".icono-image-only-overlay .icono-image-only-symbol {",
  )
  const imageOnlyEnd = sharedCardCss.indexOf("}", imageOnlyStart)
  const symbolStart = sharedCardCss.indexOf(".icono-label-symbol {")
  const symbolEnd = sharedCardCss.indexOf("}", symbolStart)
  const staticStart = head.indexOf(".icono-gene-lead--static-shell .icono-label-symbol {")
  const staticEnd = head.indexOf("}", staticStart)
  assert.notEqual(imageOnlyStart, -1, "missing blot-only symbol reference style")
  assert.notEqual(symbolStart, -1, "missing shared lab-label symbol style")
  assert.notEqual(staticStart, -1, "missing static gene shell symbol style")

  const imageOnlyBlock = sharedCardCss.slice(imageOnlyStart, imageOnlyEnd)
  const symbolBlock = sharedCardCss.slice(symbolStart, symbolEnd)
  const staticBlock = head.slice(staticStart, staticEnd)

  assert.match(imageOnlyBlock, /letter-spacing:\s*-0\.05em/)
  assert.match(
    symbolBlock,
    /font-family:\s*"League Spartan",\s*"Bahnschrift",\s*"Arial Narrow",\s*sans-serif/,
    "hydrated gene symbols should keep the same League Spartan stack as the other display symbols",
  )
  assert.match(symbolBlock, /font-weight:\s*800/)
  assert.match(symbolBlock, /line-height:\s*0\.9/)
  assert.match(
    symbolBlock,
    /letter-spacing:\s*-0\.05em/,
    "hydrated gene symbols should use the same tight tracking as blot-only card symbols",
  )
  assert.match(
    staticBlock,
    /font-family:\s*"League Spartan",\s*"Bahnschrift",\s*"Arial Narrow",\s*sans-serif/,
    "static first-paint gene symbols should not use a different font stack than hydrated cards",
  )
  assert.match(staticBlock, /font-weight:\s*800/)
  assert.match(staticBlock, /line-height:\s*0\.9/)
  assert.match(staticBlock, /letter-spacing:\s*-0\.05em/)
  assert.match(
    staticBlock,
    /font-size:\s*calc\(60 \/ 1220 \* 100cqw\)/,
    "static first-paint gene symbols should not resize when hydration CSS arrives",
  )
})

test("gene lit-archival first paint uses the same physical geometry as the hydrated card", async () => {
  const sharedCardCss = await readFile(sharedCardCssPath, "utf8")
  const styles = await readFile(stylesPath, "utf8")
  const head = await readFile(headPath, "utf8")

  const hydratedCardStart = sharedCardCss.indexOf(
    ".icono-card--variant-lab-label.icono-card--brick {",
  )
  const hydratedCardEnd = sharedCardCss.indexOf("}", hydratedCardStart)
  const criticalCardStart = head.indexOf(
    ".icono-gene-lead-card.icono-card--variant-lab-label.icono-card--brick,",
  )
  const criticalCardEnd = head.indexOf("}", criticalCardStart)
  const hydratedSheetStart = sharedCardCss.indexOf("\n.icono-label-sheet-body {")
  const hydratedSheetEnd = sharedCardCss.indexOf("}", hydratedSheetStart)
  const criticalSheetStart = head.indexOf(
    ".icono-gene-lead--static-shell .icono-label-sheet-body {",
  )
  const criticalSheetEnd = head.indexOf("}", criticalSheetStart)
  const geneDetailStart = styles.indexOf("/* ───────── Gene detail page ───────── */")
  const hydratedLeadStart = styles.indexOf(".icono-gene-lead {", geneDetailStart)
  const hydratedLeadEnd = styles.indexOf("}", hydratedLeadStart)
  const criticalLeadStart = head.indexOf(".icono-gene-lead,\n.icono-gene-lead--static-shell {")
  const criticalLeadEnd = head.indexOf("}", criticalLeadStart)

  assert.notEqual(hydratedCardStart, -1, "missing hydrated lab-label card geometry")
  assert.notEqual(criticalCardStart, -1, "missing critical lead-card geometry")
  assert.notEqual(hydratedSheetStart, -1, "missing hydrated lab-label sheet geometry")
  assert.notEqual(criticalSheetStart, -1, "missing critical lead-card sheet geometry")
  assert.notEqual(hydratedLeadStart, -1, "missing hydrated gene lead wrapper geometry")
  assert.notEqual(criticalLeadStart, -1, "missing critical gene lead wrapper geometry")

  const hydratedCardBlock = sharedCardCss.slice(hydratedCardStart, hydratedCardEnd)
  const criticalCardBlock = head.slice(criticalCardStart, criticalCardEnd)
  const hydratedSheetBlock = sharedCardCss.slice(hydratedSheetStart, hydratedSheetEnd)
  const criticalSheetBlock = head.slice(criticalSheetStart, criticalSheetEnd)
  const hydratedLeadBlock = styles.slice(hydratedLeadStart, hydratedLeadEnd)
  const criticalLeadBlock = head.slice(criticalLeadStart, criticalLeadEnd)

  for (const declaration of [
    "container-type: inline-size",
    "inline-size: min(100%, 1220px)",
    "max-inline-size: 100%",
    "aspect-ratio: 1220 / 634",
    "display: grid",
    "grid-template-columns: var(--icono-label-portrait-fr) var(--icono-label-form-fr)",
    "box-sizing: border-box",
    "overflow: hidden",
  ]) {
    assert.match(
      criticalCardBlock,
      new RegExp(declaration.replace(/[()]/g, "\\$&").replace(/\s+/g, "\\s*")),
      `critical lead-card CSS must reserve ${declaration} before hydration`,
    )
  }

  const hydratedRows = hydratedSheetBlock.match(/grid-template-rows:\s*([^;]+);/)?.[1]
  const criticalRows = criticalSheetBlock.match(/grid-template-rows:\s*([^;]+);/)?.[1]
  assert.equal(
    criticalRows,
    hydratedRows,
    "the printed lit-archival sheet rows must not change when the shared stylesheet arrives",
  )
  assert.match(hydratedCardBlock, /display:\s*grid/)
  assert.match(
    sharedCardCss,
    /\.icono-card--variant-lab-label,[\s\S]*font-family:\s*var\(--icono-label-type\),\s*monospace/,
    "lab-label card roots should not inherit Quartz Crimson Pro while card fonts load",
  )
  for (const declaration of ["width: min(100%, 800px)", "margin: 0 auto 1.75rem"]) {
    const pattern = new RegExp(declaration.replace(/[()]/g, "\\$&").replace(/\s+/g, "\\s*"))
    assert.match(
      criticalLeadBlock,
      pattern,
      `critical gene lead wrapper must reserve ${declaration}`,
    )
    assert.match(hydratedLeadBlock, pattern, `hydrated gene lead wrapper must keep ${declaration}`)
  }
})

test("website simple cards use the same symbol typography contract as blot-only cards", async () => {
  const styles = await readFile(stylesPath, "utf8")
  const symbolStart = styles.indexOf(".icono-card--brick .iconoplasm-tooltip-symbol {")
  const symbolEnd = styles.indexOf("}", symbolStart)
  const nameStart = styles.indexOf(".icono-card--brick .iconoplasm-tooltip-name {")
  const nameEnd = styles.indexOf("}", nameStart)
  assert.notEqual(symbolStart, -1, "missing website simple-card symbol style")
  assert.notEqual(nameStart, -1, "missing website simple-card name style")

  const symbolBlock = styles.slice(symbolStart, symbolEnd)
  const nameBlock = styles.slice(nameStart, nameEnd)
  assert.match(
    symbolBlock,
    /font-family:\s*"League Spartan",\s*"Bahnschrift",\s*"Arial Narrow",\s*sans-serif/,
    "website Simple card symbol should use the same face as the blot-only symbol",
  )
  assert.match(symbolBlock, /font-weight:\s*800/)
  assert.match(symbolBlock, /letter-spacing:\s*-0\.05em/)
  assert.match(symbolBlock, /line-height:\s*0\.9/)
  assert.doesNotMatch(
    symbolBlock,
    /font-family:\s*"IBM Plex Mono"/,
    "website Simple card symbol should not use mono UI typography",
  )
  assert.match(
    nameBlock,
    /font-family:\s*"Special Elite",\s*Georgia,\s*serif/,
    "website Simple card full name should keep the blot-only name face",
  )
  assert.match(nameBlock, /line-height:\s*1\.22/)
  assert.match(nameBlock, /max-inline-size:\s*20ch/)
  assert.match(nameBlock, /text-wrap:\s*pretty/)
})

test("website Simple card metadata keeps essence rows but never invents unknown companions", async () => {
  const vm = await import("node:vm")
  const runtime = await readFile(generatedSharedCardRuntimePath, "utf8")
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(runtime, sandbox)
  const shared = sandbox.IconoplasmCardShared
  assert.equal(typeof shared?.collectTooltipMetaRows, "function")

  const rows = shared.collectTooltipMetaRows({
    symbol: "ERBB2",
    essence: {
      age_years: 35,
      weight_kg: 137.9,
      skin_hex: "#423d37",
      skin_name: "Mocha Black",
      sex: "Male",
      sex_origin: ["Transmembrane"],
      aesthetics: ["Pirate"],
      aesthetics_origin: ["Protein Kinase"],
      politics: "pro-growth",
      politics_origin: ["oncogene"],
    },
  })

  assert.ok(
    rows.some((row) => row.character === "35 years old"),
    "homepage Simple cards use the mobile manifest, so age_years must render without first_publication_year",
  )
  assert.ok(
    rows.some((row) => row.character === "138 kg"),
    "homepage Simple cards use the mobile manifest, so weight_kg must render without molecular_weight_kda",
  )
  assert.ok(
    rows.some((row) => String(row.character || "").includes("Mocha Black")),
    "homepage Simple cards use the mobile manifest, so skin_name must render without primary_tissue",
  )
  assert.equal(
    rows.some((row) => String(row.molecular || "").toLowerCase() === "unknown"),
    false,
    "homepage Simple cards must not mask an incomplete fast payload with fake unknown molecular facts",
  )
})

test("website Simple account-window cards render metadata from cached card artifacts", async () => {
  const app = await readFile(appPath, "utf8")

  assert.match(
    app,
    /function readCachedRenderableGenePayload\(symbol\)[\s\S]*portraitDetailCache\[key\] \|\| geneCardArtifactCache\[key\]/,
    "complete mobile card artifacts must be renderable data, not just a separate gene-page cache",
  )

  const brickStart = app.indexOf("function buildBrickCardMarkup")
  const brickEnd = app.indexOf("function hydrateBrickPortrait", brickStart)
  assert.notEqual(brickStart, -1, "missing buildBrickCardMarkup")
  assert.notEqual(brickEnd, -1, "missing buildBrickCardMarkup boundary")
  const brickBlock = app.slice(brickStart, brickEnd)

  assert.match(
    brickBlock,
    /var detail = readCachedRenderableGenePayload\(key\)/,
    "Simple card first render must use the complete account-window card artifact instead of leaving skeleton metadata",
  )

  const hydrateStart = app.indexOf("function hydrateBrickCards(cards)")
  const hydrateEnd = app.indexOf("function buildVoteLoginPromptMarkup", hydrateStart)
  assert.notEqual(hydrateStart, -1, "missing hydrateBrickCards")
  assert.notEqual(hydrateEnd, -1, "missing hydrateBrickCards boundary")
  const hydrateBlock = app.slice(hydrateStart, hydrateEnd)

  assert.match(
    hydrateBlock,
    /var cachedPayload = readCachedRenderableGenePayload\(symbol\)[\s\S]*hydrateBrickCard\(card, cachedPayload\)/,
    "Simple card hydration must also consume cached account-window artifacts before fetching slower gene detail",
  )
})

test("extension install panel gives numbered click-by-click browser install instructions", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function buildInstallBrowserPanels(browser, faqUrl)")
  const end = app.indexOf("function currentInstallExperience()", start)
  assert.notEqual(start, -1, "missing install browser panel builder")
  assert.notEqual(end, -1, "missing install browser panel boundary")
  const panelsBlock = app.slice(start, end)

  assert.match(app, /<ol class="icono-install-steps">/)
  assert.doesNotMatch(app, /<ul class="icono-install-steps">/)
  assert.match(
    app,
    /var headerHtml = activeTab[\s\S]*\? ""[\s\S]*: '<div class="icono-install-header">/,
    "browser-tab install panels should not repeat the selected browser as a title/subtitle pair",
  )
  assert.match(panelsBlock, /Tap the button above to download the extension zip/)
  assert.match(panelsBlock, /Your browser will save it to your Downloads folder/)
  assert.match(panelsBlock, /label: "Download extension file"/)
  assert.match(panelsBlock, /extract "' \+ chromePackageName \+ '"/)
  assert.match(
    panelsBlock,
    /select the extracted "' \+[\s\S]*chromePackageBaseName[\s\S]*\+[\s\S]*'" folder/,
  )
  assert.match(panelsBlock, /click the "Developer mode" switch so it is on/)
  assert.match(panelsBlock, /Click the "Load unpacked" button/)
  assert.match(panelsBlock, /click "Select Folder"/)
  assert.doesNotMatch(panelsBlock, /label: "Source"/)
  assert.doesNotMatch(panelsBlock, /Download Chrome developer package/)
  assert.doesNotMatch(app, /github\.com\/Brinedew\/brinedew-site/)
  assert.match(panelsBlock, /Click this button to visit the Edge Add-ons page/)
  assert.match(panelsBlock, /label: "Get extension for Edge"/)
  assert.match(panelsBlock, /label: "Brave"/)
  assert.match(panelsBlock, /In Brave, click the address bar, type brave:\/\/extensions/)
  assert.match(panelsBlock, /brave:\/\/extensions/)
  assert.match(panelsBlock, /Click this button to visit the Firefox Add-ons page/)
  assert.match(panelsBlock, /label: "Get extension for Firefox"/)
  assert.doesNotMatch(panelsBlock, /label: "Safari"/)
  assert.doesNotMatch(panelsBlock, /Safari support needs a separate App Store package/)
  assert.doesNotMatch(panelsBlock, /Create a Safari Web Extension wrapper in Xcode/)
  assert.doesNotMatch(panelsBlock, /Publish the containing macOS app through App Store Connect/)
  assert.doesNotMatch(panelsBlock, /label: "Edge Add-ons"/)
  assert.doesNotMatch(panelsBlock, /label: "Firefox Add-ons"/)
  assert.match(app, /id: "brave",\s*label: "Brave",\s*selected: activeTab === "brave"/)
  assert.doesNotMatch(app, /id: "safari",\s*label: "Safari",\s*selected: activeTab === "safari"/)
  assert.doesNotMatch(app, /requested === "safari"/)
  assert.doesNotMatch(app, /browser\.family === "safari"\) return "safari"/)
})

test("home extension install surface is a gallery card after starter genes, not a detached toolbar panel", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("var appendResolvedItems = function (resolvedItems)")
  const end = app.indexOf("if (shouldUseHomeMasonry(homeLayout, cardVariant))", start)
  assert.notEqual(start, -1, "missing home page append block")
  assert.notEqual(end, -1, "missing masonry branch after append block")
  const appendBlock = app.slice(start, end)

  assert.doesNotMatch(app, /id="icono-install-panel-host"/)
  assert.match(app, /data-icono-home-install-card/)
  assert.match(
    appendBlock,
    /galleryState\.offset >= GUEST_STARTER_GENES\.length[\s\S]*appendHomeInstallCard\(auxiliaryContainer\)/,
  )
  assert.match(
    appendBlock,
    /appendHomeInstallCard\(auxiliaryContainer\)[\s\S]*appendDiscordActionCard\(auxiliaryContainer\)/,
    "install card should be inserted before the Discord action card in the starter grid flow",
  )
})

test("guest vote auth shows a page-level modal without joining artwork grids", async () => {
  const app = await readFile(appPath, "utf8")
  const popupStart = app.indexOf("function showVoteLoginPopup(")
  const popupEnd = app.indexOf("function voteBoxMarkup", popupStart)
  assert.notEqual(popupStart, -1, "missing vote auth prompt handler")
  assert.notEqual(popupEnd, -1, "missing vote auth prompt handler boundary")
  const popupBlock = app.slice(popupStart, popupEnd)

  assert.doesNotMatch(
    popupBlock,
    /window\.location\.(assign|href)|location\.assign|location\.href/,
    "guest vote clicks must not immediately redirect to Discord auth",
  )
  assert.match(
    app,
    /function buildVoteLoginPromptMarkup\(/,
    "guest vote auth should render a modal prompt",
  )
  const promptStart = app.indexOf("function buildVoteLoginPromptMarkup(")
  const promptEnd = app.indexOf("function showVoteLoginPopup", promptStart)
  assert.notEqual(promptStart, -1, "missing vote auth prompt builder")
  assert.notEqual(promptEnd, -1, "missing vote auth prompt builder boundary")
  const promptBlock = app.slice(promptStart, promptEnd)

  assert.match(
    popupBlock,
    /buildVoteLoginPromptMarkup\(/,
    "guest vote auth should render a visible prompt before exposing the Discord login CTA",
  )
  assert.match(promptBlock, /role="dialog"/, "vote login prompt should use a standard modal dialog")
  assert.match(
    promptBlock,
    /aria-modal="true"/,
    "vote login prompt should take focus out of page context",
  )
  assert.match(
    popupBlock,
    /document\.body\.appendChild\(prompt\)/,
    "vote login prompt should mount at page level",
  )
  assert.match(popupBlock, /document\.documentElement\.classList\.add\("icono-modal-locked"\)/)
  assert.doesNotMatch(
    promptBlock,
    /icono-card|icono-guest-login-card|icono-candidate-footer|<article/,
    "vote login modal must not reuse card/grid/footer classes",
  )
  assert.doesNotMatch(
    popupBlock,
    /\.closest\("\.icono-candidate-card"\)|\.closest\("\.icono-candidate-footer"\)|insertAdjacentElement|insertBefore|[^.]appendChild\(prompt\)/,
    "candidate vote prompts must not be inserted into any artwork/card context",
  )
})

test("gene pages always render the vintage lab label card regardless of gallery card style", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function buildGeneLeadCardMarkup(g)")
  const end = app.indexOf("function hydrateBrickPortrait", start)
  assert.notEqual(start, -1, "missing gene lead renderer")
  assert.notEqual(end, -1, "missing gene lead renderer boundary")
  const block = app.slice(start, end)

  assert.doesNotMatch(
    block,
    /resolveCardVariant\(/,
    "gene pages must not inherit the mutable home/gallery card style",
  )
  assert.match(
    block,
    /var cardVariant = "lit-archival"/,
    "gene pages should force the vintage lab label card",
  )
  assert.match(
    block,
    /data-icono-card-variant/,
    "gene pages should expose their fixed card variant for validation",
  )
})

test("home brick cards render the explicit settings card variant for the render pass", async () => {
  const app = await readFile(appPath, "utf8")
  const cardStart = app.indexOf("function buildBrickCardMarkup(g, cardIndex, cardVariant)")
  const cardEnd = app.indexOf("function buildGeneLeadCardMarkup(g)", cardStart)
  const gridStart = app.indexOf("function buildBrickGridMarkup(genes, startIndex, cardVariant)")
  const gridEnd = app.indexOf(
    "function renderGrid(container, genes, layout, cardVariant)",
    gridStart,
  )
  assert.notEqual(cardStart, -1, "brick card renderer must accept the render-pass card variant")
  assert.notEqual(cardEnd, -1, "missing brick card renderer boundary")
  assert.notEqual(gridStart, -1, "brick grid renderer must accept the render-pass card variant")
  assert.notEqual(gridEnd, -1, "missing brick grid renderer boundary")
  const cardBlock = app.slice(cardStart, cardEnd)
  const gridBlock = app.slice(gridStart, gridEnd)

  assert.doesNotMatch(
    cardBlock,
    /resolveCardVariant\(/,
    "individual home cards must not re-read mutable global settings during a render pass",
  )
  assert.match(
    cardBlock,
    /var resolvedCardVariant = normalizeRenderableCardVariant\(cardVariant\)/,
    "home cards should normalize the explicit variant they were given",
  )
  assert.match(
    gridBlock,
    /buildBrickCardMarkup\(genes\[i\], startIndex \+ i, resolvedCardVariant\)/,
    "the brick grid must pass one resolved card style into every card",
  )
  assert.match(
    app,
    /: buildBrickGridMarkup\(genes, 0, resolvedCardVariant\)/,
    "initial home render must pass the selected card style into brick cards",
  )
  assert.match(
    app,
    /: buildBrickGridMarkup\(genes, startIndex, resolvedCardVariant\)/,
    "incremental home append must pass the selected card style into brick cards",
  )
})

test("gene pages do not render raw sample prose as public copy", async () => {
  const app = await readFile(appPath, "utf8")
  assert.doesNotMatch(
    app,
    /g\.manifestation\s*\|\|\s*g\.description|icono-gene-manifestation/,
    "gene pages must not render internal sample/manifestation text as public prose",
  )
})

test("blot-only masonry keeps auxiliary login cards out of the artwork grid", async () => {
  const app = await readFile(appPath, "utf8")
  const css = await readFile(stylesPath, "utf8")
  const helperStart = app.indexOf("function homeAuxiliaryContainer(grid, cardVariant)")
  const helperEnd = app.indexOf("function clearHomeAuxiliaryCards()", helperStart)
  assert.notEqual(helperStart, -1, "missing image-only auxiliary container helper")
  assert.notEqual(helperEnd, -1, "missing image-only auxiliary cleanup helper")
  const helperBlock = app.slice(helperStart, helperEnd)
  assert.match(
    helperBlock,
    /isImageOnlyCardVariant\(cardVariant\)[\s\S]*document\.getElementById\("icono-home-auxiliary"\)/,
    "blot-only cards need a separate auxiliary host so login/install panels cannot become masonry items",
  )
  const appendStart = app.indexOf(
    "var auxiliaryContainer = homeAuxiliaryContainer(grid, cardVariant)",
  )
  const appendEnd = app.indexOf("if (shouldUseHomeMasonry(homeLayout, cardVariant))", appendStart)
  assert.notEqual(
    appendStart,
    -1,
    "missing auxiliary container selection before appending login cards",
  )
  const appendBlock = app.slice(appendStart, appendEnd)
  assert.match(appendBlock, /appendHomeInstallCard\(auxiliaryContainer\)/)
  assert.match(appendBlock, /appendDiscordActionCard\(auxiliaryContainer\)/)
  assert.match(
    appendBlock,
    /auxiliaryContainer === grid[\s\S]*newCards\.concat\(auxiliaryCards\)[\s\S]*: newCards/,
  )
  assert.match(app, /clearHomeAuxiliaryCards\(\)[\s\S]*destroyHomeMasonry\(\)/)
  assert.doesNotMatch(
    app,
    /hydrateBrickCards\(newCards\)\.then\(function \(\) \{[\s\S]{0,180}applyHomeMasonry\(grid,\s*newCards\)/,
    "hydration relayout must not re-append the same masonry elements or Masonry will reserve ghost slots",
  )
  assert.match(
    css,
    /\.icono-home-auxiliary[\s\S]*width:\s*min\(100%,\s*var\(--icono-image-tile-width\)\)/,
  )
})

test("installed extension card combines guest login with hover guidance", async () => {
  const app = await readFile(appPath, "utf8")
  const functionStart = app.indexOf("function currentInstallExperience()")
  assert.notEqual(functionStart, -1, "missing current install experience builder")
  const start = app.indexOf("if (iconoInstallState.installed)", functionStart)
  const end = app.indexOf("if (browser && browser.isMobile)", start)
  assert.notEqual(start, -1, "missing installed install-card branch")
  assert.notEqual(end, -1, "missing installed install-card branch boundary")
  const installedBlock = app.slice(start, end)

  assert.match(
    installedBlock,
    /title: "Want more cards\? Hover over gene names on other websites\."/,
  )
  assert.match(
    installedBlock,
    /When you are logged in, your Iconoplasm add-on will record discoveries in the archive above\./,
  )
  assert.match(installedBlock, /steps: \[\]/)
  assert.match(installedBlock, /actions: guestLoginActions/)
  assert.match(app, /label: "Log in with Discord"/)
  assert.match(app, /href: voteLoginUrl\(\)/)
  assert.doesNotMatch(installedBlock, /Iconoplasm extension already installed/)
  assert.doesNotMatch(installedBlock, /automatically record discoveries/)
  assert.doesNotMatch(installedBlock, /Hover a gene symbol on another site/)
  assert.doesNotMatch(installedBlock, /add-on settings/)
  assert.doesNotMatch(installedBlock, /blocklist words/)
  assert.doesNotMatch(installedBlock, /Already installed/)
  assert.doesNotMatch(installedBlock, /homepage stays quiet/i)
  assert.doesNotMatch(installedBlock, /blot card/i)
  assert.doesNotMatch(installedBlock, /Read FAQ/)
})

test("guest discovery login card is folded into the install panel", async () => {
  const app = await readFile(appPath, "utf8")
  const loginCardStart = app.indexOf("function buildGuestDiscoveryLoginCardMarkup()")
  const loginCardEnd = app.indexOf("function buildDiscordInviteCardMarkup()", loginCardStart)
  assert.notEqual(loginCardStart, -1, "missing guest login card builder")
  assert.notEqual(loginCardEnd, -1, "missing guest login card boundary")
  const loginCardBlock = app.slice(loginCardStart, loginCardEnd)

  assert.match(loginCardBlock, /return ""/)
  assert.doesNotMatch(app, /Log in with Discord to track discovered genes/)
  assert.doesNotMatch(loginCardBlock, /data-icono-guest-login-card/)
})

test("mobile extension install card is device-specific and does not reuse desktop sideload steps", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function buildMobileInstallExperience(browser, faqUrl)")
  const end = app.indexOf("function buildInstallBrowserPanels(browser, faqUrl)", start)
  assert.notEqual(start, -1, "missing mobile install experience builder")
  assert.notEqual(end, -1, "missing mobile install experience boundary")
  const mobileBlock = app.slice(start, end)

  assert.match(
    app,
    /if \(browser && browser\.isMobile\) \{\s*return buildMobileInstallExperience\(browser, faqUrl\)/,
  )
  assert.match(mobileBlock, /Firefox Android is the right first mobile target/)
  assert.match(mobileBlock, /There is no Safari install path today, manual or automatic/)
  assert.match(mobileBlock, /Edge Android has mobile extension support/)
  assert.doesNotMatch(mobileBlock, /chrome:\/\/extensions/)
  assert.doesNotMatch(mobileBlock, /Developer mode/)
  assert.doesNotMatch(mobileBlock, /Load unpacked/)
  assert.doesNotMatch(mobileBlock, /Download extension file/)
})

test("mobile home collection renders manifest failures as visible data failure cards", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function loadNextGalleryPage()")
  const end = app.indexOf("if (orderEl)", start)
  assert.notEqual(start, -1, "missing loadNextGalleryPage")
  assert.notEqual(end, -1, "missing loadNextGalleryPage boundary")
  const block = app.slice(start, end)

  assert.match(app, /function appendMobileDataFailureTiles\(container, failures\)/)
  assert.match(app, /icono-mobile-data-failure-card/)
  assert.match(
    block,
    /var failureTiles = appendMobileDataFailureTiles\(grid, failures\)/,
    "mobile manifest failures should become visible failure cards, not hidden console-only errors",
  )
  assert.doesNotMatch(
    block,
    /failures\.length[\s\S]{0,500}fallbackDiscoveredGene/,
    "mobile manifest failures must not be converted into fake fallback dossiers",
  )
})

test("mobile home collection always uses the lit-archival card contract", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function resolveCardVariant()")
  const end = app.indexOf("function effectiveHomeGridLayout", start)
  assert.notEqual(start, -1, "missing resolveCardVariant")
  assert.notEqual(end, -1, "missing resolveCardVariant boundary")
  const block = app.slice(start, end)

  assert.match(block, /if \(isMobileLabelReviewEnabled\(\)\) \{[\s\S]*return "lit-archival"/)
  assert.match(
    block,
    /synced desktop masonry setting cannot downgrade the mobile card contract/,
    "mobile override needs an explicit comment because desktop settings are intentionally ignored",
  )
})

test("mobile home collection refreshes card VMs from the manifest before painting", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function loadMobileCardPageVM(pageEntries)")
  const end = app.indexOf("function prewarmMobileCardPageVM(pageEntries)", start)
  assert.notEqual(start, -1, "missing loadMobileCardPageVM")
  assert.notEqual(end, -1, "missing prewarmMobileCardPageVM boundary")
  const block = app.slice(start, end)

  assert.match(app, /var MOBILE_CARD_VM_IDB_NAME = "iconoplasm-mobile-card-vms"/)
  assert.match(app, /function mobileCardCacheGetMany\(version, symbols\)/)
  assert.match(app, /function mobileCardCacheSetMany\(version, cards\)/)
  assert.match(block, /\/api\/iconoplasm\/mobile-card-manifest/)
  assert.match(block, /symbols:\s*symbols/)
  assert.match(block, /mobileCardCacheSetMany\(manifest\.snapshot_version, cards\)/)
  assert.doesNotMatch(
    block,
    /mobileCardCacheGetMany\(knownVersion, symbols\)[\s\S]*__mobileCardPageResult/,
    "a fully cached Edge profile must still ask the backend manifest for the current snapshot before painting",
  )
  assert.doesNotMatch(
    block,
    /cachedBySymbol/,
    "old-version IndexedDB rows must not fill holes in a current manifest response",
  )
  assert.match(app, /prewarmMobileCardPageVM\(\s*galleryState\.sortedDiscoveries\.slice/)
})

test("account gallery first window is discovery-fresh and does not use a stale ordered-window cache", async () => {
  const app = await readFile(appPath, "utf8")
  const loaderStart = app.indexOf("function loadNextGalleryPage()")
  assert.notEqual(loaderStart, -1, "missing loadNextGalleryPage")
  const start = app.indexOf(
    "if (accountGalleryWindowAvailable(galleryState.order, activeDiscoveryScope()))",
    loaderStart,
  )
  const end = app.indexOf("ensureCollectionReady()", start)
  assert.notEqual(start, -1, "missing account gallery window branch")
  assert.notEqual(end, -1, "missing account gallery window branch boundary")
  const block = app.slice(start, end)

  assert.doesNotMatch(app, /ACCOUNT_GALLERY_WINDOW_IDB_STORE/)
  assert.doesNotMatch(app, /function accountGalleryWindowCacheGet/)
  assert.doesNotMatch(app, /function accountGalleryWindowCacheSet/)
  assert.doesNotMatch(block, /cachedPaint/)
  assert.match(
    block,
    /Product invariant: the account shelf is discovery-fresh[\s\S]*per-user collection version/,
  )
  assert.match(block, /fetchAccountGalleryWindow\(/)
})

test("archival fallback cards clear missing portrait state during hydration", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function hydrateBrickCard(card, genePayload)")
  const end = app.indexOf("function hydrateBrickCards(cards)", start)
  assert.notEqual(start, -1, "missing hydrateBrickCard")
  assert.notEqual(end, -1, "missing hydrateBrickCard boundary")
  const block = app.slice(start, end)

  assert.match(
    block,
    /portraitShell\.classList\.remove\("iconoplasm-tooltip-portrait-missing"\)/,
    "archival hydration must remove the missing state after a real portrait arrives",
  )
  assert.match(
    block,
    /portraitShell\.classList\.add\("iconoplasm-tooltip-portrait--ready"\)/,
    "archival hydration must mark the portrait shell ready, not only inject an image",
  )
  assert.match(
    block,
    /card\.style\.setProperty\("--width", String\(dims\.width\)\)/,
    "archival hydration must replace fallback square dimensions with the real portrait width",
  )
  assert.match(
    block,
    /card\.style\.setProperty\(\s*"--icono-card-accent",\s*String\(\(genePayload && genePayload\.color\) \|\| "#888"\),\s*\)/,
    "archival hydration must restore the card accent from rich gene data",
  )
  assert.doesNotMatch(
    block,
    /geneAccentColor\(/,
    "archival hydration must not call undefined helper names that only fail in the live browser",
  )
})

test("gene route uses the shared detail cache instead of issuing raw duplicate fetches", async () => {
  const app = await readFile(appPath, "utf8")
  const head = await readFile(headPath, "utf8")
  const iconoplasmIndex = await readFile(iconoplasmIndexPath, "utf8")
  const internalWorker = await readFile(internalWorkerPath, "utf8")
  const start = app.indexOf("function renderGene(root, symbol, options)")
  const end = app.indexOf("function renderGeneContent(container, g)", start)
  assert.notEqual(start, -1, "missing renderGene")
  assert.notEqual(end, -1, "missing renderGene boundary")
  const block = app.slice(start, end)

  assert.match(block, /var renderId = \+\+activeGeneRenderId/)
  assert.match(block, /fetchGeneDetail\(symbol, opts\)/)
  assert.match(block, /if \(renderId !== activeGeneRenderId\) return/)
  assert.doesNotMatch(
    block,
    /fetchJSON\(detailPath/,
    "gene renders must not bypass the in-memory/in-flight detail cache",
  )
  assert.doesNotMatch(
    block,
    /\/api\/iconoplasm\/site\/genes\//,
    "the raw gene endpoint belongs in fetchGeneDetail, not the renderer",
  )

  assert.match(head, /geneDetailSymbol: ""/)
  assert.match(head, /geneDetailSnapshotVersion: ""/)
  assert.doesNotMatch(head, /function renderCriticalGene\(data\)/)
  assert.doesNotMatch(head, /icono-critical-gene/)
  assert.doesNotMatch(head, /data-icono-critical-gene/)
  assert.doesNotMatch(head, /function renderGeneStaticShell\(\)/)
  assert.doesNotMatch(head, /__iconoInstallGeneStaticShell/)
  // The static gene shell HTML is generated by the worker at request time
  // (personalizeIconoplasmStaticGeneShell) and inserted into the rendered
  // response, not into the raw markdown. Assert against the worker source
  // so the contract is "the worker has this HTML" not "the markdown has
  // this HTML".
  assert.match(internalWorker, /data-icono-static-gene-shell="true"/)
  assert.match(internalWorker, /icono-gene-lead-card/)
  assert.match(internalWorker, /icono-card--variant-lab-label/)
  assert.match(internalWorker, /iconoplasm-static-gene-shell:start/)
  assert.match(internalWorker, /iconoplasm-static-gene-shell:end/)
  assert.doesNotMatch(iconoplasmIndex, /root\.querySelectorAll\(&quot;/)
  assert.match(internalWorker, /function personalizeIconoplasmStaticGeneShell\(html, path\)/)
  assert.match(
    internalWorker,
    /async function iconoplasmGeneCardBootstrapInjection\(request, env, ctx, path\)/,
  )
  assert.match(internalWorker, /function insertIconoplasmGeneCardBootstrap\(html, injection\)/)
  assert.match(internalWorker, /iconoplasmStaticGeneLeadCardHtmlFromPayload/)
  assert.match(internalWorker, /replaceIconoplasmStaticGeneShell/)
  assert.match(internalWorker, /iconoplasmStaticGenePageHtmlFromPayload/)
  assert.match(internalWorker, /renderCandidateGalleryHtml\(cardPayload\)/)
  assert.match(internalWorker, /contract: "GenePageBootstrapV1"/)
  assert.match(internalWorker, /data-icono-server-rendered-gene="true"/)
  assert.match(internalWorker, /renderLabLabelCardHtml\(cardPayload/)
  assert.match(internalWorker, /function iconoplasmGeneHtmlCacheKey\(url, path, snapshotVersion\)/)
  assert.match(internalWorker, /const snapshot = String\(snapshotVersion \|\| ""\)\.trim\(\)/)
  assert.match(
    internalWorker,
    /key\.searchParams\.set\("snapshot", snapshot\)/,
    "gene HTML cache entries must be keyed by the live canonical detail asset, not only by symbol",
  )
  assert.match(
    internalWorker,
    /function iconoplasmGeneDetailShellVersion\(cardPayload, responseEtag = ""\)/,
  )
  assert.match(internalWorker, /detailResponse\.headers\.get\("ETag"\)/)
  assert.match(
    internalWorker,
    /function addIconoplasmGeneShellHeaders\(headers, path\) \{[\s\S]*const next = new Headers\(headers\)[\s\S]*if \(!String\(path \|\| ""\)\.startsWith\("\/gene\/"\)\) return next/,
    "home/root shell responses must clone upstream immutable Headers before setting Cache-Control",
  )
  assert.match(internalWorker, /HIT-GENE/)
  assert.match(internalWorker, /window\.__iconoplasmBootstrap/)
  assert.match(internalWorker, /id="iconoplasm-card-bootstrap"/)
  assert.match(internalWorker, /No-Vary-Search/)
  assert.match(internalWorker, /data-icono-startup-route="gene"/)
  assert.match(internalWorker, /data-icono-startup-route="home"/)
  assert.match(internalWorker, /iconoplasm-static-gene-shell:start/)
  assert.match(block, /classList\.remove\("icono-static-shell-only"\)/)
  assert.doesNotMatch(head, /not\(\[data-icono-startup-route="gene"\]\) \.icono-static-shell-only/)
  assert.match(head, /\^\\\\\/gene\\\\\/\(\[\^\/\?#\]\+\)/)
  assert.match(
    head,
    /"\/api\/iconoplasm\/site\/genes\/" \+[\s\S]{0,120}encodeURIComponent\(bootstrap\.geneDetailSymbol\)/,
  )
  assert.match(head, /geneCardPromise: null/)
  assert.match(head, /getElementById\("iconoplasm-card-bootstrap"\)/)
  assert.match(head, /embeddedGeneCardPayload\.symbol === bootstrap\.geneDetailSymbol/)
  assert.match(
    head,
    /\/api\/iconoplasm\/cards\/" \+ encodeURIComponent\(bootstrap\.geneDetailSymbol\)/,
  )
  assert.match(head, /var startGeneDetailFetch = function \(\)/)
  assert.match(head, /startGeneDetailFetch\(\)/)
  assert.match(
    head,
    /var isCompleteGeneDetail = function \(data\)[\s\S]*Array\.isArray\(data\.portrait_candidates\)/,
    "the head bootstrap must distinguish a complete gene detail from the lean first-paint card",
  )
  assert.match(
    head,
    /if \(isCompleteGeneDetail\(embeddedGeneCard\)\)[\s\S]*bootstrap\.geneDetailPromise = Promise\.resolve\(embeddedGeneCard\)/,
    "the complete embedded page contract should satisfy the detail promise without a second read",
  )
  assert.match(
    head,
    /var portraitSeedPromise = embeddedGeneCard[\s\S]*Promise\.resolve\(embeddedGeneCard\)[\s\S]*bootstrap\.portraitSourcePromise = portraitSeedPromise/,
    "the embedded payload may accelerate the portrait probe while older sparse HTML stays repairable",
  )
  assert.match(head, /img\.fetchPriority = "high"/)
  assert.doesNotMatch(
    internalWorker,
    /iconoplasmPortraitPreloadUrlFromCardPayload|<link rel="preload" as="image" href="\$\{escapeIconoplasmHtmlAttribute\(portraitUrl\)\}/,
    "the server cannot unconditionally preload Bunny because it cannot see the tab's failed-source decision",
  )
  assert.doesNotMatch(head, /installCriticalGeneRenderer\(\)/)
  assert.doesNotMatch(
    head,
    /Promise\.race\(\[bootstrap\.geneCriticalPromise, bootstrap\.geneDetailPromise\]\)/,
  )

  const fetchStart = app.indexOf("function fetchGeneDetail(symbol, options)")
  const fetchEnd = app.indexOf("function invalidateGeneDetail(symbol)", fetchStart)
  assert.notEqual(fetchStart, -1, "missing fetchGeneDetail")
  assert.notEqual(fetchEnd, -1, "missing fetchGeneDetail boundary")
  const fetchBlock = app.slice(fetchStart, fetchEnd)
  assert.match(fetchBlock, /isCompleteGeneDetailPayload\(portraitDetailCache\[key\], key\)/)
  assert.match(fetchBlock, /bootstrap\.geneDetailData/)
  assert.match(fetchBlock, /bootstrap\.geneDetailPromise/)
  assert.match(
    fetchBlock,
    /isCompleteGeneDetailPayload\(data, key\)[\s\S]*fetchCompleteGeneDetailFromEndpoint\(key, options\)/,
    "an older or incomplete bootstrap promise must be repaired by the complete endpoint",
  )
  assert.doesNotMatch(
    fetchBlock,
    /return fetchGeneDetail\(symbol\)/,
    "an incomplete bootstrap must not recursively rejoin its own promise",
  )
  assert.ok(
    fetchBlock.indexOf("bootstrap.geneDetailPromise") <
      fetchBlock.lastIndexOf(
        "portraitDetailPromiseCache[key] = fetchCompleteGeneDetailFromEndpoint",
      ),
    "the app must join the head-started gene detail request before issuing its own endpoint fetch",
  )
  assert.match(app, /bootstrap\.geneCardPromise/)
  assert.match(app, /function rememberGeneCardArtifact\(payload, options\)/)
  const rememberStart = app.indexOf("function rememberGeneCardArtifact(payload, options)")
  const rememberEnd = app.indexOf("function rememberGeneCardArtifacts(items)", rememberStart)
  assert.notEqual(rememberStart, -1, "missing gene card artifact cache helper")
  assert.notEqual(rememberEnd, -1, "missing gene card artifact cache helper boundary")
  const rememberBlock = app.slice(rememberStart, rememberEnd)
  assert.match(rememberBlock, /geneCardArtifactCache\[key\] = card/)
  assert.doesNotMatch(
    rememberBlock,
    /portraitDetailCache\[key\] = card/,
    "lightweight card artifacts must not poison the rich detail cache that carries candidate blots",
  )
  assert.doesNotMatch(app, /readCachedGeneCardArtifact\(resolvedSymbol\)/)
  assert.match(app, /renderLabLabelCardHtml\(genePayload/)
  assert.doesNotMatch(app, /generated\/lit-archival-card/)
  assert.doesNotMatch(app, /renderLitArchivalCardHtml\(genePayload/)
  assert.match(block, /var getRichGenePromise = function \(\)/)
  assert.doesNotMatch(
    block,
    /fetchGeneCardArtifact\(symbol\)/,
    "gene pages must not silently downgrade a failed complete-detail read to a sparse card",
  )
  assert.match(
    block,
    /getRichGenePromise\(\)[\s\S]*return richData \? \{ data: richData, source: "detail" \} : null/,
  )
  assert.doesNotMatch(block, /Promise\.race\(\[[\s\S]*richGenePromise/)
  assert.match(block, /renderGeneContent\(contentEl, g\)/)
  assert.match(block, /canAdoptServerContent/)
  assert.match(block, /wireGeneContent\(contentEl, g\)/)
  assert.match(block, /data-icono-gene-snapshot/)
  assert.doesNotMatch(block, /renderGeneResult\(\{ data: cachedGeneCard, source: "card" \}\)/)
  assert.match(block, /hasHeadStartedGene/)
  assert.match(
    block,
    /\(bootstrap\.geneDetailPromise \|\| bootstrap\.geneCardData \|\| bootstrap\.geneCardPromise\)[\s\S]*if \(!hasHeadStartedGene\) \{[\s\S]*buildBrickSkeletonCardMarkup\(\)/,
    "direct gene loads with head-started detail/card data must not wipe to a fake card or skeleton before real-card hydration",
  )
})

test("gene page visits record signed-in discovery without blocking first paint", async () => {
  const app = await readFile(appPath, "utf8")
  assert.match(app, /function recordGenePageVisitDiscovery\(symbol\)/)
  assert.match(app, /lastGenePageDiscoveryVisitKey/)
  assert.match(app, /\/api\/iconoplasm\/discoveries\/encounter/)
  assert.match(app, /source: "gene_page_visit"/)
  assert.match(app, /trigger: "gene_page_visit"/)
  assert.doesNotMatch(app, /source: "gene_page_visit"[\s\S]{0,220}dwell_ms/)

  const renderStart = app.indexOf("function renderGene(root, symbol, options)")
  const renderEnd = app.indexOf("function renderGeneContent(container, g)", renderStart)
  assert.notEqual(renderStart, -1, "missing renderGene")
  assert.notEqual(renderEnd, -1, "missing renderGene boundary")
  const renderBlock = app.slice(renderStart, renderEnd)
  assert.ok(
    renderBlock.indexOf("renderGeneContent(contentEl, g)") <
      renderBlock.indexOf("recordGenePageVisitDiscovery"),
    "discovery recording must be queued after the gene UI render, not before first paint",
  )
  assert.match(renderBlock, /recordGenePageVisitDiscovery\(g && g\.symbol \? g\.symbol : symbol\)/)
})

test("gene candidate data is present in the first response while images stay lazy", async () => {
  const app = await readFile(appPath, "utf8")
  const shared = await readFile(sharedCardPath, "utf8")
  const internalWorker = await readFile(internalWorkerPath, "utf8")
  const contentStart = app.indexOf("function renderGeneContent(container, g)")
  const contentEnd = app.indexOf("function render404(root)", contentStart)
  assert.notEqual(contentStart, -1, "missing renderGeneContent")
  assert.notEqual(contentEnd, -1, "missing renderGeneContent boundary")
  const block = app.slice(contentStart, contentEnd)
  assert.match(block, /html \+= renderCandidateGallery\(g\)/)
  assert.doesNotMatch(block, /data-icono-deferred-candidates|new IntersectionObserver/)
  assert.match(shared, /function renderCandidateGalleryHtml\(geneDetail, options\)/)
  assert.match(shared, /data-icono-public-candidates/)
  assert.match(shared, /candidate blot" loading="lazy" decoding="async" fetchpriority="low"/)
  assert.match(internalWorker, /renderCandidateGalleryHtml\(cardPayload\)/)
  assert.match(internalWorker, /data-icono-gene-snapshot=/)
})

test("shared candidate renderer emits a complete, escaped public snapshot", async () => {
  const vm = await import("node:vm")
  const runtime = await readFile(generatedSharedCardRuntimePath, "utf8")
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(runtime, sandbox)
  const shared = sandbox.IconoplasmCardShared
  assert.equal(typeof shared?.renderCandidateGalleryHtml, "function")

  const html = shared.renderCandidateGalleryHtml({
    symbol: "CD4",
    portrait_candidates: [
      {
        is_current: true,
        asset_sha256: "current",
        medium_url: "https://example.test/current.webp",
      },
      {
        asset_sha256: "candidate-a",
        candidate_image_id: 18,
        vision_id: "vision-a",
        medium_url: "https://example.test/a.webp",
        full_url: "https://example.test/a.png",
        sample_label: "A1-18",
        emulsion_id: "emulsion-1",
        width: 800,
        height: 1000,
      },
      {
        asset_sha256: "candidate-b",
        medium_url: "https://example.test/b.webp",
        sample_label: "<unsafe>",
      },
      { asset_sha256: "missing-media" },
    ],
  })

  assert.match(html, /data-icono-public-candidates/)
  assert.equal((html.match(/class="icono-candidate-card"/g) || []).length, 2)
  assert.match(html, /data-icono-candidate-vote-box="candidate-a"/)
  assert.match(html, /data-icono-candidate-image-id="18"/)
  assert.match(html, /data-icono-vision-id="vision-a"/)
  assert.match(html, /data-icono-candidate-actions-island="candidate-a"/)
  assert.match(html, /loading="lazy" decoding="async" fetchpriority="low"/)
  assert.match(html, /&lt;unsafe&gt;/)
  assert.doesNotMatch(html, /current\.webp|missing-media/)
})

test("gene route does not warm full-size portraits during first paint", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function renderGeneContent(container, g)")
  const end = app.indexOf("function render404(root)", start)
  assert.notEqual(start, -1, "missing renderGeneContent")
  assert.notEqual(end, -1, "missing renderGeneContent boundary")
  const block = app.slice(start, end)

  assert.doesNotMatch(
    block,
    /publishedPortraitUrl\(g,\s*"full"\)[\s\S]{0,240}preloadImage/,
    "non-visible full-size lightbox art must not compete with the visible medium portrait",
  )
})

test("gene candidate portraits stay out of the critical image lane", async () => {
  const app = await readFile(appPath, "utf8")
  const shared = await readFile(sharedCardPath, "utf8")
  const start = app.indexOf("function renderCandidateGallery(genePayload)")
  const end = app.indexOf("function renderGene(root, symbol, options)", start)
  assert.notEqual(start, -1, "missing renderCandidateGallery")
  assert.notEqual(end, -1, "missing renderCandidateGallery boundary")
  const block = app.slice(start, end)

  assert.match(block, /candidate blot" loading="lazy" decoding="async" fetchpriority="low/)
  assert.doesNotMatch(
    block,
    /candidate blot" loading="\s*\+\s*\(i < 2 \? "eager" : "lazy"\)/,
    "below-hero candidate images must not compete with the canonical portrait on first paint",
  )
  assert.match(shared, /candidate blot" loading="lazy" decoding="async" fetchpriority="low"/)
  assert.doesNotMatch(shared, /candidate blot" loading="eager"/)
})

test("gene request summary and image edit providers are single-flight route dependencies", async () => {
  const app = await readFile(appPath, "utf8")
  assert.match(app, /function fetchGeneRequestSummary\(symbol, options\)/)
  assert.match(app, /singleFlightQuery\("gene-request-summary:" \+ key/)
  assert.match(app, /geneRequestSummaryCache\[key\] = state/)
  assert.match(app, /function fetchImageEditProviders\(options\)/)
  // Match the key string used at app.js:1117. The call itself is on
  // the previous line; the key + op concatenation is on its own line:
  //   imageEditProvidersPromise[cacheKey] = singleFlightQuery(
  //     "image-edit-providers:" + op,
  //     function () { ... }
  //   )
  assert.match(app, /"image-edit-providers:" \+ op/)
  assert.match(app, /imageEditProvidersCache\[cacheKey\] = payload \|\| \{\}/)
  assert.match(
    app,
    /if \(previousHadUser !== !!currentUser\) \{[\s\S]{0,80}invalidateImageEditProviders\(\)/,
  )

  const requestPanelStart = app.indexOf("function wireGeneRequestPanel(container, genePayload)")
  const requestPanelEnd = app.indexOf("function renderCandidateGallery", requestPanelStart)
  assert.notEqual(requestPanelStart, -1, "missing wireGeneRequestPanel")
  assert.notEqual(requestPanelEnd, -1, "missing wireGeneRequestPanel boundary")
  const requestPanelBlock = app.slice(requestPanelStart, requestPanelEnd)
  assert.match(requestPanelBlock, /fetchGeneRequestSummary\(symbol\)/)
  assert.match(requestPanelBlock, /fetchImageEditProviders\(\{ op: "candidate_generation" \}\)/)
  assert.doesNotMatch(
    requestPanelBlock,
    /\/api\/iconoplasm\/requests\/gene\/" \+ encodeURIComponent\(symbol\) \+ "\/summary/,
    "request panel rerenders must not each create their own summary network request",
  )
  assert.doesNotMatch(
    requestPanelBlock,
    /fetchAuthedJSON\("\/api\/iconoplasm\/image-edit\/providers"/,
    "request panel rerenders must share the provider fetch",
  )
})

test("direct candidate image API panel stays compact and hides transport details", async () => {
  const app = await readFile(appPath, "utf8")
  const styles = await readFile(stylesPath, "utf8")

  assert.doesNotMatch(app, /data-icono-request-prompt-preview/)
  assert.doesNotMatch(app, /data-icono-request-payload-preview/)
  assert.doesNotMatch(app, /data-icono-request-prompt-mode/)
  assert.doesNotMatch(app, /Prompt recipe/)
  assert.doesNotMatch(app, /Request body sent to Iconoplasm/)
  assert.match(app, /function candidateGenerationSampleLabel\(\)/)
  assert.doesNotMatch(app, /Current gene prose sample/)
  assert.doesNotMatch(app, /assetSha\.slice\(0, 8\)/)
  assert.doesNotMatch(app, /sample_text_hash[\s\S]{0,160}\.slice\(0, 8\)/)
  assert.match(app, /latest_sample/)
  assert.match(app, /symbol \+ "-0"/)
  assert.match(app, /function refreshDirectGenerationSamplePreview\(\)/)
  assert.match(app, /fetchGeneDetail\(symbol, \{ forceFresh: true \}\)/)
  assert.doesNotMatch(app, /function candidateGenerationPromptRecipePreview\(\)/)
  assert.match(app, /data-icono-request-prompt-body-mode/)
  assert.match(app, /value="prose_sample" checked/)
  assert.match(app, /value="tags_sample"/)
  assert.match(app, /function selectedDirectPromptBodyMode\(\)/)
  assert.doesNotMatch(app, /uploaded image reference\(s\) only as emulsion examples/)
  assert.match(app, /request_kind:\s*"new_candidate"/)
  assert.match(app, /request_mode:\s*"novel"/)
  assert.match(app, /prompt_body_mode:\s*selectedDirectPromptBodyMode\(\)/)
  assert.doesNotMatch(app, /Not sent separately by this live API path\./)
  assert.match(
    app,
    /No saved image provider\. The free queue still works\./,
    "the disabled direct generation state should be concise",
  )
  assert.match(styles, /\.icono-request-direct-preview\s*\{/)
  assert.match(styles, /\.icono-request-segmented\s*\{/)
  assert.doesNotMatch(styles, /\.icono-request-direct-details pre\s*\{/)
  assert.match(styles, /\.icono-request-direct-publish\[hidden\]\s*\{/)
})

test("candidate upvote polls fresh rich detail before rerendering the gene page", async () => {
  const app = await readFile(appPath, "utf8")

  assert.match(
    app,
    /VOTE_PROJECTION_REFRESH_DELAYS_MS = \[600, 1200, 2000, 3200, 5000, 8000, 13000\]/,
  )
  assert.match(app, /function fetchGeneDetail\(symbol, options\)/)

  const pollStart = app.indexOf("function refreshGeneWhenCanonicalDetailMatchesVote")
  const pollEnd = app.indexOf("function refreshGeneAfterCandidateVote", pollStart)
  assert.notEqual(pollStart, -1, "missing canonical-detail polling function")
  assert.notEqual(pollEnd, -1, "missing canonical-detail polling function boundary")
  const pollBlock = app.slice(pollStart, pollEnd)
  assert.match(pollBlock, /fetchGeneDetail\(key, \{ forceFresh: true \}\)/)
  assert.match(pollBlock, /printCopyCurrentAssetSha\(genePayload\)/)
  assert.match(pollBlock, /currentAssetSha === expectedAssetSha/)
  assert.match(pollBlock, /rerenderCurrentGeneRoute\(\{ forceFresh: true \}\)/)
  assert.doesNotMatch(
    pollBlock,
    /fetchFreshGeneCardArtifact|\/api\/iconoplasm\/cards/,
    "candidate vote refresh must not wait for the KV card catalog artifact",
  )

  const candidateRefreshStart = app.indexOf("function refreshGeneAfterCandidateVote")
  const candidateRefreshEnd = app.indexOf("function wireBrickVoteBoxes", candidateRefreshStart)
  assert.notEqual(candidateRefreshStart, -1, "missing candidate-vote refresh function")
  assert.notEqual(candidateRefreshEnd, -1, "missing candidate-vote refresh boundary")
  const candidateRefreshBlock = app.slice(candidateRefreshStart, candidateRefreshEnd)
  assert.doesNotMatch(
    candidateRefreshBlock,
    /window\.setTimeout\(function \(\) \{[\s\S]*rerenderCurrentGeneRoute\(\{ forceFresh: true \}\)[\s\S]*\}, 900\)/,
    "candidate upvotes must not rely on a one-shot 900ms refresh that can miss Queue publication",
  )
  assert.match(
    candidateRefreshBlock,
    /refreshGeneWhenCanonicalDetailMatchesVote\(symbol, votedAssetSha\)/,
  )

  const candidateWireStart = app.indexOf("function wireCandidateVoteBoxes")
  const candidateWireEnd = app.indexOf("function wireCandidateRemoveButtons", candidateWireStart)
  assert.notEqual(candidateWireStart, -1, "missing candidate vote wiring")
  assert.notEqual(candidateWireEnd, -1, "missing candidate vote wiring boundary")
  const candidateWireBlock = app.slice(candidateWireStart, candidateWireEnd)
  assert.match(candidateWireBlock, /var candidateAssetSha = voteBox\.getAttribute/)
  assert.match(
    candidateWireBlock,
    /refreshGeneAfterCandidateVote\(symbol, data, state, \{ assetSha: candidateAssetSha \}\)/,
  )
})
