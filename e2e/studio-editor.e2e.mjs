// B-1045: /studio as a full diagram editor, checked in a real browser on the
// built site with the real public resolver and portrait CDN. Nothing is mocked.
//
// Ways this editor can break, each asserted below:
// 1. the studio never mounts (a stale module stamp, an import error);
// 2. a gene node renders blank while or after its portrait loads (the live
//    v2 studio showed EGFR and MAP2K1 as empty boxes);
// 3. the chrome falls back from IBM Plex Sans, or a typewriter or handwriting
//    face (Special Elite, Caveat) appears in the interface;
// 4. selecting a relationship does not open its Format controls;
// 5. a Format control changes the panel but not the drawing;
// 6. undo does not restore the drawing;
// 7. after auto layout an edge label sits on a portrait (the v2 bug);
// 8. the SVG export loses characters or ships the editing sheet and grid;
// 9. a phone gets a sideways page scroll.
//
// B-1050, the owner's list:
// 10. the mouse wheel over the canvas does nothing (or scrolls the page);
// 11. a dragged portrait does not land on the grid the reader sees;
// 12. reverse does nothing you can see, and selecting a relationship spawns
//     two triangles at its ends;
// 13. a T-bar tilts with its stem instead of lying flat on the portrait;
// 14. a template is missing, or the faction and control variable charts
//     lose their portraits or arrows on the real resolver;
// 15. the page colour cannot be anything but paper or white, or a dark page
//     keeps dark ink;
// 16. there is no first-run tour, or it cannot be closed.
//
// B-1051:
// 17. the control variable chart's variable is not a gauge, or a gauge cannot
//     be added from the Shapes panel, or its words never reach the canvas.
//
// Needs `pnpm run build` (public-iconoplasm-edge) and an installed Chrome.
// Screenshots and measurements land in artifacts/e2e/.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, launchChrome, routeProduction, startSite } from "./harness.mjs"

const LONG_LABEL_CHAIN = ["EGFR", "KRAS", "BRAF", "MAP2K1", "MAPK1"]

// WebMCP is how agents drive the studio. Chrome stable has no
// document.modelContext yet, so the page gets a recorder with the same
// registerTool shape and the test calls the tools the studio registered.
function installToolRecorder() {
  window.__studioTools = {}
  document.modelContext = {
    registerTool(tool) {
      window.__studioTools[tool.name] = tool
    },
  }
}

async function openStudio(browser, origin, { width, height, theme = "light", tour = false }) {
  const context = await browser.newContext({ viewport: { width, height } })
  await routeProduction(context, origin, () => undefined, { session: false })
  await context.addInitScript(installToolRecorder)
  await context.addInitScript((value) => window.localStorage.setItem("theme", value), theme)
  // The first-run tour dims the page; only the tour test lets it run.
  if (!tour)
    await context.addInitScript(() =>
      window.localStorage.setItem("iconoplasm.diagramStudio.tour.v1", "done"),
    )
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto(`${HOST}/studio`)
  await page.waitForSelector('[data-studio-root][data-ready="true"]', { timeout: 45_000 })
  return { context, page, errors }
}

async function portraitsReady(page, count) {
  await page.waitForFunction(
    (expected) => {
      const images = [...document.querySelectorAll(".ics-cast-item img")]
      return images.length === expected && images.every((image) => image.complete)
    },
    count,
    { timeout: 45_000 },
  )
}

test("the studio is a working diagram editor in the printed-lab skin", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const report = {}
  try {
    const { context, page, errors } = await openStudio(browser, origin, {
      width: 1440,
      height: 900,
    })

    // 1. Mounted over the whole window: no Quartz ancestor traps the fixed
    // editor inside the article column.
    const frame = await page.evaluate(() => {
      const rect = document.querySelector("[data-studio-root]").getBoundingClientRect()
      return [rect.left, rect.top, rect.width, rect.height].map(Math.round)
    })
    report.frame = frame
    assert.deepEqual(frame, [0, 0, 1440, 900])
    // The chrome stacks in rows and the canvas gets the room. A site rule
    // (Quartz's footer grid-area) once put the editor in two columns and left
    // the canvas a 26 px strip, while every DOM-level check still passed.
    const layout = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect()
      const canvas = box("[data-studio-canvas-area]")
      return {
        titleTop: box(".ics-titlebar").top,
        menuTop: box(".ics-menubar").top,
        statusBottom: Math.round(box(".ics-status").bottom),
        canvas: [Math.round(canvas.width), Math.round(canvas.height)],
      }
    })
    report.layout = layout
    assert.ok(layout.menuTop > layout.titleTop, "menus sit under the title row")
    assert.equal(layout.statusBottom, 900)
    assert.ok(layout.canvas[0] >= 800 && layout.canvas[1] >= 650, `canvas ${layout.canvas}`)

    // 3. In Plex Sans, with no typewriter face anywhere.
    const type = await page.evaluate(async () => {
      await document.fonts.ready
      const faces = new Set()
      for (const element of document.querySelectorAll(".icono-studio *")) {
        if (!element.checkVisibility?.()) continue
        faces.add(getComputedStyle(element).fontFamily.split(",")[0].replaceAll('"', "").trim())
      }
      return {
        chrome: getComputedStyle(document.querySelector(".ics-menu-trigger")).fontFamily,
        plexLoaded: document.fonts.check('12px "IBM Plex Sans"'),
        faces: [...faces].sort(),
      }
    })
    report.type = type
    assert.match(type.chrome, /^"?IBM Plex Sans/)
    assert.equal(type.plexLoaded, true)
    assert.ok(!type.faces.some((face) => /Special Elite|Caveat/i.test(face)), type.faces.join(", "))

    // 2. The template's ten characters all paint; none is a blank box.
    // The template library opens from the toolbar; a double-click inserts.
    await page.click('.ics-toolbar [data-studio-action="templates"]')
    await page.click('[data-studio-template="mechanism"]', { clickCount: 2 })
    await portraitsReady(page, 10)
    const nodes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-shape="iconoplasm-gene"]')].map((node) => ({
        id: node.getAttribute("data-cell-id"),
        href: node.querySelector("image")?.getAttribute("href") || "",
        fallback: node.querySelector("text")?.textContent || "",
      })),
    )
    report.nodes = nodes
    assert.equal(nodes.length, 10)
    for (const node of nodes) {
      assert.match(node.href, /^https:\/\/.+\.webp$/, node.id)
      assert.ok(node.fallback.length > 1, `${node.id} has no symbol under its portrait`)
    }
    await page.screenshot({ path: path.join(OUT, "studio-desktop-light.png") })

    // 4. Clicking the BRAF → MAP2K1 line opens its relationship controls.
    const line = page.locator('[data-cell-id="edge-5"] path').first()
    const box = await line.boundingBox()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    const kind = page.locator('[data-studio-format-body] select[data-field="kind"]')
    await kind.waitFor({ state: "visible" })
    assert.equal(await kind.inputValue(), "phosphorylation")
    assert.match(
      await page.locator("[data-studio-selection-status]").textContent(),
      /BRAF → MAP2K1/,
    )

    // 5. The width stepper reaches the X6 line; 6. undo brings it back.
    const width = page.locator('[data-studio-format-body] input[data-field="width"]')
    await width.fill("4")
    await width.evaluate((element) => element.blur())
    const stroke = () =>
      page.evaluate(() =>
        document
          .querySelector('[data-cell-id="edge-5"] path:nth-of-type(2)')
          ?.getAttribute("stroke-width"),
      )
    assert.equal(await stroke(), "4")
    await page.locator('[data-studio-format-body] [data-field="kind"]').selectOption("inhibition")
    assert.equal(
      await page.evaluate(() =>
        document
          .querySelector('[data-cell-id="edge-5"] path:nth-of-type(2)')
          ?.getAttribute("stroke"),
      ),
      "#a24834",
    )
    // X6 writes the bend as a cubic curve. The width edit above runs first on
    // purpose: an edit used to leave the line unable to redraw (see 13).
    const tbarPath = () =>
      document.querySelector('[data-cell-id="edge-5"] path:nth-of-type(2)')?.getAttribute("d") || ""
    const tbar = await page.evaluate(tbarPath)
    report.tbarPath = tbar
    assert.match(tbar, / C /, "an inhibition meets the portrait square-on")
    // 12: the ends are round handles, not two extra arrowheads.
    const handles = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          ".x6-edge-tool-source-arrowhead, .x6-edge-tool-target-arrowhead",
        ),
      ].map((element) => element.tagName.toLowerCase()),
    )
    report.endHandles = handles
    assert.deepEqual(handles, ["circle", "circle"])
    await page.screenshot({ path: path.join(OUT, "studio-edge-format.png") })
    // 13. An edited relationship still follows its portraits. Edits used to
    // replace the edge's attributes wholesale and drop X6's `connection` flag,
    // so the drawn line froze in place while its handles moved on (B-1050 #9).
    await page.mouse.click(4, 4)
    const target = await page.locator('[data-cell-id="gene-map2k1"]').boundingBox()
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2 + 60, {
      steps: 8,
    })
    await page.mouse.up()
    const followed = await page.evaluate(tbarPath)
    report.editedEdgeAfterDrag = followed
    assert.notEqual(followed, tbar, "an edited relationship follows its portrait")
    await page.mouse.click(4, 4)
    await page.keyboard.press("Control+z")
    await page.keyboard.press("Control+z")
    await page.keyboard.press("Control+z")
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-cell-id="edge-5"] path:nth-of-type(2)')
          ?.getAttribute("stroke-width") === "1.5",
    )

    // 14. The page's lines (B-1051): "Top to bottom" starts each line 3 units
    // below its source and ends it 3 units above its target, at the middle of
    // a side it has to itself; an arrow on Auto follows; one Undo is Free again.
    const linesOf = (id) =>
      page.evaluate(async (edgeId) => {
        const url = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .find((name) => /diagram-studio\.js/.test(name))
        const { graph } = await (await import(url)).__testing.editor()
        const edge = graph.getCellById(edgeId)
        const view = graph.findViewByCell(edge)
        const source = edge.getSourceCell().getBBox()
        const target = edge.getTargetCell().getBBox()
        return {
          belowSource: Math.round(view.sourcePoint.y - (source.y + source.height)),
          aboveTarget: Math.round(target.y - view.targetPoint.y),
          offCentre: Math.round(view.sourcePoint.x - (source.x + source.width / 2)),
        }
      }, id)
    await page.keyboard.press("Escape")
    const preset = page.locator('[data-studio-format-body] [data-field="lines.preset"]')
    await preset.waitFor()
    assert.equal(await preset.inputValue(), "free", "a template without lines is Free")
    await preset.selectOption("top-to-bottom")
    await page.waitForTimeout(300)
    const flowing = await linesOf("edge-1")
    report.linesTopToBottom = flowing
    assert.deepEqual(flowing, { belowSource: 3, aboveTarget: 3, offCentre: 0 })
    await page.keyboard.press("Control+z")
    await page.waitForTimeout(300)
    assert.equal(await preset.inputValue(), "free", "one Undo brings Free back")

    // 10. The wheel pans the sheet and never the page; Ctrl+wheel zooms.
    const canvasBox = await page.locator("[data-studio-x6-canvas]").boundingBox()
    const viewState = () =>
      page.evaluate(() => ({
        transform: document.querySelector(".x6-graph-svg-viewport").getAttribute("transform"),
        pageScroll: window.scrollY + document.documentElement.scrollTop,
      }))
    const matrix = (transform) => transform.match(/-?[\d.]+/g).map(Number)
    const center = () =>
      page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)
    const wheel = async (dy, modifier) => {
      await center()
      if (modifier) await page.keyboard.down(modifier)
      await page.mouse.wheel(0, dy)
      if (modifier) await page.keyboard.up(modifier)
      // A new gesture starts after 240 ms of quiet.
      await page.waitForTimeout(300)
      return viewState()
    }
    const navigation = async (mode) => {
      await page.click('[data-studio-menu="view"]')
      await page.click(`[data-studio-action="navigation:${mode}"]`)
    }
    // Auto, the default: a mouse's wheel zooms in about the pointer, as in
    // Lucidchart's and Miro's Mouse navigation; the page never scrolls.
    const beforeWheel = await viewState()
    const zoomedIn = await wheel(-200)
    report.wheel = { beforeWheel, zoomedIn }
    assert.equal(zoomedIn.pageScroll, 0, "the page itself never scrolls")
    assert.ok(
      matrix(zoomedIn.transform)[0] > matrix(beforeWheel.transform)[0],
      "a mouse wheel zooms in",
    )
    // Shift+wheel pans sideways and leaves the zoom alone.
    const sideways = await wheel(200, "Shift")
    assert.equal(matrix(sideways.transform)[0], matrix(zoomedIn.transform)[0])
    assert.notEqual(
      matrix(sideways.transform)[4],
      matrix(zoomedIn.transform)[4],
      "Shift+wheel pans",
    )
    // Trackpad: two fingers pan up and down, a pinch (Ctrl+wheel) zooms.
    await navigation("trackpad")
    const beforePan = await viewState()
    const panned = await wheel(300)
    const moved = matrix(beforePan.transform)[5] - matrix(panned.transform)[5]
    assert.ok(moved > 200 && moved <= 301, `a 300 px scroll panned ${moved} px`)
    const pinched = await wheel(-200, "Control")
    assert.ok(matrix(pinched.transform)[0] > matrix(panned.transform)[0], "a pinch zooms in")
    // Mouse, chosen by hand: the wheel zooms out again.
    await navigation("mouse")
    const zoomedOut = await wheel(200)
    assert.ok(matrix(zoomedOut.transform)[0] < matrix(pinched.transform)[0], "the wheel zooms out")
    await navigation("auto")
    await page.keyboard.press("Control+Shift+H")

    // 11. A dragged portrait lands on the grid step the status bar names.
    const step = Number(
      (await page.locator("[data-studio-grid-status]").textContent()).match(/Grid (\d+)/)[1],
    )
    const kras = page.locator('[data-cell-id="gene-kras"]')
    const krasBox = await kras.boundingBox()
    await page.mouse.move(krasBox.x + krasBox.width / 2, krasBox.y + krasBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(krasBox.x + krasBox.width / 2 + 23, krasBox.y + krasBox.height / 2 + 17, {
      steps: 8,
    })
    await page.mouse.up()
    const dropped = matrix(await kras.getAttribute("transform"))
    report.snap = { step, dropped }
    assert.ok(step >= 10, "the step follows the zoom")
    assert.equal(dropped[0] % step, 0, "x on the grid")
    assert.equal(dropped[1] % step, 0, "y on the grid")

    // 12. Reverse: binding has no direction, an activation flips visibly.
    const selectEdge = async (id) => {
      const edgeBox = await page.locator(`[data-cell-id="${id}"] path`).first().boundingBox()
      await page.mouse.click(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2)
      await page.locator('[data-studio-format-body] select[data-field="kind"]').waitFor()
    }
    await selectEdge("edge-1")
    assert.equal(
      await page.locator('[data-studio-format-body] [data-studio-action="reverse"]').isDisabled(),
      true,
      "binding cannot be reversed",
    )
    await selectEdge("edge-4")
    await page.locator('[data-studio-format-body] [data-studio-action="reverse"]').click()
    await page.waitForFunction(() =>
      /BRAF → KRAS/.test(document.querySelector("[data-studio-selection-status]").textContent),
    )
    await page.mouse.click(4, 4)

    // 7. A chain with long labels, laid out by the editor, keeps every label
    // off every portrait.
    await page.evaluate(
      async (symbols) =>
        window.__studioTools.compose_gene_diagram.execute({
          title: "Label spacing",
          genes: symbols.map((symbol) => ({ symbol })),
          relationships: symbols.slice(1).map((symbol, index) => ({
            from: symbols[index],
            to: symbol,
            kind: "phosphorylation",
            label: "phosphorylates and activates",
          })),
          layout: "horizontal",
        }),
      LONG_LABEL_CHAIN,
    )
    await page.waitForFunction(
      () => document.querySelectorAll('[data-shape="edge"] text').length >= 8,
    )
    const overlaps = await page.evaluate(() => {
      const genes = [...document.querySelectorAll('[data-shape="iconoplasm-gene"]')].map((node) =>
        node.getBoundingClientRect(),
      )
      const hits = []
      for (const text of document.querySelectorAll('[data-shape="edge"] text')) {
        const label = text.getBoundingClientRect()
        for (const gene of genes) {
          const overlap =
            label.left < gene.right - 1 &&
            label.right > gene.left + 1 &&
            label.top < gene.bottom - 1 &&
            label.bottom > gene.top + 1
          if (overlap) hits.push(text.textContent)
        }
      }
      return hits
    })
    report.labelOverlaps = overlaps
    assert.deepEqual(overlaps, [])
    await page.screenshot({ path: path.join(OUT, "studio-label-spacing.png") })

    // 8. The exported SVG carries the characters and the evidence metadata,
    // and none of the editing sheet.
    const svg = await page.evaluate(async () => {
      const result = await window.__studioTools.export_gene_diagram.execute({})
      return result.svg
    })
    report.svgBytes = svg.length
    assert.equal((svg.match(/<image/g) || []).length, LONG_LABEL_CHAIN.length)
    assert.ok(svg.includes("<metadata>"))
    assert.ok(!svg.includes("iconoplasm-page"))
    assert.ok(!svg.includes("icono-grid"))
    // B-1050: the export places the page by its viewBox, never by the view's
    // on-screen zoom (a 2x PNG once drew the page at 0.89x in a corner).
    assert.ok(
      !/x6-graph-svg-viewport[^>]*transform=/.test(svg),
      "the export keeps the on-screen zoom",
    )

    // 14. The faction chart and the control variable chart open on the real
    // resolver with every portrait and arrow.
    for (const [id, genes, gauges, relationships] of [
      ["faction", 7, 0, 8],
      ["control-variable", 8, 1, 8],
    ]) {
      // The template library: draw.io's dialog, opened from the toolbar.
      await page.click('.ics-toolbar [data-studio-action="templates"]')
      await page.locator("[data-studio-template-library]").waitFor()
      await page.click('[data-studio-template="' + id + '"]')
      await page.click(
        '[data-studio-template-library] .ics-library-dialog-actions [data-studio-action="insert-template"]',
      )
      await page.waitForFunction(
        ([expected, edges]) =>
          document.querySelectorAll('[data-shape="iconoplasm-gene"]').length === expected &&
          document.querySelectorAll('[data-shape="edge"]').length === edges,
        [genes, relationships],
        { timeout: 45_000 },
      )
      await portraitsReady(page, genes)
      assert.equal(
        await page.locator('[data-shape="iconoplasm-gauge"]').count(),
        gauges,
        id + " gauges",
      )
      await page.mouse.click(4, 4)
      await page.screenshot({ path: path.join(OUT, `studio-template-${id}.png`) })
    }

    // 17. The Gauge tile adds a gauge, Format opens on its name, and the
    // words and the needle are drawn on the canvas.
    const gaugeTile = page.locator('.ics-tile[data-studio-action="insert-gauge"]')
    await gaugeTile.scrollIntoViewIfNeeded()
    await gaugeTile.click()
    await page.waitForFunction(
      () => document.querySelectorAll('[data-shape="iconoplasm-gauge"]').length === 2,
    )
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute("data-field")),
      "label",
    )
    await page.keyboard.type("cAMP")
    await page.keyboard.press("Tab")
    await page.locator('[data-studio-format-body] [data-field="needle"]').selectOption("high")
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-shape="iconoplasm-gauge"]')].some((gauge) =>
        [...gauge.querySelectorAll("text")].some((text) => text.textContent === "cAMP"),
      ),
    )
    await page.screenshot({ path: path.join(OUT, "studio-gauge-added.png") })
    // A click on the empty canvas outside the sheet clears the selection, so
    // Format shows the page again for step 15.
    const canvasArea = await page.locator("[data-studio-canvas-area]").boundingBox()
    await page.mouse.click(canvasArea.x + 40, canvasArea.y + canvasArea.height - 20)
    await page.locator("[data-studio-format-body] .ics-bg-swatches").waitFor()

    // 15. Any page colour; a dark page turns the default ink light.
    await page.locator('[data-studio-format-body] .ics-bg-swatches [data-value="#2b211b"]').click()
    await page.waitForFunction(
      () =>
        document.querySelector('[data-cell-id="iconoplasm-page"] rect')?.getAttribute("fill") ===
        "#2b211b",
    )
    const darkInk = await page.evaluate(() =>
      [...document.querySelectorAll('[data-shape="edge"] path:nth-of-type(2)')]
        .map((line) => line.getAttribute("stroke"))
        .filter((stroke) => stroke !== "#a24834"),
    )
    assert.ok(darkInk.length && darkInk.every((stroke) => stroke === "#f1e9de"), darkInk.join())
    await page.screenshot({ path: path.join(OUT, "studio-dark-page.png") })

    assert.deepEqual(errors, [])
    await context.close()

    // 16. A first visit gets the tour; it can be closed and stays closed.
    const touring = await openStudio(browser, origin, { width: 1440, height: 900, tour: true })
    const popover = touring.page.locator(".driver-popover.ics-tour")
    await popover.waitFor({ state: "visible", timeout: 15_000 })
    report.tourFirstStep = await popover.textContent()
    assert.match(report.tourFirstStep, /1 of \d/)
    await touring.page.screenshot({ path: path.join(OUT, "studio-tour.png") })
    await touring.page.locator(".driver-popover-next-btn").click()
    // driver.js swaps the popover between steps, so a "detached" wait can end on
    // the swap: Escape goes to step 2 once it is on screen, and the remembered
    // step is read when the tour has really closed.
    await popover.filter({ hasText: /2 of \d/ }).waitFor({ state: "visible" })
    await touring.page.keyboard.press("Escape")
    await popover.waitFor({ state: "detached" })
    await touring.page.waitForFunction(
      () => window.localStorage.getItem("iconoplasm.diagramStudio.tour.v1") === "done",
      null,
      { timeout: 10_000 },
    )
    assert.deepEqual(touring.errors, [])
    await touring.context.close()

    // Dark roast keeps a cream sheet.
    const dark = await openStudio(browser, origin, { width: 1440, height: 900, theme: "dark" })
    await dark.page.click('.ics-toolbar [data-studio-action="templates"]')
    await dark.page.click('[data-studio-template="mechanism"]', { clickCount: 2 })
    await portraitsReady(dark.page, 10)
    const sheet = await dark.page.evaluate(() => ({
      chrome: getComputedStyle(document.querySelector(".ics-titlebar")).backgroundColor,
      sheet: document.querySelector('[data-cell-id="iconoplasm-page"] rect')?.getAttribute("fill"),
      // Quartz's base layer sets `fill` on every SVG <text>; a label must keep
      // its own ink on the cream sheet, not the dark theme's near-white.
      labelFill: getComputedStyle(
        [...document.querySelectorAll('[data-shape="edge"] text')].find(
          (text) => text.textContent === "GEF",
        ),
      ).fill,
    }))
    report.dark = sheet
    assert.equal(sheet.sheet, "#f7f1e8")
    assert.equal(sheet.chrome, "rgb(28, 20, 15)")
    assert.equal(sheet.labelFill, "rgb(32, 18, 11)")
    await dark.page.screenshot({ path: path.join(OUT, "studio-desktop-dark.png") })
    assert.deepEqual(dark.errors, [])
    await dark.context.close()

    // 9. Phones: no sideways scroll, the shape library opens as a sheet.
    for (const phoneWidth of [360, 402, 440]) {
      const phone = await openStudio(browser, origin, { width: phoneWidth, height: 860 })
      const layout = await phone.page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        inner: window.innerWidth,
      }))
      report[`phone${phoneWidth}`] = layout
      assert.ok(layout.scroll <= layout.inner, `${phoneWidth}px scrolls sideways`)
      await phone.page.click('.ics-toolbar [data-studio-action="toggle-library"]')
      // The toggle settles asynchronously (it waits for the editor).
      await phone.page.locator("[data-studio-library]").waitFor({ state: "visible" })
      const sheetBox = await phone.page.locator("[data-studio-library]").boundingBox()
      assert.ok(sheetBox && sheetBox.width >= phoneWidth - 1)
      await phone.page.screenshot({ path: path.join(OUT, `studio-phone-${phoneWidth}.png`) })
      assert.deepEqual(phone.errors, [])
      await phone.context.close()
    }
  } finally {
    writeFileSync(path.join(OUT, "studio-editor.json"), JSON.stringify(report, null, 2))
    await browser.close()
    server.close()
  }
})
