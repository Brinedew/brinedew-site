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

test("mobile infocard closed state only peeks the top sheet and draws a zigzag cutoff", async () => {
  const css = await sourceText(cssPath)
  assert.match(
    css,
    /--icono-label-mobile-preview-height:\s*0rem;/,
    "closed state should not reserve an extra preview slab below the top infocard strip",
  )
  assert.match(
    css,
    /padding-bottom:\s*calc\(var\(--icono-label-mobile-peek-height\) \+ 0\.72rem\);/,
    "collapsed viewport should reserve only the visible top infocard plus cutoff breathing room",
  )

  assert.match(
    css,
    /--icono-label-info-card-pull-y:\s*calc\(\s*100% - var\(--icono-label-mobile-peek-height\) - var\(--icono-label-mobile-collapse-lift\)\s*\);/,
    "the closed pull distance should be governed by the top infocard strip, not an old sleeve preview",
  )
  assert.match(css, /transform:\s*translateY\(var\(--icono-label-info-card-pull-y\)\)/)

  const expandedBlock = cssBlockFor(
    css,
    '.icono-card--variant-lab-label.icono-card--brick[data-icono-mobile-expanded="true"]\n    .iconoplasm-tooltip-body',
  )
  assert.match(expandedBlock, /--icono-label-info-card-pull-y:\s*0px;/)

  const zigzagBlock = cssBlockFor(
    css,
    ".icono-card--variant-lab-label.icono-card--brick .icono-label-mobile-peek::after",
  )
  assert.match(zigzagBlock, /linear-gradient\(135deg/)
  assert.match(zigzagBlock, /linear-gradient\(225deg/)
  assert.match(zigzagBlock, /repeat-x/)
  assert.match(zigzagBlock, /mask-image:/)
})

test("expanded mobile viewport follows the infocard, not a removed sleeve layer", async () => {
  const app = await sourceText(appPath)
  const alignStart = app.indexOf("function alignExpandedMobileLabelCard")
  assert.notEqual(alignStart, -1, "missing expanded viewport follow helper")
  const alignEnd = app.indexOf("function syncMobileLabelDossierContent", alignStart)
  assert.notEqual(alignEnd, -1, "expanded viewport follow helper should precede dossier sync")
  const align = app.slice(alignStart, alignEnd)

  assert.match(align, /\.iconoplasm-tooltip-body/)
  assert.match(align, /window\.scrollBy\(\{ top: delta/)
  assert.equal(/sleeve|envelope|sleeve-front|physical-noun/.test(align), false)
})

test("mobile collapsed voting remains in the top infocard, not in a separate pocket", async () => {
  const app = await sourceText(appPath)
  const css = await sourceText(cssPath)
  const litCard = await sourceText(litCardPath)
  assert.match(app, /labelVoteBoxMarkup\(detail \|\| g,[\s\S]*showArrows: isMobileLabelReviewEnabled\(\)/)
  assert.match(app, /voteHtml: isImageOnlyVariant \? "" : labelVoteHtml/)
  assert.match(
    litCard,
    /class="icono-label-mobile-peek-swipe"\>\$\{voteShellTemplate\(model\.voteHtml\)\}/,
    "the closed top infocard must include voting, not hide it in the expanded sheet",
  )
  assert.match(css, /\.icono-label-mobile-peek-swipe[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\)/)
  assert.equal(/data-icono-mobile-sleeve-vote|icono-label-mobile-pocket-control/.test(app + css), false)
})
