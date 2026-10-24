// B-1173: a signed-out first-time visitor finds genes on the Archive before
// installing anything. Checked in Chrome, desktop and phone, against the live
// published catalogue.
//
// Ways this can fail, written before the code:
// 1. the visitor still gets the install card, or gets both, or a returning
//    guest with finds gets the strip again instead of their guest card;
//    a signed-out reader with the add-on and no finds gets no strip (it hid
//    the strip from the owner's private window on 2026-10-24), or one whose
//    add-on already found genes gets the strip instead of their guest card;
// 2. hovering (desktop) or tapping (phone) a symbol raises no card, or the
//    counter waits for anything: it must read "You discovered 1 gene so far"
//    the moment the card rises;
// 3. the raised card covers the counter, leaves the screen, or drifts away
//    from its word when late cards above push the strip down; or the find
//    itself moves the strip: the Archive header's new progress line (46 px,
//    above the strip) slid the symbol out from under the owner's pointer in
//    Edge on 2026-10-24 and the card dropped;
// 4. the find is not stored in this browser, or the Archive header doesn't
//    count it;
// 5. more than one button follows the find, the strip never says that it is
//    a sample of a browser extension, or the add-on on other sites (the two
//    screenshots) is missing after a find, for a reader with the add-on too,
//    or loads before a find;
// 6. a Chrome reader's button downloads a file or leaves the page, instead of
//    opening the install steps under the strip, or those steps carry a second,
//    login button;
// 7. Firefox gets anything but its add-on store, an Android phone anything
//    but the Firefox steps; Safari or an iPhone, which have no install path,
//    get a button at all; a reader who has the add-on gets anything but a
//    page to try it on;
// 8. the first tap on a phone opens the gene page (it must raise the card);
//    the second tap, or a desktop click, doesn't open it, or the raised card
//    stays on the gene page;
// 9. the strip asks the Worker anything (it must cost nothing per reader);
// 10. a returning guest gets more than their guest card with one install
//    button, or a login before the add-on; a guest whose add-on found genes
//    gets the login without its reason (syncing across devices).
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
// page at document start and answers the Archive's request for the genes it
// found while the reader was signed out.
function addOnBridge(symbols) {
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
        detail: JSON.stringify(symbols),
      }),
    )
  })
}

async function openArchive(browser, origin, options, { seed = null, addOn = null } = {}) {
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
  await page.waitForSelector("#icono-home-auxiliary:not([hidden]) > *", { timeout: 45_000 })
  return { context, page, api, downloads, sites }
}

const pill = (symbol) => `[data-icono-play-symbol="${symbol}"]`
const title = (page) => page.textContent("[data-icono-play-title]")
// The visible buttons in a card's next-step row: their words (without the
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
const nextNote = (page, scope = "[data-icono-play-next]") =>
  page.textContent(`${scope} .icono-install-note`)
// The two other sites, drawn and loaded.
const siteImages = (page) =>
  page.$$eval("[data-icono-play-next] .icono-play-site img", (images) =>
    images
      .filter((image) => image.checkVisibility())
      .map((image) => ({ alt: image.alt, loaded: image.complete && image.naturalWidth > 0 })),
  )
// The drawn window: the essay's address and the add-on's toolbar icon.
const windowBar = (page) =>
  page.$eval(".icono-play-bar", (bar) => ({
    address: bar.querySelector(".icono-play-address").textContent,
    icon: bar.querySelector("img.icono-play-addon").complete,
  }))

// The raised card, the counter, the strip, the word and the viewport, in
// viewport pixels.
function geometry(symbol) {
  const box = (el) => {
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
  }
  const raised = document.querySelector(".icono-play-raised.is-up")
  return {
    raised: raised ? box(raised) : null,
    title: box(document.querySelector("[data-icono-play-title]")),
    strip: box(document.querySelector(".icono-play-card")),
    word: box(document.querySelector(`[data-icono-play-symbol="${symbol}"]`)),
    width: document.documentElement.clientWidth,
  }
}

function assertPlaced(where, g) {
  assert.ok(g.raised, `${where}: no card rose`)
  assert.ok(
    g.raised.left >= 0 && g.raised.right <= g.width,
    `${where}: the card leaves the screen ${JSON.stringify(g)}`,
  )
  const overlaps =
    g.raised.left < g.title.right &&
    g.raised.right > g.title.left &&
    g.raised.top < g.title.bottom &&
    g.raised.bottom > g.title.top
  assert.ok(!overlaps, `${where}: the card covers the counter ${JSON.stringify(g)}`)
  // Above the strip, beside it, or just above or below the word.
  const near = (a, b) => Math.abs(a - b) <= 4
  const attached =
    near(g.raised.bottom, g.strip.top - 12) ||
    near(g.raised.left, g.strip.right + 18) ||
    near(g.raised.right, g.strip.left - 18) ||
    near(g.raised.bottom, g.word.top - 10) ||
    near(g.raised.top, g.word.bottom + 10)
  assert.ok(attached, `${where}: the card drifted from its word ${JSON.stringify(g)}`)
}

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
      const { context, page, api, downloads, sites } = await openArchive(browser, origin, {
        ...DESKTOP,
        userAgent: UA.chrome,
      })
      // 1. The strip, not the install card, in a browser window with the add-on.
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      assert.equal(await page.$("[data-icono-home-install-card]"), null, "install card shown too")
      assert.equal(await title(page), "Hover any gene symbol")
      const bar = await windowBar(page)
      assert.equal(bar.address, "brinedew.bio/posts/Mnemonic-portraits-for-19023-human-genes")
      await page.waitForTimeout(1_000)
      assert.deepEqual(sites, [], "the other sites loaded before a find")
      await shot(page, "desktop-rest")

      // 2. The count changes the moment the card rises. A plain mouse move,
      // as a person's pointer: Playwright's hover() scrolls its target back
      // into view when it moves, which would hide failure 3.
      // Instant: the page scrolls smoothly, and a measurement mid-scroll
      // would aim the pointer at an empty spot.
      await page.$eval(pill("MYC"), (element) =>
        element.scrollIntoView({ block: "center", behavior: "instant" }),
      )
      const rest = await page.$eval(pill("MYC"), (element) => element.getBoundingClientRect())
      await page.mouse.move(rest.x + rest.width / 2, rest.y + rest.height / 2, { steps: 4 })
      assert.equal(await title(page), "You discovered 1 gene so far")
      await page.waitForSelector(".icono-play-raised.is-up", { timeout: 1_000 })
      await page.waitForTimeout(300)
      const g = await page.evaluate(geometry, "MYC")
      assertPlaced("desktop", g)
      await shot(page, "desktop-card")

      // 4. Stored here and counted in the Archive header.
      assert.deepEqual(await storedSymbols(page), ["MYC"])
      await page.waitForFunction(
        () => /^1 gene found/.test(document.querySelector(".icono-collection-copy")?.textContent),
        null,
        { timeout: 5_000 },
      )
      // 3. The header grew above the strip; the symbol stayed under the pointer.
      const counted = await page.$eval(
        pill("MYC"),
        (element) => element.getBoundingClientRect().top,
      )
      assert.ok(
        Math.abs(counted - rest.y) <= 1,
        `the find moved MYC from ${rest.y} to ${counted} px on screen`,
      )
      assert.ok(await page.$(".icono-play-raised.is-up"), "MYC's card dropped after the find")

      // The card goes when the pointer leaves.
      await page.mouse.move(5, 5)
      await page.waitForSelector(".icono-play-raised", { state: "detached", timeout: 2_000 })
      await page.hover(pill("TP53"))
      assert.equal(await title(page), "You discovered 2 genes so far")
      await page.mouse.move(5, 5)

      // 5. What it was a sample of, the add-on on two other sites, one button.
      assert.equal(await nextNote(page), DOCS_LINE)
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll(".icono-play-site img")].every(
            (image) => image.complete && image.naturalWidth > 0,
          ),
        null,
        { timeout: 10_000 },
      )
      assert.deepEqual(
        (await siteImages(page)).map((image) => image.alt),
        [
          "Wikipedia's Homeobox article with Iconoplasm installed",
          "The UCSC Genome Browser with Iconoplasm installed",
        ],
      )
      const found = await buttons(page)
      assert.deepEqual(
        found.map((button) => [button.text, button.glyph]),
        [["Install for Chrome", true]],
      )
      await (
        await page.$(".icono-play-card")
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

      // 8. A click on a symbol whose card is up opens its page, in the app.
      await page.hover(pill("BAX"))
      await page.click(pill("BAX"))
      await page.waitForURL(/\/gene\/BAX$/, { timeout: 20_000 })
      await page.waitForTimeout(500)
      assert.equal(await page.$(".icono-play-raised"), null, "the card stayed on the gene page")

      // 9. Nothing reached the Worker.
      assert.deepEqual(api, [], `the strip asked the Worker: ${api.join(", ")}`)
      report.desktop = { geometry: g, buttons: found, bar, sites, api }
      await context.close()
    })

    await t.test("desktop Firefox: the add-on store", async () => {
      const { context, page } = await openArchive(browser, origin, {
        ...DESKTOP,
        userAgent: UA.firefox,
      })
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      await page.hover(pill("HRAS"))
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

    await t.test("Android phone: tap raises, second tap opens, Firefox steps", async () => {
      const { context, page, api, downloads } = await openArchive(browser, origin, {
        ...PHONE,
        userAgent: UA.android,
      })
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      assert.equal(await title(page), "Tap any gene symbol")
      await page.tap(pill("TP53"))
      // 8. The first tap stays on the Archive and raises the card.
      assert.equal(new URL(page.url()).pathname, "/")
      assert.equal(await title(page), "You discovered 1 gene so far")
      await page.waitForSelector(".icono-play-raised.is-up", { timeout: 1_000 })
      await page.waitForTimeout(300)
      assertPlaced("phone", await page.evaluate(geometry, "TP53"))
      // A late card above the strip grows by 300 px: the card goes with its word.
      await page.evaluate(() => {
        const late = document.createElement("div")
        late.style.height = "300px"
        document.getElementById("icono-home-auxiliary").before(late)
      })
      await page.waitForTimeout(300)
      const g = await page.evaluate(geometry, "TP53")
      assertPlaced("phone, after a late card", g)
      await page.evaluate(() =>
        document.getElementById("icono-home-auxiliary").previousSibling.remove(),
      )
      await shot(page, "phone-card")

      const found = await buttons(page)
      assert.deepEqual(
        found.map((button) => button.text),
        ["Install on mobile"],
      )
      assert.equal(await nextNote(page), DOCS_LINE)
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

      await page.tap(pill("TP53"))
      await page.tap(pill("TP53"))
      await page.waitForURL(/\/gene\/TP53$/, { timeout: 20_000 })
      assert.deepEqual(api, [], `the strip asked the Worker: ${api.join(", ")}`)
      report.android = { geometry: g, buttons: found }
      await context.close()
    })

    await t.test("iPhone: what it is, and no button", async () => {
      const { context, page } = await openArchive(browser, origin, {
        ...PHONE,
        userAgent: UA.iphone,
      })
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      await page.tap(pill("BBC3"))
      assert.equal(await nextNote(page), DOCS_LINE)
      assert.deepEqual(await buttons(page), [])
      assert.equal((await siteImages(page)).length, 2)
      await page.mouse.click(5, 5)
      await page.waitForTimeout(400)
      await (
        await page.$(".icono-play-card")
      ).screenshot({
        path: path.join(OUT, "home-play-strip-iphone-found.png"),
      })
      report.iphone = await nextNote(page)
      await context.close()
    })

    await t.test("desktop Safari: where it installs, and no button", async () => {
      const { context, page } = await openArchive(browser, origin, {
        ...DESKTOP,
        userAgent: UA.safari,
      })
      await page.waitForSelector("[data-icono-home-play]", { timeout: 20_000 })
      await page.hover(pill("TP53"))
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
      await page.hover(pill("MDM2"))
      assert.equal(await title(page), "You discovered 1 gene so far")
      assert.equal(await nextNote(page), "Open any page that names human genes.")
      const found = await buttons(page)
      assert.deepEqual(
        found.map((button) => [button.text, button.href, button.target]),
        [["Wikipedia's Homeobox article", "https://en.wikipedia.org/wiki/Homeobox", "_blank"]],
      )
      assert.deepEqual(
        (await siteImages(page)).map((image) => image.alt),
        [
          "Wikipedia's Homeobox article with Iconoplasm installed",
          "The UCSC Genome Browser with Iconoplasm installed",
        ],
        "the add-on's reader lost the two other sites",
      )
      await page.mouse.move(5, 5)
      await page.waitForTimeout(400)
      await (
        await page.$(".icono-play-card")
      ).screenshot({
        path: path.join(OUT, "home-play-strip-addon-dark-found.png"),
      })
      report.addOn = found
      await context.close()
    })

    await t.test("a reader whose add-on found genes gets the guest card", async () => {
      const { context, page } = await openArchive(
        browser,
        origin,
        { ...DESKTOP, userAgent: UA.chrome },
        { addOn: ["TP53", "BRCA1"] },
      )
      const card = await page.waitForSelector("[data-icono-guest-discovery-card]", {
        timeout: 20_000,
      })
      assert.equal(await page.$("[data-icono-home-play]"), null, "the strip hid the add-on's finds")
      assert.match(await card.textContent(), /Connect with Discord to sync across devices\./)
      assert.deepEqual(
        (await buttons(page, "[data-icono-guest-discovery-card]")).map((button) => button.text),
        ["Log in with Discord"],
      )
      assert.equal(await page.$("[data-icono-home-install-card]"), null, "an install card too")
      await (
        await page.$("#icono-home-auxiliary")
      ).screenshot({
        path: path.join(OUT, "home-play-strip-addon-guest.png"),
      })
      await context.close()
    })

    await t.test("a returning guest gets their guest card, not the strip", async () => {
      const now = new Date().toISOString()
      const { context, page } = await openArchive(
        browser,
        origin,
        { ...DESKTOP, userAgent: UA.chrome },
        {
          seed: [{ gene_symbol: "TP53", first_discovered_at: now, last_encountered_at: now }],
        },
      )
      await page.waitForSelector("[data-icono-guest-discovery-card]", { timeout: 20_000 })
      assert.equal(await page.$("[data-icono-home-play]"), null, "the strip came back")
      // 10. One card, one install button, no login; the steps open under it.
      const scope = "[data-icono-guest-discovery-card]"
      assert.equal(await nextNote(page, scope), DOCS_LINE)
      assert.deepEqual(
        (await buttons(page, scope)).map((button) => [button.text, button.glyph]),
        [["Install for Chrome", true]],
      )
      assert.equal(await page.$("[data-icono-home-install-card]"), null, "the steps came uninvited")
      await (
        await page.$("#icono-home-auxiliary")
      ).screenshot({
        path: path.join(OUT, "home-play-strip-returning-guest.png"),
      })
      await page.click(`${scope} [data-icono-play-open]`)
      await page.waitForSelector("[data-icono-home-install-card]", { timeout: 5_000 })
      assert.deepEqual(await buttons(page, scope), [], "the button stayed after opening the steps")
      await context.close()
    })
  } finally {
    writeFileSync(path.join(OUT, "home-play-strip.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})
