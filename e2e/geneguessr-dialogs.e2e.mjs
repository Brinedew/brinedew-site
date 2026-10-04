// The GeneGuessr tutorial and the practice-mode dialog, as a visitor uses them, in real Chrome.
// Real page (quartz/static/geneguessr: app.js, tutorial.js, styles.css), real Worker on a real
// local D1, the game document's real Content Security Policy, and nothing mocked.
//
// What decides whether these dialogs work for a visitor is Chrome's modal dialog: focus moves in,
// Tab stays in, Escape closes, focus returns to the button that opened it, the page behind cannot
// scroll, and the real Validate and Play buttons work. A DOM stand-in cannot show any of that.
//
// Ways this can fail, written before the code:
//  1. a first visit shows no tutorial, or Escape closes it without remembering the step
//  2. the "?" tutorial skips a step, cannot go back, or "Got it" does not close it and mark all
//     three steps seen
//  3. a dialog does not take focus, lets Tab out to the page behind, or leaves the page behind
//     scrollable
//  4. closing a dialog (Close, Escape, a click on the backdrop) does not return focus to the
//     button that opened it
//  5. the practice dialog's label is not tied to its box, Validate does not say what it found,
//     Play does not start a practice game from the pasted genes, or the list is lost on reopen
//  6. Validate makes a request to the Worker (B-934: a paste resolves in the browser from the
//     static protein index and costs no D1 read and no Worker request)
// Needs an installed Chrome. A screenshot of each dialog lands in artifacts/e2e/ (E2E_OUT).
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { mkdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import test, { after, before, mock } from "node:test"

import worker from "../workers/the-only-allowed-internal-stateful-worker-runtime-do-not-duplicate.js"
import { publicContentSecurityPolicy } from "../workers/lib/the-only-public-document-policy-do-not-duplicate.js"
import {
  geneguessrWorkerEnv,
  openCatalogDb,
  productionShapedCatalogRows,
  seedCatalog,
} from "../workers/daily-selection-pool-test-d1.js"
import { OUT, ROOT, launchChrome } from "./harness.mjs"

const STATIC = path.join(ROOT, "quartz", "static")
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "text/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
}
// The game page as the site gives it: the stylesheet, the tutorial script, the page script and
// the game's mount point beside the sidebar that holds the practice button.
const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>GeneGuessr</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/static/geneguessr/styles.css">
<script src="/static/geneguessr/molstar-shared.js"></script>
<script defer src="/static/geneguessr/tutorial.js"></script>
</head><body style="margin:0"><div class="page"><div id="quartz-body">
<div class="center"><article><div id="geneguessr-root"></div></article></div>
<div class="sidebar right"></div>
</div></div>
<script type="module" src="/static/geneguessr/app.js"></script></body></html>`
const CSP = publicContentSecurityPolicy({ geneguessrGame: true }).replace(
  /;?\s*upgrade-insecure-requests/,
  "",
)

let server
let origin
let harness
let db
let dispose
let rows
let playable

before(async () => {
  mkdirSync(OUT, { recursive: true })
  ;({ db, dispose } = await openCatalogDb())
  rows = productionShapedCatalogRows().filter((row) => row.structure_source && row.gene_summary)
  playable = rows.filter((row) => row.structure_source !== "alphafold").slice(0, 60)
  await seedCatalog(db, rows.slice(0, 400))
  harness = geneguessrWorkerEnv(db)
  // The Worker's own provider fetches (the structure of a practice target) answer with a file.
  mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response("data_structure\nHEADER    MODEL\nATOM  1\n", {
        status: 200,
        headers: { "Content-Type": "chemical/x-cif" },
      }),
  )
  for (const method of ["log", "warn", "info", "error"]) mock.method(console, method, () => {})

  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://local")
      if (url.pathname.startsWith("/api/")) {
        const chunks = []
        for await (const chunk of request) chunks.push(chunk)
        const answer = await worker.fetch(
          new Request(`${origin}${url.pathname}${url.search}`, {
            method: request.method,
            headers: {
              Cookie: request.headers.cookie || "geneguessr_session=e2e-dialogs",
              "Content-Type": "application/json",
            },
            body: request.method === "GET" ? undefined : Buffer.concat(chunks),
          }),
          harness.env,
          { waitUntil() {} },
        )
        response.writeHead(answer.status, {
          "content-type": answer.headers.get("content-type") || "application/json",
        })
        return response.end(Buffer.from(await answer.arrayBuffer()))
      }
      if (url.pathname === "/static/geneguessr/protein-index.json") {
        // The static file the page downloads; its rows are the seeded proteins.
        response.writeHead(200, { "content-type": TYPES[".json"] })
        return response.end(JSON.stringify(proteinIndex()))
      }
      if (url.pathname === "/") {
        response.writeHead(200, { "content-type": TYPES[".html"], "content-security-policy": CSP })
        return response.end(PAGE)
      }
      const file = path.join(STATIC, decodeURIComponent(url.pathname).replace(/^\/static\//, ""))
      if (
        url.pathname.startsWith("/static/") &&
        file.startsWith(STATIC) &&
        statSync(file).isFile()
      ) {
        response.writeHead(200, {
          "content-type": TYPES[path.extname(file)] || "application/octet-stream",
        })
        return response.end(readFileSync(file))
      }
      response.writeHead(404)
      response.end("not found")
    } catch (error) {
      response.writeHead(error?.code === "ENOENT" ? 404 : 500)
      response.end(String(error?.message || error))
    }
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  origin = `http://127.0.0.1:${server.address().port}`
})

after(async () => {
  mock.restoreAll()
  await new Promise((resolve) => server?.close(resolve))
  await dispose?.()
})

// The page's static protein index for the seeded catalog: every seeded protein has a structure
// source, so each is playable; no symbol is listed as recognized but unplayable.
function proteinIndex() {
  return {
    schema_version: 1,
    fields: ["uniprot", "hgnc", "gene_surname", "full_name", "length", "synonyms"],
    rows: rows.slice(0, 400).map((row) => [row.uniprot, row.gene, null, row.gene, 100, []]),
    recognized_unplayable: [],
  }
}

// A visitor's tab. `seenTutorial` is a visitor who has already been through the steps (the
// page stores a bitmask of the three steps in localStorage), so no step opens by itself.
async function visitor(browser, { seenTutorial = true } = {}) {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } })
  if (seenTutorial) await context.addInitScript(() => localStorage.setItem("gg_tut", "7"))
  // Mol* and every other third party stay off the network: the dialogs do not use them.
  await context.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  )
  const page = await context.newPage()
  await page.goto(`${origin}/?gg_api=${encodeURIComponent(origin)}`)
  await page.waitForSelector('body[data-geneguessr-status="rendered"]', { timeout: 30000 })
  return { page, context }
}

// What the visitor can tell about the page right now.
// Waits up to 5 s for a condition the page reaches a task after a key press (a dialog's "close"
// event runs after the dialog has closed), then lets the assertion that follows report it.
const settle = (page, condition) =>
  page.waitForFunction(condition, null, { timeout: 5000 }).catch(() => {})

const state = (page) =>
  page.evaluate(() => {
    const active = document.activeElement
    const dialog = document.querySelector("dialog[open]")
    return {
      openDialogs: document.querySelectorAll("dialog[open]").length,
      focusInside: Boolean(dialog && active && dialog.contains(active)),
      // Focus is on the game or its sidebar, behind the dialog. (From the last button of a modal
      // dialog Tab may go to the browser's own controls, which leaves no element focused.)
      focusBehind: Boolean(active && active.closest("#geneguessr-root, .sidebar")),
      focusedText: (active?.textContent || active?.id || "").trim().slice(0, 40),
      focusedId: active?.id || "",
      focusedClass: active?.className || "",
      htmlOverflow: getComputedStyle(document.documentElement).overflow,
      seen: localStorage.getItem("gg_tut"),
    }
  })

const chrome = async (t) => {
  try {
    return await launchChrome(t)
  } catch (error) {
    if (process.env.CI) throw error
    t.skip(`Chrome is not available: ${error.message}`)
    return null
  }
}

test("a first visit opens the first tutorial step by itself; Escape closes it and remembers the step", async (t) => {
  const browser = await chrome(t)
  if (!browser) return
  try {
    const { page, context } = await visitor(browser, { seenTutorial: false })
    const dialog = page.locator("dialog.pg-tutorial-dialog[open]")
    await dialog.waitFor({ timeout: 10000 })
    assert.equal(await dialog.getAttribute("aria-labelledby"), "pg-tutorial-title")
    assert.equal(await dialog.locator("#pg-tutorial-title").innerText(), "Welcome to GeneGuessr!")
    const open = await state(page)
    assert.equal(open.focusInside, true, "focus moved into the dialog")
    assert.equal(open.htmlOverflow, "hidden", "the page behind cannot scroll")
    await page.screenshot({ path: path.join(OUT, "geneguessr-tutorial-first-visit.png") })

    // Tab goes round the dialog and never to the game behind it.
    for (let press = 0; press < 8; press += 1) {
      await page.keyboard.press("Tab")
      assert.equal((await state(page)).focusBehind, false, `Tab ${press + 1} reached the game`)
    }

    await page.keyboard.press("Escape")
    // The dialog closes at once; the step is written by its "close" event handler, a task later.
    await settle(page, () => localStorage.getItem("gg_tut") === "1")
    const closed = await state(page)
    assert.equal(closed.openDialogs, 0, "Escape closes it")
    assert.equal(closed.seen, "1", "the step is remembered, so it does not open again")
    assert.notEqual(closed.htmlOverflow, "hidden", "the page scrolls again")
    await page.reload()
    await page.waitForSelector('body[data-geneguessr-status="rendered"]')
    await page.waitForTimeout(1500)
    assert.equal((await state(page)).openDialogs, 0, "a seen step stays closed on the next visit")
    await context.close()
  } finally {
    await browser.close()
  }
})

test("the How to Play button walks the three steps and returns focus to itself", async (t) => {
  const browser = await chrome(t)
  if (!browser) return
  try {
    const { page, context } = await visitor(browser)
    const invoker = page.locator("#pg-how-to-play")
    await invoker.click()
    const dialog = page.locator("dialog.pg-tutorial-dialog[open]")
    await dialog.waitFor()
    const status = dialog.locator(".pg-tutorial-status")
    assert.match(await status.innerText(), /Step 1 of 3/)
    assert.equal(
      await dialog.locator(".pg-tutorial-back").isDisabled(),
      true,
      "no step before the first",
    )
    assert.equal((await state(page)).focusInside, true)

    await dialog.getByRole("button", { name: "Next" }).click()
    assert.match(await status.innerText(), /Step 2 of 3/)
    assert.equal(await dialog.locator(".pg-tutorial-back").isDisabled(), false)
    await dialog.getByRole("button", { name: "Back" }).click()
    assert.match(await status.innerText(), /Step 1 of 3/, "Back goes back")
    await dialog.getByRole("button", { name: "Next" }).click()
    await dialog.getByRole("button", { name: "Next" }).click()
    assert.match(await status.innerText(), /Step 3 of 3/)
    await page.screenshot({ path: path.join(OUT, "geneguessr-tutorial-last-step.png") })

    await dialog.getByRole("button", { name: "Got it" }).click()
    const closed = await state(page)
    assert.equal(closed.openDialogs, 0)
    assert.equal(closed.seen, "7", "all three steps are remembered")
    assert.equal(closed.focusedId, "pg-how-to-play", "focus returns to the button that opened it")
    await context.close()
  } finally {
    await browser.close()
  }
})

test("the practice dialog: label, Validate, Play from the pasted genes, and the list kept on reopen", async (t) => {
  const browser = await chrome(t)
  if (!browser) return
  try {
    const { page, context } = await visitor(browser)
    const invoker = page.locator(".pg-sidebar-practice-button")
    await invoker.click()
    const dialog = page.locator("dialog.pg-practice-dialog[open]")
    await dialog.waitFor()
    assert.equal(await dialog.getAttribute("aria-labelledby"), "pg-practice-title")
    const box = dialog.getByLabel("Gene symbols")
    assert.equal(
      await box.evaluate((element) => element === document.activeElement),
      true,
      "the box has focus",
    )
    assert.equal((await state(page)).htmlOverflow, "hidden", "the page behind cannot scroll")
    await page.screenshot({ path: path.join(OUT, "geneguessr-practice-dialog.png") })

    // Three genes of the catalog and one symbol that no protein has.
    const genes = playable.slice(0, 3).map((row) => row.gene)
    await box.fill([...genes, "ZZZ99"].join("\n"))
    // Opening the dialog already downloaded the index; Validate needs the network for nothing,
    // so no request to the Worker may follow it.
    const apiRequests = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url())
    })
    await dialog.getByRole("button", { name: "Validate" }).click()
    const results = dialog.locator(".pg-practice-results")
    await page.waitForFunction(
      () => document.querySelector(".pg-practice-results")?.textContent.trim().length > 0,
    )
    const verdict = await results.innerText()
    assert.match(verdict, /3 recognized/, verdict)
    assert.match(verdict, /3 playable/, verdict)
    assert.match(verdict, /1 unrecognized/, "the unknown symbol is counted, not silently dropped")
    assert.equal(await results.getAttribute("role"), "status")
    assert.deepEqual(apiRequests, [], "Validate makes no request to the Worker")

    // Play starts a practice game whose target is one of the pasted genes.
    await dialog.getByRole("button", { name: "Play" }).click()
    await page.waitForFunction(() => !document.querySelector("dialog.pg-practice-dialog[open]"))
    await page.waitForSelector('body[data-geneguessr-status="rendered"]')
    const practice = await page.evaluate(
      async (apiOrigin) =>
        (
          await (
            await fetch(`${apiOrigin}/api/game/bootstrap?practice=1`, { credentials: "include" })
          ).json()
        ).status.practiceMode,
      origin,
    )
    assert.equal(practice, true, "the Worker's game is a practice game")
    const { targetId } = [...harness.sessions.values()].at(-1)
    assert.ok(
      playable.slice(0, 3).some((row) => row.uniprot === targetId),
      "the target is one of the pasted genes",
    )
    assert.match(
      await page.locator(".pg-sidebar-practice-badge").innerText(),
      /practice mode\s+3 genes/i,
      "the page says so, with the size of the pasted list",
    )

    // The list is kept: reopening shows what was pasted. Escape closes and returns focus.
    await page.locator(".pg-sidebar-practice-button").click()
    await dialog.waitFor()
    assert.equal(
      await dialog.getByLabel("Gene symbols").inputValue(),
      [...genes, "ZZZ99"].join("\n"),
    )
    await page.keyboard.press("Escape")
    await settle(page, () =>
      document.activeElement?.classList.contains("pg-sidebar-practice-button"),
    )
    const escaped = await state(page)
    assert.equal(escaped.openDialogs, 0)
    assert.match(escaped.focusedClass, /pg-sidebar-practice-button/, "focus returns to the button")

    // A click on the backdrop closes it too, and Close does.
    await page.locator(".pg-sidebar-practice-button").click()
    await dialog.waitFor()
    await page.mouse.click(4, 4)
    assert.equal((await state(page)).openDialogs, 0, "a click outside the card closes it")
    await page.locator(".pg-sidebar-practice-button").click()
    await dialog.waitFor()
    await dialog.getByRole("button", { name: "Close" }).click()
    const afterClose = await state(page)
    assert.equal(afterClose.openDialogs, 0)
    assert.match(afterClose.focusedClass, /pg-sidebar-practice-button/)
    await context.close()
  } finally {
    await browser.close()
  }
})
