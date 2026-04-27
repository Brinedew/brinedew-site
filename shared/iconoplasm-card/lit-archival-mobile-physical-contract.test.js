import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")
const appPath = path.join(repoRoot, "quartz", "static", "iconoplasm", "app.js")
const cssPath = path.join(repoRoot, "shared", "iconoplasm-card", "shared-card-label.css")

async function sourceText(filePath) {
  return readFile(filePath, "utf8")
}

function assertInOrder(text, labels) {
  let cursor = -1
  for (const label of labels) {
    const next = text.indexOf(label, cursor + 1)
    assert.notEqual(next, -1, `missing ${label}`)
    assert.ok(next > cursor, `${label} should appear after the previous physical layer noun`)
    cursor = next
  }
}

test("iconoplasm app script still parses after mobile sleeve edits", () => {
  const result = spawnSync(process.execPath, ["--check", appPath], {
    cwd: repoRoot,
    encoding: "utf8",
  })
  assert.equal(
    result.status,
    0,
    `app.js must parse before physical contract checks mean anything\n${result.stderr}${result.stdout}`,
  )
})

test("mobile archival sleeve has visible DOM nouns in physical z-order", async () => {
  const app = await sourceText(appPath)
  const helperStart = app.indexOf("function renderMobileArchivalPhysicalPocketHtml")
  assert.notEqual(helperStart, -1, "mobile physical pocket helper must exist")
  const helperEnd = app.indexOf("function buildBrickCardMarkup", helperStart)
  assert.notEqual(helperEnd, -1, "physical pocket helper must sit before brick markup")
  const helper = app.slice(helperStart, helperEnd)

  assertInOrder(helper, [
    "icono-label-mobile-pocket",
    "icono-label-mobile-pocket-back",
    "icono-label-mobile-card-stack",
    "icono-label-mobile-pocket-front",
  ])

  assert.match(
    app,
    /isArchivalVariant && isMobileLabelReviewEnabled\(\)[\s\S]*renderMobileArchivalPhysicalPocketHtml\(portraitHtml, infoHtml\)/,
    "mobile archival cards must route portrait and info surfaces into the physical pocket",
  )
})

test("mobile archival sleeve front is not a card pseudo-element decal", async () => {
  const css = await sourceText(cssPath)

  assert.equal(
    css.includes(".icono-card--variant-lab-label.icono-card--brick::after"),
    false,
    "lab-label mobile sleeve must not live on the outer card pseudo-element",
  )
  assert.match(
    css,
    /\.icono-card--variant-lab-label\.icono-card--brick \.icono-label-mobile-pocket \{[\s\S]*B-474 physical contract/,
    "CSS must keep the B-474 physical noun contract beside the pocket styles",
  )
  assert.match(
    css,
    /\.icono-card--variant-lab-label\.icono-card--brick \.icono-label-mobile-pocket-front::before/,
    "thumb-cut edge shadow must belong to the sleeve front layer, not to the card",
  )
})
