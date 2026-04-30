import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath, pathToFileURL } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const appPath = path.join(repoRoot, "quartz", "static", "iconoplasm", "app.js")
const cssPath = path.join(repoRoot, "shared", "iconoplasm-card", "shared-card-label.css")
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

test("iconoplasm app script still parses after infocard-only mobile pivot", () => {
  const result = spawnSync(process.execPath, ["--check", appPath], {
    cwd: repoRoot,
    encoding: "utf8",
  })
  assert.equal(result.status, 0, `app.js must parse\n${result.stderr}${result.stdout}`)
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
    "data-icono-physical-noun=\"sleeve-front\"",
    "data-icono-physical-noun=\"thumb-cut\"",
    "data-icono-material-system=\"baked-paper-atlas\"",
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

test("mobile infocard projects five fixed PFAM clan lanes without overflow summaries", async () => {
  const shared = await import(pathToFileURL(runtimePath).href)
  const sharedRuntime = shared.IconoCardShared || globalThis.IconoplasmCardShared
  const model = sharedRuntime.resolveArchivalCardModel({
    symbol: "FIVE",
    full_name: "five clan test",
    essence: {
      aesthetics_origin: ["Clan A", "Clan B", "Clan C", "Clan D", "Clan E"],
      aesthetics: ["alpha", "beta", "gamma", "delta", "epsilon"],
    },
  })
  assert.equal(model.stylePairs.length, 5, "mobile and Lit cards need five fixed clan lanes")
  assert.deepEqual(
    model.stylePairs.map((pair) => pair.origin),
    ["Clan A", "Clan B", "Clan C", "Clan D", "Clan E"],
  )
  assert.deepEqual(
    model.stylePairs.map((pair) => pair.note),
    ["alpha", "beta", "gamma", "delta", "epsilon"],
  )
  assert.equal(
    model.stylePairs.some((pair) => /\+\d|more clans|mixed/i.test(`${pair.origin} ${pair.note}`)),
    false,
    "five-clan genes should show the five lanes directly, not a lossy overflow summary",
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
    /block-size:\s*calc\(var\(--icono-label-mobile-viewport-height\) \* var\(--icono-label-mobile-fit-scale,\s*1\)\);/,
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
    /filter:\s*[\s\S]*drop-shadow\(0 0\.045rem 0 color-mix\(in srgb, var\(--icono-label-rule-strong\) 58%, transparent\)\)[\s\S]*drop-shadow\(0 0\.16rem 0\.18rem rgba\(53, 38, 27, 0\.16\)\)/,
    "closed clipped viewport needs a visible edge treatment that follows the actual clip-path geometry",
  )

  const expandedBlock = cssBlockFor(
    css,
    '.icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-expanded="true"]',
  )
  assert.match(expandedBlock, /clip-path:\s*inset\(0\);/, "jagged crop must disappear when the viewport is fully open")
  assert.match(expandedBlock, /filter:\s*none;/, "open state must remove the visible torn cutoff edge")
  const peekAfterBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek::after",
  )
  assert.match(peekAfterBlock, /content:\s*none;/, "the tab must not have a fake footer separator line")
  assert.equal(
    /icono-card--variant-lab-label\.icono-card--brick::after[\s\S]*linear-gradient/.test(css) ||
      /linear-gradient/.test(peekAfterBlock),
    false,
    "the rip edge must not be a painted pseudo-element overlay on the card or peek",
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
    /inline-size:\s*calc\(var\(--icono-label-mobile-physical-width\) \* var\(--icono-label-mobile-fit-scale,\s*1\)\);/,
    "the root card is a layout box that reserves the scaled physical width",
  )
  assert.match(cardBlock, /max-inline-size:\s*none;/)
  assert.match(
    cardBlock,
    /block-size:\s*calc\(var\(--icono-label-mobile-viewport-height\) \* var\(--icono-label-mobile-fit-scale,\s*1\)\);/,
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
  const rootMobileCardBlock = cardBlock.slice(0, cardBlock.indexOf(".icono-card--variant-lab-label.icono-card--brick .icono-mobile-card-physical-object"))
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
  assert.match(setupBlock, /cardParent\.clientWidth/)
  assert.match(setupBlock, /document\.documentElement\.clientWidth/)
  assert.match(
    setupBlock,
    /parentInset[\s\S]*viewportWidth - parentInset \* 2/,
    "mobile fit scale must account for the parent column inset so the card does not crop off one browser edge",
  )
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
})

test("mobile Iconoplasm page removes nested padding that creates dead card gutters", async () => {
  const styles = await sourceText(path.join(repoRoot, "quartz/static/iconoplasm/styles.css"))
  assert.match(styles, /@media \(max-width:\s*720px\)[\s\S]*#iconoplasm-root[\s\S]*padding-inline:\s*0;/)
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
  assert.match(reconcileBlock, /querySelectorAll\(\s*["']\.icono-card--variant-lab-label\.icono-card--brick/)
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
    /--icono-label-mobile-tab-symbol-capacity:\s*14ch;/,
    "mobile tab must fit the longest current catalog gene symbol on one row",
  )
  assert.match(
    css,
    /--icono-label-mobile-tab-width:\s*var\(--icono-label-mobile-tab-symbol-capacity\);/,
    "tab width must be a character-capacity contract",
  )
  assert.match(
    css,
    /--icono-label-mobile-tab-safe-inset:\s*0\.92rem;/,
    "tab needs a safe inset so the symbol stays visible when the mobile card fits inside an inset page column",
  )

  const bodyBeforeBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .iconoplasm-tooltip-body::before",
  )
  assert.match(bodyBeforeBlock, /right:\s*var\(--icono-label-mobile-tab-safe-inset\);/)
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
  assert.match(
    tabBlock,
    /visible tab material is owned by the infocard body's compound surface/,
    "the tab text container must not own separate material/border geometry",
  )
  assert.match(tabBlock, /inline-size:\s*calc\(var\(--icono-label-mobile-tab-width\) \+ 1\.36rem\);/)
  assert.match(tabBlock, /font-family:\s*"League Spartan";/)
  assert.match(tabBlock, /font-size:\s*1\.14rem;/, "B-483 requires the mobile gene symbol scale to be bumped")
  assert.match(tabBlock, /align-items:\s*center;/, "tab symbol should sit optically centered in the tab face")
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
  assert.match(symbolBlock, /transform:\s*none;/)
  assert.doesNotMatch(
    symbolBlock,
    /translateY/,
    "tab symbol vertical position should come from the tab layout, not a brittle nudge",
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
  assert.match(geometry, /voteRect[\s\S]*\? toPhysicalCardPx\(voteRect\.bottom - cardRect\.top\) \+ 16/)
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
  assert.match(app, /setTimeout\(function \(\) \{\s*syncMobileLabelViewportGeometry\(card\)[\s\S]*?restoreCardTop\(\)[\s\S]*?\}, 320\)/)
  assert.match(app, /setTimeout\(function \(\) \{\s*syncMobileLabelViewportGeometry\(card\)[\s\S]*?restoreCardTop\(\)[\s\S]*?\}, 720\)/)
  assert.equal(/scrollBy|scrollIntoView|translateY|sleeve|envelope|sleeve-front|physical-noun/.test(geometry), false)
  const expansionStart = app.indexOf("function setMobileLabelExpanded")
  const expansionEnd = app.indexOf("function setMobileLabelQcCopy", expansionStart)
  assert.notEqual(expansionStart, -1, "missing mobile expansion helper")
  assert.notEqual(expansionEnd, -1, "missing mobile expansion helper end")
  const expansionBlock = app.slice(expansionStart, expansionEnd)
  assert.match(
    expansionBlock,
    /anchorTop[\s\S]*restoreCardTop[\s\S]*window\.scrollBy\(0,\s*delta\)/,
    "expanding the viewport must preserve the card's visual top so browser scroll anchoring cannot make the card jump upward",
  )
  assert.match(expansionBlock, /requestAnimationFrame[\s\S]*restoreCardTop\(\)/)
  assert.doesNotMatch(
    app,
    /setMobileLabelExpanded\(leadCard,\s*true\)/,
    "the gene page must not auto-expand; closed state should show the top infocard until the viewport is tapped",
  )
})

test("mobile card uses the larger B-483 type scale instead of the tiny draft scale", async () => {
  const css = await sourceText(cssPath)
  const cardStart = css.indexOf(".icono-card--variant-lab-label.icono-card--brick {\n    /* Mobile archival card has only two writing systems:")
  assert.notEqual(cardStart, -1, "missing mobile typography token block")
  const cardEnd = css.indexOf(".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek-name", cardStart)
  assert.notEqual(cardEnd, -1, "missing mobile typography token block end")
  const tokenBlock = css.slice(cardStart, cardEnd)
  assert.match(tokenBlock, /--icono-label-mobile-typewriter-size:\s*1\.008rem;/)
  assert.match(tokenBlock, /--icono-label-mobile-hand-size:\s*1\.8rem;/)
  assert.doesNotMatch(tokenBlock, /--icono-label-mobile-typewriter-size:\s*0\.672rem;/)
  const voteButtonBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek-swipe .icono-vote-btn",
  )
  assert.match(voteButtonBlock, /font-size:\s*0\.78rem;/)
  assert.match(voteButtonBlock, /min-height:\s*1\.24rem;/)
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
    /--icono-label-mobile-alignment-row-height:\s*4\.9rem;/,
    "alignment is a compact printed field, not a tall blank tab",
  )
  assert.match(
    css,
    /--icono-label-mobile-footer-row-height:\s*13\.3rem;/,
    "expanded mobile cards must reserve a compact real printed row for remarks/color breakdown after alignment",
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
  assert.match(stylePairBlock, /grid-template-columns:\s*minmax\(0,\s*1\.18fr\) minmax\(5\.9rem,\s*0\.82fr\);/)
  assert.match(
    stylePairBlock,
    /min-block-size:\s*3\.12rem;/,
    "PFAM style pairs need fixed five-lane height with real vertical space, not ellipsis compression",
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
  assert.match(alignmentGridBlock, /grid-template-rows:\s*0\.86rem 0\.86rem;/)
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
    /position:\s*static;/,
    "alignment verdict handwriting must be in its own row, not absolutely crossing both typewritten options",
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
    /event\.target\.closest\("\[data-icono-vote-box\], \[data-icono-brick-vote-box\], \[data-icono-gene-vote-box\]"\)[\s\S]*return/,
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
  const litCard = await sourceText(litCardPath)
  assert.match(app, /labelVoteBoxMarkup\(detail \|\| g,[\s\S]*showArrows: isMobileLabelReviewEnabled\(\)/)
  assert.match(app, /voteHtml: isImageOnlyVariant \? "" : labelVoteHtml/)
  assert.match(
    app,
    /voteHtml:\s*!isImageOnlyVariant\s*\?\s*labelVoteBoxMarkup\(g, "data-icono-gene-vote-box", \{\s*showArrows: isMobileLabelReviewEnabled\(\),\s*\}\)\s*:\s*""/,
    "the gene lead info-card must receive voting controls even when the portrait asset sha is absent from the first render",
  )
  assert.match(
    app,
    /generated\/lit-archival-card\.js\?v=20260429b477attachedtab/,
    "the live page must cache-bust the Lit archival component after changing the mobile tab markup contract",
  )
  assert.doesNotMatch(app, /generated\/lit-archival-card\.js\?v=20260429b47(6infocard|7viewport)/)
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
    "the mobile peek toggle must be a non-button interactive region so it can legally contain vote buttons",
  )
  assert.equal(
    /<button[\s\S]*data-icono-label-mobile-toggle/.test(litCard),
    false,
    "the mobile peek toggle must not be a button containing nested vote buttons",
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
  assert.match(css, /\.icono-label-mobile-peek-swipe[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/)
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
  assert.equal(/data-icono-mobile-sleeve-vote|icono-label-mobile-pocket-control/.test(app + css), false)
})
