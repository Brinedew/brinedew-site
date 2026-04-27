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
  const runtime = await sourceText(runtimePath)
  const helperStart = app.indexOf("function renderMobileArchivalPhysicalPocketHtml")
  assert.notEqual(helperStart, -1, "mobile physical pocket helper must exist")
  const helperEnd = app.indexOf("function buildBrickCardMarkup", helperStart)
  assert.notEqual(helperEnd, -1, "physical pocket helper must sit before brick markup")
  const helper = app.slice(helperStart, helperEnd)
  assert.match(
    helper,
    /IconoCardShared\.renderMobileArchivalPhysicalSleeveHtml\(portraitHtml, infoHtml, options\)/,
    "app helper must delegate the physical object contract to the shared card runtime",
  )

  const rendererStart = runtime.indexOf("function renderMobileArchivalPhysicalSleeveHtml")
  assert.notEqual(rendererStart, -1, "shared runtime must own the physical sleeve renderer")
  const rendererEnd = runtime.indexOf("function jsonScriptSafeString", rendererStart)
  assert.notEqual(rendererEnd, -1, "physical sleeve renderer must sit near shared HTML helpers")
  const renderer = runtime.slice(rendererStart, rendererEnd)

  assertInOrder(renderer, [
    'data-icono-physical-noun="sleeve"',
    'data-icono-physical-noun="sleeve-back"',
    'data-icono-physical-noun="card-stack"',
    'data-icono-physical-noun="portrait-card"',
    'data-icono-physical-noun="info-card"',
    'data-icono-physical-noun="sleeve-front"',
    'data-icono-physical-noun="thumb-cut"',
  ])
  assert.match(
    runtime,
    /renderMobileArchivalPhysicalSleeveHtml: renderMobileArchivalPhysicalSleeveHtml/,
    "shared runtime must export the physical sleeve renderer as a reusable component contract",
  )

  assert.match(
    app,
    /isArchivalVariant && isMobileLabelReviewEnabled\(\)[\s\S]*renderMobileArchivalPhysicalPocketHtml\(portraitHtml, infoHtml, \{/,
    "mobile archival cards must route portrait and info surfaces into the physical pocket",
  )
})

test("shared physical sleeve renderer emits nested escaped physical surfaces", async () => {
  delete globalThis.IconoplasmCardShared
  await import(pathToFileURL(runtimePath).href + "?physical-contract=" + Date.now())
  const shared = globalThis.IconoplasmCardShared
  assert.equal(
    typeof shared.renderMobileArchivalPhysicalSleeveHtml,
    "function",
    "shared runtime must expose an executable mobile physical sleeve renderer",
  )

  const html = shared.renderMobileArchivalPhysicalSleeveHtml(
    '<div data-test-surface="portrait">portrait</div>',
    '<div data-test-surface="info">info</div>',
    {
      symbol: "ERBB2",
      fullName: "erb-b2 <unsafe> receptor",
      voteHtml: '<button type="button">FIT</button>',
    },
  )

  assertInOrder(html, [
    'data-icono-physical-noun="sleeve"',
    'data-icono-physical-noun="sleeve-back"',
    'data-icono-physical-noun="card-stack"',
    'data-icono-physical-noun="portrait-card"',
    'data-test-surface="portrait"',
    'data-icono-physical-noun="info-card"',
    'data-test-surface="info"',
    'data-icono-physical-noun="sleeve-front"',
    'data-icono-physical-noun="thumb-cut"',
    'data-icono-mobile-sleeve-vote',
  ])
  assert.match(html, /erb-b2 &lt;unsafe&gt; receptor/, "full gene name must be escaped")
  assert.match(html, /ERBB2 \/ tap to pull/, "symbol pull affordance must render on sleeve")
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
    /\.icono-card--variant-lab-label\.icono-card--brick \.icono-label-mobile-thumb-cut/,
    "thumb-cut edge shadow must belong to the explicit thumb-cut noun, not a card pseudo-element",
  )
})

test("mobile archival sleeve owns review controls and visible archive metadata", async () => {
  const app = await sourceText(appPath)
  const runtime = await sourceText(runtimePath)
  const lit = await sourceText(path.join(repoRoot, "shared", "iconoplasm-card", "lit-archival-card.js"))
  const css = await sourceText(cssPath)

  assert.match(
    app,
    /renderMobileArchivalPhysicalPocketHtml\(portraitHtml, infoHtml, \{[\s\S]*voteHtml: labelVoteHtml/,
    "brick mobile review votes must be passed to the physical sleeve front",
  )
  assert.match(
    runtime,
    /icono-label-mobile-pocket-name[\s\S]*escapeHtml\(fullName \|\| symbol\)/,
    "the physical sleeve front must render the full gene name as sleeve metadata",
  )
  assert.match(
    runtime,
    /data-icono-mobile-sleeve-vote[\s\S]*voteHtml/,
    "the physical sleeve front must own the live vote control slot",
  )
  assert.equal(
    /icono-label-mobile-peek-swipe[\s\S]*voteShellTemplate\(model\.voteHtml\)/.test(lit),
    false,
    "mobile Lit info-card peek must not keep review votes on the sliding card sheet",
  )
  assert.match(
    css,
    /\.icono-label-mobile-pocket-control[\s\S]*pointer-events: auto/,
    "sleeve-owned vote controls must remain clickable even though the sleeve front is an occluder",
  )
})

test("mobile archival collapse and shadows encode physical receivers", async () => {
  const css = await sourceText(cssPath)

  assert.match(
    css,
    /@property --icono-label-info-card-pull-y[\s\S]*syntax: "<length-percentage>"/,
    "mobile info-card motion must use a registered tactile pull variable, not ad-hoc transform overrides",
  )

  assert.match(
    css,
    /--icono-label-info-card-collapsed-y: calc\(100% - 16\.2rem\)[\s\S]*--icono-label-info-card-pull-y: var\(--icono-label-info-card-collapsed-y\)/,
    "collapsed info card must put its tab behind the sleeve thumb cut without exposing the old card-mounted vote area",
  )
  assert.match(
    css,
    /\.icono-label-mobile-info-surface \{[\s\S]*position: absolute;[\s\S]*inset: 0;[\s\S]*z-index: 3;/,
    "info-card physical noun must have a real sliding surface box instead of a zero-height wrapper",
  )
  assert.equal(
    /icono-card--mobile-physical-pocket[\s\S]*\.iconoplasm-tooltip-body \{[\s\S]*transform: translateY\(calc\(100% -/.test(
      css,
    ),
    false,
    "physical-pocket state must not bypass the pull-variable framework with direct transform math",
  )
  assert.match(
    css,
    /\.icono-label-mobile-pocket-front \{[\s\S]*mask-image: url\("data:image\/svg\+xml/,
    "thumb cut should use an irregular sleeve mask rather than a clean CSS ellipse",
  )
  assert.match(
    css,
    /icono-card--mobile-physical-pocket[\s\S]*\.iconoplasm-tooltip-body \{[\s\S]*filter: drop-shadow/,
    "the sliding info paper must cast contact shadow onto the layer behind it",
  )
  assert.match(
    css,
    /icono-card--mobile-physical-pocket[\s\S]*\.iconoplasm-tooltip-portrait \{[\s\S]*filter: drop-shadow/,
    "the portrait/blot card must have its own paper-depth shadow receiver instead of relying on sleeve self-shadow",
  )
})
