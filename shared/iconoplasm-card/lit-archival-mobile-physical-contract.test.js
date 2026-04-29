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

test("mobile infocard closed state only peeks the top sheet and draws a viewport-owned zigzag cutoff", async () => {
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

  const expandedBlock = cssBlockFor(css, '.icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-expanded="true"]::after')
  assert.match(expandedBlock, /content:\s*none;/, "zigzag must disappear when the viewport is fully open")

  const zigzagBlock = cssBlockFor(css, ".icono-card--variant-lab-label.icono-card--brick::after")
  assert.match(zigzagBlock, /linear-gradient\(135deg/)
  assert.match(zigzagBlock, /linear-gradient\(225deg/)
  assert.match(zigzagBlock, /repeat-x/)
  assert.match(zigzagBlock, /mask-image:/)
  assert.equal(
    css.includes(".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek::after"),
    false,
    "zigzag cutoff belongs to the viewport/card boundary, not the moving info-card peek",
  )
})

test("mobile infocard tab seats on the sheet and casts a shadow over the blot card", async () => {
  const css = await sourceText(cssPath)
  assert.match(
    css,
    /filter:\s*drop-shadow\(0 -0\.24rem 0\.28rem rgba\(53, 38, 27, 0\.16\)\)/,
    "the moving info card needs an upward shadow onto the portrait/blot card",
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
  assert.match(geometry, /voteRect \? voteRect\.bottom/)
  assert.match(geometry, /dossierTop \+ infoRect\.height/)
  assert.equal(/scrollBy|scrollIntoView|translateY|sleeve|envelope|sleeve-front|physical-noun/.test(geometry), false)
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
    /generated\/lit-archival-card\.js\?v=20260429b476infocard/,
    "the live page must cache-bust the Lit archival component after changing mobile infocard markup",
  )
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
  assert.equal(/data-icono-mobile-sleeve-vote|icono-label-mobile-pocket-control/.test(app + css), false)
})
