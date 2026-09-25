import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..")
const appPath = path.join(repoRoot, "quartz", "static", "iconoplasm", "app.js")
const cssPath = path.join(repoRoot, "quartz", "static", "iconoplasm", "styles.css")

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

// B-838 (2026-09-25): the gene toolbar follows the platform toolbar pattern (Apple
// HIG, Material 3, Unsplash, Civitai): one row, one labelled primary on the trailing
// edge, rarely used actions in a native-popover More menu on narrow bars. The
// geometry itself is checked in a real browser (artifacts/b-838-toolbar/capture-v2.js:
// 12 width x auth combinations, 0 overlaps, 0 overflow, menu on screen).
test("gene toolbar is one row with a More menu instead of wrapping or scrolling", async () => {
  const app = await sourceText(appPath)
  const css = await sourceText(cssPath)

  assert.match(app, /<div class="icono-gene-toolbar-rail" data-icono-canonical-rail>/)
  const railBlock = cssBlockFor(css, ".icono-gene-toolbar-rail {")
  assert.match(railBlock, /display:\s*flex;/)
  assert.match(railBlock, /flex-wrap:\s*nowrap;/)
  assert.doesNotMatch(railBlock, /overflow-x:\s*auto/, "no hidden sideways scrolling")

  assert.match(app, /class="icono-button icono-button--icon icono-toolbar-more" popovertarget=/)
  assert.match(app, /<div class="icono-toolbar-menu" id="icono-toolbar-menu-' \+/)
  assert.match(css, /\.icono-toolbar-menu:not\(:popover-open\)\s*\{\s*display:\s*contents;/)
  assert.match(
    app,
    /data-icono-caretaker-claim-dialog-host/,
    "the claim dialog lives outside the menu so a closed menu cannot hide it",
  )
  assert.match(app, /data-icono-edit-source=/)
  assert.match(app, /<sl-dialog/)
  assert.doesNotMatch(app, /data-icono-edit-image-form/)
})

test("Iconoplasm archive progress summary is one compact status rail", async () => {
  const app = await sourceText(appPath)
  const css = await sourceText(cssPath)

  assert.match(app, /icono-collection-card icono-collection-card--archive/)
  assert.match(app, /icono-collection-copy/)
  assert.match(app, /ICONOPLASM_ENDGAME_LIBRARY_CARD_COUNT = 19023/)
  assert.match(app, /genes found out of/)
  assert.doesNotMatch(app, /the catalog/)
  assert.match(app, /icono-collection-progress-inline/)
  assert.doesNotMatch(app, /Next milestone:/)
  assert.doesNotMatch(app, /icono-collection-progress-milestone/)
  assert.doesNotMatch(app, /icono-collection-label icono-collection-label--archive/)
  assert.doesNotMatch(app, />Archive<\/div>/)

  const archiveBlock = cssBlockFor(css, ".icono-collection-card--archive")
  assert.match(archiveBlock, /display:\s*grid;/)
  assert.match(archiveBlock, /grid-template-columns:\s*minmax\(0, 1fr\);/)
  assert.match(archiveBlock, /align-items:\s*stretch;/)
  assert.match(archiveBlock, /max-inline-size:\s*100%;/)
  assert.match(archiveBlock, /overflow:\s*hidden;/)
  assert.doesNotMatch(archiveBlock, /overflow-x:\s*auto;/)
  assert.doesNotMatch(archiveBlock, /align-content:\s*start/)

  const copyBlock = cssBlockFor(css, ".icono-collection-copy")
  assert.match(copyBlock, /text-wrap:\s*balance;/)
  assert.doesNotMatch(copyBlock, /white-space:\s*nowrap;/)

  const progressBlock = cssBlockFor(css, ".icono-collection-progress-inline")
  assert.match(progressBlock, /display:\s*grid;/)
  assert.match(progressBlock, /grid-template-columns:\s*minmax\(0, 1fr\);/)
})

test("Iconoplasm collection summary has no duplicate hero count plaque", async () => {
  const app = await sourceText(appPath)
  const syncStart = app.indexOf("function syncCounts()")
  const syncEnd = app.indexOf("function syncCollectionChrome()", syncStart)
  assert.notEqual(syncStart, -1, "missing syncCounts")
  assert.notEqual(syncEnd, -1, "missing syncCounts boundary")
  const syncBlock = app.slice(syncStart, syncEnd)

  assert.doesNotMatch(
    app,
    /id="icono-gene-count"/,
    "the home hero must not keep a second collection counter above the archive rail",
  )
  assert.doesNotMatch(
    syncBlock,
    /function syncCounts\(\) \{\s*if \(!countEl\) return/,
    "removing the hero count must not short-circuit sidebar state updates",
  )
  assert.match(
    syncBlock,
    /renderIconoplasmSidebar\(\)[\s\S]{0,80}if \(!countEl\) return/,
    "removing the hero count must not remove sidebar state updates",
  )
  assert.match(
    app,
    /genes found out of/,
    "the archive rail remains the single visible collection counter",
  )
  assert.doesNotMatch(
    app,
    /the catalog/,
    "the archive rail must use the fixed library size, not vague catalog copy",
  )
})

test("Iconoplasm hero inventory stat uses release metadata without an API request", async () => {
  const app = await sourceText(appPath)
  const css = await sourceText(cssPath)

  assert.match(app, /id="icono-public-inventory-stat"/)
  assert.match(app, /var ICONOPLASM_ENDGAME_LIBRARY_CARD_COUNT = 19023/)
  assert.match(
    app,
    /statEl\.textContent = ICONOPLASM_ENDGAME_LIBRARY_CARD_COUNT\.toLocaleString\(\) \+ " genes"/,
  )
  assert.doesNotMatch(app, /\/api\/public\/v1\/stats/)
  assert.doesNotMatch(app, /generated_candidate_blot_count|canonical_blot_count/)

  const statBlock = cssBlockFor(css, ".icono-hero .stat")
  assert.match(statBlock, /font-variant-numeric:\s*tabular-nums;/)
})
