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

function cssBlockFor(css, selector) {
  const start = css.indexOf(selector)
  assert.notEqual(start, -1, `missing CSS selector ${selector}`)
  const open = css.indexOf("{", start)
  assert.notEqual(open, -1, `missing CSS block for ${selector}`)
  const close = css.indexOf("}", open)
  assert.notEqual(close, -1, `unclosed CSS block for ${selector}`)
  return css.slice(open + 1, close)
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
    'data-icono-sleeve-kinematics="fixed-cards-moving-envelope"',
    'data-icono-physical-noun="sleeve-back" data-icono-kinematic-role="sliding-envelope"',
    'data-icono-physical-noun="card-stack" data-icono-kinematic-role="fixed-card-stack"',
    'data-icono-physical-noun="portrait-card" data-icono-kinematic-role="fixed-portrait-card"',
    'data-icono-physical-noun="info-card" data-icono-kinematic-role="fixed-info-card"',
    'data-icono-physical-noun="sleeve-front" data-icono-kinematic-role="sliding-envelope"',
    'data-icono-physical-noun="thumb-cut" data-icono-kinematic-role="transparent-aperture"',
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
    'data-icono-sleeve-kinematics="fixed-cards-moving-envelope"',
    'data-icono-physical-noun="sleeve-back" data-icono-kinematic-role="sliding-envelope"',
    'data-icono-physical-noun="card-stack" data-icono-kinematic-role="fixed-card-stack"',
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
  assert.equal(
    /tap to open|tap to close/i.test(lit),
    false,
    "mobile info-card text must not contain mutable tap-open/tap-close instructions; that copy belongs to the sleeve",
  )
  assert.match(
    css,
    /\.icono-label-mobile-pocket-control[\s\S]*pointer-events: auto/,
    "sleeve-owned vote controls must remain clickable even though the sleeve front is an occluder",
  )
})

test("mobile archival sleeve review buttons read MISFIT left and FIT right", async () => {
  delete globalThis.IconoplasmCardShared
  await import(pathToFileURL(runtimePath).href + "?vote-order=" + Date.now())
  const shared = globalThis.IconoplasmCardShared
  const html = shared.voteBoxMarkup('data-icono-brick-vote-box="asset"', {
    variant: "label",
    showArrows: true,
  })

  assert.ok(
    html.indexOf("data-icono-vote-down") < html.indexOf("data-icono-vote-up"),
    "label review voting must put MISFIT/reject on the left and FIT/approve on the right",
  )
  assert.ok(
    html.indexOf("MISFIT") < html.indexOf("FIT"),
    "visible label review copy must read MISFIT before FIT",
  )
})

test("mobile archival expansion follows envelope edge instead of measuring dossier offsets", async () => {
  const app = await sourceText(appPath)
  const alignStart = app.indexOf("function alignExpandedMobileLabelCard")
  assert.notEqual(alignStart, -1, "mobile expansion alignment helper must exist")
  const alignEnd = app.indexOf("function syncMobileLabelDossierContent", alignStart)
  assert.notEqual(alignEnd, -1, "alignment helper must end before content sync helper")
  const helper = app.slice(alignStart, alignEnd)

  assert.match(
    helper,
    /data-icono-physical-noun=\"sleeve-front\"/,
    "expanded viewport follow should anchor to the visible moving sleeve-front edge",
  )
  assert.match(helper, /window\.scrollBy\(\{ top: delta/, "expanded state should slide viewport down")
  assert.match(
    helper,
    /window\.setTimeout\(function \(\) \{[\s\S]*followEnvelopeEdge\("smooth"\)[\s\S]*\}, 320\)/,
    "expanded viewport follow must re-measure after the moving envelope finishes its CSS transition",
  )
  assert.equal(
    /setProperty\("--icono-label-mobile-dossier-top"/.test(helper),
    false,
    "expansion must not reintroduce measurement-driven dossier offsets",
  )
})

test("mobile archival collapse and shadows encode physical receivers", async () => {
  const css = await sourceText(cssPath)
  const runtime = await sourceText(runtimePath)

  assert.match(
    css,
    /@property --icono-label-info-card-pull-y[\s\S]*syntax: "<length-percentage>"/,
    "mobile info-card motion must use a registered tactile pull variable, not ad-hoc transform overrides",
  )

  assert.match(
    css,
    /--icono-label-pocket-front-height: 16\.4rem;[\s\S]*--icono-label-envelope-pull-y: 0px;[\s\S]*--icono-label-envelope-expanded-y: var\(--icono-label-pocket-front-height\)/,
    "B-476 motion must slide the envelope fully below the fixed info sheet instead of stopping short",
  )
  assert.match(
    css,
    /\.icono-label-mobile-pocket-back,[\s\S]*\.icono-label-mobile-pocket-front \{[\s\S]*transform: translateY\(var\(--icono-label-envelope-pull-y\)\)/,
    "sleeve back and front must share the same moving-envelope transform",
  )
  assert.match(
    css,
    /icono-card--mobile-physical-pocket\[data-icono-mobile-expanded="true"\][\s\S]*\.icono-label-mobile-pocket \{[\s\S]*--icono-label-envelope-pull-y: var\(--icono-label-envelope-expanded-y\)/,
    "expanded state must slide the envelope down while cards remain fixed",
  )
  assert.match(
    css,
    /\.icono-label-mobile-info-surface \{[\s\S]*position: absolute;[\s\S]*inset: 0;[\s\S]*z-index: 3;/,
    "info-card physical noun must have a real sliding surface box instead of a zero-height wrapper",
  )
  assert.match(
    css,
    /\.icono-label-mobile-info-surface \{[\s\S]*pointer-events: none;/,
    "transparent info-card wrapper must not hide the portrait window in hit-test based probes",
  )
  assert.match(
    css,
    /icono-card--mobile-physical-pocket[\s\S]*\.iconoplasm-tooltip-body \{[\s\S]*top: calc\(100% - var\(--icono-label-pocket-front-height\)\)/,
    "collapsed physical pocket must start the fixed info sheet at the sleeve edge so dossier content is covered",
  )
  assert.match(
    css,
    /\.iconoplasm-tooltip-body \{[\s\S]*pointer-events: auto;/,
    "the actual info sheet must remain interactive after the transparent wrapper stops catching probes",
  )
  assert.match(
    css,
    /--icono-label-thumb-cut-left: calc\(100% - 6\.8rem\);[\s\S]*--icono-label-thumb-cut-width: 4\.88rem;[\s\S]*\.icono-label-mobile-pocket-pull \{[\s\S]*left: var\(--icono-label-thumb-cut-left\);[\s\S]*inline-size: var\(--icono-label-thumb-cut-width\)/,
    "visible gene pull label must share the thumb-cut mouth geometry instead of drifting independently",
  )
  assert.match(
    css,
    /\.icono-label-mobile-peek-tab \{[\s\S]*right: calc\([\s\S]*100% - var\(--icono-label-thumb-cut-left\) - var\(--icono-label-thumb-cut-width\) - 1\.56rem[\s\S]*\)/,
    "visible gene tab must share the thumb-cut center rather than matching the aperture's right edge",
  )
  assert.equal(
    /icono-card--mobile-physical-pocket[\s\S]*\.iconoplasm-tooltip-body \{[\s\S]*transform: translateY\(calc\(100% -/.test(
      css,
    ),
    false,
    "physical-pocket state must not bypass the pull-variable framework with direct transform math",
  )
  assert.match(
    runtime,
    /icono-label-mobile-pocket-paper[\s\S]*feTurbulence type="fractalNoise"[\s\S]*feDisplacementMap[\s\S]*fill-rule="evenodd"[\s\S]*M0 0 H247 V262 H0 Z M149 0 L205 0 C203 8/,
    "sleeve face must be an inline SVG paper asset with procedural grain and a real even-odd punched aperture",
  )
  assert.match(
    css,
    /\.icono-label-mobile-thumb-cut \{[\s\S]*clip-path: path\("M10 0 L66 0 C64 8/,
    "visible thumb-cut edge must use the same punched silhouette as the transparent aperture",
  )
  assert.equal(
    /border-radius:/.test(cssBlockFor(css, ".icono-label-mobile-thumb-cut")),
    false,
    "thumb-cut edge must not regress to a computer-clean elliptical border-radius",
  )
  assert.match(
    css,
    /\.icono-label-mobile-pocket-paper \{[\s\S]*filter:[\s\S]*drop-shadow\(0\.1rem 0\.22rem[\s\S]*drop-shadow\(0\.24rem 0\.78rem/,
    "the SVG sleeve asset must cast a positive-y shape-aware shadow onto lower layers, not upward onto itself",
  )
  assert.match(
    css,
    /\.icono-label-mobile-pocket-front \{[\s\S]*box-shadow: none;/,
    "the envelope face must not use inset/self shadow chrome when the physical shadow belongs on lower layers",
  )
  assert.match(
    css,
    /\.icono-label-mobile-thumb-cut \{[\s\S]*box-shadow: none;/,
    "the thumb aperture must not paint a fake filled cutout over the transparent mask hole",
  )
  assert.match(
    css,
    /\.icono-label-mobile-pocket-control[\s\S]*\.icono-vote-btn \{[\s\S]*border: 0;[\s\S]*background: transparent;[\s\S]*box-shadow: none;/,
    "sleeve votes must read as printed review marks rather than boxed web controls",
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
