import { readFile } from "node:fs/promises"
import test from "node:test"
import assert from "node:assert/strict"

const appPath = new URL("./app.js", import.meta.url)
const homeOrdersPath = new URL("./home-orders.js", import.meta.url)
const stylesPath = new URL("./styles.css", import.meta.url)
const headPath = new URL("../../components/Head.tsx", import.meta.url)
const sharedCardCssPath = new URL(
  "../../../shared/iconoplasm-card/shared-card-label.css",
  import.meta.url,
)

test("public gallery default order is newly discovered genes first", async () => {
  const homeOrders = await readFile(homeOrdersPath, "utf8")
  const head = await readFile(headPath, "utf8")

  assert.match(homeOrders, /ICONOPLASM_DISCOVERY_DEFAULT_ORDER = "newest"/)
  assert.match(homeOrders, /ICONOPLASM_GALLERY_DEFAULT_ORDER = "newest"/)
  assert.match(head, /\/api\/public\/v1\/gallery\?order=newest&limit=4&offset=0/)
  assert.doesNotMatch(
    homeOrders + "\n" + head,
    /ICONOPLASM_GALLERY_DEFAULT_ORDER = "votes"/,
    "public gallery default must not silently become vote order",
  )
  assert.doesNotMatch(
    head,
    /\/api\/public\/v1\/gallery\?order=votes&limit=4&offset=0/,
    "HTML head bootstrap must match the public gallery default order",
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

  assert.match(app, /function fetchAccountGalleryWindow\(order, cursor, limit\)/)
  assert.match(app, /\/api\/iconoplasm\/account-gallery-window\?order=/)
  assert.match(firstWindowBlock, /accountGalleryWindowAvailable\(galleryState\.order\)/)
  assert.match(firstWindowBlock, /fetchAccountGalleryWindow\(/)
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

test("guest collection does not call the signed-in account window before auth resolves", async () => {
  const app = await readFile(appPath, "utf8")
  const helperStart = app.indexOf("function accountGalleryWindowAvailable(order)")
  const helperEnd = app.indexOf("function fetchAccountGalleryWindow", helperStart)
  assert.notEqual(helperStart, -1, "missing account window availability helper")
  assert.notEqual(helperEnd, -1, "missing account window availability boundary")
  const helperBlock = app.slice(helperStart, helperEnd)

  assert.match(helperBlock, /!!currentUser/)
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
  assert.match(firstWindowBlock, /accountGalleryWindowAvailable\(galleryState\.order\)/)
})

test("account collection single-flights duplicate window requests", async () => {
  const app = await readFile(appPath, "utf8")

  assert.match(app, /var iconoplasmQueryInflight = new Map\(\)/)
  assert.match(app, /function singleFlightQuery\(key, producer\)/)
  assert.match(
    app,
    /singleFlightQuery\(\s*\["account-gallery-window", resolvedOrder, resolvedCursor, resolvedLimit\]\.join\(":\"\)/,
    "account window requests need a stable same-key in-flight dedupe barrier",
  )
})

test("account collection does not immediately prefetch a second rich window", async () => {
  const app = await readFile(appPath, "utf8")
  const resetStart = app.indexOf("function resetGallery(order)")
  const resetEnd = app.indexOf("function loadNextGalleryPage()", resetStart)
  assert.notEqual(resetStart, -1, "missing resetGallery")
  assert.notEqual(resetEnd, -1, "missing loadNextGalleryPage")
  const resetBlock = app.slice(resetStart, resetEnd)

  assert.match(resetBlock, /currentAccountGalleryWindowLimit\(\)/)
  assert.doesNotMatch(
    resetBlock,
    /currentGalleryLimit\(\) \+ 48/,
    "account-window first load must not schedule a hidden 48-card prefetch burst",
  )
  assert.match(app, /function currentAccountGalleryWindowLimit\(\)/)
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

test("image-only masonry has a physical artboard cap and adaptive columns", async () => {
  const styles = await readFile(stylesPath, "utf8")
  const sharedCardCss = await readFile(sharedCardCssPath, "utf8")
  const app = await readFile(appPath, "utf8")

  assert.match(styles, /--icono-image-tile-width:\s*384px/)
  assert.match(styles, /--icono-image-tile-gutter:\s*16px/)
  assert.match(
    styles,
    /\.icono-grid\[data-layout="image-only-masonry"\]\s+\.icono-grid-sizer[\s\S]*width:\s*min\(100%,\s*var\(--icono-image-tile-width\)\)/,
  )
  assert.match(
    styles,
    /\.icono-grid\[data-layout="image-only-masonry"\]\s+\.icono-card--image-tile[\s\S]*width:\s*min\(100%,\s*var\(--icono-image-tile-width\)\)/,
  )
  assert.match(
    styles,
    /@media \(max-width:\s*600px\)[\s\S]*\.icono-grid\[data-layout="image-only-masonry"\]\s+\.icono-gutter-sizer[\s\S]*width:\s*0/,
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

  const skeletonStart = app.indexOf("function buildImageOnlySkeletonCardMarkup(index)")
  const skeletonEnd = app.indexOf("function buildHomeSkeletonGridMarkup", skeletonStart)
  assert.notEqual(skeletonStart, -1, "missing image-only skeleton renderer")
  assert.notEqual(skeletonEnd, -1, "missing image-only skeleton renderer boundary")
  const skeletonBlock = app.slice(skeletonStart, skeletonEnd)
  assert.match(skeletonBlock, /icono-card--image-tile/)
  assert.match(skeletonBlock, /icono-card--variant-image-only/)
  assert.match(
    skeletonBlock,
    /--width:384;--height:512/,
    "blot-only masonry skeletons must reserve the same physical artboard geometry as final cards",
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
  assert.match(panelsBlock, /Click this button to download the extension file/)
  assert.match(panelsBlock, /label: "Download extension file"/)
  assert.match(panelsBlock, /extract "iconoplasm-extension-v0\.4\.2\.zip"/)
  assert.match(panelsBlock, /select the extracted "iconoplasm-extension-v0\.4\.2" folder/)
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
  assert.match(panelsBlock, /label: "Safari"/)
  assert.match(panelsBlock, /Safari support needs a separate App Store package/)
  assert.match(panelsBlock, /Create a Safari Web Extension wrapper in Xcode/)
  assert.match(panelsBlock, /Publish the containing macOS app through App Store Connect/)
  assert.doesNotMatch(panelsBlock, /label: "Edge Add-ons"/)
  assert.doesNotMatch(panelsBlock, /label: "Firefox Add-ons"/)
  assert.match(app, /id: "brave",\s*label: "Brave",\s*selected: activeTab === "brave"/)
  assert.match(app, /id: "safari",\s*label: "Safari",\s*selected: activeTab === "safari"/)
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
  assert.match(appendBlock, /galleryState\.offset >= GUEST_STARTER_GENES\.length[\s\S]*appendHomeInstallCard\(auxiliaryContainer\)/)
  assert.match(
    appendBlock,
    /appendHomeInstallCard\(auxiliaryContainer\)[\s\S]*appendDiscordActionCard\(auxiliaryContainer\)/,
    "install card should be inserted before the Discord action card in the starter grid flow",
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
  const appendStart = app.indexOf("var auxiliaryContainer = homeAuxiliaryContainer(grid, cardVariant)")
  const appendEnd = app.indexOf("if (shouldUseHomeMasonry(homeLayout, cardVariant))", appendStart)
  assert.notEqual(appendStart, -1, "missing auxiliary container selection before appending login cards")
  const appendBlock = app.slice(appendStart, appendEnd)
  assert.match(appendBlock, /appendHomeInstallCard\(auxiliaryContainer\)/)
  assert.match(appendBlock, /appendDiscordActionCard\(auxiliaryContainer\)/)
  assert.match(appendBlock, /auxiliaryContainer === grid[\s\S]*newCards\.concat\(auxiliaryCards\)[\s\S]*: newCards/)
  assert.match(app, /clearHomeAuxiliaryCards\(\)[\s\S]*destroyHomeMasonry\(\)/)
  assert.doesNotMatch(
    app,
    /hydrateBrickCards\(newCards\)\.then\(function \(\) \{[\s\S]{0,180}applyHomeMasonry\(grid,\s*newCards\)/,
    "hydration relayout must not re-append the same masonry elements or Masonry will reserve ghost slots",
  )
  assert.match(css, /\.icono-home-auxiliary[\s\S]*width:\s*min\(100%,\s*var\(--icono-image-tile-width\)\)/)
})

test("installed extension card uses concise add-on settings copy", async () => {
  const app = await readFile(appPath, "utf8")
  const functionStart = app.indexOf("function currentInstallExperience()")
  assert.notEqual(functionStart, -1, "missing current install experience builder")
  const start = app.indexOf("if (iconoInstallState.installed)", functionStart)
  const end = app.indexOf("if (browser && browser.isMobile)", start)
  assert.notEqual(start, -1, "missing installed install-card branch")
  assert.notEqual(end, -1, "missing installed install-card branch boundary")
  const installedBlock = app.slice(start, end)

  assert.match(installedBlock, /title: "Iconoplasm extension already installed\."/)
  assert.match(
    installedBlock,
    /Hover a gene symbol on another site to open the gene card\. Use the add-on settings to change styling or blocklist words\./,
  )
  assert.doesNotMatch(installedBlock, /Already installed/)
  assert.doesNotMatch(installedBlock, /homepage stays quiet/i)
  assert.doesNotMatch(installedBlock, /blot card/i)
  assert.doesNotMatch(installedBlock, /Read FAQ/)
})

test("mobile extension install card is device-specific and does not reuse desktop sideload steps", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function buildMobileInstallExperience(browser, faqUrl)")
  const end = app.indexOf("function buildInstallBrowserPanels(browser, faqUrl)", start)
  assert.notEqual(start, -1, "missing mobile install experience builder")
  assert.notEqual(end, -1, "missing mobile install experience boundary")
  const mobileBlock = app.slice(start, end)

  assert.match(app, /if \(browser && browser\.isMobile\) \{\s*return buildMobileInstallExperience\(browser, faqUrl\)/)
  assert.match(mobileBlock, /Firefox Android is the right first mobile target/)
  assert.match(mobileBlock, /Safari mobile extensions ship through an App Store app/)
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

test("mobile home collection caches card VMs in IndexedDB and prewarms the next page", async () => {
  const app = await readFile(appPath, "utf8")
  const start = app.indexOf("function loadMobileCardPageVM(pageEntries)")
  const end = app.indexOf("function prewarmMobileCardPageVM(pageEntries)", start)
  assert.notEqual(start, -1, "missing loadMobileCardPageVM")
  assert.notEqual(end, -1, "missing prewarmMobileCardPageVM boundary")
  const block = app.slice(start, end)

  assert.match(app, /var MOBILE_CARD_VM_IDB_NAME = "iconoplasm-mobile-card-vms"/)
  assert.match(app, /function mobileCardCacheGetMany\(version, symbols\)/)
  assert.match(app, /function mobileCardCacheSetMany\(version, cards\)/)
  assert.match(block, /mobileCardCacheGetMany\(knownVersion, symbols\)/)
  assert.match(block, /mobileCardCacheSetMany\(manifest\.snapshot_version, cards\)/)
  assert.match(app, /prewarmMobileCardPageVM\(\s*galleryState\.sortedDiscoveries\.slice/)
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
