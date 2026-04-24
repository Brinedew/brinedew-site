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
