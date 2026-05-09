import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

function readUtf8(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8")
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

const requiredContentModules = [
  "content-api.js",
  "content-settings.js",
  "content-matcher.js",
  "content-scanner.js",
  "content-tooltip.js",
  "content-portrait-cache.js",
  "content-detail-cache.js",
  "content-vote-bridge.js",
  "content-visibility-scheduler.js",
  "highlight-runtime.js",
]

test("DO NOT DELETE: extension content modules load before the content adapter", () => {
  const manifest = JSON.parse(readUtf8("./iconoplasm-extension/manifest.json"))
  const contentScript = manifest.content_scripts.find(
    (entry) => Array.isArray(entry.js) && entry.js.includes("content.js"),
  )
  assert.ok(contentScript, "manifest should contain the main content script entry")
  const jsFiles = contentScript.js
  const adapterIndex = jsFiles.indexOf("content.js")
  assert.ok(adapterIndex > 0, "content.js should load after its dependency modules")

  for (const moduleName of requiredContentModules) {
    const moduleIndex = jsFiles.indexOf(moduleName)
    assert.notEqual(moduleIndex, -1, `${moduleName} should be listed in manifest content scripts`)
    assert.ok(
      moduleIndex < adapterIndex,
      `${moduleName} should load before content.js so content.js stays a page adapter`,
    )
  }
})

test("DO NOT DELETE: rough ellipse highlights do not repaint when geometry is unchanged", () => {
  const source = readUtf8("./iconoplasm-extension/highlight-runtime.js")

  assert.match(
    source,
    /function highlightSceneRenderKey\(mode, scene, context\)/,
    "highlight-runtime should compute a stable render key from visual inputs",
  )
  assert.match(
    source,
    /if \(sceneLayer\.dataset\.iconoRenderKey === renderKey\) return/,
    "existing rough ellipse geometry should survive unrelated mutation rescans",
  )
  assert.match(
    source,
    /sceneLayer\.dataset\.iconoRenderKey = renderKey[\s\S]*sceneLayer\.replaceChildren\(\)/,
    "the renderer should only clear and redraw the paint layer after the visual key changes",
  )
  assert.match(
    source,
    /activeRenderer\.substrate !== "anchored-scene"[\s\S]*sceneLayer\.replaceChildren\(\)/,
    "switching back to non-scene highlight modes should still clear old ellipse or pill paint",
  )
})

test("DO NOT DELETE: extension package script ships the content modules", () => {
  const packageScript = readUtf8("./scripts/package-iconoplasm-extension.mjs")
  const contentIndex = packageScript.indexOf('"content.js"')
  assert.ok(contentIndex > 0, "package script should ship content.js")

  for (const moduleName of requiredContentModules.filter(
    (name) => name !== "highlight-runtime.js",
  )) {
    const pattern = new RegExp(`"${escapeRegExp(moduleName)}"`)
    assert.match(packageScript, pattern, `${moduleName} should be copied into extension packages`)
    assert.ok(
      packageScript.indexOf(`"${moduleName}"`) < contentIndex,
      `${moduleName} should be staged before content.js in the runtime file list`,
    )
  }
})

test("DO NOT DELETE: Firefox release packaging is a first-class path", () => {
  const packageJson = JSON.parse(readUtf8("./package.json"))
  assert.equal(
    packageJson.scripts["package:iconoplasm-firefox"],
    "node ./scripts/package-iconoplasm-extension.mjs --target=firefox",
    "Firefox packaging should not depend on fragile npm argument forwarding",
  )

  const sourcePackageScript = readUtf8("./scripts/package-iconoplasm-firefox-source.mjs")
  for (const moduleName of requiredContentModules) {
    assert.match(
      sourcePackageScript,
      new RegExp(`"iconoplasm-extension/${escapeRegExp(moduleName)}"`),
      `${moduleName} should be included in the AMO source package`,
    )
  }
})

test("DO NOT DELETE: Chromium and Edge packages keep the MV3 service worker shape", () => {
  const manifest = JSON.parse(readUtf8("./iconoplasm-extension/manifest.json"))
  assert.equal(manifest.background.service_worker, "service-worker.js")
  assert.equal(manifest.background.scripts, undefined)
})

test("DO NOT DELETE: extension version bumps have explicit npm entrypoints", () => {
  const packageJson = JSON.parse(readUtf8("./package.json"))
  assert.equal(
    packageJson.scripts["version:iconoplasm-extension:patch"],
    "node ./scripts/bump-iconoplasm-extension-version.mjs --patch",
  )
  assert.match(readUtf8("./scripts/bump-iconoplasm-extension-version.mjs"), /--set=/)
})

test("DO NOT DELETE: content.js delegates split responsibilities to extension modules", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")
  const requiredGlobals = [
    "IconoplasmContentApi",
    "IconoplasmContentSettings",
    "IconoplasmContentScanner",
    "IconoplasmContentTooltip",
    "IconoplasmContentPortraitCache",
    "IconoplasmContentDetailCache",
    "IconoplasmContentVoteBridge",
  ]
  for (const globalName of requiredGlobals) {
    assert.match(source, new RegExp(globalName), `content.js should depend on ${globalName}`)
  }

  const forbiddenInlineBoundaries = [
    /function extensionApiFetch\(/,
    /function buildVoteIconSvg\(/,
    /function createVoteBoxNode\(/,
    /function processTextNode\(/,
    /const portraitDataUrlPromiseCache = new Map\(/,
    /const geneDetailPromiseCache = new Map\(/,
    /const geneDetailWarmQueue = \[\]/,
  ]
  for (const pattern of forbiddenInlineBoundaries) {
    assert.doesNotMatch(
      source,
      pattern,
      `${pattern} means a split extension responsibility drifted back into content.js`,
    )
  }
})

test("DO NOT DELETE: simple card batch request includes fields consumed by its metadata rows", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")
  const fieldsMatch = source.match(/const GENE_DETAIL_BATCH_FIELDS = Object\.freeze\(\[([\s\S]*?)\]\)/)
  assert.ok(fieldsMatch, "content.js should define the projected batch fields for hover details")
  const fields = [...fieldsMatch[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])

  for (const field of [
    "essence",
    "first_publication_year",
    "molecular_weight_kda",
    "primary_tissue",
    "portrait",
  ]) {
    assert.ok(
      fields.includes(field),
      `${field} should be requested because the simple card metadata renderer consumes it`,
    )
  }
})

test("DO NOT DELETE: simple card metadata renders mass, age, and tissue when projected fields exist", async () => {
  const vm = await import("node:vm")
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(readUtf8("./iconoplasm-extension/generated/shared-card-runtime.js"), sandbox)
  const shared = sandbox.IconoplasmCardShared
  assert.equal(typeof shared?.collectTooltipMetaRows, "function")

  const rows = shared.collectTooltipMetaRows({
    symbol: "TP53",
    first_publication_year: 1979,
    molecular_weight_kda: 43.7,
    primary_tissue: "bone marrow",
    essence: {
      age_years: 47,
      weight_kg: 68,
      skin_name: "pale rose",
    },
  })

  assert.ok(
    rows.some((row) => row.character === "68 kg" && row.molecular === "44 kDa"),
    "mass row should survive the simple metadata projection",
  )
  assert.ok(
    rows.some((row) => row.character === "47 years old" && row.molecular === "discovered in 1979"),
    "age row should survive the simple metadata projection",
  )
  assert.ok(
    rows.some((row) => row.molecular === "bone marrow"),
    "skin/tissue row should survive the simple metadata projection",
  )
})

test("DO NOT DELETE: split content modules expose stable globals", () => {
  const moduleGlobals = new Map([
    ["content-api.js", "IconoplasmContentApi"],
    ["content-settings.js", "IconoplasmContentSettings"],
    ["content-scanner.js", "IconoplasmContentScanner"],
    ["content-tooltip.js", "IconoplasmContentTooltip"],
    ["content-portrait-cache.js", "IconoplasmContentPortraitCache"],
    ["content-detail-cache.js", "IconoplasmContentDetailCache"],
    ["content-vote-bridge.js", "IconoplasmContentVoteBridge"],
  ])

  for (const [filename, globalName] of moduleGlobals) {
    const source = readUtf8(`./iconoplasm-extension/${filename}`)
    assert.match(
      source,
      new RegExp(`root\\.${globalName}\\s*=`),
      `${filename} should publish ${globalName} for manifest-ordered content script loading`,
    )
  }
})

test("DO NOT DELETE: custom entries promoted into defaults behave like defaults", async () => {
  const vm = await import("node:vm")
  const sandbox = {}
  sandbox.globalThis = sandbox
  vm.runInNewContext(readUtf8("./iconoplasm-extension/content-settings.js"), sandbox)
  const settings = sandbox.IconoplasmContentSettings
  assert.equal(typeof settings?.buildEffectiveBlocklist, "function")

  assert.deepEqual(
    [...settings.buildEffectiveBlocklist(["GPT"], ["GPT"], [])],
    ["GPT"],
    "a stale custom GPT should collapse into the shipped default GPT",
  )
  assert.deepEqual(
    [...settings.buildEffectiveBlocklist(["GPT"], ["GPT"], ["GPT"])],
    [],
    "removing the default GPT should not be defeated by the stale custom GPT entry",
  )
})

test("DO NOT DELETE: default blocklist keeps alias-only pruning outcome", () => {
  const source = readUtf8("./iconoplasm-extension/blocklist-defaults.js")
  const defaults = [...source.matchAll(/"([A-Z0-9-]+)"/g)].map((match) => match[1])
  const defaultSet = new Set(defaults)

  assert.equal(defaults.length, 73, "default blocklist should stay at the alias-only pruned size")
  for (const term of ["FLOWER", "JERKY"]) {
    assert.ok(defaultSet.has(term), `${term} should be kept because it is an alias-only term`)
  }
  for (const term of [
    "ACE",
    "ACHE",
    "ARC",
    "BAD",
    "CAMP",
    "CAST",
    "CAT",
    "CHAT",
    "COIL",
    "COPE",
    "GALE",
    "KIT",
    "MALL",
    "MET",
    "OAT",
    "PALM",
    "POLL",
    "RAN",
    "REST",
    "SELL",
    "SET",
    "SHE",
    "SKI",
    "SON",
    "STAR",
    "TANK",
    "TUB",
    "WAS",
  ]) {
    assert.ok(!defaultSet.has(term), `${term} should not be default-blocked as a main symbol`)
  }
})

test("DO NOT DELETE: simple card title uses stable label typography and ink", () => {
  const contentCss = readUtf8("./iconoplasm-extension/content.css")

  assert.match(
    contentCss,
    /\.iconoplasm-tooltip-symbol\s*\{[\s\S]*font-family:\s*"League Spartan"/,
    "simple card symbol should use the same face as the blot-only symbol",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip-symbol\s*\{[\s\S]*letter-spacing:\s*-0\.05em/,
    "simple card symbol should use the blot-only symbol tracking, not lab-label tracking",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip-symbol\s*\{[\s\S]*line-height:\s*0\.9/,
    "simple card symbol should use the blot-only symbol line height",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip-symbol\s*\{[\s\S]*color:\s*var\(--iconoplasm-tooltip-ink\)/,
    "simple card symbol should stay stable ink instead of inheriting each gene accent color",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip-name\s*\{[\s\S]*font-family:\s*"Special Elite"/,
    "simple card subtitle should use the same face as the blot-only full name",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip-name\s*\{[\s\S]*line-height:\s*1\.22/,
    "simple card subtitle should use the blot-only full-name line height",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip-name\s*\{[\s\S]*max-inline-size:\s*20ch/,
    "simple card subtitle should keep the blot-only full-name measure",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip-name\s*\{[\s\S]*text-wrap:\s*pretty/,
    "simple card subtitle should keep the blot-only full-name wrapping behavior",
  )
  assert.doesNotMatch(
    contentCss,
    /\.iconoplasm-tooltip-symbol\s*\{[\s\S]*--iconoplasm-gene-color/,
    "simple card title should not mix in per-gene colors",
  )
})

test("DO NOT DELETE: simple card portrait warmup decodes hover-neighbor images", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")
  assert.match(
    source,
    /const decodedPortraitSrcCache = new Set\(\)/,
    "content.js should keep a decoded portrait cache, not only a data-url byte cache",
  )
  assert.match(
    source,
    /function decodePortraitSrc\(src\)[\s\S]*new Image\(\)[\s\S]*img\.decode/,
    "simple hover portraits should be decoded before the card switches to them",
  )
  assert.match(
    source,
    /function onPortraitWarmBatch\(usableSources\)[\s\S]*prewarmLitArchivalFramePortraitSrcs\(usableSources\)[\s\S]*warmDecodedPortraitSources\(usableSources\)/,
    "neighbor portrait warming should serve both the frame renderer and the simple-card renderer",
  )
})

test("DO NOT DELETE: blot-only frame waits for portrait decode before first paint", () => {
  const frameSource = readUtf8("./iconoplasm-extension/lit-archival-frame.js")
  assert.match(
    frameSource,
    /let renderSerial = 0/,
    "frame rendering should fence async first-paint decode work against stale hover payloads",
  )
  assert.match(
    frameSource,
    /const portraitSrc = String\(\(payload && payload\.portraitSrc\) \|\| ""\)\.trim\(\)[\s\S]*await prewarmPortraitSource\(portraitSrc\)/,
    "blot-only should not replace the frame contents until the first portrait source has decoded",
  )
  assert.match(
    frameSource,
    /if \(serial !== renderSerial\) return[\s\S]*replaceTrustedChildren/,
    "a slow first decode should not overwrite a newer neighbor hover card",
  )
})

test("DO NOT DELETE: frame portrait prewarm queues until the iframe is ready", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")
  assert.match(
    source,
    /iframe\.__iconoPendingPrewarmSources \|\| new Set\(\)/,
    "neighbor blot prewarm should not be dropped when it races the first iframe ready event",
  )
  assert.match(
    source,
    /iframe\.__iconoPendingPrewarmSources && iframe\.__iconoPendingPrewarmSources\.size[\s\S]*prewarmLitArchivalFramePortraitSrcs\(pendingSources\)/,
    "queued neighbor prewarms should flush as soon as the frame is ready",
  )
})

test("DO NOT DELETE: first tooltip creation applies frame-card classes after assignment", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")
  assert.match(
    source,
    /tooltip = IconoContentTooltip\.createTooltipShell\([\s\S]*?\)\s*\n\s*\/\/ createTooltipShell invokes the callback before this module's tooltip variable is assigned\.[\s\S]*?applyTooltipTheme\(\)/,
    "the first hover should not miss image-only/frame-card classes until a later settings change",
  )
})

test("DO NOT DELETE: hover tooltip placement compares viewport space above and below", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")
  assert.match(
    source,
    /function chooseTooltipViewportPosition\(rect, tooltipWidth, tooltipHeight\)/,
    "tooltip placement should live in one auditable placement helper",
  )
  assert.match(
    source,
    /const availableAbove = Math\.max\(0, rect\.top - TOOLTIP_VIEWPORT_MARGIN_PX\)/,
    "placement should measure available space above the hovered symbol",
  )
  assert.match(
    source,
    /const availableBelow = Math\.max\([\s\S]*window\.innerHeight - rect\.bottom - TOOLTIP_VIEWPORT_MARGIN_PX/,
    "placement should measure available space below the hovered symbol",
  )
  assert.match(
    source,
    /tooltip\.dataset\.placement = tooltipPosition\.showBelow \? "below" : "above"/,
    "placement should expose the chosen side for visual regression checks",
  )
  assert.doesNotMatch(
    source,
    /const showBelow = rect\.top < tooltipHeight \+ 16/,
    "the old one-sided rule reopened downward even when downward overflowed",
  )
})

test("DO NOT DELETE: highlight timing setting is wired through popup, shared settings, and content script", () => {
  const settingsSource = readUtf8("./iconoplasm-extension/content-settings.js")
  const popupHtml = readUtf8("./iconoplasm-extension/popup.html")
  const popupSource = readUtf8("./iconoplasm-extension/popup.js")
  const contentSource = readUtf8("./iconoplasm-extension/content.js")
  const contentCss = readUtf8("./iconoplasm-extension/content.css")

  assert.match(
    settingsSource,
    /highlightVisibility:\s*"iconoplasm_highlight_visibility"/,
    "content-settings.js should publish one shared storage key for highlight timing",
  )
  assert.match(
    popupHtml,
    /id="highlight-visibility"[\s\S]*name="highlight-visibility" value="always"[\s\S]*name="highlight-visibility" value="hover"/,
    "popup.html should expose both Always on and On hover choices in one highlight timing radiogroup",
  )
  assert.match(
    popupSource,
    /const HIGHLIGHT_VISIBILITY_KEY = "iconoplasm_highlight_visibility"/,
    "popup.js should write the shared highlight timing storage key",
  )
  assert.match(
    popupSource,
    /bindRadioGroup\("highlight-visibility", normalizeHighlightVisibility, HIGHLIGHT_VISIBILITY_KEY\)/,
    "popup.js should bind highlight timing changes to chrome.storage like the other appearance controls",
  )
  assert.match(
    contentSource,
    /const HIGHLIGHT_VISIBILITY_KEY = CONTENT_STORAGE_KEYS\.highlightVisibility/,
    "content.js should consume the shared settings key instead of inventing a second one",
  )
  assert.match(
    contentSource,
    /function normalizeHighlightVisibility\(raw\)[\s\S]*\? "hover"[\s\S]*: "always"/,
    "content.js should normalize unknown values back to always-on highlighting",
  )
  assert.match(
    contentSource,
    /document\.body\.classList\.toggle\([\s\S]*"iconoplasm-highlight-on-hover"[\s\S]*highlightVisibility === "hover"/,
    "content.js should express the current timing mode as a body class for CSS to render cheaply",
  )
  assert.match(
    contentSource,
    /changes\[HIGHLIGHT_VISIBILITY_KEY\][\s\S]*applyHighlightVisibility\(\)/,
    "content.js should react live when the popup changes highlight timing",
  )
  assert.match(
    contentCss,
    /body\.iconoplasm-highlight-on-hover \.iconoplasm-gene:not\(:hover\)[\s\S]*background-size:\s*0 0;/,
    "hover mode should suppress underline paint while the gene is not hovered",
  )
  assert.match(
    contentCss,
    /body\.iconoplasm-highlight-on-hover \.iconoplasm-gene:not\(:hover\) \.iconoplasm-gene-paint-layer[\s\S]*opacity:\s*0;/,
    "hover mode should suppress local paint-layer highlights while the gene is not hovered",
  )
})

test("DO NOT DELETE: blocklist changes live-unhighlight already wrapped page text", () => {
  const settingsSource = readUtf8("./iconoplasm-extension/content-settings.js")
  const popupSource = readUtf8("./iconoplasm-extension/popup.js")
  const contentSource = readUtf8("./iconoplasm-extension/content.js")

  assert.match(
    settingsSource,
    /userBlocklist:\s*"iconoplasm_user_blocklist"/,
    "content-settings.js should publish the shared user blocklist storage key",
  )
  assert.match(
    popupSource,
    /await chrome\.storage\.local\.set\(\{ \[USER_BLOCKLIST_KEY\]: list \}\)/,
    "popup.js should persist blocklist edits through chrome.storage so content tabs receive onChanged",
  )
  assert.match(
    contentSource,
    /function unwrapBlockedGeneHighlights\(blocklist\)[\s\S]*querySelectorAll\("\.iconoplasm-gene"\)[\s\S]*unwrapGeneElement\(el\)/,
    "content.js should remove existing highlights for symbols that become blocklisted",
  )
  assert.match(
    contentSource,
    /changes\[USER_BLOCKLIST_KEY\] \|\| changes\[REMOVED_DEFAULTS_KEY\][\s\S]*refreshBlocklistFromStorage\(\)/,
    "content.js should react live to blocklist storage changes instead of waiting for a reload",
  )
  assert.match(
    contentSource,
    /rebuildGeneMatcher\(nextBlocklist\)[\s\S]*unwrapBlockedGeneHighlights\(nextBlocklist\)/,
    "content.js should rebuild the matcher before rescanning so blocked words are not immediately rewrapped",
  )
})

test("DO NOT DELETE: user-facing card style copy calls the blot-only card a blot, not an image", () => {
  const popupHtml = readUtf8("./iconoplasm-extension/popup.html")
  const siteSettings = readUtf8("./quartz/static/site-settings/app.js")
  const storeListingCopy = readUtf8("./iconoplasm-extension/store-assets/STORE-LISTING-COPY.md")

  assert.match(
    popupHtml,
    /name="card-variant" value="image-only"[\s\S]*>Blot only</,
    "popup.html should keep the stored image-only enum but show users the Blot only label",
  )
  assert.doesNotMatch(
    popupHtml,
    />Image only</,
    "the extension popup should not expose the old Image only label",
  )
  assert.match(
    siteSettings,
    /\{ value: "image-only", label: "Blot only" \}/,
    "site settings should show Blot only for the same stored card variant",
  )
  assert.match(
    storeListingCopy,
    /blot-only portrait/,
    "store listing copy should describe the card style as blot-only",
  )
})

test("DO NOT DELETE: extension popup no longer exposes the broken tooltip theme switch", () => {
  const popupHtml = readUtf8("./iconoplasm-extension/popup.html")
  const popupSource = readUtf8("./iconoplasm-extension/popup.js")
  const contentSource = readUtf8("./iconoplasm-extension/content.js")
  const settingsSource = readUtf8("./iconoplasm-extension/content-settings.js")
  const frameSource = readUtf8("./iconoplasm-extension/lit-archival-frame.js")

  assert.doesNotMatch(
    popupHtml,
    /Tooltip theme|name="tooltip-theme"|value="dark"|>Dark</,
    "popup.html should not expose the inconsistent light/dark tooltip switch",
  )
  assert.doesNotMatch(
    popupSource,
    /TOOLTIP_THEME|tooltip-theme|normalizeTooltipTheme|iconoplasm_tooltip_theme/,
    "popup.js should not read or write the removed tooltip theme setting",
  )
  assert.doesNotMatch(
    settingsSource,
    /tooltipTheme|normalizeTooltipTheme|iconoplasm_tooltip_theme/,
    "content-settings.js should not publish the removed tooltip theme setting",
  )
  assert.doesNotMatch(
    contentSource,
    /TOOLTIP_THEME|tooltipTheme|normalizeTooltipTheme|loadTooltipTheme|iconoplasm_tooltip_theme/,
    "content.js should ignore old stored theme values and default tooltips to light",
  )
  assert.match(
    contentSource,
    /tooltip\.classList\.remove\("iconoplasm-tooltip--dark"\)[\s\S]*tooltip\.classList\.add\("iconoplasm-tooltip--light"\)/,
    "content.js should actively force the native tooltip back to light",
  )
  assert.match(
    frameSource,
    /const resolvedTheme = "light"/,
    "lit-archival-frame.js should ignore incoming theme payloads and force light",
  )
  assert.doesNotMatch(
    frameSource,
    /theme === "dark"/,
    "lit-archival-frame.js should not branch on dark theme anymore",
  )
})

test("DO NOT DELETE: new-user extension defaults stay pill, always-on, and blot-only", () => {
  const popupHtml = readUtf8("./iconoplasm-extension/popup.html")
  const popupSource = readUtf8("./iconoplasm-extension/popup.js")
  const contentSource = readUtf8("./iconoplasm-extension/content.js")
  const settingsSource = readUtf8("./iconoplasm-extension/content-settings.js")
  const popupCss = readUtf8("./iconoplasm-extension/popup.css")

  assert.match(
    popupHtml,
    /name="highlight-mode" value="underline"[\s\S]*>Under line</,
    "the underline option should be two words so the popup cannot split it as underlin/e",
  )
  assert.doesNotMatch(
    popupHtml,
    />Underline</,
    "the old one-word Underline label caused ugly emergency wrapping in the popup",
  )
  assert.match(
    popupCss,
    /\.popup-segment-label[\s\S]*overflow-wrap:\s*normal;[\s\S]*word-break:\s*normal;/,
    "segmented labels should wrap at real word boundaries instead of splitting short words",
  )
  assert.match(
    popupSource,
    /function normalizeHighlightMode\(value\)[\s\S]*: "pill"/,
    "popup.js should select Color pills when a new user has no stored highlight mode",
  )
  assert.match(
    popupSource,
    /function normalizeHighlightVisibility\(value\)[\s\S]*return value === "hover" \? "hover" : "always"/,
    "popup.js should select Always on when a new user has no stored timing setting",
  )
  assert.match(
    popupSource,
    /function normalizeCardVariant\(value\)[\s\S]*if \(value === "simple"\) return "simple"[\s\S]*return "image-only"/,
    "popup.js should select Blot only when a new user has no stored card style",
  )
  assert.match(
    contentSource,
    /let highlightMode = highlightRuntime\.setMode\("pill"\)/,
    "content.js should render Color pills before storage loads for a new user",
  )
  assert.match(
    contentSource,
    /highlightMode = highlightRuntime\.setMode\("pill"\)/,
    "content.js should fall back to Color pills if storage is unavailable",
  )
  assert.match(
    contentSource,
    /let highlightVisibility = "always"/,
    "content.js should keep Always on as the new-user highlight timing default",
  )
  assert.match(
    contentSource,
    /let cardVariant = "image-only"/,
    "content.js should render Blot only before storage loads for a new user",
  )
  assert.match(
    contentSource,
    /cardVariant = "image-only"/,
    "content.js should fall back to Blot only if storage is unavailable",
  )
  assert.match(
    settingsSource,
    /return normalized === "simple" && raw == null \? "image-only" : normalized/,
    "shared extension settings should treat an absent card style as Blot only without breaking stored Simple users",
  )
})

test("extension popup account tab replaces sign-in with signed-in notice and compact sign-out control", () => {
  const popupHtml = readUtf8("./iconoplasm-extension/popup.html")
  const popupSource = readUtf8("./iconoplasm-extension/popup.js")
  const popupCss = readUtf8("./iconoplasm-extension/popup.css")

  assert.match(
    popupHtml,
    /id="account-sign-in-link"[\s\S]*Sign in with Discord/,
    "the sign-in CTA should stay addressable so authenticated state can hide it",
  )
  assert.match(
    popupHtml,
    /id="account-sign-out-btn"[\s\S]*aria-label="Sign out"[\s\S]*>×</,
    "the account tab should expose a compact cross sign-out button",
  )
  assert.match(
    popupSource,
    /function renderAccountState\(state\)[\s\S]*"Signed in!"[\s\S]*popup-account-status--signed-in/,
    "authenticated state should render the terse signed-in notice and signed-in styling",
  )
  assert.match(
    popupSource,
    /accountSignInLink\?\.classList\.toggle\("popup-btn--hidden", isSignedIn\)/,
    "authenticated state should remove the Discord sign-in CTA from the visible account tab",
  )
  assert.match(
    popupSource,
    /accountSignOutBtn\?\.classList\.toggle\("popup-account-sign-out--hidden", !isSignedIn\)/,
    "authenticated state should reveal the compact sign-out button",
  )
  assert.match(
    popupSource,
    /url:\s*"\/api\/auth\/logout", method:\s*"POST"/,
    "sign out should call the existing logout endpoint through the extension API bridge",
  )
  assert.match(
    popupCss,
    /\.popup-account-status--signed-in[\s\S]*\.popup-account-sign-out[\s\S]*oklch\(42% 0\.16 25\)/,
    "the signed-in account state should keep the muted popup style with a small red sign-out control",
  )
})

test("Iconoplasm home keeps guest Discord login in the starter-card flow", () => {
  const appSource = readUtf8("./quartz/static/iconoplasm/app.js")
  const stylesSource = readUtf8("./quartz/static/iconoplasm/styles.css")
  const guestCardBuilder = appSource.match(
    /function buildGuestDiscoveryLoginCardMarkup\(\) \{[\s\S]*?\n  \}/,
  )?.[0]
  assert.ok(guestCardBuilder, "home guest login card builder should exist")

  assert.doesNotMatch(
    appSource,
    /id="icono-gallery-auth"/,
    "home toolbar should not reserve an out-of-place Discord login slot",
  )
  assert.match(
    guestCardBuilder,
    /Log in with Discord to track discovered genes[\s\S]*>Log in with Discord<\/a>/,
    "guest login card should use the requested short copy and a direct Discord login button",
  )
  assert.doesNotMatch(
    guestCardBuilder,
    /guest mode|Your starter cards stay visible/,
    "guest login card should stay terse, without a kicker or explanatory note",
  )
  assert.match(
    appSource,
    /galleryState\.offset >= GUEST_STARTER_GENES\.length[\s\S]*appendGuestDiscoveryLoginCard\(grid\)/,
    "guest login card should be appended after the three starter gene cards render",
  )
  assert.match(
    stylesSource,
    /\.icono-card\.icono-guest-login-card[\s\S]*display: grid/,
    "guest login prompt should be styled as an inline card in the home gene-card flow",
  )
  assert.match(
    stylesSource,
    /\.icono-guest-login-card-title[\s\S]*font-family: "IBM Plex Mono"/,
    "guest login headline should use the same IBM Plex face as the card UI",
  )
  assert.match(
    stylesSource,
    /\.icono-guest-login-card-button[\s\S]*box-sizing: border-box[\s\S]*min-height: 2\.15rem[\s\S]*background: color-mix\(in srgb, var\(--dark\) 88%, var\(--accent\) 12%\)[\s\S]*font-family: "IBM Plex Mono"/,
    "guest login button should reuse the auth link style with compact, deliberate IBM Plex text",
  )
})

test("DO NOT DELETE: lab-label row labels do not collapse into character stacks", () => {
  const stylesSource = readUtf8("./shared/iconoplasm-card/shared-card-label.css")

  assert.match(
    stylesSource,
    /--icono-label-row-label-fr: clamp\(3\.15rem, 9\.2%, 7rem\)/,
    "desktop lab-label row labels need a real minimum column width, not a collapsing percentage",
  )
  assert.match(
    stylesSource,
    /\.icono-label-row-label \{[\s\S]*overflow-wrap: normal[\s\S]*word-break: normal[\s\S]*hyphens: none/,
    "lab-label row labels should not break into one-letter stacks",
  )
})
