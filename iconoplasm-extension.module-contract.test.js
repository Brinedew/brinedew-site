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
