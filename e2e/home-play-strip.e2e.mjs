// B-1173: a signed-out first-time visitor finds genes on the Archive before
// installing anything. Checked in Chrome, desktop and phone, against the live
// published catalogue.
//
// Ways this can fail, written before the code:
// 1. the visitor still gets the install card, or gets both; the starters'
//    feed shows beside the strip; a signed-out reader with the add-on and no
//    finds gets no strip (it hid the strip from the owner's private window on
//    2026-10-24);
// 2. hovering (desktop) or tapping (phone) a symbol doesn't turn that gene's
//    card face up, turns another, or the "Your discoveries" tab waits for
//    anything: it must read 1 the moment the pointer arrives (the card itself
//    turns once its portrait is painted, 17);
// 3. the Archive's header is not one row of search and Sort with two tabs
//    under it, a phone's Sort button squeezes the search box, or the strip
//    offers a Sort that has nothing to sort;
// 4. the find is not stored in this browser, or a visit to "Global
//    discoveries" and back loses it;
// 5. more than one button follows the cards, the strip never says that it is
//    a sample of a browser extension, or the add-on on other sites (the two
//    screenshots) is missing, for a reader with the add-on too;
// 6. a Chrome reader's button downloads a file or leaves the page, instead of
//    opening the install steps under the strip, or those steps carry a second,
//    login button;
// 7. Firefox gets anything but its add-on store, an Android phone anything
//    but the Firefox steps; Safari or an iPhone, which have no install path,
//    get a button at all; a reader who has the add-on is not told first that
//    the page knows it (2026-10-28: they got two screenshots and a button
//    named after an article, and asked why), or can't open the two pages
//    from the windows and their named links;
// 8. the first tap on a phone opens the gene page (it must turn the card);
//    the second tap, or a desktop click, doesn't open it;
// 9. the strip asks the Worker anything (it must cost nothing per reader);
// 10. the strip shows more than the four starters, a starter found before is
//    not face up, or the finds are counted wrong;
// 11. a guest's finds (the add-on's, gene pages, the strip's) are not their
//    gallery under the strip, newest first, as a signed-in reader's are
//    (owner, 2026-10-28: "Now I have apparently discovered five genes, yet
//    ... I see only four starters");
// 12. the strip goes before all four starters are found, or stays after
//    (owner, 2026-10-28: omit it "only if the user already discovered all
//    the four starters", add-on or not);
// 13. a guest with a find has no "Log in to save" in Sort's place, one with
//    none has it, or the strip carries a login of its own;
// 14. a guest who comes back from another tab with new finds doesn't see
//    them until a reload;
// 15. on a phone the two sites shrink side by side until they can't be read,
//    instead of sitting in a swipe row (owner, 2026-10-29: "examples
//    screenshot unreadable side by side on mobile");
// 16. a card found on the strip waits for a reload before it joins the
//    gallery under it (owner, 2026-10-29: "tapped cards dont get instantly
//    added to the collection");
// 17. a card turns face up before its portrait is painted, onto a black void
//    that the picture then pops into (owner, 2026-10-29), or a face still
//    down can be focused or read out, which gives the gene away.
//
// Needs `pnpm run build` (public-iconoplasm-edge) and an installed Chrome.
// Screenshots and measurements land in artifacts/e2e/home-play-strip*.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, HttpStatus, OUT, launchChrome, routeProduction, startSite } from "./harness.mjs"

const CDN_HOST = "img.brinedew.bio"
const STORE_KEY = "iconoplasm.website-guest-discoveries.v1"
// The "Global discoveries" tab's feed, which is the Worker's to answer.
const SHARED_FEED = "/api/iconoplasm/account-gallery-window"
const UA = {
  chrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0",
  android:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  safari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
}
const DESKTOP = { viewport: { width: 1280, height: 860 } }
const DOCS_LINE =
  "Iconoplasm is a browser extension that highlights all the gene names on any web page."
const PHONE = { viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true }

// The reader falls back to the Worker when the CDN is slow, and a slow runner
// would turn that into a failed catalogue here. The published JSON is read
// once from the live CDN, with retries, and served from memory (as in
// anonymous-reader-requests.e2e.mjs). Portraits load from the live CDN.
const CDN_OBJECTS = new Map()
function cdnObject(pathname) {
  if (!CDN_OBJECTS.has(pathname)) {
    CDN_OBJECTS.set(
      pathname,
      (async () => {
        let last = ""
        for (let attempt = 1; attempt <= 5; attempt += 1) {
          try {
            const response = await fetch(`https://${CDN_HOST}${pathname}`, {
              signal: AbortSignal.timeout(45_000),
            })
            if (response.ok || response.status === 404) {
              return {
                status: response.status,
                contentType: response.headers.get("content-type") || "application/json",
                body: Buffer.from(await response.arrayBuffer()),
              }
            }
            last = `HTTP ${response.status}`
          } catch (error) {
            last = String(error?.message || error)
          }
          await new Promise((resolve) => setTimeout(resolve, 1_000 * attempt))
        }
        throw new Error(`the live CDN did not answer for ${pathname} after 5 tries: ${last}`)
      })(),
    )
  }
  return CDN_OBJECTS.get(pathname)
}

// The add-on's site bridge (iconoplasm-extension/site-bridge.js) marks the
// page at document start and answers each of the Archive's requests with the
// genes it has found so far while the reader was signed out (oldest first).
// A test finds more by changing window.__iconoAddOnFinds.
function addOnBridge(symbols) {
  window.__iconoAddOnFinds = symbols
  // An init script can run before <html> exists; document_start runs after.
  const mark = () =>
    document.documentElement.setAttribute("data-iconoplasm-extension-installed", "true")
  if (document.documentElement) mark()
  else {
    new MutationObserver((_records, observer) => {
      if (!document.documentElement) return
      observer.disconnect()
      mark()
    }).observe(document, { childList: true })
  }
  window.addEventListener("iconoplasm-extension-guest-discoveries-request", () => {
    window.dispatchEvent(
      new CustomEvent("iconoplasm-extension-guest-discoveries", {
        detail: JSON.stringify(window.__iconoAddOnFinds),
      }),
    )
  })
}

async function openArchive(
  browser,
  origin,
  options,
  { seed = null, addOn = null, holdPortraits = false } = {},
) {
  const context = await browser.newContext(options)
  const api = []
  await routeProduction(
    context,
    origin,
    (pathname) => {
      api.push(pathname)
      return new HttpStatus(404)
    },
    { session: false },
  )
  await context.route(`https://${CDN_HOST}/**`, async (route) => {
    const { pathname } = new URL(route.request().url())
    if (!/^\/(?:catalog|genes)\/v3\//.test(pathname)) return route.continue()
    const object = await cdnObject(pathname)
    return route.fulfill({ ...object, headers: { "access-control-allow-origin": "*" } })
  })
  // Portraits wait here until the test releases them, so "before the
  // portrait came" doesn't depend on how fast the runner is.
  const heldPortraits = []
  let releasePortraits = () => {}
  if (holdPortraits) {
    const gate = new Promise((resolve) => (releasePortraits = resolve))
    await context.route(
      (url) => url.hostname === CDN_HOST && url.pathname.startsWith("/portraits/"),
      async (route) => {
        heldPortraits.push(new URL(route.request().url()).pathname)
        await gate
        return route.fallback()
      },
    )
  }
  if (addOn) await context.addInitScript(addOnBridge, addOn)
  if (seed) {
    await context.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [STORE_KEY, JSON.stringify(seed)],
    )
  }
  const page = await context.newPage()
  const downloads = []
  page.on("download", (download) => downloads.push(download.suggestedFilename()))
  const sites = []
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/static/iconoplasm/play/")) {
      sites.push(request.url())
    }
  })
  await page.goto(`${HOST}/`)
  await page.waitForSelector("[data-icono-home-play], #icono-home-auxiliary:not([hidden]) > *", {
    timeout: 45_000,
  })
  return { context, page, api, downloads, sites, heldPortraits, releasePortraits }
}

const pill = (symbol) => `[data-icono-play-symbol="${symbol}"]`
// The reader's gallery under the strip, in order: the genes its cards open.
const gallery = (page) =>
  page.$$eval("#icono-grid a.icono-image-only-link", (links) => [
    ...new Set(links.map((link) => link.getAttribute("href").replace("/gene/", ""))),
  ])
// "Log in to save" in Sort's place, and where it goes.
const login = (page) =>
  page.$eval("#icono-guest-login", (link) =>
    link.checkVisibility() ? { text: link.textContent, href: link.getAttribute("href") } : null,
  )
const title = (page) => page.textContent("[data-icono-play-title]")
const yours = (page) => page.textContent(".icono-collection-tab-count")
// The cards in the strip that are face up, and the one that stands out.
const faceUp = (page) =>
  page.$$eval(".icono-play-slot.is-found", (slots) =>
    slots.map((slot) => slot.dataset.iconoPlaySlot),
  )
// A card turns once its portrait is painted (17), so wait for the turn.
const turned = (page, symbols) =>
  page.waitForFunction(
    (want) =>
      [...document.querySelectorAll(".icono-play-slot.is-found")]
        .map((slot) => slot.dataset.iconoPlaySlot)
        .join() === want.join(),
    symbols,
    { timeout: 15_000 },
  )
const lit = (page) =>
  page.$$eval(".icono-play-slot.is-lit", (slots) => slots.map((slot) => slot.dataset.iconoPlaySlot))
// The visible buttons in the next-step row: their words (without the
// browser's mark or the new-tab arrow), whether they carry a mark, and where
// they go.
const buttons = (page, scope = "[data-icono-play-next]") =>
  page.$$eval(`${scope} .icono-button`, (nodes) =>
    nodes
      .filter((node) => node.checkVisibility())
      .map((node) => ({
        text: (node.querySelector("span") || node).textContent.trim(),
        glyph: !!node.querySelector("svg.icono-play-glyph"),
        href: node.getAttribute("href") || "",
        target: node.getAttribute("target") || "",
      })),
  )
const nextNote = (page) => page.textContent("[data-icono-play-next] .icono-install-note")
// The two other sites, drawn and loaded, each in a browser window with its
// address.
const siteImages = (page) =>
  page.$$eval("[data-icono-play-next] .icono-play-site .icono-play-window > img", (images) =>
    images
      .filter((image) => image.checkVisibility())
      .map((image) => ({ alt: image.alt, loaded: image.complete && image.naturalWidth > 0 })),
  )
const SITE_ALTS = [
  "Wikipedia's Homeobox article with Iconoplasm installed",
  "The UCSC Genome Browser with Iconoplasm installed",
]
const siteAddresses = (page) =>
  page.$$eval("[data-icono-play-next] .icono-play-site .icono-play-address", (nodes) =>
    nodes.map((node) => node.textContent),
  )
// On a phone the two windows sit in one swipe row (candidate-strip.js), each
// wide enough to read, the second peeking in and running past the edge.
const siteRow = (page) =>
  page.$eval("[data-icono-play-next] .icono-play-sites", (row) => ({
    ready: row.classList.contains("is-strip-ready"),
    still: row.classList.contains("is-strip-still"),
    screen: document.documentElement.clientWidth,
    windows: [...row.querySelectorAll(".icono-play-site")].map((site) => {
      const box = site.getBoundingClientRect()
      return { left: Math.round(box.left), top: Math.round(box.top), width: Math.round(box.width) }
    }),
  }))
// For a reader with the add-on, each window and the page's name under it are
// one link.
const siteLinks = (page) =>
  page.$$eval("[data-icono-play-next] a.icono-play-site", (links) =>
    links.map((link) => [
      link.querySelector(".icono-play-site-label").textContent.replace("↗", "").trim(),
      link.getAttribute("href"),
      link.getAttribute("target"),
    ]),
  )
// The drawn window: the site's address and the add-on's toolbar icon.
const windowBar = (page) =>
  page.$eval(".icono-play-bar", (bar) => ({
    address: bar.querySelector(".icono-play-address").textContent,
    icon: bar.querySelector("img.icono-play-addon").complete,
  }))
// The Archive's header: the toolbar's two controls, their boxes, and what
// shows under them.
const header = (page) =>
  page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect()
      return { top: Math.round(r.top), height: Math.round(r.height), width: Math.round(r.width) }
    }
    const sort = document.querySelector(".icono-gallery-order")
    return {
      search: box(document.getElementById("icono-q")),
      sort: sort.checkVisibility() ? box(sort) : null,
      // What the button shows: its label, and the choice where there is room.
      sortText: [...sort.querySelectorAll("span")]
        .filter((span) => span.checkVisibility())
        .map((span) => span.textContent.trim())
        .join(" "),
      tabs: [...document.querySelectorAll(".icono-collection-tab")].map(
        (tab) =>
          tab.innerText.replace(/\s+/g, " ").trim() +
          (tab.getAttribute("aria-selected") === "true" ? "*" : ""),
      ),
      feed: document.getElementById("icono-grid").checkVisibility(),
    }
  })

const storedSymbols = (page) =>
  page.evaluate(
    (key) =>
      (JSON.parse(localStorage.getItem(key) || "{}").discoveries || []).map((entry) => entry[0]),
    STORE_KEY,
  )

test("a first-time visitor finds genes on the Archive strip", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const report = {}
  const shot = (page, name) =>
    page.screenshot({ path: path.join(OUT, `home-play-strip-${name}.png`) })
  try {
    await t.test("desktop Chrome: hover, one button, steps without a download", async () => {
      const { context, page, api, downloads } = await openArchive(browser, origin, {
        ...DESKTOP,
        userAgent: UA.chrome,
      })
      // 1. The strip, not the install card or the starters' feed.
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      assert.equal(await page.$("[data-icono-home-install-card]"), null, "install card shown too")
      assert.equal(await title(page), "Hover any gene symbol")
      const bar = await windowBar(page)
      assert.equal(bar.address, new URL(HOST).host)
      assert.deepEqual(await faceUp(page), [], "a starter was face up before a find")
      // 3. One row: the search box alone (nothing to sort), the tabs under it.
      const top = await header(page)
      assert.equal(top.feed, false, "the starters' feed shows beside the strip")
      assert.equal(top.sort, null, "the strip offers a Sort")
      assert.deepEqual(top.tabs, ["Your discoveries 0*", "Global discoveries"])
      // 13. Nothing found yet, nothing to save.
      assert.equal(await login(page), null, "a login with nothing to save")
      await shot(page, "desktop-rest")

      // 2. The card turns and the count changes the moment the pointer arrives.
      // Instant: the page scrolls smoothly, and a measurement mid-scroll
      // would aim the pointer at an empty spot.
      await page.$eval(pill("INS"), (element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      )
      const rest = await page.$eval(pill("INS"), (element) => element.getBoundingClientRect())
      await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2, { steps: 4 })
      await turned(page, ["INS"])
      assert.deepEqual(await lit(page), ["INS"])
      assert.equal(await yours(page), "1")
      // 4. Stored here. 13. Now there is something to save.
      assert.deepEqual(await storedSymbols(page), ["INS"])
      assert.equal((await login(page))?.text, "Log in to save")
      await page.waitForTimeout(700)
      await shot(page, "desktop-card")
      await page.mouse.move(5, 5)
      assert.deepEqual(await lit(page), [], "INS stayed lit after the pointer left")
      for (const symbol of ["RHO", "PRL", "CD4"]) await page.hover(pill(symbol))
      await page.mouse.move(5, 5)
      await turned(page, ["INS", "RHO", "PRL", "CD4"])
      assert.equal(await yours(page), "4")

      // 5. What it was a sample of, the add-on on two other sites, one button.
      assert.equal(await nextNote(page), DOCS_LINE)
      await page.$eval("[data-icono-play-next]", (element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      )
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll(".icono-play-site .icono-play-window > img")].every(
            (image) => image.complete && image.naturalWidth > 0,
          ),
        null,
        { timeout: 10_000 },
      )
      assert.deepEqual(
        (await siteImages(page)).map((image) => image.alt),
        SITE_ALTS,
      )
      const found = await buttons(page)
      assert.deepEqual(
        found.map((button) => [button.text, button.glyph]),
        [["Install for Chrome", true]],
      )
      await (
        await page.$("[data-icono-home-play]")
      ).screenshot({
        path: path.join(OUT, "home-play-strip-desktop-found.png"),
      })

      // 6. It opens the steps here and downloads nothing; the steps have no login.
      await page.click("[data-icono-play-open]")
      const steps = await page.waitForSelector("[data-icono-home-install-card]", {
        timeout: 5_000,
      })
      await page.waitForTimeout(1_500)
      assert.deepEqual(downloads, [], "a download started")
      assert.equal(new URL(page.url()).pathname, "/")
      assert.deepEqual(await buttons(page), [], "the button stayed after opening the steps")
      assert.doesNotMatch(await steps.textContent(), /Log in/, "the steps ask for a login")
      await shot(page, "desktop-steps")

      // 9. Nothing reached the Worker while the strip was up.
      assert.deepEqual(api, [], `the strip asked the Worker: ${api.join(", ")}`)

      // 8. A click on a symbol whose card is lit opens its page, in the app.
      await page.hover(pill("PRL"))
      await page.click(pill("PRL"))
      await page.waitForURL(/\/gene\/PRL$/, { timeout: 20_000 })

      // 4. 12. Back on the Archive with all four starters found: no strip, the
      // four as the reader's gallery, newest first, with the login.
      const again = await context.newPage()
      await again.goto(`${HOST}/`)
      await again.waitForSelector("#icono-grid a.icono-image-only-link", { timeout: 45_000 })
      assert.equal(await again.$("[data-icono-home-play]"), null, "the strip after all four")
      assert.deepEqual(await gallery(again), ["CD4", "PRL", "RHO", "INS"])
      assert.equal(await yours(again), "4")
      assert.equal((await login(again))?.text, "Log in to save")
      await shot(again, "desktop-all-starters")

      // Global discoveries shows the shared Archive with its Sort and no
      // login; it is the one read of the Worker.
      await again.click('[data-icono-collection-tab="shared"]')
      await again.waitForFunction(
        () =>
          document
            .querySelector('[data-icono-collection-tab="shared"]')
            .getAttribute("aria-selected") === "true",
        null,
        { timeout: 5_000 },
      )
      const shared = await header(again)
      assert.deepEqual(shared.tabs, ["Your discoveries 4", "Global discoveries*"])
      assert.ok(shared.sort, "Global discoveries has no Sort")
      assert.equal(shared.sort.height, shared.search.height, "Sort and search differ in height")
      assert.equal(shared.sort.top, shared.search.top, "Sort and search are not one row")
      assert.equal(await login(again), null, "a login in Sort's place on the global tab")

      assert.deepEqual(
        api.filter((path) => path !== SHARED_FEED),
        [],
        `the strip asked the Worker: ${api.join(", ")}`,
      )
      report.desktop = { header: top, shared, buttons: found, bar, api }
      await context.close()
    })

    await t.test("desktop Firefox: the add-on store", async () => {
      const { context, page } = await openArchive(browser, origin, {
        ...DESKTOP,
        userAgent: UA.firefox,
      })
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      const found = await buttons(page)
      assert.equal(found.length, 1)
      assert.equal(found[0].text, "Get extension for Firefox")
      assert.ok(found[0].glyph, "no Firefox mark on the button")
      assert.match(found[0].href, /^https:\/\/addons\.mozilla\.org\//)
      assert.equal(found[0].target, "_blank")
      assert.equal((await siteImages(page)).length, 2)
      report.firefox = found
      await context.close()
    })

    await t.test("a card turns over with its portrait already painted", async () => {
      const { context, page, heldPortraits, releasePortraits } = await openArchive(
        browser,
        origin,
        { ...PHONE, userAgent: UA.android },
        { holdPortraits: true },
      )
      // Each card as it starts to turn: is its portrait painted, and is a face
      // still down out of reach?
      await page.evaluate(() => {
        window.__turns = []
        new MutationObserver((records) => {
          for (const { target } of records) {
            if (!target.classList.contains("is-found") || target.__turned) continue
            target.__turned = true
            const photo = target.querySelector(".icono-play-slot-front img")
            window.__turns.push({
              symbol: target.dataset.iconoPlaySlot,
              painted:
                photo.complete &&
                photo.naturalWidth > 0 &&
                photo.classList.contains("icono-image-only-photo--loaded"),
            })
          }
        }).observe(document.querySelector(".icono-play-slots"), {
          subtree: true,
          attributes: true,
          attributeFilter: ["class"],
        })
      })
      const down = await page.$$eval(
        ".icono-play-slot:not(.is-found) .icono-play-slot-front",
        (faces) => faces.map((face) => face.inert && face.getAttribute("aria-hidden") === "true"),
      )
      assert.deepEqual(down, [true, true, true, true], "a face still down can be reached")
      await page.tap(pill("INS"))
      // The find counts at once; the portrait is still on its way.
      assert.equal(await yours(page), "1")
      assert.deepEqual(await lit(page), ["INS"])
      assert.deepEqual(await faceUp(page), [], "the card turned before its portrait came")
      assert.ok(
        heldPortraits.some((pathname) => pathname.includes("/portraits/")),
        "no portrait request was held, so this proves nothing",
      )
      releasePortraits()
      await turned(page, ["INS"])
      assert.deepEqual(await page.evaluate(() => window.__turns), [
        { symbol: "INS", painted: true },
      ])
      assert.equal(
        await page.$eval(
          '[data-icono-play-slot="INS"] .icono-play-slot-front',
          (face) => face.inert,
        ),
        false,
        "the face-up card can't be reached",
      )
      await context.close()
    })

    await t.test("Android phone: tap turns, second tap opens, Firefox steps", async () => {
      const { context, page, api, downloads } = await openArchive(browser, origin, {
        ...PHONE,
        userAgent: UA.android,
      })
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      assert.equal(await title(page), "Tap any gene symbol")
      await page.tap(pill("CD4"))
      // 8. The first tap stays on the Archive and turns the card.
      assert.equal(new URL(page.url()).pathname, "/")
      await turned(page, ["CD4"])
      assert.equal(await yours(page), "1")
      await page.waitForTimeout(700)
      await shot(page, "phone-card")

      assert.deepEqual(api, [], `the strip asked the Worker: ${api.join(", ")}`)

      // 3. Back on the shared Archive, the phone's Sort button leaves the
      // search box most of the row.
      await page.tap('[data-icono-collection-tab="shared"]')
      await page.waitForSelector("[data-icono-home-play]", { state: "detached", timeout: 5_000 })
      const shared = await header(page)
      assert.equal(shared.sortText, "Sort")
      assert.ok(
        shared.search.width > 2 * shared.sort.width,
        `the search box is ${shared.search.width} px beside a ${shared.sort.width} px Sort`,
      )
      await page.tap('[data-icono-collection-tab="personal"]')
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })

      const found = await buttons(page)
      assert.deepEqual(
        found.map((button) => button.text),
        ["Install on mobile"],
      )
      assert.equal(await nextNote(page), DOCS_LINE)
      // 15. The two sites are a swipe row, not two shrunken windows.
      const row = await siteRow(page)
      assert.ok(row.ready && !row.still, `the sites are not a swipe row: ${JSON.stringify(row)}`)
      const [first, second] = row.windows
      assert.ok(first.width >= 250, `a ${first.width} px window on a ${row.screen} px phone`)
      assert.equal(second.top, first.top, "the windows stack instead of sitting in a row")
      assert.ok(
        second.left < row.screen && second.left + second.width > row.screen,
        `the second window doesn't peek in from the edge: ${JSON.stringify(row)}`,
      )
      await page.$eval("[data-icono-play-next]", (element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      )
      await shot(page, "phone-sites")
      await page.tap("[data-icono-play-open]")
      const steps = await page.waitForSelector("[data-icono-home-install-card]", {
        timeout: 5_000,
      })
      const text = await steps.textContent()
      assert.match(text, /Firefox for Android/)
      assert.ok(
        await steps.$('a[href^="https://addons.mozilla.org/"]'),
        "the steps have no Firefox Add-ons link",
      )
      assert.deepEqual(downloads, [], "a download started")
      assert.doesNotMatch(text, /Log in/, "the steps ask for a login")
      await shot(page, "phone-steps")

      await page.tap(pill("RHO"))
      assert.equal(new URL(page.url()).pathname, "/")
      await page.tap(pill("RHO"))
      await page.waitForURL(/\/gene\/RHO$/, { timeout: 20_000 })
      assert.deepEqual(
        api.filter((path) => path !== SHARED_FEED),
        [],
        `the strip asked the Worker: ${api.join(", ")}`,
      )
      report.android = { header: shared, buttons: found }
      await context.close()
    })

    await t.test("iPhone: what it is, and no button", async () => {
      const { context, page } = await openArchive(browser, origin, {
        ...PHONE,
        userAgent: UA.iphone,
      })
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      await page.tap(pill("PRL"))
      assert.equal(await nextNote(page), DOCS_LINE)
      assert.deepEqual(await buttons(page), [])
      assert.equal((await siteImages(page)).length, 2)
      await page.waitForTimeout(700)
      await shot(page, "iphone-found")
      report.iphone = await nextNote(page)
      await context.close()
    })

    await t.test("desktop Safari: where it installs, and no button", async () => {
      const { context, page } = await openArchive(browser, origin, {
        ...DESKTOP,
        userAgent: UA.safari,
      })
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      assert.equal(
        await nextNote(page),
        DOCS_LINE + " For one-click install, visit this page on Edge or Firefox browsers.",
      )
      assert.deepEqual(await buttons(page), [])
      report.safari = await nextNote(page)
      await context.close()
    })

    await t.test("a signed-out reader with the add-on: the strip, then a page to try", async () => {
      const { context, page } = await openArchive(
        browser,
        origin,
        { ...DESKTOP, userAgent: UA.chrome, colorScheme: "dark" },
        { addOn: [] },
      )
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      await page.hover(pill("RHO"))
      assert.equal(await yours(page), "1")
      assert.equal(
        await page.textContent("[data-icono-play-next] .icono-play-installed"),
        "Iconoplasm is already installed in this browser.",
        "the page didn't say first that it knows the reader has the add-on",
      )
      assert.equal(await nextNote(page), "Open any page that names human genes, like these two:")
      const found = await siteLinks(page)
      assert.deepEqual(found, [
        ["Wikipedia's Homeobox article", "https://en.wikipedia.org/wiki/Homeobox", "_blank"],
        [
          "RHO in the UCSC Genome Browser",
          "https://genome.ucsc.edu/cgi-bin/hgTracks?db=hg38&position=RHO",
          "_blank",
        ],
      ])
      assert.equal(
        await page.$$eval(
          "[data-icono-play-next] button, [data-icono-play-next] a.icono-button",
          (n) => n.length,
        ),
        0,
        "a reader with the add-on got an install or login button",
      )
      assert.deepEqual(await siteAddresses(page), ["en.wikipedia.org", "genome.ucsc.edu"])
      await page.$eval("[data-icono-play-next]", (element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      )
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll(".icono-play-site .icono-play-window > img")].every(
            (image) => image.complete && image.naturalWidth > 0,
          ),
        null,
        { timeout: 10_000 },
      )
      assert.deepEqual(
        (await siteImages(page)).map((image) => image.alt),
        SITE_ALTS,
        "the add-on's reader lost the two other sites",
      )
      await page.mouse.move(5, 5)
      await page.waitForTimeout(700)
      await (
        await page.$("[data-icono-home-play]")
      ).screenshot({
        path: path.join(OUT, "home-play-strip-addon-dark-found.png"),
      })
      report.addOn = found
      await context.close()
    })

    await t.test("a guest whose add-on found genes sees them under the strip", async () => {
      const { context, page, api } = await openArchive(
        browser,
        origin,
        { ...DESKTOP, userAgent: UA.chrome },
        { addOn: ["TP53", "RHO"] },
      )
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      await page.waitForSelector("#icono-grid a.icono-image-only-link", { timeout: 20_000 })
      // 11. Their finds are their gallery, newest first, under the strip.
      // 12. A starter is still missing, so the strip stays, its found one up.
      assert.deepEqual(await gallery(page), ["RHO", "TP53"])
      assert.equal(await page.$$eval(".icono-play-slot", (slots) => slots.length), 4)
      assert.deepEqual(await faceUp(page), ["RHO"])
      assert.equal(await yours(page), "2")
      const order = await page.evaluate(() => ({
        strip: document.querySelector("[data-icono-home-play]").getBoundingClientRect().top,
        grid: document.getElementById("icono-grid").getBoundingClientRect().top,
      }))
      assert.ok(order.strip < order.grid, "the strip is not over the reader's gallery")
      // 13. The login is in Sort's place, the strip has none of its own.
      const saved = await login(page)
      assert.equal(saved?.text, "Log in to save")
      assert.match(saved.href, /\/api\/auth\/login\?return_to=/)
      assert.equal((await header(page)).sort, null, "a Sort over the reader's own finds")
      assert.equal(
        await page.textContent("[data-icono-play-next] .icono-play-installed"),
        "Iconoplasm is already installed in this browser.",
      )
      assert.equal(
        await page.$$eval(
          "[data-icono-play-next] button, [data-icono-play-next] a.icono-button",
          (n) => n.length,
        ),
        0,
        "the strip has a button besides the login",
      )
      assert.equal(await page.$("[data-icono-home-install-card]"), null, "an install card too")
      // 9. The gallery reads the published catalogue, never the Worker.
      assert.deepEqual(api, [], `the gallery asked the Worker: ${api.join(", ")}`)
      await shot(page, "addon-guest")

      // 14. The reader finds KRAS in another tab and comes back.
      await page.evaluate(() => {
        window.__iconoAddOnFinds = ["TP53", "RHO", "KRAS"]
        document.dispatchEvent(new Event("visibilitychange"))
      })
      await page.waitForFunction(
        () => document.querySelector(".icono-collection-tab-count")?.textContent === "3",
        null,
        { timeout: 10_000 },
      )
      await page.waitForSelector('#icono-grid a.icono-image-only-link[href="/gene/KRAS"]', {
        timeout: 20_000,
      })
      assert.deepEqual(await gallery(page), ["KRAS", "RHO", "TP53"])
      await context.close()
    })

    await t.test("a guest with all four starters and more: no strip, their gallery", async () => {
      const { context, page } = await openArchive(
        browser,
        origin,
        { ...DESKTOP, userAgent: UA.chrome },
        { addOn: ["INS", "RHO", "PRL", "CD4", "EGFR"] },
      )
      await page.waitForSelector("#icono-grid a.icono-image-only-link", { timeout: 20_000 })
      // 12. Every starter is found, add-on or not: the strip goes.
      assert.equal(await page.$("[data-icono-home-play]"), null, "the strip after all four")
      assert.deepEqual(await gallery(page), ["EGFR", "CD4", "PRL", "RHO", "INS"])
      assert.equal(await yours(page), "5")
      assert.equal((await login(page))?.text, "Log in to save")
      // The add-on's next step follows the gallery, with a page of 453 genes.
      const next = await page.$("#icono-home-auxiliary [data-icono-home-install-card]")
      assert.ok(next, "no next step after the gallery")
      assert.equal(
        await next.$eval("a.icono-install-link", (link) => link.href),
        "https://en.wikipedia.org/wiki/List_of_human_clusters_of_differentiation",
      )
      await context.close()
    })

    await t.test(
      "a returning guest finds their starter face up and the rest in their gallery",
      async () => {
        const now = new Date().toISOString()
        const entry = (gene_symbol) => ({
          gene_symbol,
          first_discovered_at: now,
          last_encountered_at: now,
        })
        const { context, page } = await openArchive(
          browser,
          origin,
          { ...DESKTOP, userAgent: UA.chrome },
          { seed: [entry("RHO"), entry("TP53")] },
        )
        await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
        await page.waitForSelector("#icono-grid a.icono-image-only-link", { timeout: 20_000 })
        // 10. 11. A starter found before is face up in its place; a gene page
        // opened here is in the gallery under the strip.
        assert.equal(await page.$$eval(".icono-play-slot", (slots) => slots.length), 4)
        assert.deepEqual(await faceUp(page), ["RHO"])
        assert.deepEqual(await gallery(page), ["TP53", "RHO"])
        assert.equal(await yours(page), "2")
        assert.deepEqual(
          (await buttons(page)).map((button) => [button.text, button.glyph]),
          [["Install for Chrome", true]],
        )
        await page.hover(pill("INS"))
        assert.equal(await yours(page), "3")
        // 16. The card found on the strip joins the gallery under it at once.
        await page.waitForSelector('#icono-grid a.icono-image-only-link[href="/gene/INS"]', {
          timeout: 10_000,
        })
        assert.deepEqual(await gallery(page), ["INS", "TP53", "RHO"])
        await turned(page, ["INS", "RHO"])
        await page.mouse.move(5, 5)
        await page.waitForTimeout(700)
        await (
          await page.$("#icono-home-lead")
        ).screenshot({
          path: path.join(OUT, "home-play-strip-returning-guest.png"),
        })
        await context.close()
      },
    )
  } finally {
    writeFileSync(path.join(OUT, "home-play-strip.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})
