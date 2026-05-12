import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { brotliDecompressSync } from "node:zlib"

function readUtf8(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8")
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
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
    /renderCandidateGallery\(g\)[\s\S]*buildDiscordActionCardMarkup\(\)/,
    "gene pages should end with the same Discord action card",
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
