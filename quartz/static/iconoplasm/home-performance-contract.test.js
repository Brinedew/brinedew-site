import { readFile } from "node:fs/promises"
import test from "node:test"
import assert from "node:assert/strict"

const appPath = new URL("./app.js", import.meta.url)
const homeOrdersPath = new URL("./home-orders.js", import.meta.url)
const headPath = new URL("../../components/Head.tsx", import.meta.url)

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
    /if \(homeLayout === "masonry"\) \{\s*var immediateItems = pageEntries\.map\(function \(entry\) \{\s*return fallbackDiscoveredGene\(entry\)/,
    "desktop masonry may create immediate discovery-row cards while rich gene details hydrate afterward",
  )
  assert.match(
    block,
    /void hydrateBrickCards\(newCards\)/,
    "rich card detail should still hydrate after first paint",
  )
  assert.match(
    block,
    /if \(homeLayout === "masonry"\)[\s\S]*void hydrateBrickCards\(newCards\)/,
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
    /if \(homeLayout === "masonry"\)[\s\S]*fallbackDiscoveredGene\(entry\)[\s\S]*\} else \{\s*return loadMobileCardPageVM\(pageEntries\)/,
    "mobile/non-masonry infocards must be built from the strict mobile card manifest, not partial discovery fallback records",
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
  assert.match(panelsBlock, /Click this button to visit the Firefox Add-ons page/)
  assert.match(panelsBlock, /label: "Get extension for Firefox"/)
  assert.doesNotMatch(panelsBlock, /label: "Edge Add-ons"/)
  assert.doesNotMatch(panelsBlock, /label: "Firefox Add-ons"/)
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
