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
    "brick markup should wrap the canonical portrait and info card in the physical-object/aperture model",
  )
  assert.match(
    app,
    /mobileArchivalObjectMarkup\(portraitMarkup, heroInfoMarkup\)/,
    "gene lead markup should wrap the canonical portrait and info card in the physical-object/aperture model",
  )

  const shared = await import(pathToFileURL(runtimePath).href)
  const sharedRuntime = shared.IconoCardShared || globalThis.IconoplasmCardShared
  assert.equal(
    Object.hasOwn(sharedRuntime, "renderMobileArchivalPhysicalSleeveHtml"),
    false,
    "shared runtime must not export the removed sleeve renderer",
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
    /block-size:\s*var\(--icono-label-mobile-viewport-height\);/,
    "the card viewport height, not the infocard transform, should control the crop",
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
    '.icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-expanded="true"]',
    mobileCardStart,
  )
  assert.notEqual(mobileCardEnd, -1, "missing expanded mobile card block")
  const cardBlock = css.slice(mobileCardStart, mobileCardEnd)
  assert.match(
    cardBlock,
    /\.icono-mobile-card-aperture[\s\S]*clip-path:\s*polygon\(/,
    "closed viewport edge must be owned by the aperture, not by a painted zigzag or root-card crop",
  )
  assert.match(
    cardBlock,
    /100% 97\.4%,\s*98\.9% 99\.8%/,
    "the real clipped edge must have enough amplitude to be visible, not a nearly-straight micro-zigzag",
  )
  assert.match(cardBlock, /50\.5% 99\.9%/)
  assert.match(
    cardBlock,
    /filter:\s*[\s\S]*drop-shadow\(0 0\.045rem 0 color-mix\(in srgb, var\(--icono-label-rule-strong\) 58%, transparent\)\)[\s\S]*drop-shadow\(0 0\.16rem 0\.18rem rgba\(53, 38, 27, 0\.16\)\)/,
    "closed clipped viewport needs a visible edge treatment that follows the actual clip-path geometry",
  )

  const expandedBlock = cssBlockFor(
    css,
    '.icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-expanded="true"]\n    .icono-mobile-card-aperture',
  )
  assert.match(expandedBlock, /clip-path:\s*inset\(0\);/, "jagged crop must disappear when the viewport is fully open")
  assert.match(expandedBlock, /filter:\s*none;/, "open state must remove the visible torn cutoff edge")
  const peekAfterBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek::after",
  )
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
    '.icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-expanded="true"]',
    mobileCardStart,
  )
  assert.notEqual(mobileCardEnd, -1, "missing expanded mobile card block")
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
    "the root card should reserve the scaled aperture height instead of relying on CSS zoom",
  )
  assert.match(
    cardBlock,
    /\.icono-mobile-card-aperture[\s\S]*inline-size:\s*var\(--icono-label-mobile-physical-width\);/,
    "the aperture remains the unscaled physical object width",
  )
  assert.match(
    cardBlock,
    /\.icono-mobile-card-aperture[\s\S]*transform:\s*scale\(var\(--icono-label-mobile-fit-scale,\s*1\)\);/,
    "mobile archival card should optically fit by scaling the aperture shell, not by changing the blot geometry",
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
    "browser viewport math belongs to the aperture, not the physical blot holder",
  )
  const rootMobileCardBlock = cardBlock.slice(0, cardBlock.indexOf(".icono-card--variant-lab-label.icono-card--brick .icono-mobile-card-aperture"))
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
  assert.match(setupBlock, /availableWidth \/ physicalWidth/)
  assert.doesNotMatch(
    setupBlock,
    /closedPhysicalHeight/,
    "mobile optical fit must not be height-capped by the old whole-card estimate; the aperture owns vertical reveal while width owns browser-edge fit",
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

  const bodyBeforeBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .iconoplasm-tooltip-body::before",
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
    /bottom:\s*calc\(100% - 0\.08rem\);/,
    "the gene symbol tab must seat on the infocard top edge instead of sagging into the sheet",
  )
  assert.match(
    tabBlock,
    /visible tab material is owned by the infocard body's compound surface/,
    "the tab text container must not own separate material/border geometry",
  )
  assert.match(tabBlock, /inline-size:\s*calc\(var\(--icono-label-mobile-tab-width\) \+ 1\.36rem\);/)
  assert.match(tabBlock, /font-family:\s*"League Spartan";/)
  assert.match(tabBlock, /font-size:\s*0\.76rem;/)

  const symbolBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek-tab-symbol",
  )
  assert.match(symbolBlock, /transform:\s*translateY\(0\.18rem\);/)
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
  assert.match(geometry, /measuredContent = infoCard\.querySelectorAll/)
  assert.match(geometry, /toPhysicalCardPx\(measuredRect\.bottom - infoRect\.top\)/)
  assert.match(geometry, /dossierTop \+ fullInfoHeight/)
  assert.doesNotMatch(
    geometry,
    /infoCard\.scrollHeight|infoCard\.offsetHeight|icono-label-dossier-shell|icono-label-dossier-sheet/,
    "open viewport height must follow meaningful content endpoints, not stretching grid shells",
  )
  assert.match(app, /setTimeout\(function \(\) \{\s*syncMobileLabelViewportGeometry\(card\)\s*\}, 320\)/)
  assert.match(app, /setTimeout\(function \(\) \{\s*syncMobileLabelViewportGeometry\(card\)\s*\}, 720\)/)
  assert.equal(/scrollBy|scrollIntoView|translateY|sleeve|envelope|sleeve-front|physical-noun/.test(geometry), false)
  assert.doesNotMatch(
    app,
    /setMobileLabelExpanded\(leadCard,\s*true\)/,
    "the gene page must not auto-expand; closed state should show the top infocard until the viewport is tapped",
  )
})

test("mobile infocard gestures keep voting and navigation isolated from the viewport toggle", async () => {
  const app = await sourceText(appPath)
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
    "swipe gesture setup must exclude toggle, vote, nav, and link controls",
  )
  assert.match(
    app,
    /"a, button, summary, input, select, textarea, label,[\s\S]*\[data-icono-vote-box\], \[data-icono-label-mobile-toggle\], \[data-no-navigate\],[\s\S]*\.icono-label-specimen-viewport/,
    "grid-card navigation must still exclude mobile infocard toggles and voting controls",
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
    /\.icono-label-mobile-peek-swipe[\s\S]*\.icono-vote-btn-arrow[\s\S]*inline-size:\s*0\.96rem/,
    "collapsed voting arrows must stay compact enough that MISFIT and FIT both fit on narrow mobile viewports",
  )
  assert.match(
    css,
    /\.icono-label-mobile-peek-toggle:focus-visible[\s\S]*outline:\s*1px dashed/,
    "click/focus treatment must not draw a bright boxed artifact over the infocard",
  )
  assert.equal(/data-icono-mobile-sleeve-vote|icono-label-mobile-pocket-control/.test(app + css), false)
})
