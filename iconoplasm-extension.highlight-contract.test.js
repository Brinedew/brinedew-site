import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

function readUtf8(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8")
}

function extractNumberConstant(source, constantName) {
  const pattern = new RegExp(`const ${constantName} = ([0-9.]+)`)
  const match = source.match(pattern)
  assert.ok(match, `${constantName} should exist so this test can verify the real chooser inputs`)
  return Number(match[1])
}

function parseHexRgb(hex) {
  const raw = String(hex || "")
    .trim()
    .replace(/^#/, "")
  const normalized = raw.length === 3 ? raw.replace(/./g, (ch) => ch + ch) : raw
  return [
    parseInt(normalized.slice(0, 2), 16),
    parseInt(normalized.slice(2, 4), 16),
    parseInt(normalized.slice(4, 6), 16),
  ]
}

function buildChooserFromSource(source) {
  const DARK_TEXT_RGB = [24, 22, 20]
  const LIGHT_TEXT_RGB = [249, 247, 242]
  const APCA_DELTA_Y_MIN = extractNumberConstant(source, "APCA_DELTA_Y_MIN")
  const APCA_MIN_CONTRAST = extractNumberConstant(source, "APCA_MIN_CONTRAST")
  const APCA_CONTRAST_OFFSET = extractNumberConstant(source, "APCA_CONTRAST_OFFSET")
  const APCA_SCALE = extractNumberConstant(source, "APCA_SCALE")
  const APCA_BLACK_THRESHOLD = extractNumberConstant(source, "APCA_BLACK_THRESHOLD")
  const APCA_BLACK_CLAMP_EXP = extractNumberConstant(source, "APCA_BLACK_CLAMP_EXP")
  const WHITE_TEXT_WIN_MARGIN_APCA = extractNumberConstant(source, "WHITE_TEXT_WIN_MARGIN_APCA")

  function apcaRelativeLuminance(rgb) {
    return (
      0.2126729 * Math.pow(rgb[0] / 255, 2.4) +
      0.7151522 * Math.pow(rgb[1] / 255, 2.4) +
      0.072175 * Math.pow(rgb[2] / 255, 2.4)
    )
  }

  function apcaClampBlack(relativeLuminance) {
    if (relativeLuminance >= APCA_BLACK_THRESHOLD) return relativeLuminance
    return (
      relativeLuminance + Math.pow(APCA_BLACK_THRESHOLD - relativeLuminance, APCA_BLACK_CLAMP_EXP)
    )
  }

  function apcaContrast(textRgb, backgroundRgb) {
    const textY = apcaClampBlack(apcaRelativeLuminance(textRgb))
    const backgroundY = apcaClampBlack(apcaRelativeLuminance(backgroundRgb))
    if (Math.abs(backgroundY - textY) < APCA_DELTA_Y_MIN) return 0

    const sapc =
      backgroundY > textY
        ? (Math.pow(backgroundY, 0.56) - Math.pow(textY, 0.57)) * APCA_SCALE
        : (Math.pow(backgroundY, 0.65) - Math.pow(textY, 0.62)) * APCA_SCALE

    if (Math.abs(sapc) < APCA_MIN_CONTRAST) return 0
    return 100 * (sapc > 0 ? sapc - APCA_CONTRAST_OFFSET : sapc + APCA_CONTRAST_OFFSET)
  }

  return function choose(hex) {
    const backgroundRgb = parseHexRgb(hex)
    const darkContrast = Math.abs(apcaContrast(DARK_TEXT_RGB, backgroundRgb))
    const lightContrast = Math.abs(apcaContrast(LIGHT_TEXT_RGB, backgroundRgb))
    const whiteWins = lightContrast >= darkContrast + WHITE_TEXT_WIN_MARGIN_APCA
    return {
      darkContrast,
      lightContrast,
      chosen: whiteWins ? "white" : "black",
    }
  }
}

function extractRuleBlock(css, selector) {
  const selectorIndex = css.indexOf(selector)
  if (selectorIndex === -1) return ""
  const blockStart = css.indexOf("{", selectorIndex)
  if (blockStart === -1) return ""
  let depth = 0
  for (let index = blockStart; index < css.length; index += 1) {
    const ch = css[index]
    if (ch === "{") depth += 1
    if (ch === "}") {
      depth -= 1
      if (depth === 0) {
        return css.slice(blockStart + 1, index)
      }
    }
  }
  return ""
}

test("DO NOT DELETE: deferred vote cards do not prime vote snapshots on visibility or hover", () => {
  const sources = [
    ["shared source", readUtf8("./shared/iconoplasm-card/shared-card-runtime.js")],
    [
      "extension generated runtime",
      readUtf8("./iconoplasm-extension/generated/shared-card-runtime.js"),
    ],
    [
      "website generated runtime",
      readUtf8("./quartz/static/iconoplasm/generated/shared-card-runtime.js"),
    ],
  ]

  for (const [label, source] of sources) {
    assert.match(
      source,
      /if \(cfg\.deferSnapshot\) \{[\s\S]*?return \{ ensureSnapshot/,
      `${label} should keep an explicit deferred snapshot branch`,
    )
    assert.doesNotMatch(
      source,
      /primeSnapshotOnVisibility|visibilityObserver|pointerenter|focusin|touchstart/,
      `${label} must not prefetch /api/iconoplasm/votes/snapshot before the user actually votes`,
    )
  }
})

test("DO NOT DELETE: public Iconoplasm pages do not prime vote snapshots per card on page load", () => {
  const source = readUtf8("./quartz/static/iconoplasm/app.js")

  assert.doesNotMatch(
    source,
    /deferSnapshot:\s*false/,
    "public homepage/gene-page vote boxes must not opt out of deferred snapshots; one false here can recreate a per-card /api/iconoplasm/votes/snapshot storm",
  )

  const deferredCallers = source.match(/deferSnapshot:\s*true/g) || []
  assert.ok(
    deferredCallers.length >= 5,
    "gallery brick votes, archival brick votes, hydrated brick votes, canonical gene votes, and candidate votes should all defer personalized snapshots until vote intent",
  )
})

test("DO NOT DELETE: extension highlight renderers explicitly commit to paint-only no-inline-metrics rendering", () => {
  const source = readUtf8("./iconoplasm-extension/highlight-runtime.js")

  assert.match(
    source,
    /const HIGHLIGHT_RENDER_CONTRACT = "paint-only-no-inline-metrics"/,
    "content.js should make the highlight contract explicit instead of leaving layout safety as a vibe",
  )

  const contractMentions = source.match(/contract:\s*HIGHLIGHT_RENDER_CONTRACT/g) || []
  assert.ok(
    contractMentions.length >= 4,
    "every highlight mode should declare the same layout-inert contract so nobody sneaks in a 'special exception' mode later",
  )

  const pillFamilyMentions = source.match(/family:\s*"pill"/g) || []
  assert.equal(
    pillFamilyMentions.length,
    2,
    "pill and pill-outline should be two variants in one pill family, not two unrelated renderer types",
  )

  assert.match(
    source,
    /appendPillFragmentsToScene\(sceneLayer, scene, "filled", context\.color\)/,
    "filled pills should flow through one shared scene renderer path",
  )
  assert.match(
    source,
    /appendPillFragmentsToScene\(sceneLayer, scene, "outline", context\.color\)/,
    "outline pills should flow through the same shared scene renderer path",
  )
})

test("DO NOT DELETE: host highlight selectors must not mutate inline metrics", () => {
  const css = readUtf8("./iconoplasm-extension/content.css")
  const layoutInertHostSelectors = [
    ".iconoplasm-gene--underline",
    ".iconoplasm-gene--pill",
    ".iconoplasm-gene--pill-outline",
    ".iconoplasm-gene--ellipse",
  ]
  const forbiddenPatterns = [
    /\bpadding\s*:/i,
    /\bborder\s*:/i,
    /\bborder-(?:top|right|bottom|left|width|style|color)\s*:/i,
    /display\s*:\s*inline-block/i,
    /display\s*:\s*inline-flex/i,
    /display\s*:\s*block/i,
  ]

  for (const selector of layoutInertHostSelectors) {
    const rule = extractRuleBlock(css, selector)
    assert.ok(rule, `${selector} should exist so this guard is testing a real rule`)
    for (const pattern of forbiddenPatterns) {
      assert.doesNotMatch(
        rule,
        pattern,
        `${selector} must stay layout-inert; ${pattern} means someone is back to editing the live text box instead of painting around it`,
      )
    }
  }
})

test("DO NOT DELETE: the pill family lives on shared overlay fragments instead of host-specific renderers", () => {
  const css = readUtf8("./iconoplasm-extension/content.css")
  const source = readUtf8("./iconoplasm-extension/highlight-runtime.js")

  assert.match(
    source,
    /function measureHighlightScene\(/,
    "the runtime should measure anchor geometry once and hand that shared scene to renderers",
  )
  assert.match(
    source,
    /function appendPillFragmentsToScene\(/,
    "the runtime should keep the pill family on a named shared scene renderer",
  )
  assert.match(
    css,
    /\.iconoplasm-gene-paint-fragment--pill\s*\{/,
    "content.css should define one shared pill fragment base rule",
  )
  assert.match(
    css,
    /\.iconoplasm-gene-paint-svg-pill__fill/,
    "filled pills should render through the shared pill fragment family",
  )
  assert.match(
    css,
    /\.iconoplasm-gene-paint-svg-pill__band/,
    "outline pills should render through the same shared pill fragment family",
  )
  assert.doesNotMatch(
    css,
    /\.iconoplasm-gene--pill::before\s*\{/,
    "filled pills should not keep a separate host pseudo-element renderer once the family is unified",
  )
  assert.doesNotMatch(
    source,
    /appendPillFragmentsToOverlay\(/,
    "the shared pill renderer should no longer talk like a page-wide overlay system; it should render a local scene",
  )
})

test("DO NOT DELETE: highlight mode switches must repaint local anchored paint layers instead of rewriting inline layout", () => {
  const css = readUtf8("./iconoplasm-extension/content.css")
  const source = readUtf8("./iconoplasm-extension/highlight-runtime.js")

  assert.match(
    source,
    /function ensureHighlightPaintLayer\(/,
    "the runtime should create local anchored paint layers on the highlighted spans instead of mutating inline layout",
  )
  assert.match(
    css,
    /\.iconoplasm-gene-paint-layer\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;/,
    "content.css should anchor paint layers to each highlighted span so the paint stays glued to the text",
  )
  assert.match(
    source,
    /function scheduleHighlightGeometryRefresh\([\s\S]*?refreshHighlightStyles\(\)/,
    "geometry refresh should recompute anchored paint layers directly instead of editing inline metrics",
  )
  assert.doesNotMatch(
    source,
    /function ensureHighlightOverlayRoot\(/,
    "the old page-wide overlay root should stay gone; it was the wrong abstraction for glued-to-text paint",
  )
})

test("DO NOT DELETE: ellipse rendering must use measured local RoughJS geometry instead of stretching a canned loop", () => {
  const source = readUtf8("./iconoplasm-extension/highlight-runtime.js")

  assert.match(
    source,
    /global && global\.rough && typeof global\.rough\.svg === "function"/,
    "ellipse rendering should use RoughJS directly when available so the loop geometry follows the measured fragment box",
  )
  assert.match(
    source,
    /buildMeasuredRoughEllipseSvgNode\(width, height\)/,
    "ellipse fragments should render from their measured width and height instead of a one-size-fits-all SVG template",
  )
  assert.doesNotMatch(
    source,
    /appendEllipseFragmentsToScene[\s\S]*?data-icono-rough-loop/,
    "the local ellipse renderer should not fall back to the old hydrate-later rough-loop marker path inside the paint layer",
  )
})

test("DO NOT DELETE: ellipse bleed keeps one full extra character of horizontal breathing room", () => {
  const source = readUtf8("./iconoplasm-extension/highlight-runtime.js")

  assert.match(
    source,
    /const ELLIPSE_INLINE_BLEED_CHARS_PER_SIDE = 0\.5/,
    "the rough ellipse should keep a full extra character of width overall so the outline does not look pinched",
  )
})

test("DO NOT DELETE: filled pill ink uses APCA-style perceptual contrast instead of raw luminance ratios", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")

  assert.match(
    source,
    /function apcaContrast\(/,
    "content.js should keep an APCA-style contrast helper so pill ink follows perceptual contrast instead of old-school ratio math",
  )
  assert.match(
    source,
    /apcaContrast\(DARK_TEXT_RGB, backgroundRgb\)/,
    "dark pill ink should be judged with the same perceptual contrast function as the light candidate",
  )
  assert.match(
    source,
    /apcaContrast\(LIGHT_TEXT_RGB, backgroundRgb\)/,
    "light pill ink should be judged with the same perceptual contrast function as the dark candidate",
  )
  assert.match(
    source,
    /const WHITE_TEXT_WIN_MARGIN_APCA = 15/,
    "white text should need a 15-point APCA win margin instead of stealing every near-tie from dark ink",
  )
  assert.match(
    source,
    /const whiteWins = lightContrast >= darkContrast \+ WHITE_TEXT_WIN_MARGIN_APCA/,
    "the chooser should keep the APCA math but make white prove itself with a simple win margin",
  )
  assert.doesNotMatch(
    source,
    /const darkContrast = \(lum \+ 0\.05\) \/ 0\.05/,
    "the old raw luminance ratio shortcut should stay gone because it picked the wrong ink on some saturated fills",
  )
})

test("DO NOT DELETE: a 15-point white-win margin keeps the close mid-tone fills black but lets decisive dark fills stay white", () => {
  const source = readUtf8("./iconoplasm-extension/content.js")
  const choose = buildChooserFromSource(source)
  const shouldBeBlack = {
    POU5F1P1_alias_POU5F1B: "#57a8b5",
    BARX1: "#cb8886",
    HMX2: "#8b9953",
    SIX2: "#8197bb",
  }

  for (const [symbol, hex] of Object.entries(shouldBeBlack)) {
    const result = choose(hex)
    assert.equal(
      result.chosen,
      "black",
      `${symbol} should pick black text after the white-win threshold shift; got dark=${result.darkContrast.toFixed(3)} light=${result.lightContrast.toFixed(3)}`,
    )
  }

  const decisiveDarkFill = choose("#5f8a7e")
  assert.equal(
    decisiveDarkFill.chosen,
    "white",
    `MEIS3 should stay white under the lighter 15-point rule; got dark=${decisiveDarkFill.darkContrast.toFixed(3)} light=${decisiveDarkFill.lightContrast.toFixed(3)}`,
  )
})

test("DO NOT DELETE: content.js must load and use the extracted highlight runtime", () => {
  const manifest = readUtf8("./iconoplasm-extension/manifest.json")
  const contentSource = readUtf8("./iconoplasm-extension/content.js")

  assert.match(
    manifest,
    /"highlight-runtime\.js"\s*,\s*"content\.js"/s,
    "manifest.json should load highlight-runtime.js immediately before content.js so the content script never boots without the renderer engine",
  )
  assert.match(
    contentSource,
    /const IconoHighlightRuntime = globalThis\.IconoplasmHighlightRuntime/,
    "content.js should depend on the dedicated highlight runtime instead of owning the renderer engine inline forever",
  )
  assert.match(
    contentSource,
    /const highlightRuntime = IconoHighlightRuntime\.createHighlightRuntime\(/,
    "content.js should create a highlight runtime instance instead of recreating all renderer helpers inline",
  )
  assert.match(
    contentSource,
    /highlightMode = highlightRuntime\.setMode\(/,
    "highlight mode changes should go through the extracted runtime so the content script and renderer engine cannot drift apart",
  )
})
