// B-837: the extension paints gene pills as background layers on an ancestor
// "surface". On Wikipedia's Chromosome 22 page the gene list is a CSS
// multi-column list: genes in the right column got the highlight text colour
// but no pill, so they read as near-white text on white.
//
// Ways this breaks, each asserted below in a real Chrome:
// 1. a word in the second column of a multi-column list gets no visible pill,
//    because the chosen surface is a box fragmented across columns and its
//    background is painted as one unbroken strip, off to the side;
// 2. a word in the first column loses its pill;
// 3. the painter picks a fragmented box as its surface at all;
// 4. a word in a captioned table gets its pill displaced by the caption
//    height, because the chosen surface is the captioned table itself; the
//    table's row group renders at the measured coordinates.
//    (Wikipedia's captioned gene tables.)
//
// The fixtures mirror Wikipedia's markup: div.div-col (column-width) > ul > li,
// and table.wikitable with a caption and tbody > tr > td.
// Screenshots land in artifacts/e2e/.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { OUT, ROOT, launchChrome } from "./harness.mjs"

const GENES = Array.from({ length: 24 }, (_, index) => `GENE${String(index + 1).padStart(2, "0")}`)
const FIXTURE = `<!doctype html><html><head><style>
  body { font: 16px/1.6 sans-serif; margin: 24px; background: #fff; color: #202122; }
  .mw-parser-output { padding: 16px 24px; }
  .div-col { column-width: 18em; width: 44em; }
  .div-col ul { margin: 0.3em 0 0 1.6em; padding: 0; }
</style></head><body><main class="mw-parser-output"><h2>Genes</h2>
<p>The following are some of the genes located on this chromosome:</p>
<div class="div-col"><ul>${GENES.map(
  (gene) => `<li><a href="#">${gene}</a>: encoding protein</li>`,
).join("")}</ul></div><p>See also: other chromosomes.</p></main></body></html>`

const CAPTIONED_GENES = Array.from(
  { length: 6 },
  (_, index) => `GENE${String(index + 1).padStart(2, "0")}`,
)
const CAPTIONED_FIXTURE = `<!doctype html><html><head><style>
  body { font: 14px/1.6 sans-serif; margin: 24px; background: #fff; color: #202122; }
  .mw-parser-output { padding: 16px 24px; }
  table.wikitable { background: #f8f9fa; border-collapse: collapse; margin: 1em 0; }
  table.wikitable caption { font-weight: bold; padding: 6px; }
  table.wikitable th, table.wikitable td { border: 1px solid #a2a9b1; padding: 0.2em 0.4em; }
  table.wikitable a { color: #3366cc; }
</style></head><body><main class="mw-parser-output"><h2>Gene list</h2>
<table class="wikitable"><caption>Genes on the non-recombining portion</caption>
<thead><tr><th>Name</th><th>X paralog</th><th>Note</th></tr></thead>
<tbody>${CAPTIONED_GENES.map(
  (gene) =>
    `<tr><td><a href="#">${gene}</a></td><td><a href="#">X ${gene}</a></td><td>Note for ${gene}.</td></tr>`,
).join("")}</tbody></table></main></body></html>`

// Counts pill-red pixels inside a page-coordinate box of a PNG screenshot,
// decoded by the browser itself so the test needs no image library.
async function redPixels(page, png, box) {
  return page.evaluate(
    async ({ data, box }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      const canvas = document.createElement("canvas")
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext("2d")
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(box.x, box.y, box.width, box.height).data
      let count = 0
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] > 200 && pixels[index + 1] < 80 && pixels[index + 2] < 80) count += 1
      }
      return count
    },
    { data: png.toString("base64"), box },
  )
}

// The red fill's pixel bounds inside a page-coordinate box of a PNG screenshot,
// decoded by the browser itself so the test needs no image library.
async function redBounds(page, png, box) {
  return page.evaluate(
    async ({ data, box }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      const canvas = document.createElement("canvas")
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext("2d")
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(box.x, box.y, box.width, box.height).data
      let count = 0
      let minX = box.width
      let minY = box.height
      let maxX = -1
      let maxY = -1
      for (let y = 0; y < box.height; y += 1) {
        for (let x = 0; x < box.width; x += 1) {
          const index = (y * box.width + x) * 4
          if (pixels[index] > 200 && pixels[index + 1] < 80 && pixels[index + 2] < 80) {
            count += 1
            if (x < minX) minX = x
            if (x > maxX) maxX = x
            if (y < minY) minY = y
            if (y > maxY) maxY = y
          }
        }
      }
      return { count, minX, minY, maxX, maxY }
    },
    { data: png.toString("base64"), box },
  )
}

test("gene pills paint in every column of a multi-column list", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.setContent(FIXTURE)
  await page.addScriptTag({
    path: path.join(ROOT, "iconoplasm-extension", "content-range-paint.js"),
  })

  const painted = await page.evaluate((genes) => {
    const runtime = {
      getCanvasShape: () => ({
        kind: "pill",
        fillSpreadEm: 0.12,
        ringSpreadEm: 0.2,
        radiusEm: 0.45,
        fillAlpha: 1,
        ringColor: "rgb(120, 0, 0)",
      }),
    }
    const paint = globalThis.IconoplasmRangePaint.createRangePaint({
      documentRef: document,
      highlightRuntime: runtime,
    })
    const anchors = [...document.querySelectorAll(".div-col a")]
    const columnLeft = anchors[0].getBoundingClientRect().left
    // Middle rows, like the real page: not the list's first or last line.
    const first = anchors[4]
    const second = anchors.filter(
      (anchor) => anchor.getBoundingClientRect().left > columnLeft + 100,
    )[4]
    const results = []
    for (const anchor of [first, second]) {
      const range = document.createRange()
      range.selectNodeContents(anchor.firstChild)
      const item = { range }
      paint.paint(item, "rgb(255, 0, 0)", 7)
      paint.flush()
      const rect = range.getBoundingClientRect()
      results.push({
        gene: anchor.textContent,
        rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
        surface: item.paintSurface?.element?.tagName || null,
        surfaceFragments: item.paintSurface?.element?.getClientRects().length ?? null,
      })
    }
    return { results, genes: genes.length }
  }, GENES)

  const [first, second] = painted.results
  assert.ok(second, "the fixture must put a gene in a second column")
  assert.ok(second.rect.x > first.rect.x + 100, "the second gene sits in the right column")

  mkdirSync(OUT, { recursive: true })
  const png = await page.screenshot()
  writeFileSync(path.join(OUT, "extension-range-paint-multicol.png"), png)
  const box = (rect) => ({
    x: Math.max(0, Math.floor(rect.x - 4)),
    y: Math.max(0, Math.floor(rect.y - 4)),
    width: Math.ceil(rect.width + 8),
    height: Math.ceil(rect.height + 8),
  })
  const firstRed = await redPixels(page, png, box(first.rect))
  const secondRed = await redPixels(page, png, box(second.rect))
  writeFileSync(
    path.join(OUT, "extension-range-paint-multicol.json"),
    JSON.stringify({ first, second, firstRed, secondRed }, null, 2),
  )

  // 3. never a fragmented surface
  assert.equal(first.surfaceFragments, 1, `first surface ${first.surface} is fragmented`)
  assert.equal(second.surfaceFragments, 1, `second surface ${second.surface} is fragmented`)
  // 2. and 1. a visible pill behind each word (a pill this size is hundreds of pixels)
  assert.ok(firstRed > 100, `first-column pill missing (${firstRed} red pixels)`)
  assert.ok(secondRed > 100, `second-column pill missing (${secondRed} red pixels)`)
})

// B-986: Zanagrams shows the word being spelled in `.forming`, a flex box as
// wide as the board with the word centred in it, and pops that whole box to
// 110% when a word is accepted (zanagrams-wordPop). The pill is painted into
// the box's background at offsets measured from the box's left edge; measured
// mid-pop, a centred word's offset is 10% too large (about 20 px here), and
// nothing re-measured it when the pop ended. The fixture copies the game's
// layout and holds the box at 110% long enough for the pill to be painted
// mid-animation, which is the case a quick pop makes intermittent.
const POP_FIXTURE = `<!doctype html><html><head><style>
  body { margin: 0; background: #151515; color: #fff; }
  .subtitle { width: 400px; height: 50px; margin: 60px auto 0; display: flex;
    align-items: center; justify-content: center; position: relative; }
  .forming { position: relative; flex: 1 1 auto; display: flex; align-items: center;
    justify-content: center; font: 700 27px/1 sans-serif; min-height: 34px; white-space: nowrap; }
  @keyframes held { from { transform: scale(1.1); } to { transform: scale(1.1); } }
  .forming.res-good { animation: held 1500ms linear 1; }
</style></head><body><div class="subtitle"><div class="forming">GENE07</div></div></body></html>`

test("a gene pill sits on its word after the word's pop animation ends", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 600, height: 300 } })
  await page.setContent(POP_FIXTURE)
  for (const file of [
    "content-lifecycle.js",
    "content-range-paint.js",
    "content-range-highlights.js",
  ])
    await page.addScriptTag({ path: path.join(ROOT, "iconoplasm-extension", file) })

  await page.evaluate(async () => {
    const highlights = globalThis.IconoplasmRangeHighlights.createRangeHighlights({
      documentRef: document,
      highlightRuntime: {
        getMode: () => "canvas",
        getCanvasShape: () => ({
          kind: "pill",
          fillSpreadEm: 0.12,
          ringSpreadEm: 0.2,
          radiusEm: 0.45,
          fillAlpha: 1,
          ringColor: "rgb(120, 0, 0)",
        }),
      },
      getGeneMap: () => ({ GENE07: { c: "rgb(255, 0, 0)" } }),
      registerGeneAnchor() {},
      placeholderColor: "rgb(255, 0, 0)",
    })
    const word = document.querySelector(".forming")
    word.classList.add("res-good")
    await new Promise((resolve) => setTimeout(resolve, 100))
    highlights.update(word.firstChild, [{ symbol: "GENE07", index: 0, length: 6 }])
    // The pill must be painted while the box is still scaled, or this test proves nothing.
    const deadline = performance.now() + 1200
    while (!word.style.backgroundImage.includes("svg") && performance.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25))
    globalThis.paintedMidAnimation =
      word.style.backgroundImage.includes("svg") && word.getAnimations().length > 0
  })
  assert.equal(
    await page.evaluate(() => globalThis.paintedMidAnimation),
    true,
    "the pill was not painted while the word was scaled",
  )
  // The hold ends at 1500 ms; leave time for an idle-scheduled repaint.
  await page.waitForTimeout(2000)

  const rect = await page.evaluate(() => {
    const range = document.createRange()
    range.selectNodeContents(document.querySelector(".forming").firstChild)
    const box = range.getBoundingClientRect()
    return { x: box.left, y: box.top, width: box.width, height: box.height }
  })
  mkdirSync(OUT, { recursive: true })
  const png = await page.screenshot()
  writeFileSync(path.join(OUT, "extension-range-paint-pop.png"), png)
  const boundsBox = {
    x: Math.max(0, Math.floor(rect.x - 120)),
    y: Math.max(0, Math.floor(rect.y - 40)),
    width: Math.ceil(rect.width + 240),
    height: Math.ceil(rect.height + 80),
  }
  const bounds = await redBounds(page, png, boundsBox)
  writeFileSync(
    path.join(OUT, "extension-range-paint-pop.json"),
    JSON.stringify({ rect, boundsBox, bounds }, null, 2),
  )

  assert.ok(bounds.count > 100, `pill missing (${bounds.count} red pixels)`)
  const wordCenterX = rect.x + rect.width / 2 - boundsBox.x
  const centerX = (bounds.minX + bounds.maxX + 1) / 2
  const pillWidth = bounds.maxX - bounds.minX + 1
  assert.ok(Math.abs(centerX - wordCenterX) <= 4, `pill centre x off by ${centerX - wordCenterX}`)
  // At rest the fill is the word plus 0.12 em each side; measured mid-pop it is ~10% wider.
  assert.ok(
    pillWidth <= rect.width + 27 * 0.12 * 2 + 4,
    `pill ${pillWidth}px wide for a ${rect.width}px word`,
  )
})

test("gene pills paint on their word in a captioned table", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } })
  await page.setContent(CAPTIONED_FIXTURE)
  await page.addScriptTag({
    path: path.join(ROOT, "iconoplasm-extension", "content-range-paint.js"),
  })

  const painted = await page.evaluate(() => {
    const runtime = {
      getCanvasShape: () => ({
        kind: "pill",
        fillSpreadEm: 0.12,
        ringSpreadEm: 0.2,
        radiusEm: 0.45,
        fillAlpha: 1,
        ringColor: "rgb(120, 0, 0)",
      }),
    }
    const paint = globalThis.IconoplasmRangePaint.createRangePaint({
      documentRef: document,
      highlightRuntime: runtime,
    })
    const anchor = [...document.querySelectorAll("table.wikitable tbody a")].find(
      (candidate) => candidate.textContent === "GENE03",
    )
    const range = document.createRange()
    range.selectNodeContents(anchor)
    const item = { range }
    paint.paint(item, "rgb(255, 0, 0)", 7)
    paint.flush()
    const rect = range.getBoundingClientRect()
    const surface = item.paintSurface?.element
    return {
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      surface: surface?.tagName || null,
      surfaceFragments: surface?.getClientRects().length ?? null,
      surfaceIsCaptioned: Boolean(surface?.caption),
    }
  })

  mkdirSync(OUT, { recursive: true })
  const png = await page.screenshot()
  writeFileSync(path.join(OUT, "extension-range-paint-captioned-table.png"), png)
  const boundsBox = {
    x: Math.max(0, Math.floor(painted.rect.x - 60)),
    y: Math.max(0, Math.floor(painted.rect.y - 60)),
    width: Math.ceil(painted.rect.width + 120),
    height: Math.ceil(painted.rect.height + 120),
  }
  const bounds = await redBounds(page, png, boundsBox)
  writeFileSync(
    path.join(OUT, "extension-range-paint-captioned-table.json"),
    JSON.stringify({ painted, boundsBox, bounds }, null, 2),
  )

  // 4. never the captioned table itself: its local-attachment background
  // origin is displaced by the caption height.
  assert.equal(painted.surfaceIsCaptioned, false, `surface ${painted.surface} carries a caption`)
  assert.equal(painted.surfaceFragments, 1, `surface ${painted.surface} is fragmented`)
  // and the pill lands on the word, not one caption-height below it.
  assert.ok(bounds.count > 100, `captioned-table pill missing (${bounds.count} red pixels)`)
  const wordCenterX = painted.rect.x + painted.rect.width / 2 - boundsBox.x
  const wordCenterY = painted.rect.y + painted.rect.height / 2 - boundsBox.y
  const centerX = (bounds.minX + bounds.maxX + 1) / 2
  const centerY = (bounds.minY + bounds.maxY + 1) / 2
  assert.ok(Math.abs(centerX - wordCenterX) <= 6, `pill centre x off by ${centerX - wordCenterX}`)
  assert.ok(Math.abs(centerY - wordCenterY) <= 6, `pill centre y off by ${centerY - wordCenterY}`)
})
