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

test("Iconoplasm toolbar rails are real one-row rails, not wrapped action stacks", async () => {
  const app = await sourceText(appPath)
  const css = await sourceText(cssPath)

  assert.match(app, /<div class="icono-gene-toolbar-rail" data-icono-canonical-rail>/)
  const railBlock = cssBlockFor(css, ".icono-gene-toolbar-rail")
  assert.match(railBlock, /display:\s*grid;/)
  assert.match(railBlock, /grid-template-columns:\s*max-content minmax\(11rem, 1fr\);/)
  assert.doesNotMatch(railBlock, /flex-wrap:\s*wrap/)
  assert.match(railBlock, /overflow-x:\s*auto;/)

  const requestPanelBlock = cssBlockFor(css, ".icono-gene-toolbar-rail > .icono-gene-request-panel")
  assert.match(requestPanelBlock, /min-width:\s*11rem;/)

  const expandedRailBlock = cssBlockFor(
    css,
    ".icono-gene-toolbar-rail:has([data-icono-edit-image-form]:not([hidden]))",
  )
  assert.match(expandedRailBlock, /grid-template-columns:\s*minmax\(0, 1fr\);/)
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
  const syncStart = app.indexOf("function syncHeroCount()")
  const syncEnd = app.indexOf("function renderCollectionChrome()", syncStart)
  assert.notEqual(syncStart, -1, "missing syncHeroCount")
  assert.notEqual(syncEnd, -1, "missing syncHeroCount boundary")
  const syncBlock = app.slice(syncStart, syncEnd)

  assert.doesNotMatch(
    app,
    /id="icono-gene-count"/,
    "the home hero must not keep a second collection counter above the archive rail",
  )
  assert.doesNotMatch(
    syncBlock,
    /function syncHeroCount\(\) \{\s*if \(!countEl\) return/,
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

test("Iconoplasm hero inventory stat uses explicit public stats, not portrait hash counts", async () => {
  const app = await sourceText(appPath)
  const css = await sourceText(cssPath)

  assert.match(app, /id="icono-public-inventory-stat"/)
  assert.match(app, /function fetchPublicInventoryStats\(\)/)
  assert.match(app, /\/api\/public\/v1\/stats/)
  assert.match(app, /toISOString\(\)\.slice\(0,\s*10\)/)
  assert.match(app, /generated_candidate_blot_count/)
  assert.match(app, /canonical_blot_count/)
  assert.doesNotMatch(app, /portrait_hash[\s\S]{0,160}generated_candidate_blot_count/)
  assert.doesNotMatch(app, /generated_candidate_blot_count[\s\S]{0,160}portrait_hash/)

  const statBlock = cssBlockFor(css, ".icono-hero .stat")
  assert.match(statBlock, /font-variant-numeric:\s*tabular-nums;/)
})
