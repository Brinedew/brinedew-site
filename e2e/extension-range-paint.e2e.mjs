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
// 3. the painter picks a fragmented box as its surface at all.
//
// The fixture mirrors Wikipedia's markup: div.div-col (column-width) > ul > li.
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
