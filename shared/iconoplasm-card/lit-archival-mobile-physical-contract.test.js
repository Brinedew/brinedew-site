import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const appPath = path.join(repoRoot, "quartz", "static", "iconoplasm", "app.js")
const headPath = path.join(repoRoot, "quartz", "components", "Head.tsx")
const cssPath = path.join(repoRoot, "shared", "iconoplasm-card", "shared-card-label.css")
const generatedCssPath = path.join(
  repoRoot,
  "quartz",
  "static",
  "iconoplasm",
  "generated",
  "shared-card-label.css",
)
const fontContractPath = path.join(
  repoRoot,
  "shared",
  "iconoplasm-card",
  "font-contract.json",
)
const voteCssPath = path.join(repoRoot, "shared", "iconoplasm-card", "shared-card-vote.css")
const pageCssPath = path.join(repoRoot, "quartz", "static", "iconoplasm", "styles.css")
const runtimePath = path.join(repoRoot, "shared", "iconoplasm-card", "shared-card-runtime.js")
const litCardPath = path.join(repoRoot, "shared", "iconoplasm-card", "lit-archival-card.js")
const syncPath = path.join(repoRoot, "scripts", "sync-iconoplasm-shared.mjs")

async function sourceText(filePath) {
  return readFile(filePath, "utf8")
}

function cssBlockFor(css, selector) {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `missing CSS selector ${selector}`)
  const open = css.indexOf("{", start)
  assert.notEqual(open, -1, `missing CSS block for ${selector}`)
  const close = css.indexOf("}", open)
  assert.notEqual(close, -1, `unclosed CSS block for ${selector}`)
  return css.slice(open + 1, close)
}

function cssStandaloneBlockFor(css, selector) {
  const startPattern = new RegExp(
    `(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
  )
  const match = startPattern.exec(css)
  assert.ok(match, `missing standalone CSS selector ${selector}`)
  const open = css.indexOf("{", match.index)
  assert.notEqual(open, -1, `missing CSS block for ${selector}`)
  const close = css.indexOf("}", open)
  assert.notEqual(close, -1, `unclosed CSS block for ${selector}`)
  return css.slice(open + 1, close)
}

function cssNumberProperty(block, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = block.match(new RegExp(`${escaped}:\\s*([0-9.]+)\\s*;`))
  assert.ok(match, `missing numeric CSS property ${property}`)
  return Number(match[1])
}

function cssCalcArtboardUnits(block, property) {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = block.match(
    new RegExp(`${escaped}:\\s*calc\\(\\s*([0-9.]+)\\s*/\\s*1220\\s*\\*\\s*100cqw\\s*\\)`),
  )
  assert.ok(match, `missing artboard-unit calc for ${property}`)
  return Number(match[1])
}

test("iconoplasm app script still parses after infocard-only mobile pivot", () => {
  const result = spawnSync(process.execPath, ["--check", appPath], {
    cwd: repoRoot,
    encoding: "utf8",
  })
  assert.equal(result.status, 0, `app.js must parse\n${result.stderr}${result.stdout}`)
})

test("typed footer copy follows the card ink token in light and dark themes", async () => {
  const css = await sourceText(cssPath)
  const typedFooterBlock = cssStandaloneBlockFor(css, ".icono-label-footer-line--typed")

  assert.match(typedFooterBlock, /color:\s*var\(--icono-label-ink\);/)
  assert.doesNotMatch(
    typedFooterBlock,
    /color:\s*#[0-9a-f]{3,8}/i,
    "typed footer copy must not pin light-theme brown ink in dark mode",
  )
})

test("first-paint fonts are embedded and revealed as one bounded transaction", async () => {
  const css = await sourceText(generatedCssPath)
  const head = await sourceText(headPath)
  const contract = JSON.parse(await sourceText(fontContractPath))

  assert.equal(contract.websiteDelivery.strategy, "embedded-fontface-api")
  assert.ok(contract.websiteDelivery.revealTimeoutMs > 0)
  assert.ok(contract.websiteDelivery.revealTimeoutMs < 1000)
  assert.equal(contract.extensionDisplay, "block")
  assert.doesNotMatch(css, /(?:^|\n)@font-face\s*\{/)
  assert.doesNotMatch(head, /\/static\/iconoplasm\/fonts\//)
  assert.match(head, /readFileSync\([\s\S]*\.toString\("base64"\)/)
  assert.match(head, /html\.icono-fonts-loading body \{ visibility: hidden !important; \}/)
  assert.match(head, /new FontFace\(/)
  assert.match(head, /Promise\.all\(faces\.map/)
  assert.match(head, /loadedFaces\.forEach\(function \(face\) \{ document\.fonts\.add\(face\) \}\)/)
  assert.match(head, /root\.setAttribute\("data-icono-fonts", state\)/)
  assert.match(head, /root\.setAttribute\("data-icono-fonts-duration-ms"/)
  assert.match(head, /reveal\("ready"\)/)
  assert.match(head, /reveal\("fallback"\)/)
  assert.match(head, /if \(settled\) return/)

  let embeddedBytes = 0
  for (const font of [...contract.shellFonts, ...contract.fonts]) {
    const embeddedFont = await readFile(
      path.join(repoRoot, "shared", "iconoplasm-card", "fonts", font.embeddedFile),
    )
    assert.ok(embeddedFont.byteLength > 0, `${font.embeddedFile} must contain font data`)
    embeddedBytes += embeddedFont.byteLength
  }
  assert.ok(embeddedBytes < 240_000, `embedded font payload grew to ${embeddedBytes} bytes`)
})

test("mobile voting copy uses a Firefox-safe flex row with a non-shrinking arrow", async () => {
  const css = await sourceText(cssPath)
  const copy = cssBlockFor(css, ".icono-vote-btn-copy {")
  const stack = cssBlockFor(css, ".icono-vote-btn-copy-stack {")
  const arrow = cssBlockFor(css, ".icono-vote-btn-arrow {")

  assert.match(copy, /flex:\s*1 1 auto\s*;/)
  assert.match(copy, /min-width:\s*0\s*;/)
  assert.match(stack, /display:\s*flex\s*;/)
  assert.match(stack, /min-width:\s*0\s*;/)
  assert.doesNotMatch(stack, /grid-template-columns/)
  assert.match(arrow, /flex:\s*0 0 1\.44rem\s*;/)
})

test("lab-label vote ink remains legible when legacy theme attributes disagree", async () => {
  const css = await sourceText(cssPath)

  assert.match(
    css,
    /\.icono-card--variant-lab-label\.icono-card--brick \.icono-vote-box--label,[\s\S]{0,500}--icono-vote-ink:\s*var\(--icono-label-ink\)\s*;/,
  )
  assert.match(
    css,
    /\.icono-card--variant-lab-label\.icono-card--brick \.icono-vote-box--label \.icono-vote-btn,[\s\S]{0,650}color:\s*var\(--icono-vote-ink\)\s*;/,
  )
})

test("mobile archival renderer is infocard-only and has no sleeve or material atlas path", async () => {
  const app = await sourceText(appPath)
  const css = await sourceText(cssPath)
  const runtime = await sourceText(runtimePath)
  const sync = await sourceText(syncPath)
  const combined = `${app}\n${runtime}\n${sync}`

  for (const forbidden of [
    "renderMobileArchivalPhysicalPocketHtml",
    "renderMobileArchivalPhysicalSleeveHtml",
    "icono-card--mobile-physical-pocket",
    'data-icono-physical-noun="sleeve-front"',
    'data-icono-physical-noun="thumb-cut"',
    'data-icono-material-system="baked-paper-atlas"',
    "/static/iconoplasm/materials/mobile-pocket/",
    "generate-iconoplasm-mobile-pocket-materials",
  ]) {
    assert.equal(combined.includes(forbidden), false, `${forbidden} must not survive the pivot`)
  }

  assert.match(
    app,
    /mobileArchivalObjectMarkup\(portraitHtml, infoHtml\)/,
    "brick markup should wrap the canonical portrait and info card in one physical card object",
  )
  assert.match(
    app,
    /mobileArchivalObjectMarkup\(portraitMarkup, heroInfoMarkup\)/,
    "gene lead markup should wrap the canonical portrait and info card in one physical card object",
  )
  assert.doesNotMatch(
    `${app}\n${css}`,
    /icono-mobile-card-aperture/,
    "mobile card code must not reintroduce a separate aperture object around the physical card",
  )

  const shared = await import(pathToFileURL(runtimePath).href)
  const sharedRuntime = shared.IconoCardShared || globalThis.IconoplasmCardShared
  assert.equal(
    Object.hasOwn(sharedRuntime, "renderMobileArchivalPhysicalSleeveHtml"),
    false,
    "shared runtime must not export the removed sleeve renderer",
  )
})

test("real seven-clan KALRN infocard projects PFAM lanes into a 4 plus 3 column layout", async () => {
  const shared = await import(pathToFileURL(runtimePath).href)
  const sharedRuntime = shared.IconoCardShared || globalThis.IconoplasmCardShared
  // Real local source fixture from D:\Coding\Datasets\iconoplasm\proteins_with_demographics.json
  // plus D:\Coding\Datasets\iconoplasm\prompts.db for the paired style labels.
  const model = sharedRuntime.resolveArchivalCardModel({
    symbol: "KALRN",
    full_name: "Kalirin",
    essence: {
      aesthetics_origin: [
        "Immunoglobulin E-set",
        "Protein Kinase",
        "Spectrin",
        "Dbl homology-like",
        "CRAL-TRIO",
        "PH domain",
        "SH3",
      ],
      aesthetics: [
        "Y\u014dkai",
        "Neoclassicism",
        "Sunshine Pop",
        "Ballet",
        "Old Hollywood",
        "Sprezzatura",
        "Flogger",
      ],
    },
  })
  assert.equal(model.stylePairs.length, 7, "mobile and Lit cards need up to seven clan lanes")
  assert.deepEqual(
    model.stylePairs.map((pair) => pair.origin),
    [
      "Immunoglobulin E-set",
      "Protein Kinase",
      "Spectrin",
      "Dbl homology-like",
      "CRAL-TRIO",
      "PH domain",
      "SH3",
    ],
  )
  assert.deepEqual(
    model.stylePairs.map((pair) => pair.note.normalize("NFC")),
    [
      "Y\u014dkai",
      "Neoclassicism",
      "Sunshine Pop",
      "Ballet",
      "Old Hollywood",
      "Sprezzatura",
      "Flogger",
    ],
  )
  assert.deepEqual(
    model.stylePairColumns.map((column) => column.map((pair) => pair.origin)),
    [
      ["Immunoglobulin E-set", "Protein Kinase", "Spectrin", "Dbl homology-like"],
      ["CRAL-TRIO", "PH domain", "SH3"],
    ],
    "5+ clan genes must split after the fourth lane instead of stacking every clan on the left",
  )
  assert.equal(
    model.stylePairs.some((pair) => /\+\d|more clans|mixed/i.test(`${pair.origin} ${pair.note}`)),
    false,
    "seven-clan genes should show the lanes directly, not a lossy overflow summary",
  )
  const html = sharedRuntime.renderLabLabelCardHtml(
    {
      symbol: "KALRN",
      full_name: "Kalirin",
      essence: {
        aesthetics_origin: [
          "Immunoglobulin E-set",
          "Protein Kinase",
          "Spectrin",
          "Dbl homology-like",
          "CRAL-TRIO",
          "PH domain",
          "SH3",
        ],
        aesthetics: [
          "Y\u014dkai",
          "Neoclassicism",
          "Sunshine Pop",
          "Ballet",
          "Old Hollywood",
          "Sprezzatura",
          "Flogger",
        ],
      },
    },
    { layoutVariant: "lit-archival" },
  )
  assert.match(html, /icono-label-style-stack icono-label-style-stack--two-column/)
  const rightColumnIndex = html.indexOf("icono-label-style-column icono-label-style-column--right")
  assert.notEqual(rightColumnIndex, -1, "7-clan real cards must render a right column")
  assert.equal(
    html.slice(0, rightColumnIndex).includes("CRAL-TRIO"),
    false,
    "the fifth real clan must not remain in the left column",
  )
  assert.notEqual(html.slice(rightColumnIndex).indexOf("CRAL-TRIO"), -1)
  assert.notEqual(html.slice(rightColumnIndex).indexOf("SH3"), -1)
})

test("real five-clan DMD infocard renders as four left lanes and one right lane", async () => {
  const shared = await import(pathToFileURL(runtimePath).href)
  const sharedRuntime = shared.IconoCardShared || globalThis.IconoplasmCardShared
  const model = sharedRuntime.resolveArchivalCardModel({
    symbol: "DMD",
    full_name: "Dystrophin",
    essence: {
      aesthetics_origin: ["Calponin homology", "WW", "Spectrin", "RING", "EF-hand"],
      aesthetics: ["Metal", "Mod Revival", "Sunshine Pop", "Cholo", "Chinese New Year"],
    },
  })
  assert.deepEqual(
    model.stylePairColumns.map((column) => column.map((pair) => pair.origin)),
    [["Calponin homology", "WW", "Spectrin", "RING"], ["EF-hand"]],
  )
  const html = sharedRuntime.renderLabLabelCardHtml(
    {
      symbol: "DMD",
      full_name: "Dystrophin",
      essence: {
        aesthetics_origin: ["Calponin homology", "WW", "Spectrin", "RING", "EF-hand"],
        aesthetics: ["Metal", "Mod Revival", "Sunshine Pop", "Cholo", "Chinese New Year"],
      },
    },
    { layoutVariant: "lit-archival" },
  )
  assert.match(html, /icono-label-style-stack icono-label-style-stack--two-column/)
  const rightColumnIndex = html.indexOf("icono-label-style-column icono-label-style-column--right")
  assert.notEqual(rightColumnIndex, -1, "5+ real clan cards must render a right column")
  assert.notEqual(html.slice(0, rightColumnIndex).indexOf("RING"), -1)
  assert.equal(
    html.slice(0, rightColumnIndex).includes("EF-hand"),
    false,
    "the fifth clan must not remain in the left column",
  )
  assert.notEqual(html.slice(rightColumnIndex).indexOf("EF-hand"), -1)
})

test("desktop real seven-clan PFAM lane geometry fits four rows inside the archival cell", async () => {
  const css = await sourceText(cssPath)
  const styleColumnBlock = cssStandaloneBlockFor(css, ".icono-label-style-column")
  const stylePairBlock = cssStandaloneBlockFor(css, ".icono-label-style-pair")
  const originTextBlock = cssBlockFor(css, ".icono-label-origin-text")
  const handNoteBlock = cssBlockFor(css, ".icono-label-hand-note")
  const desktopColumnGapUnits = cssCalcArtboardUnits(styleColumnBlock, "gap")
  const pairGapUnits = cssCalcArtboardUnits(stylePairBlock, "gap")
  const originTextUnits = cssCalcArtboardUnits(originTextBlock, "font-size")
  const originLineHeight = cssNumberProperty(originTextBlock, "line-height")
  const handTextUnits = 36
  assert.match(
    handNoteBlock,
    /font-size:\s*var\(--icono-label-hand-size\);/,
    "desktop handwritten style labels should continue to use the shared hand-size token",
  )
  const handLineHeight = cssNumberProperty(handNoteBlock, "line-height")
  const desktopPairHeightUnits =
    originTextUnits * originLineHeight + pairGapUnits + handTextUnits * handLineHeight
  const fourRowLaneHeightUnits = desktopPairHeightUnits * 4 + desktopColumnGapUnits * 3

  assert.ok(
    fourRowLaneHeightUnits <= 253,
    `desktop KALRN-style four-row PFAM lane is ${fourRowLaneHeightUnits.toFixed(
      2,
    )} artboard units tall; it must stay within the measured desktop cell budget`,
  )
})

test("mobile infocard closed state only peeks the top sheet and uses a real jagged viewport cutoff", async () => {
  const css = await sourceText(cssPath)
  assert.match(
    css,
    /--icono-label-mobile-preview-height:\s*0rem;/,
    "closed state should not reserve an extra preview slab below the top infocard strip",
  )
  assert.match(
    css,
    /block-size:\s*calc\(\s*var\(--icono-label-mobile-viewport-height\)\s*\*\s*var\(--icono-label-mobile-fit-scale,\s*1\)\s*\);/,
    "the card body's scaled viewport height, not an inner infocard transform, should control the crop",
  )

  assert.match(
    css,
    /--icono-label-info-card-pull-y:\s*0px;/,
    "the infocard should stay in place; the viewport changes height instead",
  )
  assert.match(
    css,
    /bottom:\s*auto;/,
    "the absolute infocard must measure its full content height; bottom: 0 clips the open viewport before the color breakdown",
  )
  assert.match(css, /transform:\s*none;/)
  assert.equal(
    /transform:\s*translateY\(var\(--icono-label-info-card-pull-y\)\)/.test(css),
    false,
    "mobile infocard must not be pulled upward or downward by transform",
  )

  const mobileCardStart = css.lastIndexOf(
    ".icono-card--variant-lab-label.icono-card--brick {",
    css.indexOf("--icono-label-mobile-portrait-pad"),
  )
  assert.notEqual(mobileCardStart, -1, "missing mobile card viewport block")
  const mobileCardEnd = css.indexOf(
    '.icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-swiping="true"]',
    mobileCardStart,
  )
  assert.notEqual(mobileCardEnd, -1, "missing swiping mobile card block")
  const cardBlock = css.slice(mobileCardStart, mobileCardEnd)
  assert.match(
    cardBlock,
    /clip-path:\s*polygon\(/,
    "closed viewport edge must be the card body's own crop geometry, not a separate viewport widget",
  )
  assert.match(
    cardBlock,
    /overflow:\s*clip;/,
    "the root physical card must own the crop instead of delegating it to an aperture shell",
  )
  assert.match(
    cardBlock,
    /100% 96\.7%,\s*96\.8% 99\.9%/,
    "the real clipped edge must use broad enough teeth to read as torn at mobile size, not a dense line that visually averages straight",
  )
  assert.match(cardBlock, /51\.2% 99\.9%/)
  assert.match(
    cardBlock,
    /filter:\s*[\s\S]*drop-shadow\(\s*0\s+0\.045rem\s+0\s+color-mix\(in srgb,\s*var\(--icono-label-rule-strong\)\s+58%,\s*transparent\)\s*\)[\s\S]*drop-shadow\(0 0\.16rem 0\.18rem rgba\(53, 38, 27, 0\.16\)\)/,
    "closed clipped viewport needs a visible edge treatment that follows the actual clip-path geometry",
  )

  const expandedBlock = cssBlockFor(
    css,
    '.icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-expanded="true"]',
  )
  assert.match(
    expandedBlock,
    /clip-path:\s*inset\(0\);/,
    "jagged crop must disappear when the viewport is fully open",
  )
  assert.match(
    expandedBlock,
    /filter:\s*none;/,
    "open state must remove the visible torn cutoff edge",
  )
  const peekAfterBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek::after",
  )
  assert.match(
    peekAfterBlock,
    /content:\s*none;/,
    "the tab must not have a fake footer separator line",
  )
  assert.equal(
    /icono-card--variant-lab-label\.icono-card--brick::after[\s\S]*linear-gradient/.test(css) ||
      /linear-gradient/.test(peekAfterBlock),
    false,
    "the rip edge must not be a painted pseudo-element overlay on the card or peek",
  )
})

test("archival card surfaces do not paint a white paper bloom in dark mode", async () => {
  const css = await sourceText(cssPath)
  const sheetBlock = cssBlockFor(css, ".icono-label-sheet-body")
  assert.doesNotMatch(
    sheetBlock,
    /radial-gradient\([^)]*rgba\(255,\s*255,\s*255,\s*0\.22\)/,
    "the main archival sheet must not layer a white radial wash over dark paper",
  )

  const dossierSelector =
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-dossier-shell"
  const dossierStart = css.indexOf(
    dossierSelector,
    css.indexOf("--icono-label-mobile-dossier-height"),
  )
  assert.notEqual(dossierStart, -1, "missing mobile dossier shell block")
  const dossierBlock = css.slice(dossierStart, css.indexOf("}", dossierStart))
  assert.doesNotMatch(
    dossierBlock,
    /radial-gradient\([^)]*rgba\(255,\s*255,\s*255,\s*0\.22\)/,
    "the mobile dossier shell must not layer a white radial wash over dark paper",
  )
})

test("mobile archival card keeps one physical width instead of reflowing with the browser", async () => {
  const css = await sourceText(cssPath)
  const mobileGridBlock = cssBlockFor(css, '.icono-grid[data-layout="bricks"]')
  assert.match(mobileGridBlock, /justify-items:\s*center;/)
  assert.match(mobileGridBlock, /overflow-x:\s*visible;/)

  const mobileCardStart = css.lastIndexOf(
    ".icono-card--variant-lab-label.icono-card--brick {",
    css.indexOf("--icono-label-mobile-portrait-pad"),
  )
  assert.notEqual(mobileCardStart, -1, "missing mobile physical card block")
  const mobileCardEnd = css.indexOf(
    '.icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-swiping="true"]',
    mobileCardStart,
  )
  assert.notEqual(mobileCardEnd, -1, "missing swiping mobile card block")
  const cardBlock = css.slice(mobileCardStart, mobileCardEnd)
  assert.match(
    cardBlock,
    /--icono-label-mobile-physical-width:\s*23\.4rem;/,
    "mobile card needs one physical design width instead of width-by-viewport reflow",
  )
  assert.match(
    cardBlock,
    /inline-size:\s*calc\(\s*var\(--icono-label-mobile-physical-width\)\s*\*\s*var\(--icono-label-mobile-fit-scale,\s*1\)\s*\);/,
    "the root card is a layout box that reserves the scaled physical width",
  )
  assert.match(cardBlock, /max-inline-size:\s*none;/)
  assert.match(
    cardBlock,
    /block-size:\s*calc\(\s*var\(--icono-label-mobile-viewport-height\)\s*\*\s*var\(--icono-label-mobile-fit-scale,\s*1\)\s*\);/,
    "the root card should reserve the scaled physical card height instead of relying on CSS zoom",
  )
  assert.match(
    cardBlock,
    /\.icono-mobile-card-physical-object[\s\S]*inline-size:\s*var\(--icono-label-mobile-physical-width\);/,
    "the physical object remains the unscaled card width",
  )
  assert.match(
    cardBlock,
    /\.icono-mobile-card-physical-object[\s\S]*transform:\s*scale\(var\(--icono-label-mobile-fit-scale,\s*1\)\);/,
    "mobile archival card should optically fit by scaling the physical object, not by changing blot geometry",
  )
  assert.doesNotMatch(
    cardBlock,
    /zoom:\s*var\(--icono-label-mobile-fit-scale/,
    "do not use CSS zoom; it couples layout measurement to scaling and encourages variable child geometry",
  )
  const portraitViewportBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-specimen-viewport",
  )
  assert.match(
    portraitViewportBlock,
    /max-height:\s*none;/,
    "the blot holder is part of the physical card and must not be height-squeezed by browser viewport math",
  )
  assert.doesNotMatch(
    portraitViewportBlock,
    /100dvh|--icono-label-mobile-peek-height/,
    "browser viewport math belongs to the whole card scale, not the physical blot holder",
  )
  assert.doesNotMatch(
    cardBlock,
    /\.icono-label-specimen-viewport[\s\S]*\.icono-brick-media-link[\s\S]*pointer-events:\s*none;/,
    "the visible blot must remain clickable for full-screen viewing; only the infocard surface owns the open/closed toggle",
  )
  const rootMobileCardBlock = cardBlock.slice(
    0,
    cardBlock.indexOf(
      ".icono-card--variant-lab-label.icono-card--brick .icono-mobile-card-physical-object",
    ),
  )
  assert.doesNotMatch(
    rootMobileCardBlock,
    /inline-size:\s*100%;/,
    "mobile archival card must not resize its internal geometry to the browser width",
  )
  assert.doesNotMatch(
    mobileGridBlock,
    /overflow-x:\s*auto;/,
    "the physical-width repair must not make narrow phones inspect a sideways-cropped card",
  )
})

test("mobile viewport geometry computes a fit scale before measuring the sheet", async () => {
  const app = await sourceText(appPath)
  const resetStart = app.indexOf("function resetMobileLabelCardState")
  const resetEnd = app.indexOf("function syncMobileLabelViewportGeometry", resetStart)
  assert.notEqual(resetStart, -1, "missing mobile reset helper")
  assert.notEqual(resetEnd, -1, "missing mobile viewport geometry helper")
  const resetBlock = app.slice(resetStart, resetEnd)
  assert.match(resetBlock, /--icono-label-mobile-fit-scale/)

  const geometryStart = app.indexOf("function syncMobileLabelViewportGeometry")
  const geometryEnd = app.indexOf("var portrait = card.querySelector", geometryStart)
  assert.notEqual(geometryStart, -1, "missing mobile viewport geometry helper")
  assert.notEqual(geometryEnd, -1, "fit-scale setup should happen before portrait measurement")
  const setupBlock = app.slice(geometryStart, geometryEnd)
  assert.match(setupBlock, /card\.scrollWidth\s*\|\|\s*card\.offsetWidth/)
  assert.match(setupBlock, /--icono-label-mobile-physical-width/)
  assert.match(
    setupBlock,
    /card\.offsetWidth\s*\?\s*card\.offsetWidth\s*:\s*Number\.POSITIVE_INFINITY/,
    "mobile fit must be bounded by the rendered card, not the wider page column",
  )
  assert.match(setupBlock, /cardParent\.clientWidth/)
  assert.match(setupBlock, /document\.documentElement\.clientWidth/)
  assert.match(
    setupBlock,
    /visibleParentLeft[\s\S]*visibleParentRight[\s\S]*visibleParentWidth/,
    "mobile fit scale must use the parent's visible intersection without subtracting its viewport inset twice",
  )
  assert.doesNotMatch(setupBlock, /parentInset|viewportWidth - parentInset \* 2/)
  assert.match(setupBlock, /availableWidth \/ physicalWidth/)
  assert.doesNotMatch(
    setupBlock,
    /closedPhysicalHeight/,
    "mobile optical fit must not be height-capped by the old whole-card estimate; width owns browser-edge fit",
  )
  assert.match(setupBlock, /Math\.min\(1\.9,\s*availableWidth \/ physicalWidth\)/)
  assert.match(setupBlock, /Math\.max\(0\.78,\s*fitScale\)/)
  assert.doesNotMatch(
    setupBlock,
    /--icono-label-mobile-portrait-max-height|availableHeight \/ activeFitScale/,
    "the geometry controller must not vary the blot/portrait holder to fix browser fit; it should scale the whole physical object",
  )
  assert.match(
    setupBlock,
    /function \(value\) \{\s*return value \/ activeFitScale\s*\}/,
    "geometry measured after CSS zoom must be normalized back into physical card pixels before writing CSS vars",
  )
  assert.match(setupBlock, /--icono-label-mobile-fit-scale/)

  const head = await sourceText(headPath)
  assert.match(
    head,
    /@media \(min-width: 407px\) and \(max-width: 720px\)[\s\S]*icono-gene-lead-card[\s\S]*\.iconoplasm-tooltip-portrait[\s\S]*\.iconoplasm-tooltip-body[\s\S]*height: auto;/,
    "critical mobile CSS must release the desktop 100% height only once the card can upscale",
  )
  assert.doesNotMatch(
    head,
    /@media \(max-width: 760px\)[\s\S]*icono-gene-lead-card/,
    "critical and hydrated lead-card breakpoints must not disagree",
  )
})

test("mobile Iconoplasm page removes nested padding that creates dead card gutters", async () => {
  const styles = await sourceText(path.join(repoRoot, "quartz/static/iconoplasm/styles.css"))
  assert.match(
    styles,
    /@media \(max-width:\s*720px\)[\s\S]*#iconoplasm-root[\s\S]*padding-inline:\s*0;/,
  )
  assert.match(
    styles,
    /@media \(max-width:\s*720px\)[\s\S]*\.icono-gene-lead[\s\S]*align-items:\s*center;/,
    "when height limits mobile zoom, the physical card must stay centered instead of leaving a one-sided gutter",
  )
})

test("mobile card recomputes fit scale on same-breakpoint browser resizing", async () => {
  const app = await sourceText(appPath)
  const reconcileStart = app.indexOf("function reconcileMobileLabelBreakpoint")
  const reconcileEnd = app.indexOf("function queueMobileLabelBreakpointRefresh", reconcileStart)
  assert.notEqual(reconcileStart, -1, "missing mobile breakpoint reconciliation")
  assert.notEqual(reconcileEnd, -1, "missing mobile breakpoint refresh queue")
  const reconcileBlock = app.slice(reconcileStart, reconcileEnd)
  assert.match(reconcileBlock, /nextMode === mobileLabelReviewMode/)
  assert.match(
    reconcileBlock,
    /querySelectorAll\(\s*["']\.icono-card--variant-lab-label\.icono-card--brick/,
  )
  assert.match(
    reconcileBlock,
    /syncMobileLabelViewportGeometry\(mobileCards\[i\]\)/,
    "dragging the browser edge inside mobile mode must recompute card scale instead of leaving a side gap",
  )
  assert.doesNotMatch(app, /--icono-label-mobile-portrait-max-height/)
})

test("mobile infocard tab is part of the sheet surface and casts a shadow over the blot card", async () => {
  const css = await sourceText(cssPath)
  const litCard = await sourceText(litCardPath)
  assert.match(
    css,
    /filter:\s*drop-shadow\(0 -0\.24rem 0\.28rem rgba\(53, 38, 27, 0\.16\)\)/,
    "the moving info card needs an upward shadow onto the portrait/blot card",
  )

  assert.equal(
    /icono-label-mobile-peek-tab-art|icono-label-mobile-peek-tab-fill|icono-label-mobile-peek-tab-highlight/.test(
      litCard,
    ),
    false,
    "the gene tab must not be a separate SVG badge that can visually detach from the sheet",
  )
  assert.match(
    css,
    /current public catalog max gene-symbol length is 14 chars[\s\S]*`EEF1AKMT4-ECE2`/,
    "mobile tab sizing must be documented against the actual longest catalog symbol, not a guessed short example",
  )
  assert.match(
    css,
    /--icono-label-mobile-tab-symbol-capacity:\s*17ch;/,
    "mobile tab must fit the longest current catalog gene symbol on one row with optical centering runway",
  )
  assert.match(
    css,
    /--icono-label-mobile-tab-width:\s*var\(--icono-label-mobile-tab-symbol-capacity\);/,
    "tab width must be a character-capacity contract",
  )
  assert.match(
    css,
    /--icono-label-mobile-tab-safe-inset:\s*0\.92rem;/,
    "the physical tab anchor is part of the existing sheet design and must not be moved to fake text centering",
  )
  const bodyBeforeBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .iconoplasm-tooltip-body::before",
  )
  assert.match(bodyBeforeBlock, /right:\s*var\(--icono-label-mobile-tab-safe-inset\);/)
  assert.doesNotMatch(
    bodyBeforeBlock,
    /left:\s*50%;/,
    "do not move the tab material to fake text centering",
  )
  assert.doesNotMatch(
    bodyBeforeBlock,
    /translateX\(-50%\);/,
    "do not move the tab material to fake text centering",
  )
  assert.match(bodyBeforeBlock, /bottom:\s*calc\(100% - 0\.08rem\);/)
  assert.match(bodyBeforeBlock, /border-bottom:\s*0;/)
  assert.match(bodyBeforeBlock, /border-radius:\s*1\.16rem 1\.16rem 0 0/)
  const oldPeekBeforeBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek::before",
  )
  assert.match(
    oldPeekBeforeBlock,
    /content:\s*none;/,
    "the peek strip must not own tab material after the compound-surface refactor",
  )

  const tabBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek-tab",
  )
  assert.match(
    tabBlock,
    /bottom:\s*calc\(100% \+ 0\.02rem\);/,
    "the gene symbol tab text must seat above the infocard top edge instead of clipping through the sheet",
  )
  assert.match(tabBlock, /right:\s*var\(--icono-label-mobile-tab-safe-inset\);/)
  assert.doesNotMatch(
    tabBlock,
    /left:\s*50%;/,
    "do not move the tab text container to fake text centering",
  )
  assert.doesNotMatch(
    tabBlock,
    /translateX\(-50%\);/,
    "do not move the tab text container to fake text centering",
  )
  assert.match(
    tabBlock,
    /visible tab material is owned by the infocard body's compound surface/,
    "the tab text container must not own separate material/border geometry",
  )
  assert.match(
    tabBlock,
    /inline-size:\s*calc\(var\(--icono-label-mobile-tab-width\) \+ 1\.36rem\);/,
  )
  assert.match(tabBlock, /font-family:\s*"League Spartan";/)
  assert.match(
    tabBlock,
    /font-size:\s*var\(--icono-label-mobile-tab-symbol-size\);/,
    "mobile gene symbol scale must come from the tab typography token",
  )
  assert.match(
    tabBlock,
    /align-items:\s*center;/,
    "tab symbol should sit optically centered in the tab face",
  )
  assert.match(
    tabBlock,
    /padding:\s*0\.05rem 0\.58rem 0;/,
    "the printed symbol must stay clear of the tab footer edge",
  )

  const symbolBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek-tab-symbol",
  )
  assert.match(symbolBlock, /line-height:\s*0\.96;/)
  assert.match(symbolBlock, /max-width:\s*none;/)
  assert.match(symbolBlock, /overflow:\s*visible;/)
  assert.match(
    symbolBlock,
    /inline-size:\s*max-content;/,
    "the printed symbol box should size to the actual rendered string plus its optical spacer",
  )
  assert.match(
    symbolBlock,
    /text-overflow:\s*clip;/,
    "gene-symbol IDs must not ellipsize; widen the tab runway instead of clipping identifiers",
  )
  assert.match(
    symbolBlock,
    /letter-spacing:\s*0\.08em;[\s\S]*text-indent:\s*0\.08em;/,
    "tracked tab text must balance the browser's trailing letter-spacing so visual ink, not the DOM text box, is centered",
  )
  assert.match(
    symbolBlock,
    /transform:\s*none;/,
    "the printed symbol must be centered by the tab layout, not by a horizontal nudge",
  )
  assert.doesNotMatch(
    symbolBlock,
    /translateY/,
    "tab symbol vertical position should come from the tab layout, not a brittle vertical nudge",
  )

  assert.match(
    css,
    /\.icono-card--variant-lab-label\.icono-card--brick \.icono-label-mobile-peek-tab-symbol::before[\s\S]*content:\s*"0";[\s\S]*visibility:\s*hidden;/,
    "mobile tab optical centering should use a hidden left spacer, not a measured or visible glyph",
  )
  assert.doesNotMatch(
    litCard,
    /@chenglou\/pretext|measureNaturalWidth|prepareWithSegments/,
    "B-479 should not depend on a text-layout library when a simple invisible spacer solves the optical padding",
  )
})

test("expanded mobile viewport grows downward instead of moving the infocard or scrolling the page", async () => {
  const app = await sourceText(appPath)
  const geometryStart = app.indexOf("function syncMobileLabelViewportGeometry")
  assert.notEqual(geometryStart, -1, "missing viewport geometry helper")
  const geometryEnd = app.indexOf("function syncMobileLabelDossierContent", geometryStart)
  assert.notEqual(geometryEnd, -1, "viewport geometry helper should precede dossier sync")
  const geometry = app.slice(geometryStart, geometryEnd)

  assert.match(geometry, /--icono-label-mobile-dossier-top/)
  assert.match(geometry, /--icono-label-mobile-viewport-height/)
  assert.match(
    geometry,
    /voteRect[\s\S]*\? toPhysicalCardPx\(voteRect\.bottom - cardRect\.top\) \+ 16/,
  )
  assert.match(geometry, /fullInfoHeight = Math\.max\(toPhysicalCardPx\(peekRect\.height\)/)
  assert.match(
    geometry,
    /infoCard\.scrollHeight[\s\S]*fullInfoHeight = Math\.max\(fullInfoHeight, toPhysicalCardPx\(infoCard\.scrollHeight\)\)/,
    "open viewport must include the full rendered sheet height; selector-only endpoint checks missed the visible tail clipping",
  )
  assert.match(geometry, /measuredContent = infoCard\.querySelectorAll/)
  assert.match(geometry, /\.icono-label-footer-row/)
  assert.match(geometry, /toPhysicalCardPx\(measuredRect\.bottom - infoRect\.top\)/)
  assert.match(geometry, /dossierTop \+ fullInfoHeight/)
  assert.doesNotMatch(
    geometry,
    /infoCard\.offsetHeight|icono-label-dossier-shell|icono-label-dossier-sheet/,
    "open viewport height must not follow stretching grid shells",
  )
  assert.match(
    app,
    /setTimeout\(function \(\) \{\s*syncMobileLabelViewportGeometry\(card\)[\s\S]*?restoreCardTop\(\)[\s\S]*?\}, 320\)/,
  )
  assert.match(
    app,
    /setTimeout\(function \(\) \{\s*syncMobileLabelViewportGeometry\(card\)[\s\S]*?restoreCardTop\(\)[\s\S]*?\}, 720\)/,
  )
  assert.equal(
    /scrollBy|scrollIntoView|translateY|sleeve|envelope|sleeve-front|physical-noun/.test(geometry),
    false,
  )
  const expansionStart = app.indexOf("function setMobileLabelExpanded")
  const expansionEnd = app.indexOf("function setMobileLabelQcCopy", expansionStart)
  assert.notEqual(expansionStart, -1, "missing mobile expansion helper")
  assert.notEqual(expansionEnd, -1, "missing mobile expansion helper end")
  const expansionBlock = app.slice(expansionStart, expansionEnd)
  assert.match(
    expansionBlock,
    /shouldPreserveTop[\s\S]*anchorRect\.bottom > 0 && anchorRect\.top < window\.innerHeight[\s\S]*anchorTop = anchorRect\.top[\s\S]*restoreCardTop[\s\S]*window\.scrollBy\(0,\s*delta\)/,
    "visible card expansion must preserve the card's visual top, but passive wiring must not let offscreen cards drag the viewport",
  )
  assert.match(app, /setMobileLabelExpanded\(card, false, \{ preserveTop: false \}\)/)
  assert.match(expansionBlock, /requestAnimationFrame[\s\S]*restoreCardTop\(\)/)
  assert.doesNotMatch(
    app,
    /setMobileLabelExpanded\(leadCard,\s*true\)/,
    "the gene page must not auto-expand; closed state should show the top infocard until the viewport is tapped",
  )
})

test("mobile archive restoration is scoped to the current SPA session", async () => {
  const app = await sourceText(appPath)
  const head = await sourceText(headPath)

  assert.match(
    app,
    /var ICONO_ARCHIVE_RESTORE_SESSION =[\s\S]*Date\.now\(\)\.toString\(36\)[\s\S]*Math\.random\(\)\.toString\(36\)/,
    "archive scroll restoration needs a runtime-only session key so reloads cannot replay old card-stack camera state",
  )
  assert.match(
    app,
    /history\.scrollRestoration = "manual"/,
    "the app bundle should keep owning restoration policy for SPA rerenders",
  )
  assert.match(
    head,
    /iconoplasmBootstrapScript[\s\S]*history\.scrollRestoration = "manual"/,
    "the head bootstrap must disable browser auto scroll restoration before the late app bundle can run",
  )
  assert.match(
    head,
    /iconoplasmFreshState\.iconoplasmHome = null[\s\S]*window\.history\.replaceState\(iconoplasmFreshState[\s\S]*window\.scrollTo\(\{ left: 0, top: 0, behavior: "instant" \}\)[\s\S]*document\.documentElement\.scrollTop = 0/,
    "a fresh home page load should clear stale archive camera state in the earliest bootstrap, before async card layout can inherit it",
  )

  const snapshotStart = app.indexOf("function snapshotHomeState")
  const snapshotEnd = app.indexOf("function writeCollectionUrl", snapshotStart)
  assert.notEqual(snapshotStart, -1, "missing home snapshot helper")
  assert.notEqual(snapshotEnd, -1, "missing home snapshot helper boundary")
  const snapshotBlock = app.slice(snapshotStart, snapshotEnd)
  assert.match(snapshotBlock, /restoreSession: ICONO_ARCHIVE_RESTORE_SESSION/)
  assert.match(snapshotBlock, /cursor: snapshot\.cursor/)
  assert.match(snapshotBlock, /offset: snapshot\.offset/)
  assert.match(snapshotBlock, /anchorGene: snapshot\.anchorGene/)
  assert.match(snapshotBlock, /scrollY: Math\.max/)

  const restoreStart = app.indexOf("function readHomeRestoreState")
  const restoreEnd = app.indexOf("function captureHomeAnchor", restoreStart)
  assert.notEqual(restoreStart, -1, "missing home restore helper")
  assert.notEqual(restoreEnd, -1, "missing home restore helper boundary")
  const restoreBlock = app.slice(restoreStart, restoreEnd)
  assert.match(
    restoreBlock,
    /home\.restoreSession !== ICONO_ARCHIVE_RESTORE_SESSION\) return null/,
    "fresh reloads must reject old persisted scroll state, while same-session Back can still restore",
  )
  assert.match(restoreBlock, /cursor/)
  assert.match(restoreBlock, /anchorGene/)
  assert.match(restoreBlock, /scrollY/)

  const navigationStart = app.indexOf("function buildNavigationState")
  const navigationEnd = app.indexOf("function navigateTo", navigationStart)
  assert.notEqual(navigationStart, -1, "missing navigation-state helper")
  assert.notEqual(navigationEnd, -1, "missing navigation-state helper boundary")
  const navigationBlock = app.slice(navigationStart, navigationEnd)
  assert.match(navigationBlock, /restoreSession === ICONO_ARCHIVE_RESTORE_SESSION/)
  assert.match(navigationBlock, /nextState\.iconoplasmHome = carriedHomeState/)
  assert.doesNotMatch(navigationBlock, /iconoplasmHome = null/)

  const initStart = app.indexOf("function init()")
  const initEnd = app.indexOf("// Quartz uses SPA navigation", initStart)
  assert.notEqual(initStart, -1, "missing init helper")
  assert.notEqual(initEnd, -1, "missing init helper boundary")
  const initBlock = app.slice(initStart, initEnd)
  assert.match(
    initBlock,
    /currentState\.iconoplasmHome\.restoreSession !== ICONO_ARCHIVE_RESTORE_SESSION[\s\S]*replaceHistoryStatePatch\(\{ iconoplasmHome: null \}\)/,
    "stale history-state scroll should be cleared on normal startup, not replayed through async archive loading",
  )
})

test("same-session archive return restores an exact virtual segment without caching the full DOM", async () => {
  const app = await sourceText(appPath)

  assert.doesNotMatch(app, /cachedHomeView|createDocumentFragment\(\)/)
  assert.match(
    app,
    /function scrollWindowInstantly[\s\S]*behavior: "instant"/,
    "programmatic archive restoration must bypass the site's global smooth-scroll CSS",
  )
  assert.match(
    app,
    /feedController\.reset\(\{ offset: startOffset, cursor: startCursor, page: startPage \}\)/,
  )
  assert.match(app, /restoreState && restoreState\.anchorGene/)
  assert.match(app, /getBoundingClientRect\(\)\.top - Number\(restoreState\.anchorTop/)
})

test("mobile card uses the larger B-483 type scale instead of the tiny draft scale", async () => {
  const css = await sourceText(cssPath)
  const cardStart = css.indexOf(
    ".icono-card--variant-lab-label.icono-card--brick {\n    /* Mobile archival card has four text voices",
  )
  assert.notEqual(cardStart, -1, "missing mobile typography token block")
  const cardEnd = css.indexOf(
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek-name",
    cardStart,
  )
  assert.notEqual(cardEnd, -1, "missing mobile typography token block end")
  const tokenBlock = css.slice(cardStart, cardEnd)
  assert.match(tokenBlock, /--icono-label-mobile-tab-symbol-size:\s*1\.14rem;/)
  assert.match(tokenBlock, /--icono-label-mobile-typewriter-size:\s*1\.008rem;/)
  assert.match(
    tokenBlock,
    /--icono-label-mobile-hand-size:\s*1\.55rem;/,
    "mobile handwriting needs one readable Caveat display size; it must not be collapsed toward the typewriter size",
  )
  assert.match(tokenBlock, /--icono-label-mobile-label-size:\s*0\.52rem;/)
  assert.doesNotMatch(tokenBlock, /--icono-label-mobile-typewriter-size:\s*0\.672rem;/)
  assert.doesNotMatch(tokenBlock, /--icono-label-mobile-hand-size:\s*1\.8rem;/)
  assert.doesNotMatch(
    tokenBlock,
    /--icono-label-mobile-hand-size:\s*var\(--icono-label-mobile-typewriter-size\);/,
  )
  const labMobileEnd = css.indexOf(".icono-card--variant-neo-drab.icono-card--brick", cardEnd)
  assert.notEqual(labMobileEnd, -1, "missing lab mobile typography block end")
  const labMobileTypography = css.slice(cardEnd, labMobileEnd)
  assert.doesNotMatch(
    labMobileTypography,
    /font-size:\s*(?:0\.33|0\.36|0\.38|0\.46|0\.52|0\.58|0\.61|0\.78|0\.88|1\.14|1\.24|1\.28)rem;/,
    "mobile lab-label card text must use the four typography tokens instead of local font-size exceptions",
  )
  const voteButtonBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek-swipe .icono-vote-btn",
  )
  assert.match(voteButtonBlock, /font-size:\s*var\(--icono-label-mobile-typewriter-size\);/)
  assert.match(
    voteButtonBlock,
    /min-height:\s*var\(--icono-label-mobile-target-size, 44px\);/,
  )
  assert.doesNotMatch(voteButtonBlock, /font-size:\s*0\.52rem;/)
  const voteArrowBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-mobile-peek-swipe\n    .icono-vote-btn-arrow",
  )
  assert.match(voteArrowBlock, /inline-size:\s*1\.44rem;/)
})

test("mobile open-state handwritten annotations do not cover fixed typewriter lanes", async () => {
  const css = await sourceText(cssPath)
  assert.match(
    css,
    /\.icono-label-band-cell--category\s*\n\s*\.icono-label-band-secondary\s*\{[\s\S]*top:\s*-1\.04rem;/,
    "category handwriting may spill upward, but it must not sit on top of the typewritten TRANSMEMBRANE/SOLUBLE lane",
  )
  assert.match(css, /--icono-label-mobile-peek-height:\s*5\.25rem;/)
  assert.match(css, /--icono-label-mobile-style-row-height:\s*17\.8rem;/)
  assert.match(
    css,
    /--icono-label-mobile-alignment-row-height:\s*2\.9rem;/,
    "alignment row height must conform to the typewritten lane, not the handwritten overlay",
  )
  assert.match(
    css,
    /--icono-label-mobile-footer-row-height:\s*15\.6rem;/,
    "expanded mobile cards must reserve enough typewriter-scale space for color analysis and remarks",
  )
  assert.match(
    css,
    /--icono-label-mobile-dossier-height:\s*calc\([\s\S]*var\(--icono-label-mobile-footer-row-height\)/,
    "mobile dossier height must include the footer row; otherwise everything after PFAM/aesthetics can be clipped visually",
  )
  const mobilePeekSummaryBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek-summary",
  )
  assert.match(
    mobilePeekSummaryBlock,
    /grid-template-rows:\s*calc\(var\(--icono-label-mobile-typewriter-size\) \* 1\.14 \* 2\);/,
    "closed/open mobile peek must not leave a third blank typewriter line under voting",
  )
  const massLineBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-mass-line",
  )
  assert.match(massLineBlock, /align-items:\s*center;/)
  const massFillBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-mass-fill",
  )
  assert.match(massFillBlock, /align-items:\s*center;/)
  const massUnitStackBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-mass-unit-stack",
  )
  assert.match(massUnitStackBlock, /position:\s*relative;/)
  assert.match(massUnitStackBlock, /display:\s*inline-grid;/)
  assert.match(massUnitStackBlock, /grid-auto-flow:\s*column;/)
  assert.match(massUnitStackBlock, /align-items:\s*baseline;/)
  const massUnitHandBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-mass-unit-stack\n    .icono-label-hand-note--unit",
  )
  assert.match(
    massUnitHandBlock,
    /position:\s*relative;/,
    "mobile mass correction belongs on the same row as kDa, not stacked below it",
  )
  const stylePairBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-style-pair",
  )
  assert.match(
    stylePairBlock,
    /grid-template-columns:\s*minmax\(0,\s*1\.18fr\) minmax\(5\.9rem,\s*0\.82fr\);/,
  )
  assert.match(
    stylePairBlock,
    /min-block-size:\s*3\.12rem;/,
    "PFAM style pairs need fixed five-lane height with real vertical space, not ellipsis compression",
  )
  const styleStackBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-style-stack",
  )
  assert.match(
    styleStackBlock,
    /grid-template-columns:\s*minmax\(0,\s*1fr\);/,
    "single-column clan stacks are allowed only below the five-clan split point",
  )
  const twoColumnStyleStackBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-style-stack--two-column",
  )
  assert.match(
    twoColumnStyleStackBlock,
    /grid-template-columns:\s*minmax\(0,\s*1fr\) minmax\(0,\s*1fr\);/,
    "5+ PFAM clans must use two equal columns so the fifth lane cannot overflow under the first four",
  )
  const styleColumnBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-style-column",
  )
  assert.match(styleColumnBlock, /grid-auto-rows:\s*3\.12rem;/)
  assert.doesNotMatch(
    styleStackBlock,
    /repeat\(5,\s*3\.12rem\)/,
    "the style stack must not force all five clans into one vertical column",
  )
  const styleOriginBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-style-pair\n    .icono-label-origin-text",
  )
  assert.match(styleOriginBlock, /white-space:\s*normal;/)
  assert.match(styleOriginBlock, /overflow:\s*visible;/)
  assert.match(styleOriginBlock, /text-overflow:\s*clip;/)
  const styleHandBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-style-pair\n    .icono-label-hand-note--style",
  )
  assert.match(
    styleHandBlock,
    /white-space:\s*nowrap;/,
    "handwritten style labels must remain single annotations, not wrap into blocks that cover neighboring PFAM rows",
  )
  assert.match(styleHandBlock, /overflow:\s*visible;/)
  assert.match(styleHandBlock, /text-overflow:\s*clip;/)
  assert.doesNotMatch(
    `${styleOriginBlock}\n${styleHandBlock}`,
    /ellipsis/,
    "PFAM clan lanes must not hide content behind ellipses",
  )
  const alignmentGridBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-alignment-grid",
  )
  assert.match(
    alignmentGridBlock,
    /grid-template-rows:\s*0\.86rem;/,
    "alignment sizing follows only the printed ONCOGENE/TUMOR SUPPRESSOR lane",
  )
  assert.match(alignmentGridBlock, /min-block-size:\s*0\.86rem;/)
  assert.match(alignmentGridBlock, /block-size:\s*0\.86rem;/)
  const alignmentRowBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-alignment-row",
  )
  assert.match(
    alignmentRowBlock,
    /grid-template-rows:\s*min-content min-content;/,
    "alignment label/body rows must not stretch into giant blank tabs",
  )
  assert.match(alignmentRowBlock, /align-content:\s*start;/)
  const politicsBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-alignment-grid\n    .icono-label-hand-note--politics",
  )
  assert.match(
    politicsBlock,
    /position:\s*absolute;/,
    "alignment verdict handwriting is an overlay and must not create row height",
  )
  const footerRowBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-footer-row",
  )
  assert.doesNotMatch(
    footerRowBlock,
    /display:\s*none;/,
    "mobile must not hide the remarks/color breakdown row after alignment",
  )
  assert.match(footerRowBlock, /grid-row:\s*5;/)
  assert.match(
    footerRowBlock,
    /grid-template-rows:\s*min-content min-content 3\.72rem;/,
    "post-clan mobile footer must show color analysis first and keep remarks on the bottom of the card",
  )
  assert.match(
    footerRowBlock,
    /align-content:\s*start;/,
    "the emulsion/color analysis field must not stretch to fill a tall blank footer tab",
  )
  assert.match(footerRowBlock, /block-size:\s*var\(--icono-label-mobile-footer-row-height\);/)
  const specimenNoteMatch = css.match(
    /\.icono-card--variant-lab-label\.icono-card--brick\s*\.icono-label-dossier-shell\s*\.icono-label-specimen-footer\[data-icono-mobile-footer-relocated="true"\]\s*\.icono-label-specimen-note\s*\{[\s\S]*?\}/,
  )
  assert.ok(specimenNoteMatch, "missing mobile emulsion note typography block")
  const specimenNoteBlock = specimenNoteMatch[0]
  assert.match(
    specimenNoteBlock,
    /font-size:\s*var\(--icono-label-mobile-label-size\);/,
    "emulsion note is an IBM label/caption and must use the one mobile label size",
  )
  assert.match(specimenNoteBlock, /white-space:\s*normal;/)
  assert.match(specimenNoteBlock, /max-width:\s*100%;/)
  assert.doesNotMatch(specimenNoteBlock, /font-size:\s*0\.36rem;/)
  assert.match(
    css,
    /\.icono-card--variant-lab-label\.icono-card--brick\s*\.icono-label-dossier-shell\s*\.icono-label-specimen-footer\[data-icono-mobile-footer-relocated="true"\]\s*\{[\s\S]*--icono-label-specimen-hand-col:\s*minmax\(8\.6rem,\s*1fr\);[\s\S]*--icono-label-specimen-row-gap:\s*0\.34rem;[\s\S]*grid-row:\s*1;[\s\S]*display:\s*grid;/,
    "color analysis footer must occupy the first post-clan tail track; remarks belong at the bottom",
  )
  assert.match(
    css,
    /\.icono-label-specimen-color-row\s*\{[\s\S]*grid-template-columns:[\s\S]*var\(--icono-label-specimen-metric-col\)[\s\S]*var\(--icono-label-specimen-value-col\)[\s\S]*var\(--icono-label-specimen-hand-col\)/,
    "mobile color analysis must use the same three columns for swatch/hex/name as the metric rows",
  )
  assert.match(
    css,
    /\.icono-label-specimen-notes\s*\{[\s\S]*grid-row:\s*1;/,
    "mobile color-analysis header must sit above the swatch and metric rows",
  )
  assert.match(
    css,
    /\.icono-label-specimen-color-row\s*\{[\s\S]*grid-row:\s*2;/,
    "mobile swatch/hex/name row must sit directly below the color-analysis header",
  )
  assert.match(
    css,
    /\.icono-label-specimen-decomposition\s*\{[\s\S]*display:\s*contents;/,
    "mobile color decomposition rows should participate in the parent table grid instead of nesting a misaligned table",
  )
  assert.match(
    css,
    /\.icono-label-specimen-cell--row-1\s*\{[\s\S]*grid-row:\s*3;/,
    "first metric row must start below the swatch row",
  )
  const footerCopyBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-dossier-shell\n    .icono-label-footer-copy",
  )
  assert.match(footerCopyBlock, /grid-row:\s*3;/)
  const footerLineBlock = css.match(
    /\.icono-card--variant-lab-label\.icono-card--brick\s*\.icono-label-dossier-shell\s*\.icono-label-footer-line--typed,[\s\S]*?\.icono-label-footer-line--caption\s*\{[\s\S]*?\}/,
  )
  assert.ok(footerLineBlock, "missing mobile footer small-print typography block")
  assert.match(
    footerLineBlock[0],
    /font-family:\s*var\(--icono-label-type\);/,
    "footer small print belongs to the IBM label/caption voice, not a second Special Elite size",
  )
  assert.match(footerLineBlock[0], /font-size:\s*var\(--icono-label-mobile-label-size\);/)
  assert.match(
    css,
    /\.icono-card--variant-lab-label\.icono-card--brick \.icono-label-dossier-shell\s*\{[\s\S]*height:\s*auto;[\s\S]*min-block-size:\s*var\(--icono-label-mobile-dossier-height\);[\s\S]*overflow:\s*visible;/,
    "mobile dossier shell must not keep the desktop overflow hidden crop that clipped everything after PFAM",
  )
})

test("mobile infocard gestures keep voting and navigation isolated from the viewport toggle", async () => {
  const app = await sourceText(appPath)
  assert.doesNotMatch(
    app,
    /alignmentBody\.appendChild\(footer\)/,
    "mobile must not hide the footer inside the alignment block; the color breakdown needs its own visible printed row",
  )
  assert.match(
    app,
    /footerRow\.appendChild\(footer\)/,
    "mobile should seat the canonical footer in the sheet footer row",
  )
  assert.doesNotMatch(
    app,
    /portraitHotzone|icono-label-specimen-viewport,\s*\.iconoplasm-tooltip-portrait-media[\s\S]*setMobileLabelExpanded\(card,\s*true\)/,
    "clicking the visible blot must keep opening the full-size blot viewer; portrait clicks must not be captured to expand the infocard",
  )
  assert.match(
    app,
    /event\.target\.closest\([\s\S]*"\[data-icono-vote-box\], \[data-icono-brick-vote-box\], \[data-icono-gene-vote-box\]"[\s\S]*\)[\s\S]*return/,
    "vote clicks must not toggle the infocard viewport",
  )
  assert.match(
    app,
    /card\.addEventListener\("keydown"[\s\S]*event\.key !== "Enter" && event\.key !== " "[\s\S]*setMobileLabelExpanded/,
    "the non-button mobile peek toggle must keep keyboard activation",
  )
  assert.match(
    app,
    /target\.closest\(\s*"\[data-icono-label-mobile-toggle\], \[data-icono-vote-box\], \[data-icono-nav\], a"/,
    "swipe gesture setup must exclude explicit controls, while keeping the blot surface swipeable like a Tinder card",
  )
  assert.doesNotMatch(
    app,
    /pointerdown[\s\S]*target\.closest\(\s*"\[data-icono-label-mobile-toggle\], \[data-icono-vote-box\], \[data-icono-nav\], \[data-icono-pswp\], a, button"/,
    "the visible blot lightbox button must remain part of the swipe surface; only a non-drag tap should open full-size",
  )
  assert.match(
    app,
    /"a, button, summary, input, select, textarea, label,[\s\S]*\[data-icono-vote-box\], \[data-icono-label-mobile-toggle\], \[data-no-navigate\],[\s\S]*\.icono-label-specimen-viewport/,
    "grid-card navigation must still exclude mobile infocard toggles and voting controls",
  )
})

test("portrait lightbox is delegated so mobile object wrappers cannot orphan the blot action", async () => {
  const app = await sourceText(appPath)
  const start = app.indexOf("function refreshPortraitLightbox")
  const end = app.indexOf("function fetchGeneDetail", start)
  assert.notEqual(start, -1, "missing portrait lightbox refresh helper")
  assert.notEqual(end, -1, "missing helper boundary after portrait lightbox refresh")
  const helper = app.slice(start, end)

  assert.match(
    helper,
    /document\.addEventListener\("click",\s*handler/,
    "full-size blot viewing must be delegated from the document, not stranded on a stale gallery wrapper",
  )
  assert.match(
    helper,
    /trigger\.closest\("\[data-icono-lightbox\]"\)/,
    "delegated lightbox clicks must scope the gallery from the clicked blot trigger",
  )
  assert.match(
    helper,
    /querySelectorAll\("\[data-icono-pswp\]"\)/,
    "the selected gallery still owns its own ordered image list",
  )
  assert.doesNotMatch(
    helper,
    /gallery\.addEventListener\("click"/,
    "per-gallery listeners are too brittle for mobile wrapper swaps and SPA rerenders",
  )
})

test("mobile swipe voting keeps feedback alive until the vote component settles", async () => {
  const app = await sourceText(appPath)

  assert.match(
    app,
    /function mobileLabelVoteBox\(card\)[\s\S]*\.icono-label-mobile-peek-swipe \[data-icono-brick-vote-box\][\s\S]*\[data-icono-brick-vote-box\]/,
    "swipe voting must drive the visible mobile peek vote box before falling back to a generic brick vote box",
  )
  assert.match(
    app,
    /function commitMobileLabelSwipe\(card, direction\)[\s\S]*var box = mobileLabelVoteBox\(card\)/,
    "swipe commit must not query the first generic vote box directly",
  )
  assert.match(
    app,
    /card\.setAttribute\("data-icono-mobile-swipe-committed", "true"\)/,
    "released swipe feedback must remain in a committed visual state while vote snapshot and POST settle",
  )
  assert.match(
    app,
    /card\.__iconoMobileSwipeFallbackTimer = window\.setTimeout\([\s\S]*clearMobileLabelSwipeState\(card\)[\s\S]*2600\)/,
    "fallback cleanup must be long enough for deferred snapshot voting instead of blindly clearing after 320ms",
  )
  assert.doesNotMatch(
    app,
    /function commitMobileLabelSwipe\(card, direction\)[\s\S]*clearMobileLabelSwipeState\(card\)\s*\n\s*}, 320\)/,
    "committed swipes must not erase feedback before the deferred vote UI can render",
  )
  assert.match(
    app,
    /onVoteCommitted: function \(\) \{\s*clearMobileLabelSwipeState\(brickCard\)\s*\}/,
    "the shared vote component must clear mobile swipe state after the vote commit callback",
  )
  assert.match(
    app,
    /onError: function \(\) \{\s*clearMobileLabelSwipeState\(brickCard\)\s*\}/,
    "vote errors must also release mobile swipe pending state",
  )
  assert.match(
    app,
    /if \(typeof opts\.onError === "function"\) \{\s*opts\.onError\(phase, err\)\s*\}/,
    "the page-level vote wrapper must forward shared vote errors to mobile swipe cleanup",
  )
})

test("mobile collapsed voting remains in the top infocard, not in a separate pocket", async () => {
  const app = await sourceText(appPath)
  const css = await sourceText(cssPath)
  const head = await sourceText(headPath)
  const litCard = await sourceText(litCardPath)
  assert.match(
    app,
    /labelVoteBoxMarkup\(detail \|\| g,[\s\S]*showArrows: isMobileLabelReviewEnabled\(\)/,
  )
  assert.match(app, /voteHtml: isImageOnlyVariant \? "" : labelVoteHtml/)
  assert.match(
    app,
    /voteHtml:\s*!isImageOnlyVariant\s*\?\s*labelVoteBoxMarkup\(g, "data-icono-gene-vote-box", \{\s*showArrows: true,\s*\}\)\s*:\s*""/,
    "the gene lead info-card must receive voting controls from viewport-independent markup even when the portrait asset sha is absent from the first render",
  )
  assert.match(
    head,
    /iconoplasm\/generated\/shared-card-runtime\.js\?v=\$\{CACHE_BUST\}/,
    "the live page must cache-bust the shared card runtime that owns the mobile tab markup contract",
  )
  assert.doesNotMatch(app, /generated\/lit-archival-card\.js\?v=/)
  assert.equal(
    /!isImageOnlyVariant && portraitAssetSha[\s\S]*labelVoteBoxMarkup\(g, "data-icono-gene-vote-box"/.test(
      app,
    ),
    false,
    "portrait asset availability must not suppress the visible gene-lead info-card voting controls",
  )
  assert.match(
    litCard,
    /class="icono-label-mobile-peek-swipe"\>\$\{voteShellTemplate\(model\.voteHtml\)\}/,
    "the closed top infocard must include voting, not hide it in the expanded sheet",
  )
  assert.match(
    litCard,
    /<div[\s\S]*role="button"[\s\S]*data-icono-label-mobile-toggle/,
    "the mobile peek details control remains keyboard operable",
  )
  assert.equal(
    /<button[\s\S]*data-icono-label-mobile-toggle/.test(litCard),
    false,
    "the mobile peek toggle must not become a button that contains nested controls",
  )
  assert.match(
    litCard,
    /data-icono-label-mobile-toggle[\s\S]*<\/div>\s*<a[\s\S]*icono-label-mobile-open-link[\s\S]*data-icono-nav[\s\S]*<span class="icono-label-mobile-peek-swipe"/,
    "details, gene navigation, and voting must be sibling controls instead of nested interactives",
  )
  assert.match(
    css,
    /\.icono-label-mobile-open-link:focus-visible[\s\S]*outline:/,
    "the visible mobile gene link needs an explicit keyboard focus treatment",
  )
  assert.match(
    css,
    /\.icono-label-mobile-peek-swipe \.icono-vote-btn[\s\S]*min-height:\s*var\(--icono-label-mobile-target-size, 44px\)/,
    "mobile vote buttons must meet the primary touch-target budget",
  )
  assert.match(
    app,
    /--icono-label-mobile-target-size[\s\S]*Math\.ceil\(44 \/ activeFitScale\)/,
    "scaled physical cards must compensate control geometry so the rendered target stays 44px",
  )
  assert.match(
    litCard,
    /var sheetVoteHtml = model\.voteHtml/,
    "the expanded info-card QC block must keep the same voting controls as the old infocard-only design",
  )
  assert.equal(
    /var sheetVoteHtml = model\.mode === "brick" && model\.mobileReview \? "" : model\.voteHtml/.test(
      litCard,
    ),
    false,
    "mobile review must not blank the info-card voting controls",
  )
  assert.match(
    css,
    /\.icono-label-mobile-peek-swipe[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/,
  )
  assert.match(
    css,
    /\.icono-label-mobile-peek-swipe[\s\S]*\.icono-vote-btn-arrow[\s\S]*inline-size:\s*1\.44rem/,
    "collapsed voting arrows should follow the larger B-483 mobile vote scale while MISFIT and FIT stay in two fixed columns",
  )
  assert.match(
    css,
    /\.icono-label-mobile-peek-toggle:focus-visible[\s\S]*outline:\s*1px dashed/,
    "click/focus treatment must not draw a bright boxed artifact over the infocard",
  )
  assert.equal(
    /data-icono-mobile-sleeve-vote|icono-label-mobile-pocket-control/.test(app + css),
    false,
  )
})

test("mobile vote arrows never affect the desktop label QC geometry", async () => {
  const voteCss = await sourceText(voteCssPath)
  const labelCss = await sourceText(cssPath)
  const desktopArrowBlock = cssStandaloneBlockFor(
    voteCss,
    ".icono-vote-box--label .icono-vote-btn-arrow",
  )
  const mobileArrowBlock = cssBlockFor(
    labelCss,
    ".icono-card--variant-lab-label.icono-card--brick\n    .icono-label-mobile-peek-swipe\n    .icono-vote-btn-arrow",
  )

  assert.match(
    desktopArrowBlock,
    /display:\s*none;/,
    "universal arrow markup must have zero intrinsic size in the desktop QC column",
  )
  assert.match(
    mobileArrowBlock,
    /display:\s*block;/,
    "the responsive mobile peek is the only layout that opts the swipe arrows into view",
  )
})

test("server-rendered gene hero reserves its measured closed mobile geometry", async () => {
  const css = await sourceText(cssPath)
  const pageCss = await sourceText(pageCssPath)
  assert.match(
    pageCss,
    /\.icono-gene-lead\s*\{[\s\S]*?container-type:\s*inline-size/,
    "the gene lead must expose a stable container width to the first-response card",
  )
  assert.match(
    css,
    /\.icono-gene-lead \.icono-card--variant-lab-label\.icono-card--brick\s*\{[\s\S]*?--icono-label-mobile-fit-scale:\s*clamp\([\s\S]*?100cqi[\s\S]*?--icono-label-mobile-dossier-top:[\s\S]*?var\(--height\) \/ var\(--width\)[\s\S]*?--icono-label-mobile-viewport-height:/,
    "the edge-rendered hero should reserve the same portrait-ratio and viewport geometry that runtime measurement confirms",
  )
})

test("gene suggestions render before the initial candidate gallery and are fetched once per gene page", async () => {
  const app = await sourceText(appPath)
  assert.match(
    app,
    /function buildSuggestSectionMarkup/,
    "the gene page should own a first-party suggestions (comments) section",
  )
  assert.match(
    app,
    /html \+= "<div data-icono-suggest-island>" \+ buildSuggestSectionMarkup\(g\.symbol\) \+ "<\/div>"[\s\S]*?html \+= renderCandidateGallery\(g\)/,
    "the suggestions section must render above the complete candidate gallery",
  )
  assert.match(
    app,
    /function wireGeneSuggestions\(container/,
    "suggestions should be wired once per gene page by symbol",
  )
  const commentFetchSites = app.match(/encodeURIComponent\(symbol\) \+ "\/comments"/g) || []
  assert.equal(
    commentFetchSites.length,
    1,
    "the comments endpoint must be fetched from exactly one site, not once per candidate card",
  )
})
