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

  assert.match(app, /\? bodyHtml\s*:\s*portraitHtml \+ infoHtml/, "brick markup should use the canonical info card")
  assert.match(
    app,
    /\? bodyHtml\s*:\s*portraitMarkup \+ heroInfoMarkup/,
    "gene lead markup should use the canonical info card",
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
    /clip-path:\s*polygon\(/,
    "closed viewport edge must be the actual clipped edge, not a painted zigzag on a straight crop",
  )
  assert.match(cardBlock, /100% 98\.5%,\s*98\.9% 99\.2%/)

  const expandedBlock = cssBlockFor(css, '.icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-expanded="true"]')
  assert.match(expandedBlock, /clip-path:\s*inset\(0\);/, "jagged crop must disappear when the viewport is fully open")
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

  const peekBeforeBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek::before",
  )
  assert.match(peekBeforeBlock, /bottom:\s*calc\(100% - 0\.08rem\);/)
  assert.match(peekBeforeBlock, /border-bottom:\s*0;/)
  assert.match(peekBeforeBlock, /border-radius:\s*1\.16rem 1\.16rem 0 0/)

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
    /visible tab material is owned by `\.icono-label-mobile-peek::before`/,
    "the tab text container must not own separate material/border geometry",
  )

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
  assert.match(geometry, /voteRect \? voteRect\.bottom - cardRect\.top \+ 16/)
  assert.match(geometry, /fullInfoHeight = Math\.max\(peekRect\.height/)
  assert.match(geometry, /measuredContent = infoCard\.querySelectorAll/)
  assert.match(geometry, /measuredRect\.bottom - infoRect\.top/)
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
    /generated\/lit-archival-card\.js\?v=20260429b477viewport/,
    "the live page must cache-bust the Lit archival component after changing the mobile viewport/toggle contract",
  )
  assert.doesNotMatch(app, /generated\/lit-archival-card\.js\?v=20260429b476infocard/)
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
