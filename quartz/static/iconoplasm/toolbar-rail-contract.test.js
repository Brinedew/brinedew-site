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
  assert.match(app, /icono-collection-label icono-collection-label--archive/)
  assert.match(app, /icono-collection-value/)
  assert.match(app, /icono-collection-copy/)
  assert.match(app, /icono-collection-progress-inline/)

  const archiveBlock = cssBlockFor(css, ".icono-collection-card--archive")
  assert.match(archiveBlock, /display:\s*grid;/)
  assert.match(
    archiveBlock,
    /grid-template-columns:\s*max-content max-content max-content minmax\(8rem, 1fr\);/,
  )
  assert.match(archiveBlock, /align-items:\s*center;/)
  assert.match(archiveBlock, /overflow-x:\s*auto;/)
  assert.doesNotMatch(archiveBlock, /align-content:\s*start/)

  const copyBlock = cssBlockFor(css, ".icono-collection-copy")
  assert.match(copyBlock, /white-space:\s*nowrap;/)

  const progressBlock = cssBlockFor(css, ".icono-collection-progress-inline")
  assert.match(progressBlock, /display:\s*grid;/)
  assert.match(progressBlock, /grid-template-columns:\s*minmax\(7rem, 1fr\) max-content;/)
})
