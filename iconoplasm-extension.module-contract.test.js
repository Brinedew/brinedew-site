import assert from "node:assert/strict"
import test from "node:test"
import { existsSync, readFileSync } from "node:fs"
import { brotliDecompressSync } from "node:zlib"
import vm from "node:vm"

function readUtf8(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8")
}

function readJson(path) {
  return JSON.parse(readUtf8(path))
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function collectFrameResourceDependencies(frameHtml) {
  return Array.from(frameHtml.matchAll(/\b(?:src|href)="([^"]+)"/g), ([, path]) => path).filter(
    (path) => !path.startsWith("http://") && !path.startsWith("https://") && !path.startsWith("#"),
  )
}

function collectManifestWebAccessibleResources(manifest) {
  return new Set(
    (manifest.web_accessible_resources || []).flatMap((entry) => Array.from(entry.resources || [])),
  )
}

function loadContentMatcher() {
  const sandbox = {}
  sandbox.globalThis = sandbox
  vm.runInNewContext(readUtf8("./iconoplasm-extension/content-matcher.js"), sandbox)
  return sandbox.IconoplasmContentMatcher
}

function normalizeMatcherResults(matches) {
  return Array.from(matches || [], (match) => ({ ...match }))
}

const woff2KnownTags = [
  "cmap",
  "head",
  "hhea",
  "hmtx",
  "maxp",
  "name",
  "OS/2",
  "post",
  "cvt ",
  "fpgm",
  "glyf",
  "loca",
  "prep",
  "CFF ",
  "VORG",
  "EBDT",
  "EBLC",
  "gasp",
  "hdmx",
  "kern",
  "LTSH",
  "PCLT",
  "VDMX",
  "vhea",
  "vmtx",
  "BASE",
  "GDEF",
  "GPOS",
  "GSUB",
  "EBSC",
  "JSTF",
  "MATH",
  "CBDT",
  "CBLC",
  "COLR",
  "CPAL",
  "SVG ",
  "sbix",
  "acnt",
  "avar",
  "bdat",
  "bloc",
  "bsln",
  "cvar",
  "fdsc",
  "feat",
  "fmtx",
  "fvar",
  "gvar",
  "hsty",
  "just",
  "lcar",
  "mort",
  "morx",
  "opbd",
  "prop",
  "trak",
  "Zapf",
  "Silf",
  "Glat",
  "Gloc",
  "Feat",
  "Sill",
]

function readUIntBase128(buffer, cursor) {
  let value = 0
  for (let i = 0; i < 5; i += 1) {
    const byte = buffer[cursor.offset]
    cursor.offset += 1
    if (i === 0 && byte === 0x80) throw new Error("Invalid WOFF2 UIntBase128 leading zero")
    value = (value << 7) | (byte & 0x7f)
    if ((byte & 0x80) === 0) return value
  }
  throw new Error("Invalid WOFF2 UIntBase128 length")
}

function readWoff2Table(buffer, tableTag) {
  assert.equal(buffer.toString("ascii", 0, 4), "wOF2", "expected a WOFF2 font")
  const numTables = buffer.readUInt16BE(12)
  const totalCompressedSize = buffer.readUInt32BE(20)
  const cursor = { offset: 48 }
  const tables = []

  for (let i = 0; i < numTables; i += 1) {
    const flags = buffer[cursor.offset]
    cursor.offset += 1
    const tagIndex = flags & 0x3f
    const tag =
      tagIndex === 0x3f
        ? buffer.toString("ascii", cursor.offset, (cursor.offset += 4))
        : woff2KnownTags[tagIndex]
    const transformVersion = flags >> 6
    const originalLength = readUIntBase128(buffer, cursor)
    const transformed =
      tag === "glyf" || tag === "loca" ? transformVersion !== 3 : transformVersion !== 0
    const transformedLength = transformed ? readUIntBase128(buffer, cursor) : originalLength
    tables.push({ tag, originalLength, transformedLength })
  }

  const compressedData = buffer.subarray(cursor.offset, cursor.offset + totalCompressedSize)
  const decompressed = brotliDecompressSync(compressedData)
  let tableOffset = 0
  for (const table of tables) {
    const length = table.transformedLength
    const data = decompressed.subarray(tableOffset, tableOffset + length)
    if (table.tag === tableTag) return data.subarray(0, table.originalLength)
    tableOffset += length
  }
  throw new Error(`Missing WOFF2 table ${tableTag}`)
}

function cmapHasCodepoint(cmap, codepoint) {
  const tableCount = cmap.readUInt16BE(2)
  for (let i = 0; i < tableCount; i += 1) {
    const tableOffset = cmap.readUInt32BE(4 + i * 8 + 4)
    const format = cmap.readUInt16BE(tableOffset)
    if (format === 12) {
      const groupCount = cmap.readUInt32BE(tableOffset + 12)
      for (let group = 0; group < groupCount; group += 1) {
        const offset = tableOffset + 16 + group * 12
        const start = cmap.readUInt32BE(offset)
        const end = cmap.readUInt32BE(offset + 4)
        if (codepoint >= start && codepoint <= end) return true
      }
    }
    if (format === 4) {
      const segCount = cmap.readUInt16BE(tableOffset + 6) / 2
      const endCodes = tableOffset + 14
      const startCodes = endCodes + segCount * 2 + 2
      for (let segment = 0; segment < segCount; segment += 1) {
        const start = cmap.readUInt16BE(startCodes + segment * 2)
        const end = cmap.readUInt16BE(endCodes + segment * 2)
        if (codepoint >= start && codepoint <= end) return true
      }
    }
  }
  return false
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

test("DO NOT DELETE: Firefox image-only hover cards stay on the rich frame renderer", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")
  const packageSource = readUtf8("./scripts/package-iconoplasm-extension.mjs")
  assert.doesNotMatch(
    source,
    /if\s*\(\s*isFirefoxExtensionRuntime\(\)\s*\)\s*return\s+false/,
    "Firefox must not fall back to the native simple tooltip for image-only cards",
  )
  assert.match(
    source,
    /return\s+cardVariant\s*===\s*"lit-archival"\s*\|\|\s*cardVariant\s*===\s*"image-only"/,
    "image-only and lab-label variants should both use the frame renderer",
  )
  assert.doesNotMatch(
    packageSource,
    /rmSync\(resolve\(stageRoot,\s*"lit-archival-frame\.(?:html|js)"\)/,
    "Firefox packages must ship the lit archival frame files used by the rich renderer",
  )
})

test("DO NOT DELETE: extension archival hover frames do not use mobile drawer layout", () => {
  const frameHtml = readUtf8("./iconoplasm-extension/lit-archival-frame.html")
  const frameSource = readUtf8("./iconoplasm-extension/lit-archival-frame.js")
  const contentCss = readUtf8("./iconoplasm-extension/content.css")
  assert.match(
    frameHtml,
    /<script src="generated\/rough\.js"><\/script>[\s\S]*<script src="generated\/shared-card-runtime\.js"><\/script>/,
    "the extension frame must load rough.js before the shared runtime so lab-label pen loops render as rough hand-drawn loops",
  )
  const manifestResources = collectManifestWebAccessibleResources(
    readJson("./iconoplasm-extension/manifest.json"),
  )
  const frameDependencies = [
    "lit-archival-frame.html",
    ...collectFrameResourceDependencies(frameHtml),
    "generated/shared-card-label.css",
    "generated/shared-card-vote.css",
  ]
  for (const dependency of frameDependencies) {
    assert.ok(
      manifestResources.has(dependency),
      `${dependency} must be declared in web_accessible_resources so Edge and Firefox packages expose every frame dependency`,
    )
  }
  assert.doesNotMatch(
    frameSource,
    /https:\/\/iconoplasm\.brinedew\.bio\/static\/iconoplasm\/styles\.css|ensureSiteStylesLoaded|fetch\(SITE_BRICK_CSS_URL\)/,
    "extension hover frames must use packaged CSS instead of fetching live site CSS that can drift from the released extension",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip\.iconoplasm-tooltip--frame-card\s*\{[\s\S]*max-width:\s*none/,
    "frame-card tooltips must clear the simple tooltip max-width so archival iframes keep desktop sheet width",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip\.iconoplasm-tooltip--frame-card\s*>\s*\.iconoplasm-tooltip-portrait\s*\{[\s\S]*display:\s*none/,
    "frame-card tooltips must hide the native simple portrait even after shared lab-label CSS is present on the page",
  )
})

test("DO NOT DELETE: blot-only frame marks prewarmed portraits as loaded", () => {
  const frameSource = readUtf8("./iconoplasm-extension/lit-archival-frame.js")
  assert.match(
    frameSource,
    /function markImageOnlyPortraitLoaded\(img\)[\s\S]*icono-image-only-photo--loaded[\s\S]*icono-image-only-media-stage--loaded[\s\S]*icono-image-only-link--loaded/,
    "image-only frames should flip all loaded-state classes after the portrait is available",
  )
  assert.match(
    frameSource,
    /img\.complete && img\.naturalWidth > 0[\s\S]*markImageOnlyPortraitLoaded\(img\)/,
    "prewarmed images may already be complete before insertion and still must become visible",
  )
  assert.match(
    frameSource,
    /img\.addEventListener\("load", \(\) => markImageOnlyPortraitLoaded\(img\), \{ once: true \}\)/,
    "non-cached image-only portraits should become visible from their real load event",
  )
})

test("DO NOT DELETE: Iconoplasm card fonts ship macron-vowel glyph coverage", () => {
  const fontPaths = [
    "./shared/iconoplasm-card/fonts/Caveat-400.woff2",
    "./shared/iconoplasm-card/fonts/IBMPlexMono-Medium.woff2",
    "./shared/iconoplasm-card/fonts/IBMPlexMono-Regular.woff2",
    "./shared/iconoplasm-card/fonts/LeagueSpartan-800.woff2",
    "./shared/iconoplasm-card/fonts/SpecialElite-Regular.woff2",
    "./quartz/static/iconoplasm/fonts/Caveat-400.woff2",
    "./quartz/static/iconoplasm/fonts/IBMPlexMono-Medium.woff2",
    "./quartz/static/iconoplasm/fonts/IBMPlexMono-Regular.woff2",
    "./quartz/static/iconoplasm/fonts/LeagueSpartan-800.woff2",
    "./quartz/static/iconoplasm/fonts/SpecialElite-Regular.woff2",
    "./iconoplasm-extension/fonts/Caveat-400.woff2",
    "./iconoplasm-extension/fonts/IBMPlexMono-Medium.woff2",
    "./iconoplasm-extension/fonts/IBMPlexMono-Regular.woff2",
    "./iconoplasm-extension/fonts/LeagueSpartan-800.woff2",
    "./iconoplasm-extension/fonts/SpecialElite-Regular.woff2",
  ]

  for (const fontPath of fontPaths) {
    const cmap = readWoff2Table(readFileSync(new URL(fontPath, import.meta.url)), "cmap")
    for (const codepoint of [
      0x0100, 0x0101, 0x0112, 0x0113, 0x012a, 0x012b, 0x014c, 0x014d, 0x016a, 0x016b,
    ]) {
      assert.ok(
        cmapHasCodepoint(cmap, codepoint),
        `${fontPath} should include U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`,
      )
    }
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
  assert.match(
    source,
    /rect\.right < hostRect\.left - 1[\s\S]*rect\.left > hostRect\.right \+ 1[\s\S]*rect\.bottom < hostRect\.top - 1[\s\S]*rect\.top > hostRect\.bottom \+ 1/,
    "paint fragments must be rejected when measured text geometry is outside the highlighted host",
  )
  assert.match(
    source,
    /left:\s*rect\.left - hostRect\.left,[\s\S]*top:\s*rect\.top - hostRect\.top,/,
    "measured rough-ellipse fragments should use local coordinates inside their highlighted span",
  )
  assert.match(
    source,
    /if \(!scene \|\| !scene\.fragments\.length\) \{[\s\S]*sceneLayer\.replaceChildren\(\)[\s\S]*return/,
    "empty or invalid geometry must clear old pill/ellipse fragments instead of leaving orphan rectangles on the page",
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

test("DO NOT DELETE: Edge packaging has a first-class Chromium manifest target", () => {
  const packageScript = readUtf8("./scripts/package-iconoplasm-extension.mjs")
  assert.match(
    packageScript,
    /if \(arg === "--edge"\) return "edge"/,
    "Edge publishing must not reuse the generic developer package target",
  )
  assert.match(
    packageScript,
    /stageDir:\s*"edge-package"[\s\S]*zipName:\s*`iconoplasm-edge-v\$\{packageVersion\}\.zip`/,
    "Edge publishing should produce its own zip so store validation evidence points at the exact submitted package",
  )
  assert.match(
    packageScript,
    /browser:\s*"edge"/,
    "Edge publishing should use WXT's Edge browser target",
  )
  const wxtConfig = readUtf8("./wxt.config.ts")
  assert.match(
    wxtConfig,
    /browser !== "firefox"[\s\S]*delete manifest\.browser_specific_settings/,
    "Chromium packages must strip Firefox-only browser_specific_settings.gecko before store validation",
  )
})

test("DO NOT DELETE: extension versions can advance only through publisher authority", () => {
  const packageJson = JSON.parse(readUtf8("./package.json"))
  assert.equal(packageJson.scripts["version:iconoplasm-extension:patch"], undefined)
  assert.equal(packageJson.scripts["version:iconoplasm-extension:minor"], undefined)
  assert.equal(packageJson.scripts["version:iconoplasm-extension:major"], undefined)
  assert.equal(existsSync(new URL("./scripts/bump-iconoplasm-extension-version.mjs", import.meta.url)), false)
  assert.match(
    packageJson.scripts["verify:iconoplasm-publisher-authority"],
    /verify-iconoplasm-publisher-authority/,
  )
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

test("DO NOT DELETE: canonical gene symbols require word-like boundaries while allowing hyphen prefixes", () => {
  const matcherApi = loadContentMatcher()
  assert.equal(typeof matcherApi?.createGeneMatcher, "function")

  const matcher = matcherApi.createGeneMatcher({
    SYMBOL: { c: "#123456", n: "Example gene" },
  })

  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("thatSYMBOL")),
    [],
    "SYMBOL inside a larger letter/digit word should not be highlighted",
  )
  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("SYMBOLthat")),
    [],
    "SYMBOL followed by more letters or digits should not be highlighted",
  )
  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("that-SYMBOL")),
    [{ symbol: "SYMBOL", index: 5, length: 6, text: "SYMBOL", matchedBy: "symbol" }],
    "SYMBOL after a separator hyphen should be highlighted as its own gene token",
  )
  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("SYMBOL-that")),
    [{ symbol: "SYMBOL", index: 0, length: 6, text: "SYMBOL", matchedBy: "symbol" }],
    "SYMBOL before a separator hyphen should be highlighted as its own gene token",
  )
  assert.deepEqual(
    normalizeMatcherResults(matcher.findMatches("(SYMBOL)/that")),
    [{ symbol: "SYMBOL", index: 1, length: 6, text: "SYMBOL", matchedBy: "symbol" }],
    "punctuation should separate a canonical gene symbol from surrounding prose",
  )
})

test("DO NOT DELETE: simple card batch request includes fields consumed by its metadata rows", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")
  const fieldsMatch = source.match(
    /const GENE_DETAIL_BATCH_FIELDS = Object\.freeze\(\[([\s\S]*?)\]\)/,
  )
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

test("DO NOT DELETE: simple card metadata keeps essence rows but never invents unknown companions", async () => {
  const vm = await import("node:vm")
  const sandbox = { console }
  sandbox.globalThis = sandbox
  vm.runInNewContext(readUtf8("./iconoplasm-extension/generated/shared-card-runtime.js"), sandbox)
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
    "age_years is an essence field and must not disappear when first_publication_year is absent",
  )
  assert.ok(
    rows.some((row) => row.character === "138 kg"),
    "weight_kg is an essence field and must not disappear when molecular_weight_kda is absent",
  )
  assert.ok(
    rows.some((row) => String(row.character || "").includes("Mocha Black")),
    "skin_name is an essence field and must not disappear when primary_tissue is absent",
  )
  assert.equal(
    rows.some((row) => String(row.molecular || "").toLowerCase() === "unknown"),
    false,
    "missing companion metadata should render blank until the payload is fixed, never as fake unknown data",
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

  assert.equal(defaults.length, 74, "default blocklist should stay at the alias-only pruned size")
  for (const term of ["FLOWER", "JERKY", "STAT"]) {
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
  const detailCacheSource = readUtf8("./iconoplasm-extension/content-detail-cache.js")
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
  assert.match(
    detailCacheSource,
    /const onResolvedBatch =[\s\S]*options\.onResolvedBatch[\s\S]*if \(genes\.length\) onResolvedBatch\(genes\)/,
    "detail cache batches should expose hydrated records to the content script instead of hiding portrait URLs inside the cache",
  )
  assert.match(
    source,
    /function onGeneDetailWarmBatch\(records\)[\s\S]*portraitUrlFromGeneDetail\(record\)[\s\S]*warmPortraitUrls\(urls\)/,
    "preloaded gene details should immediately warm the exact detail portrait URLs the rich hover card will render",
  )
  assert.match(
    source,
    /onResolvedBatch: onGeneDetailWarmBatch/,
    "content.js should connect detail preloading to portrait preloading",
  )
  assert.match(
    source,
    /function collectNeighborGeneSymbols\(targetEl[\s\S]*if \(targetIndex === -1\) return \[\][\s\S]*for \(let distance = 1; symbols\.length < max; distance \+= 1\)[\s\S]*const left = targetIndex - distance[\s\S]*const right = targetIndex \+ distance[\s\S]*if \(left >= 0\)[\s\S]*if \(right < genes\.length\)/,
    "neighbor warming should walk both left and right rings instead of spending the budget on only one side of the hovered symbol",
  )
  assert.doesNotMatch(
    source,
    /pushSymbol\(targetEl\.dataset[\s\S]*let left = targetIndex - 1[\s\S]*let right = targetIndex \+ 1/,
    "neighbor warming should not let the hovered symbol consume a prewarm slot before left/right neighbors are collected",
  )
})

test("DO NOT DELETE: extension runtime typography uses Iconoplasm fonts, not legacy site fonts", () => {
  const contentCss = readUtf8("./iconoplasm-extension/content.css")
  const popupCss = readUtf8("./iconoplasm-extension/popup.css")
  const contentSource = readUtf8("./iconoplasm-extension/content.js")
  const frameHtml = readUtf8("./iconoplasm-extension/lit-archival-frame.html")
  const manifest = readUtf8("./iconoplasm-extension/manifest.json")
  const runtimeTypography = [contentCss, popupCss, contentSource, frameHtml, manifest].join("\n")

  assert.doesNotMatch(
    runtimeTypography,
    /Crimson Pro|Monaspace Xenon|CrimsonPro-Variable|MonaspaceXenon-Var/,
    "extension runtime surfaces must not ship or inject the old Crimson/Monaspace typography",
  )
  assert.match(
    popupCss,
    /html,\s*\nbody\s*\{[\s\S]*font-family:\s*"IBM Plex Mono", monospace/,
    "extension popup body text should use IBM Plex Mono",
  )
  assert.match(
    popupCss,
    /\.popup-brand-copy h1\s*\{[\s\S]*font-family:\s*"League Spartan"/,
    "extension popup title should use the Iconoplasm title face",
  )
  assert.match(
    readUtf8("./iconoplasm-extension/popup.html"),
    /<h1>ICONOPLASM<\/h1>/,
    "extension popup title should render the brand in all caps",
  )
  assert.match(
    readUtf8("./iconoplasm-extension/popup.html"),
    /<legend>Highlight appearance<\/legend>/,
    "extension popup should label highlight styling as Highlight appearance",
  )
  assert.match(
    readUtf8("./iconoplasm-extension/popup.html"),
    /<legend>Hover card appearance<\/legend>[\s\S]*aria-label="Hover card appearance"/,
    "extension popup should label hover-card styling consistently for visible and accessible text",
  )
  assert.match(
    popupCss,
    /\.popup-segment-label\s*\{[\s\S]*font-size:\s*0\.72rem;[\s\S]*letter-spacing:\s*0\.08em;/,
    "segmented popup pills should use the same compact IBM size/weight treatment as Appearance and Blocklist",
  )
  assert.doesNotMatch(
    popupCss.match(/\.popup-segment-label\s*\{[\s\S]*?\n\}/)?.[0] || "",
    /text-transform:\s*uppercase/,
    "segmented popup option labels should preserve their written casing",
  )
  assert.match(
    popupCss,
    /\.popup-field legend\s*\{[\s\S]*color:\s*color-mix\(in srgb, var\(--dark\) 78%, transparent\)/,
    "above-picker field labels should use the stronger transparency value",
  )
  assert.match(
    popupCss,
    /\.popup-segment-label\s*\{[\s\S]*color:\s*color-mix\(in srgb, var\(--secondary\) 64%, transparent\)/,
    "deselected picker options should use the softer transparency value",
  )
  assert.match(
    popupCss,
    /\.popup-radio:checked \+ \.popup-segment-label\s*\{[\s\S]*font-weight:\s*500;/,
    "active segmented pills should not become heavier than section kickers",
  )
  assert.match(
    popupCss,
    /\.popup-blocklist-symbol\s*\{[\s\S]*font-family:\s*"Special Elite"/,
    "blocklisted terms should use the Special Elite gene-name face",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip-meta-value\s*\{[\s\S]*font-family:\s*"IBM Plex Mono", monospace/,
    "extension tooltip body metadata should use IBM Plex Mono instead of the typewriter display face",
  )
  assert.match(
    frameHtml,
    /--headerFont:\s*"League Spartan"[\s\S]*--codeFont:\s*"IBM Plex Mono"/,
    "extension iframe card shell should expose Iconoplasm font tokens to shared card CSS",
  )
})

test("DO NOT DELETE: blot-only frame clears stale neighbor cards before portrait decode", () => {
  const frameSource = readUtf8("./iconoplasm-extension/lit-archival-frame.js")
  const contentSource = readUtf8("./iconoplasm-extension/content.js")
  assert.match(
    frameSource,
    /let renderSerial = 0/,
    "frame rendering should keep a serial fence so older hover payloads cannot overwrite newer cards",
  )
  assert.doesNotMatch(
    frameSource,
    /await prewarmPortraitSource\(portraitSrc\)[\s\S]*replaceTrustedChildren/,
    "neighbor hovers must not keep showing the old card while the new portrait source decodes",
  )
  assert.match(
    frameSource,
    /if \(serial !== renderSerial\) return[\s\S]*replaceTrustedChildren[\s\S]*const portraitSrc = String\(\(payload && payload\.portraitSrc\) \|\| ""\)\.trim\(\)[\s\S]*if \(portraitSrc\) void prewarmPortraitSource\(portraitSrc\)/,
    "the frame should synchronously replace stale content with the new card, then warm/decode the new portrait in the background",
  )
  assert.match(
    frameSource,
    /FRAME_RENDERED_TYPE = "ICONOPLASM_LIT_ARCHIVAL_RENDERED"[\s\S]*postToParent\(FRAME_RENDERED_TYPE/,
    "the frame should acknowledge the exact render request after it replaces stale card markup",
  )
  assert.match(
    contentSource,
    /iframe\.dataset\.iconoFrameRenderState = "pending"[\s\S]*iframe\.contentWindow\.postMessage\(payload/,
    "content.js should hide a stale symbol frame before asking it to render the next symbol",
  )
  assert.match(
    contentSource,
    /data\.type === LIT_ARCHIVAL_RENDERED_MESSAGE[\s\S]*iframe\.dataset\.iconoFrameRenderState = "current"/,
    "content.js should restore the frame only after the frame acknowledges the current render request",
  )
  assert.match(
    frameSource,
    /const portraitDecodedSourceCache = new Set\(\)[\s\S]*portraitDecodedSourceCache\.add\(usableSrc\)/,
    "the frame should remember which prewarmed portrait sources are actually decoded",
  )
  assert.match(
    frameSource,
    /portraitDecodedSourceCache\.has\(portraitSrc\)[\s\S]*icono-image-only-photo--loaded/,
    "prewarmed blot-only cards should render loaded classes on the first markup pass instead of flashing the paper background",
  )
})

test("DO NOT DELETE: frame portrait prewarm decodes before a visible neighbor hover", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")
  const contentCss = readUtf8("./iconoplasm-extension/content.css")
  assert.match(
    source,
    /let litArchivalPrewarmFrame = null[\s\S]*const pendingLitArchivalPrewarmSources = new Set\(\)/,
    "neighbor blot prewarm should keep a frame-side queue even when no visible tooltip exists yet",
  )
  assert.match(
    source,
    /function ensureLitArchivalPrewarmFrame\(\)[\s\S]*document\.createElement\("iframe"\)[\s\S]*iconoplasm-tooltip-lit-frame--prewarm[\s\S]*document\.body\.appendChild\(iframe\)/,
    "neighbor portrait preloading should create a hidden extension frame before the user hovers the neighboring symbol",
  )
  assert.match(
    source,
    /function prewarmLitArchivalFramePortraitSrcs\(sources\)[\s\S]*pendingLitArchivalPrewarmSources\.add\(source\)[\s\S]*ensureLitArchivalPrewarmFrame\(\)[\s\S]*flushLitArchivalPrewarmSources\(\)/,
    "neighbor portrait preloading should queue sources, ensure a frame exists, then flush into that frame for decode",
  )
  assert.match(
    source,
    /litArchivalPrewarmFrame\.dataset\.iconoFrameReady = "true"[\s\S]*flushLitArchivalPrewarmSources\(\)/,
    "queued neighbor prewarms should flush as soon as the hidden prewarm frame is ready",
  )
  assert.match(
    contentCss,
    /\.iconoplasm-tooltip-lit-frame--prewarm\s*\{[\s\S]*width:\s*1px[\s\S]*height:\s*1px[\s\S]*visibility:\s*hidden/,
    "the prewarm frame should decode images without showing a second card on the page",
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
    /id="highlight-visibility"[\s\S]*name="highlight-visibility"[\s\S]*value="always"[\s\S]*name="highlight-visibility"[\s\S]*value="hover"/,
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

test("DO NOT DELETE: extension scanner never wraps editable textbox content", () => {
  const scannerSource = readUtf8("./iconoplasm-extension/content-scanner.js")
  const contentSource = readUtf8("./iconoplasm-extension/content.js")

  assert.match(
    scannerSource,
    /function isEditableTextSurface\(element\)[\s\S]*closest\(\s*"\[contenteditable\],\s*textarea,\s*input,\s*select,\s*\[role='textbox'\],\s*\[role=\\"textbox\\"\]"\s*,?\s*\)/,
    "content-scanner.js must reject editable textbox descendants before it replaces text nodes with highlight spans",
  )
  assert.match(
    scannerSource,
    /if \(isEditableTextSurface\(parent\)\) return nodeFilter\.FILTER_REJECT/,
    "content-scanner.js must skip live editable text surfaces so the browser caret is not moved by DOM replacement",
  )
  assert.match(
    contentSource,
    /function isEditableTextSurface\(el\)[\s\S]*closest\(\s*"\[contenteditable\],\s*textarea,\s*input,\s*select,\s*\[role='textbox'\],\s*\[role=\\"textbox\\"\]"\s*,?\s*\)/,
    "content.js mutation scanning must ignore editable textbox roots before queuing rescans",
  )
  assert.match(
    contentSource,
    /if \(isEditableTextSurface\(el\)\) return true/,
    "content.js mutation scanning must not queue editable textbox changes for later highlighting",
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
  const sitePreferences = readUtf8("./quartz/static/site-preferences.js")
  const preferencesBridge = readUtf8("./quartz/static/site-preferences/bridge.html")
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
    siteSettings,
    /CARD_VARIANT_OPTIONS = \[\s*\{ value: "simple", label: "Simple" \},\s*\{ value: "lit-archival", label: "Vintage lab label" \},\s*\{ value: "image-only", label: "Blot only" \},\s*\]/,
    "site settings card style options should match the three labels exposed by the extension popup",
  )
  assert.doesNotMatch(
    siteSettings,
    /neo-drab|Neo-drab|drab/i,
    "site settings should not expose the removed drab card style",
  )
  assert.match(
    sitePreferences,
    /if \(value === "neo-drab"\) return "lit-archival"/,
    "old website neo-drab settings should migrate to the remaining lab label style",
  )
  assert.match(
    preferencesBridge,
    /if \(value === "neo-drab"\) return "lit-archival"/,
    "the cross-host preferences bridge should migrate old neo-drab values the same way",
  )
  assert.match(
    storeListingCopy,
    /blot-only portrait/,
    "store listing copy should describe the card style as blot-only",
  )
})

test("Iconoplasm settings prefer the current shared card-style cookie over stale host duplicates", async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  const storage = new Map([
    [
      "brinedew.iconoplasm.settings.v1",
      JSON.stringify({ homeLayout: "bricks", cardVariant: "lit-archival", showAllGenes: false }),
    ],
  ])
  globalThis.window = {
    location: {
      hostname: "iconoplasm.brinedew.bio",
      origin: "https://iconoplasm.brinedew.bio",
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  }
  globalThis.document = {
    cookie:
      "brinedew_icono_card_variant=lit-archival; brinedew_icono_layout=bricks; brinedew_icono_card_variant=simple",
    dispatchEvent: () => true,
  }
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init && init.detail
    }
  }

  try {
    const preferences = await import(
      new URL(
        `./quartz/static/site-preferences.js?duplicate-card-cookie=${Date.now()}`,
        import.meta.url,
      )
    )
    assert.equal(preferences.readIconoplasmSettings().cardVariant, "simple")
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }
})

test("Iconoplasm settings writes both host and shared-domain cookies for card style", async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  const assignments = []
  const storage = new Map()
  globalThis.window = {
    location: {
      hostname: "brinedew.bio",
      origin: "https://brinedew.bio",
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  }
  globalThis.document = {
    dispatchEvent: () => true,
  }
  Object.defineProperty(globalThis.document, "cookie", {
    get() {
      return ""
    },
    set(value) {
      assignments.push(String(value))
    },
  })
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init && init.detail
    }
  }

  try {
    const preferences = await import(
      new URL(
        `./quartz/static/site-preferences.js?write-card-cookie=${Date.now()}`,
        import.meta.url,
      )
    )
    assert.equal(
      preferences.writeIconoplasmSettings({
        homeLayout: "bricks",
        cardVariant: "simple",
        showAllGenes: false,
      }),
      true,
    )
    assert.ok(
      assignments.some(
        (assignment) =>
          assignment.startsWith("brinedew_icono_card_variant=simple;") &&
          !assignment.includes("Domain="),
      ),
      "settings writes should refresh the host cookie so stale same-host values cannot shadow the shared cookie",
    )
    assert.ok(
      assignments.some(
        (assignment) =>
          assignment.startsWith("brinedew_icono_card_variant=simple;") &&
          assignment.includes("Domain=.brinedew.bio"),
      ),
      "settings writes should refresh the shared domain cookie used across Brinedew hosts",
    )
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }
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
    /value === "underline"[\s\S]*value === "pill"[\s\S]*value === "pill-outline"[\s\S]*value === "ellipse"/,
    "popup.js must preserve an explicit underline highlight choice instead of normalizing it back to pills",
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
    /const storedMode = String\(result\[HIGHLIGHT_MODE_KEY\] \|\| ""\)\.trim\(\)[\s\S]*highlightMode = highlightRuntime\.setMode\(storedMode \|\| "pill"\)/,
    "content.js should match the popup by treating a missing stored highlight mode as Color pills",
  )
  assert.match(
    contentSource,
    /catch \(_\)[\s\S]*highlightMode = highlightRuntime\.setMode\("pill"\)/,
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

test("DO NOT DELETE: website guest defaults stay bricks and blot-only", async () => {
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  const originalCustomEvent = globalThis.CustomEvent
  const storage = new Map()
  globalThis.window = {
    location: {
      hostname: "iconoplasm.brinedew.bio",
      origin: "https://iconoplasm.brinedew.bio",
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
  }
  globalThis.document = {
    cookie: "",
    dispatchEvent: () => true,
  }
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, init) {
      this.type = type
      this.detail = init && init.detail
    }
  }

  try {
    const preferences = await import(
      new URL(`./quartz/static/site-preferences.js?guest-defaults=${Date.now()}`, import.meta.url)
    )
    assert.equal(preferences.readIconoplasmSettings().homeLayout, "bricks")
    assert.equal(preferences.readIconoplasmSettings().cardVariant, "image-only")
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    globalThis.CustomEvent = originalCustomEvent
  }
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

test("Iconoplasm home keeps Discord actions in the starter-card flow", () => {
  const appSource = readUtf8("./quartz/static/iconoplasm/app.js")
  const stylesSource = readUtf8("./quartz/static/iconoplasm/styles.css")
  const guestCardBuilder = appSource.match(
    /function buildGuestDiscoveryLoginCardMarkup\(\) \{[\s\S]*?\n  \}/,
  )?.[0]
  assert.ok(guestCardBuilder, "home guest login card builder should exist")

  assert.match(
    appSource,
    /from "\.\.\/shared\/sidebar-shell\.js\?v=20260509a"/,
    "Iconoplasm should request a fresh sidebar module version when it imports newly exported sidebar values",
  )
  assert.doesNotMatch(
    appSource,
    /id="icono-gallery-auth"/,
    "home toolbar should not reserve an out-of-place Discord login slot",
  )
  assert.match(
    guestCardBuilder,
    /return ""/,
    "guest login is folded into the install panel now; this helper remains as the no-op guest branch of the Discord action slot",
  )
  assert.doesNotMatch(appSource, /Log in with Discord to track discovered genes/)
  assert.match(
    appSource,
    /galleryState\.offset >= GUEST_STARTER_GENES\.length[\s\S]*appendDiscordActionCard\(auxiliaryContainer\)/,
    "Discord action card should be appended after the three starter gene cards render without forcing every card variant into the same grid host",
  )
  assert.match(
    appSource,
    /function buildDiscordInviteCardMarkup\(\)/,
    "logged-in users should get a Discord server invite card instead of another login card",
  )
  assert.match(
    appSource,
    /data-icono-discord-invite-card[\s\S]*Join the Discord server[\s\S]*>Join Discord<\/a>/,
    "logged-in Discord card should invite users to the server",
  )
  assert.match(
    appSource,
    /function buildCollectionEmptyMarkup\(collectionState\)[\s\S]*currentUser[\s\S]*COMMUNITY_URL[\s\S]*Join Discord/,
    "logged-in empty collection states should also point users to the Discord server invite",
  )
  assert.match(
    appSource,
    /Log in to request new candidates[\s\S]*currentUser \? COMMUNITY_URL : voteLoginUrl\(\)[\s\S]*currentUser \? "Join Discord" : "Log in with Discord"/,
    "gene request-access panels should not show a login action when the shared page user is already signed in",
  )
  assert.match(
    appSource,
    /function renderGeneContent\(container, g\)[\s\S]*renderCandidateGallery\(g\)[\s\S]*icono-gene-discord-card[\s\S]*buildDiscordActionCardMarkup\(\)/,
    "gene pages should include candidate panels in the initial content and still end with the same Discord action card",
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
  assert.match(
    appSource,
    /icono-card icono-guest-login-card icono-install-panel/,
    "extension install instructions should reuse the working guest-login card visual template",
  )
  assert.match(
    appSource,
    /icono-home-auth-link icono-guest-login-card-button icono-install-link/,
    "extension install primary actions should reuse the working guest-login button template",
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

test("DO NOT DELETE: print copy request opens a PNG image, not a modal", () => {
  const appSource = readUtf8("./quartz/static/iconoplasm/app.js")
  const workerSource = readUtf8(
    "./workers/iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js",
  )
  const workerConfig = readUtf8(
    "./wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  )
  const stylesSource = readUtf8("./shared/iconoplasm-card/shared-card-label.css")
  const pageStylesSource = readUtf8("./quartz/static/iconoplasm/styles.css")

  assert.match(
    appSource,
    /function printCopyImageUrl\(symbol, genePayload\)[\s\S]*\/api\/iconoplasm\/print-copy\/[\s\S]*\.png[\s\S]*searchParams\.set\("asset", assetSha\)/,
    "print-copy controls should link to the server PNG endpoint with the displayed asset identity when available",
  )
  assert.match(
    appSource,
    /function setPrintCopyTriggerUrl\(symbol, url\)[\s\S]*data-icono-print-copy-url[\s\S]*setAttribute\("href", url\)[\s\S]*setAttribute\("target", "_blank"\)/,
    "gene pages should attach the PNG endpoint to the printed request control",
  )
  assert.match(
    appSource,
    /function preparePrintCopyImageUrl\(symbol, genePayload\)[\s\S]*printCopyImageUrl\(key, genePayload \|\| readCachedRenderableGenePayload\(key\)\)[\s\S]*setPrintCopyTriggerUrl\(key, url\)/,
    "print-copy preparation should be a cheap link attachment, not a background raster job",
  )
  assert.match(
    workerConfig,
    /\[browser\][\s\S]*binding = "ICONOPLASM_PRINT_COPY_BROWSER"[\s\S]*\[env\.staging\.browser\][\s\S]*binding = "ICONOPLASM_PRINT_COPY_BROWSER"/,
    "the stateful worker must own the Browser Run binding in both prod and staging",
  )
  assert.match(
    workerSource,
    /import puppeteer from "@cloudflare\/puppeteer"/,
    "print-copy PNG generation should use Cloudflare Browser Run, not a browser-side clone renderer",
  )
  assert.match(
    workerSource,
    /function iconoplasmPrintCopyRenderHtml\(\{ cardPayload, origin, symbol \}\)[\s\S]*shared\.renderLabLabelCardHtml\(cardPayload, \{[\s\S]*layoutVariant: "image-only"[\s\S]*portraitSrc: portraitUrl/,
    "the server render page should reuse the existing image-only card renderer",
  )
  assert.match(
    workerSource,
    /ICONOPLASM_PRINT_COPY_RENDER_PREFIX[\s\S]*shared-card-label\.css[\s\S]*handleIconoplasmPrintCopyRender/,
    "Browser Run should screenshot a same-origin render page with the shared card stylesheet and fonts",
  )
  assert.match(
    workerSource,
    /function renderIconoplasmPrintCopyPngWithBrowser\(env, renderUrl, dims\)[\s\S]*page\.setViewport\(\{[\s\S]*deviceScaleFactor: iconoplasmPrintCopyDeviceScaleFactor\(dims\)[\s\S]*element\.screenshot\(\{ type: "png"/,
    "PNG generation should be a real Chromium element screenshot at full portrait scale",
  )
  assert.match(
    workerSource,
    /finally \{[\s\S]*browser\.close\(\)/,
    "Browser Run sessions must be closed explicitly so screenshots do not leak billable browser time",
  )
  assert.match(
    workerSource,
    /env\.KV\.get\(kvKey, "arrayBuffer"\)[\s\S]*env\.KV\.put\(kvKey, pngBytes, \{/,
    "generated PNGs should be cached by snapshot and asset before spending Browser Run again",
  )
  assert.match(
    workerSource,
    /Response\.redirect\([\s\S]*iconoplasmPrintCopyVersionedUrl/,
    "symbol-only PNG requests should redirect to a versioned image URL before immutable caching",
  )
  assert.match(
    workerSource,
    /family === "print_copy_png" \|\| family === "print_copy_render"[\s\S]{0,80}return "first_party_read"/,
    "print-copy routes must be explicitly classified before the fail-loud budget attribution gate",
  )
  assert.doesNotMatch(
    appSource,
    /html2canvas|ensureHtml2Canvas|canvasToPngObjectUrl|toBlob\(|createPrintCopyRasterFrame|renderPrintCopyImageOnlyCard|freezePrintCopyRenderedStyles/,
    "the client must not keep a second DOM rasterization pipeline",
  )
  assert.doesNotMatch(
    appSource + workerSource,
    /fillText\(model\.(fullName|symbol)|ctx\.font =|drawPrintCopyPngCanvas/,
    "print-copy must not maintain a second handmade label renderer",
  )
  assert.doesNotMatch(
    appSource,
    /openPrintCopyViewer|data-icono-print-copy-viewer|cloneNode|role", "dialog"|about:blank/,
    "print-copy requests must not open a modal, clone the archival card, or use a blank-tab placeholder",
  )
  assert.match(
    appSource,
    /function wireGeneContent\(container, genePayload\)[\s\S]*wirePrintCopyRequests\(container, genePayload\)/,
    "gene pages should prepare the PNG before the user clicks",
  )
  assert.match(
    appSource,
    /printCopyTrigger\.getAttribute\("href"\)[\s\S]*stopImmediatePropagation[\s\S]*return/,
    "ready print-copy requests should let the browser open the prepared PNG link directly",
  )
  assert.doesNotMatch(
    stylesSource,
    /\.icono-label-print-copy-request \{[\s\S]*text-decoration:\s*underline/,
    "request print copy should stay printed small-copy, not become a web link",
  )
  assert.doesNotMatch(
    pageStylesSource,
    /icono-print-copy-(viewer|shell|toolbar|stage|action)/,
    "print-copy should not introduce a modal-specific visual language",
  )
})
