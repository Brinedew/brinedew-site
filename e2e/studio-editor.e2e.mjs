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
    await page.click('.ics-empty [data-studio-action="template:mechanism"]')
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
    const tbar = await page.evaluate(() =>
      document.querySelector('[data-cell-id="edge-5"] path:nth-of-type(2)')?.getAttribute("d"),
    )
    report.tbarPath = tbar
    assert.match(tbar || "", /Q/, "an inhibition meets the portrait square-on")
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
    await page.mouse.click(4, 4)
    await page.keyboard.press("Control+z")
    await page.keyboard.press("Control+z")
    await page.waitForFunction(
      () =>
        document
          .querySelector('[data-cell-id="edge-5"] path:nth-of-type(2)')
          ?.getAttribute("stroke-width") === "1.5",
    )

    // 10. The wheel pans the sheet and never the page; Ctrl+wheel zooms.
    const canvasBox = await page.locator("[data-studio-x6-canvas]").boundingBox()
    const viewState = () =>
      page.evaluate(() => ({
        transform: document.querySelector(".x6-graph-svg-viewport").getAttribute("transform"),
        pageScroll: window.scrollY + document.documentElement.scrollTop,
      }))
    const matrix = (transform) => transform.match(/-?[\d.]+/g).map(Number)
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2)
    const beforeWheel = await viewState()
    await page.mouse.wheel(0, 300)
    await page.waitForTimeout(150)
    const afterWheel = await viewState()
    report.wheel = { beforeWheel, afterWheel }
    assert.equal(afterWheel.pageScroll, 0, "the page itself never scrolls")
    assert.ok(
      Math.abs(matrix(beforeWheel.transform)[5] - matrix(afterWheel.transform)[5] - 300) < 2,
      "a 300 px wheel pans the sheet 300 px",
    )
    await page.keyboard.down("Control")
    await page.mouse.wheel(0, -200)
    await page.keyboard.up("Control")
    await page.waitForTimeout(150)
    const zoomed = await viewState()
    assert.ok(matrix(zoomed.transform)[0] > matrix(afterWheel.transform)[0], "Ctrl+wheel zooms in")
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

    // 14. The faction chart and the control variable chart open on the real
    // resolver with every portrait and arrow.
    for (const [id, genes, molecules, relationships] of [
      ["faction", 7, 0, 8],
      ["control-variable", 8, 1, 8],
    ]) {
      await page.click('.ics-library [data-studio-action="template:' + id + '"]')
      await page.waitForFunction(
        ([expected, edges]) =>
          document.querySelectorAll('[data-shape="iconoplasm-gene"]').length === expected &&
          document.querySelectorAll('[data-shape="edge"]').length === edges,
        [genes, relationships],
        { timeout: 45_000 },
      )
      await portraitsReady(page, genes)
      assert.equal(
        await page.locator('[data-shape="iconoplasm-molecule"]').count(),
        molecules,
        id + " molecules",
      )
      await page.mouse.click(4, 4)
      await page.screenshot({ path: path.join(OUT, `studio-template-${id}.png`) })
    }

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
    await touring.page.keyboard.press("Escape")
    await popover.waitFor({ state: "detached" })
    assert.equal(
      await touring.page.evaluate(() =>
        window.localStorage.getItem("iconoplasm.diagramStudio.tour.v1"),
      ),
      "done",
    )
    assert.deepEqual(touring.errors, [])
    await touring.context.close()

    // Dark roast keeps a cream sheet.
    const dark = await openStudio(browser, origin, { width: 1440, height: 900, theme: "dark" })
    await dark.page.click('.ics-empty [data-studio-action="template:mechanism"]')
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
