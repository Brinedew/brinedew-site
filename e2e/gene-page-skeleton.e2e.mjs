// B-1105: the gene page's skeleton is the loaded page with its data left out, so
// nothing moves when the gene arrives. Before this, the skeleton was two boxes
// measured by hand in September 2026; the toolbar, tabs and comments grew under
// the card after that, and on a phone the card was 551 px against 1,286 loaded.
//
// Ways this can fail, written before the check:
// 1. A section of the loaded page (card, toolbar, tabs, comments, candidates)
//    has no skeleton stand-in.
// 2. A box the reader can see on arrival moves by more than a pixel.
// 3. A box below the fold moves by more than real genes differ from each other
//    (one wrapped line: on a phone WEE1's card is 1,286 px and TP53's 1,271 in
//    Windows Chrome on 2026-10-17; in CI's Linux Chrome the gap is 15.7 px, so
//    the allowance is 20).
// 4. The skeleton shows a value, a pen mark or a picture that isn't this gene's.
// 5. The skeleton can be focused or clicked.
//
// What is real: the built site, TP53's published card and candidates, Chrome.
// The gene's published file is held back until the skeleton is measured.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, VIEWPORTS, launchChrome, routeProduction, startSite } from "./harness.mjs"

const SYMBOL = "TP53"
const PARTS = {
  card: ".icono-gene-lead-card",
  toolbar: ".icono-gene-toolbar-rail",
  tablist: ".icono-gene-tablist",
  comments: ".icono-suggest",
  candidates: ".icono-candidate-strip",
  tile: ".icono-candidate-strip .icono-candidate-card",
}

// Runs in the page: each part's box inside `scope`, in page coordinates.
function boxes([scope, parts]) {
  const root = document.querySelector(scope)
  const out = {}
  for (const [name, selector] of Object.entries(parts)) {
    const el = root && root.querySelector(selector)
    if (!el) continue
    const b = el.getBoundingClientRect()
    out[name] = { x: b.x, y: b.y + scrollY, width: b.width, height: b.height }
  }
  return { out, fold: innerHeight }
}

// Runs in the page: whatever the skeleton shows or offers that it shouldn't.
function skeletonLeaks() {
  const skeleton = document.querySelector(".icono-gene-skeleton")
  const leaks = []
  for (const el of skeleton.querySelectorAll(".icono-gene-lead-card *")) {
    const style = getComputedStyle(el)
    const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())
    if (ownText && style.color !== "rgba(0, 0, 0, 0)" && style.visibility !== "hidden")
      leaks.push(`card text shows: "${el.textContent.trim().slice(0, 24)}"`)
    if (el.matches("img, svg, canvas") && el.checkVisibility({ visibilityProperty: true }))
      leaks.push(`card ${el.tagName.toLowerCase()} shows`)
  }
  // The printed card carries its own peek toggle and licence link; inert keeps
  // them from focus and clicks. An id would clash with the loaded page's.
  if (!skeleton.inert) leaks.push("skeleton is not inert")
  for (const el of skeleton.querySelectorAll("[id]")) leaks.push(`skeleton repeats id ${el.id}`)
  return leaks
}

test("the gene page skeleton holds the loaded page's boxes", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const site = await startSite()
  t.after(async () => {
    await browser.close()
    site.server.close()
  })
  mkdirSync(OUT, { recursive: true })

  for (const [width, height, label] of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width, height } })
    await routeProduction(context, site.origin, undefined, { session: false })
    const held = []
    await context.route("**/genes/v3/**", (route) => {
      held.push(route)
    })
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await page.goto(`${HOST}/${SYMBOL}`, { waitUntil: "domcontentloaded" })
    await page.waitForSelector(".icono-gene-skeleton .icono-gene-lead-card")
    await page.waitForTimeout(500)
    await page.screenshot({ path: path.join(OUT, `gene-skeleton-${label}.png`) })
    const skeleton = await page.evaluate(boxes, [".icono-gene-skeleton", PARTS])
    assert.deepEqual(await page.evaluate(skeletonLeaks), [], label)

    while (held.length) await held.shift().continue()
    await context.unroute("**/genes/v3/**")
    await page.waitForSelector("#icono-gene-content .icono-candidate-strip .icono-candidate-card")
    await page.waitForTimeout(1500)
    await page.screenshot({ path: path.join(OUT, `gene-loaded-${label}.png`) })
    const loaded = await page.evaluate(boxes, ["#icono-gene-content", PARTS])

    const problems = []
    for (const name of Object.keys(PARTS)) {
      const a = skeleton.out[name]
      const b = loaded.out[name]
      if (!a) {
        problems.push(`${name} has no skeleton`)
        continue
      }
      const seen = b.y < loaded.fold
      const slack = seen ? 1 : 20
      for (const key of ["x", "y", "width"]) {
        if (Math.abs(a[key] - b[key]) > slack)
          problems.push(
            `${name} ${key}: skeleton ${a[key].toFixed(1)}, loaded ${b[key].toFixed(1)}`,
          )
      }
      // A box the reader sees whole keeps its height too; one that runs past the
      // fold may differ below it.
      const bottom = Math.max(a.y + a.height, b.y + b.height)
      const heightSlack = bottom <= loaded.fold ? 1 : 20
      if (Math.abs(a.height - b.height) > heightSlack)
        problems.push(
          `${name} height: skeleton ${a.height.toFixed(1)}, loaded ${b.height.toFixed(1)}`,
        )
    }
    assert.deepEqual(problems, [], label)
    assert.deepEqual(errors, [], label)
    await context.close()
  }
})
