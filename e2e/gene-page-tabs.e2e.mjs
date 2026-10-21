// B-1101: a gene's sections sit under the lead card as tabs. Overview is the
// page as it was, each section cut to a slice that leads into its own tab
// (owner, 2026-10-17: "A compressed slice from other tabs"); Lore, Comments and
// Candidates each show one section whole. TP53 is the heaviest real case: 71
// candidates and 2,150 characters of text.
//
// Ways this can fail, written before the check:
// 1. The tabs never render, so the page stacks every section at full length.
// 2. Overview is not the default, or loses a section's slice.
// 3. Lore is not cut in Overview, or Read more is missing or opens nothing.
// 4. Overview shows every comment instead of the newest three, See all is
//    missing, or the Comments tab has no count.
// 5. A tab with nothing behind it shows: a Lore tab on a gene whose lore
//    readers can't see.
// 6. The Candidates tab keeps the carousel (Embla's transform on the track)
//    instead of a grid, or its tiles are too narrow for their footers.
// 7. Back in Overview the strip doesn't come back as a carousel.
// 8. The address caretaker notifications use (#gene-comments) doesn't open
//    Comments, or leaves it off screen while the lead card fills in.
// 9. Left and Right on a tab don't move between tabs.
// 10. The tab row or the grid scrolls the page sideways on a phone.
//
// What is real: the built site, TP53's published payload and candidates, Embla,
// Chrome. Mocked: the signed-in /api/* answers, five comments, and TP53's text
// marked public (readers can't see it in production yet), added to the
// published payload as it loads. Screenshots land in artifacts/e2e.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
  HOST,
  OUT,
  VIEWPORTS,
  fulfillWithoutLore,
  launchChrome,
  routeProduction,
  startSite,
} from "./harness.mjs"

const SYMBOL = "TP53"
const TABS = "[data-icono-gene-tabs]"
const LORE =
  "A regal sovereign and final arbiter sits in heavy deliberation, weighing every damaged cell that comes before her. ".repeat(
    12,
  )
const COMMENTS = Array.from({ length: 5 }, (_, i) => ({
  id: i + 1,
  username: `reader${i + 1}`,
  body: `Comment number ${i + 1} on this gene.`,
  created_at: new Date(Date.UTC(2026, 9, 17 - i)).toISOString(),
}))

// Runs in the page before any script: TP53's text arrives marked public.
function publishLore(lore) {
  let reader
  Object.defineProperty(window, "IconoplasmPublicationReader", {
    configurable: true,
    get() {
      return reader
    },
    set(value) {
      const gene = value.gene.bind(value)
      value.gene = (key, options) =>
        gene(key, options).then((payload) => {
          if (payload && payload.symbol === "TP53") {
            payload.canonical_manifestation = {
              ...payload.canonical_manifestation,
              public_page_visible: true,
              prose: lore,
            }
          }
          return payload
        })
      reader = value
    },
  })
}

function readTabs() {
  const tabs = document.querySelector("[data-icono-gene-tabs]")
  const shown = (el) => !!el && el.checkVisibility()
  const body = tabs.querySelector(".icono-public-manifestation__body")
  const grid = tabs.querySelector("[data-icono-candidate-strip] .icono-candidate-grid")
  const list = tabs.querySelector("[data-icono-gene-tablist]")
  const footers = [...tabs.querySelectorAll(".icono-candidate-footer")].filter(shown)
  return {
    selected: tabs.getAttribute("data-icono-gene-selected"),
    hash: location.hash,
    tabs: [...list.querySelectorAll("[data-icono-gene-tab]")].map((b) => ({
      id: b.getAttribute("data-icono-gene-tab"),
      selected: b.getAttribute("aria-selected") === "true",
      count: b.querySelector(".icono-section-count:not([hidden])")?.textContent || "",
    })),
    focused: document.activeElement?.getAttribute?.("data-icono-gene-tab") || "",
    parts: [...tabs.querySelectorAll("[data-icono-gene-part]")]
      .filter(shown)
      .map((part) => part.getAttribute("data-icono-gene-part")),
    links: [...tabs.querySelectorAll("[data-icono-gene-more]")]
      .filter(shown)
      .map((link) => link.getAttribute("data-icono-gene-more")),
    loreClipped: body ? body.scrollHeight > body.clientHeight + 1 : null,
    commentsShown: [...tabs.querySelectorAll(".icono-suggest-item")].filter(shown).length,
    stripReady: tabs
      .querySelector("[data-icono-candidate-strip]")
      .classList.contains("is-strip-ready"),
    gridDisplay: grid ? getComputedStyle(grid).display : "",
    trackTransform: grid ? grid.style.transform : "",
    footerSpill: Math.max(0, ...footers.map((f) => f.scrollWidth - f.clientWidth)),
    tablistSpill: list.scrollWidth - list.clientWidth,
    tablistTop: list.getBoundingClientRect().top,
    pageSpill: document.documentElement.scrollWidth - innerWidth,
  }
}

test("gene page tabs: Overview slices lead into Lore, Comments and Candidates", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const [width, height, name] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: "dark" })
      await routeProduction(context, origin, (pathname) =>
        pathname === `/api/iconoplasm/genes/${SYMBOL}/comments`
          ? { comments: COMMENTS }
          : undefined,
      )
      await context.addInitScript(publishLore, LORE)
      const page = await context.newPage()
      const state = () => page.evaluate(readTabs)
      const open = async (selector) => {
        await page.click(selector)
        await page.waitForTimeout(400)
        return state()
      }

      await page.goto(`${HOST}/gene/${SYMBOL}`)
      await page.waitForSelector(`${TABS} [data-icono-candidate-strip].is-strip-ready`, {
        timeout: 30_000,
      })
      await page.waitForSelector(`${TABS} .icono-suggest-item`, { timeout: 30_000 })
      await page.waitForTimeout(800)

      // 1, 2: Overview is open and shows a slice of every section.
      const overview = await state()
      assert.deepEqual(
        overview.tabs.map((tab) => tab.id),
        ["overview", "lore", "comments", "candidates"],
        `${name}: tabs`,
      )
      assert.equal(overview.selected, "overview", `${name}: Overview opens first`)
      assert.deepEqual(overview.parts, ["lore", "comments", "candidates"], `${name}: slices`)
      // 3, 4: each slice is cut and says so.
      assert.equal(overview.loreClipped, true, `${name}: lore is cut in Overview`)
      assert.equal(overview.commentsShown, 3, `${name}: the newest three comments`)
      // The strip holds every candidate, so it gets no "See all" under it.
      assert.deepEqual(overview.links, ["lore", "comments"], `${name}: slice links`)
      assert.equal(overview.tabs.find((tab) => tab.id === "comments").count, "5")
      assert.equal(overview.tabs.find((tab) => tab.id === "candidates").count, "71")
      // 10
      assert.ok(
        overview.tablistSpill <= 0,
        `${name}: tab row fits (${overview.tablistSpill} px over)`,
      )
      assert.ok(overview.pageSpill <= 0, `${name}: no sideways page scroll`)
      await page.screenshot({ path: path.join(OUT, `gene-tabs-overview-${name}.png`) })

      // 3: Read more opens the whole lore.
      const lore = await open('[data-icono-gene-more="lore"]')
      assert.equal(lore.selected, "lore", `${name}: Read more opens Lore`)
      assert.equal(lore.hash, "#lore")
      assert.deepEqual(lore.parts, ["lore"])
      assert.equal(lore.loreClipped, false, `${name}: the Lore tab shows all of it`)
      assert.ok(lore.tablistTop >= 0, `${name}: the tab row is on screen after Read more`)

      // 4: the Comments tab shows every comment.
      const comments = await open('[data-icono-gene-tab="comments"]')
      assert.equal(comments.commentsShown, 5, `${name}: every comment in its tab`)
      assert.deepEqual(comments.links, [], `${name}: no slice links outside Overview`)

      // 6: the Candidates tab is a grid, with room for every footer.
      const candidates = await open('[data-icono-gene-tab="candidates"]')
      assert.equal(candidates.gridDisplay, "grid", `${name}: Candidates is a grid`)
      assert.equal(candidates.stripReady, false, `${name}: Embla stands down`)
      assert.equal(candidates.trackTransform, "", `${name}: no carousel transform on the grid`)
      assert.equal(candidates.footerSpill, 0, `${name}: footers fit their tiles`)
      assert.ok(candidates.pageSpill <= 0, `${name}: the grid stays inside the page`)
      await page.screenshot({ path: path.join(OUT, `gene-tabs-candidates-${name}.png`) })

      // 7: back in Overview the strip is a carousel again.
      await page.click('[data-icono-gene-tab="overview"]')
      await page.waitForSelector(`${TABS} [data-icono-candidate-strip].is-strip-ready`, {
        timeout: 10_000,
      })
      const back = await state()
      assert.equal(back.hash, "", `${name}: Overview has no address of its own`)
      assert.equal(back.gridDisplay, "flex", `${name}: the strip is a row again`)

      // 9: Left and Right move between tabs and open them.
      await page.focus('[data-icono-gene-tab="overview"]')
      await page.keyboard.press("ArrowRight")
      const right = await state()
      assert.equal(right.selected, "lore")
      assert.equal(right.focused, "lore")
      await page.keyboard.press("ArrowLeft")
      await page.keyboard.press("ArrowLeft")
      assert.equal((await state()).selected, "candidates", `${name}: Left wraps to the last tab`)

      // 8: a notification link opens Comments, on screen.
      // A new query makes this a fresh load, not an in-page jump to a hash.
      await page.goto(`${HOST}/gene/${SYMBOL}?from=notification#gene-comments`)
      await page.waitForSelector(`${TABS} .icono-suggest-item`, { timeout: 30_000 })
      await page.waitForTimeout(1500)
      const arrival = await state()
      assert.equal(arrival.selected, "comments", `${name}: #gene-comments opens Comments`)
      assert.ok(
        arrival.tablistTop >= 0 && arrival.tablistTop < height / 2,
        `${name}: the tab row is on screen (${Math.round(arrival.tablistTop)} px)`,
      )
      await context.close()
    }

    // 5: TP53 with its lore hidden from readers: no Lore tab.
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
    await routeProduction(context, origin)
    await context.route(`**/genes/v3/${SYMBOL}.json`, fulfillWithoutLore)
    const page = await context.newPage()
    await page.goto(`${HOST}/gene/${SYMBOL}`)
    await page.waitForSelector(`${TABS} [data-icono-gene-tab]`, { timeout: 30_000 })
    const plain = await page.evaluate(readTabs)
    assert.deepEqual(
      plain.tabs.map((tab) => tab.id),
      ["overview", "comments", "candidates"],
      "no Lore tab while readers can't see the lore",
    )
    await context.close()
  } finally {
    await browser.close()
    server.close()
  }
})

// A reader who is not signed in reads the comments from the gene's CDN object, not the
// Worker (a gene page view costs no Worker request). Ways this can fail, written before the
// check: the guest sees "No comments yet." on a gene that has comments (the bug this
// fixes); the page still asks the Worker; a gene with no object (the CDN's 404) shows an
// error instead of an empty list.
test("gene page comments: a guest reads them from the CDN copy", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    for (const present of [true, false]) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
      const workerAsked = []
      await routeProduction(
        context,
        origin,
        (pathname) => {
          if (pathname.includes("/comments")) workerAsked.push(pathname)
          return undefined
        },
        { session: false },
      )
      await context.route(`https://img.brinedew.bio/comments/v1/${SYMBOL}.json`, (route) =>
        present
          ? route.fulfill({
              status: 200,
              contentType: "application/json",
              headers: { "Access-Control-Allow-Origin": "*" },
              body: JSON.stringify({ symbol: SYMBOL, count: COMMENTS.length, comments: COMMENTS }),
            })
          : route.fulfill({
              status: 404,
              headers: { "Access-Control-Allow-Origin": "*" },
              body: "Not Found",
            }),
      )
      const page = await context.newPage()
      await page.goto(`${HOST}/gene/${SYMBOL}`)
      await page.waitForSelector(`${TABS} [data-icono-suggest-list] > *`, { timeout: 30_000 })
      const seen = await page.evaluate(readTabs)
      const empty = await page
        .locator(`${TABS} .icono-suggest-empty`)
        .first()
        .textContent()
        .catch(() => "")
      if (present) {
        assert.equal(seen.commentsShown, 3, "a guest sees the newest three in Overview")
        assert.equal(seen.tabs.find((tab) => tab.id === "comments").count, "5")
      } else {
        assert.equal(seen.commentsShown, 0)
        assert.equal(empty.trim(), "No comments yet.", "a 404 is an empty list, not an error")
      }
      assert.deepEqual(workerAsked, [], "a guest's comments cost no Worker request")
      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})
