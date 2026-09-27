// B-883: the New candidate > Free queue style picker, checked in a real browser.
// Owner decision (27 Sep 2026): mockup C on desktop (3:4 style cards plus a
// "Your batch" tray) and A-mobile on phones, built from the design system.
//
// Ways this picker can fail, written before the code, each asserted below at
// 1280 and 400 px in light and dark:
// 1. a card or a preview is not 3:4, or a preview uses the square `thumb` crop;
// 2. anything artist-shaped reaches the page: the search offers artists, a
//    card shows an artist label, or typing an artist name finds a style;
// 3. "Select all N favorites" is not a shared `.icono-button`, or it sits in
//    the fixed chrome (it lives with the view switch, which scrolls; a phone
//    footer cannot hold it and "Queue 20 candidates" on one line);
// 4. the view switch offers anything beyond Favorites and All styles;
// 5. the dialog explains open requests in prose instead of marking the card
//    ("2 queued") of a style that is already queued for this gene;
// 6. on a phone, more than the title and the method switch stay fixed above
//    the grid (search and views must scroll away with it);
// 7. the primary action is not at the bottom-right of the dialog;
// 8. the primary label does not follow the batch (random, one number, N);
// 9. the desktop tray is missing, miscounts, or cannot remove a style, or the
//    tray shows on a phone;
// 10. Select all favorites breaks the 20-style limit;
// 11. the queue request payload changes shape (random vs specific batch);
// 12. the card star no longer toggles a favorite;
// 13. the dialog scrolls sideways at phone width;
// 14. the analytics consent box (EU/UK, bottom-right, top z-index) covers the
//     bottom-right Queue button while the dialog is open.
//
// Needs `pnpm run build` (public-iconoplasm-edge) and an installed Chrome.
// Screenshots and the measurements land in artifacts/e2e/.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, VIEWPORTS, launchChrome, routeProduction, startSite } from "./harness.mjs"

const SLOTS = [
  36978, 51084, 31261, 1184, 21006, 22811, 20128, 20910, 55908, 2561, 21404, 30593, 255, 21329,
  21103, 343, 28999, 28478, 29469, 34047, 45472, 11111, 22222, 33333,
]
const FAVORITES = SLOTS.slice(0, 22).map((slot) => `0-${slot}`)
const ARTIST_SLOT = 28478
const SINGLE_PREVIEW_SLOT = 11111
const EMPTY_SLOT = 33333
const QUEUED_SLOT = 51084

function previewAssets(slot) {
  if (slot === EMPTY_SLOT) return []
  const count = slot === SINGLE_PREVIEW_SLOT ? 1 : 5
  return Array.from({ length: count }, (_, i) => {
    const sha = `${String(slot).padStart(6, "0")}${i}`.padEnd(64, "a")
    const base = `${HOST}/portraits/v1/${sha.slice(0, 2)}/${sha}`
    return {
      gene_symbol: ["TP53", "ATM", "ADO", "TH", "MTOR"][i],
      asset_sha256: sha,
      medium_url: `${base}/medium.webp`,
      thumb_url: `${base}/thumb.webp`,
    }
  })
}

const OPTIONS = SLOTS.map((slot, index) => ({
  vision_id: `anima-v1-${slot}`,
  label: String(slot),
  primary_label: String(slot),
  secondary_label: slot === ARTIST_SLOT ? "@secretartist · Secret Artist" : "",
  search_text: `0-${slot} anima-v1-${slot}`,
  emulsion_id: `0-${slot}`,
  emulsion_family_id: `0-${slot}`,
  artist_tag: slot === ARTIST_SLOT ? "@secretartist" : "",
  artist_name: slot === ARTIST_SLOT ? "Secret Artist" : "",
  image_count: 30 - index,
  live_count: 0,
  score: 0,
  vote_h_index: SLOTS.length - index,
  preview_assets: previewAssets(slot),
  is_preallocated_without_preview: slot === EMPTY_SLOT,
  is_favorite: FAVORITES.includes(`0-${slot}`),
}))

function createApi(posts) {
  return (pathname, request) => {
    if (/^\/api\/iconoplasm\/requests\/gene\/[^/]+\/summary$/.test(pathname)) {
      const specific = {
        request_mode: "specific",
        requested_vision_id: `anima-v1-${QUEUED_SLOT}`,
        requested_emulsion_id: `C9-${QUEUED_SLOT}`,
        requested_emulsion_label: `C9-${QUEUED_SLOT}`,
        request_count: 2,
        my_request_count: 1,
      }
      const random = { request_mode: "random", request_count: 1, my_request_count: 1 }
      return {
        authenticated: true,
        my_lane_summary: [specific, random],
        gene_lane_summary: [specific, random],
      }
    }
    if (pathname === "/api/iconoplasm/requests/options") return { request_options: OPTIONS }
    if (pathname === "/api/iconoplasm/emulsion-favorites") {
      return { favorite_emulsion_ids: FAVORITES }
    }
    if (pathname.startsWith("/api/iconoplasm/emulsion-favorites/")) {
      return { ok: true, favorite_emulsion_ids: FAVORITES }
    }
    if (pathname === "/api/iconoplasm/requests" && request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}")
      posts.push(body)
      const count = Array.isArray(body.requested_vision_ids) ? body.requested_vision_ids.length : 1
      return { ok: true, queued_count: count, failures: [] }
    }
    return undefined
  }
}

// Every portrait is served as a 384x512 (3:4) picture, a distinct hue per URL.
async function routePortraits(context) {
  await context.route(/\/portraits\/.+\.webp(\?.*)?$/, (route) => {
    const url = route.request().url()
    let hash = 0
    for (const ch of url) hash = (hash * 31 + ch.charCodeAt(0)) % 360
    const square = url.includes("/thumb.webp")
    const [w, h] = square ? [256, 256] : [384, 512]
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="hsl(${hash} 45% 42%)"/><circle cx="${w / 2}" cy="${h * 0.38}" r="${w / 5}" fill="hsl(${(hash + 40) % 360} 60% 72%)"/></svg>`
    return route.fulfill({ status: 200, contentType: "image/svg+xml", body: svg })
  })
}

const DIALOG = "[data-icono-request-dialog]"

// Runs in the page: everything the assertions need, measured once.
function measurePicker() {
  const dialog = document.querySelector("[data-icono-request-dialog]")
  const panel = dialog.shadowRoot.querySelector('[part~="panel"]')
  const header = dialog.shadowRoot.querySelector('[part~="header"]')
  const box = (el) => {
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height }
  }
  const visible = (el) => !!el && el.checkVisibility() && el.getBoundingClientRect().width > 0
  const browse = dialog.querySelector("[data-icono-request-browse]")
  const tabs = dialog.querySelector(".icono-request-tabs")
  const search = dialog.querySelector("[data-icono-request-query]")
  const views = [...dialog.querySelectorAll("[data-icono-request-view]")]
  const cards = [...dialog.querySelectorAll("[data-icono-request-card]")]
  const arts = cards
    .map((card) => card.querySelector(".icono-request-card-art"))
    .filter((art) => visible(art))
  const images = [...dialog.querySelectorAll(".icono-request-card-art img")].filter(visible)
  const selectAll = dialog.querySelector("[data-icono-request-select-all-favorites]")
  const primary = dialog.querySelector("[data-icono-request-free-submit]")
  const tray = dialog.querySelector("[data-icono-request-batch]")
  const text = dialog.innerText
  const attributes = [...dialog.querySelectorAll("*")]
    .flatMap((el) => [...el.attributes].map((a) => a.value))
    .join(" ")
  return {
    viewport: innerWidth,
    panel: box(panel),
    header: box(header),
    tabs: box(tabs),
    browse: box(browse),
    browseScrolls: browse ? browse.scrollHeight > browse.clientHeight : false,
    searchInsideBrowse: !!(browse && search && browse.contains(search)),
    viewsInsideBrowse: views.length > 0 && views.every((v) => browse && browse.contains(v)),
    selectAllInsideBrowse: !!(browse && selectAll && browse.contains(selectAll)),
    tabsInsideBrowse: !!(browse && tabs && browse.contains(tabs)),
    searchPlaceholder: search ? search.getAttribute("placeholder") : null,
    searchLabel: search ? search.getAttribute("aria-label") : null,
    views: views.map((v) => ({
      key: v.getAttribute("data-icono-request-view"),
      text: v.textContent.trim().replace(/\s+/g, " "),
      pressed: v.getAttribute("aria-pressed"),
    })),
    visibleCards: cards.filter(visible).length,
    cardLabels: cards.filter(visible).map((c) => c.getAttribute("data-icono-request-card")),
    arts: arts.map((a) => a.getBoundingClientRect().width / a.getBoundingClientRect().height),
    images: images.map((img) => ({
      src: img.getAttribute("src") || "",
      ratio: img.getBoundingClientRect().width / img.getBoundingClientRect().height,
    })),
    queuedBadges: [...dialog.querySelectorAll("[data-icono-request-queued]")]
      .filter(visible)
      .map((b) => ({
        card: b.closest("[data-icono-request-card]")?.getAttribute("data-icono-request-card"),
        text: b.textContent.trim(),
      })),
    selectAll: selectAll
      ? {
          tag: selectAll.tagName,
          className: String(selectAll.className),
          text: selectAll.textContent.trim(),
          visible: visible(selectAll),
          ...box(selectAll),
        }
      : null,
    primary: primary
      ? { text: primary.textContent.trim(), className: String(primary.className), ...box(primary) }
      : null,
    trayVisible: visible(tray),
    trayCount: tray?.querySelector("[data-icono-request-batch-count]")?.textContent.trim() || "",
    trayRows: tray ? [...tray.querySelectorAll("[data-icono-request-batch-row]")].length : 0,
    mentionsArtist: /artist/i.test(text) || /secretartist|secret artist/i.test(attributes),
    mentionsOpenRequests: /open request/i.test(text),
    horizontalOverflow: browse ? browse.scrollWidth > browse.clientWidth + 1 : false,
    cardFont: cards[0]
      ? getComputedStyle(cards[0].querySelector(".icono-request-card-label")).fontFamily
      : "",
  }
}

async function openPicker(page) {
  await page.click("[data-icono-request-dialog-open]")
  await page.waitForSelector(`${DIALOG}[open]`)
  await page.click("[data-icono-request-tab='free']")
  await page.waitForSelector("[data-icono-request-card]", { timeout: 15_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400) // dialog open animation
}

const card = (slot) => `[data-icono-request-card='${slot}'] [data-icono-request-option]`

test("the Free queue picker is a 3:4 style grid with a batch tray and a bottom-right action", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const report = []
  try {
    for (const [width, height, size] of VIEWPORTS) {
      for (const theme of ["light", "dark"]) {
        const where = `${size}/${theme}`
        const shot = (name) => path.join(OUT, `style-picker-${size}-${theme}-${name}.png`)
        const posts = []
        const context = await browser.newContext({ viewport: { width, height } })
        await context.addInitScript((value) => localStorage.setItem("theme", value), theme)
        await context.addInitScript(() =>
          localStorage.setItem("iconoplasm.new-candidate-tab", "free"),
        )
        await routeProduction(context, origin, createApi(posts))
        await routePortraits(context)
        const page = await context.newPage()
        await page.goto(`${HOST}/gene/TP53`)
        await page.waitForSelector("[data-icono-request-dialog-open]", { timeout: 30_000 })
        await openPicker(page)
        await page.screenshot({ path: shot("open") })

        const first = await page.evaluate(measurePicker)
        report.push({ where, moment: "open", ...first })

        // 1. 3:4 cards from 3:4 previews, never the square thumb crop.
        assert.ok(first.visibleCards >= 4, `${where}: only ${first.visibleCards} cards visible`)
        for (const ratio of first.arts) {
          assert.ok(Math.abs(ratio - 0.75) < 0.02, `${where}: card art ratio ${ratio}`)
        }
        assert.ok(first.images.length > 0, `${where}: no card previews rendered`)
        for (const image of first.images) {
          assert.equal(/thumb\.webp/.test(image.src), false, `${where}: square thumb ${image.src}`)
          assert.ok(Math.abs(image.ratio - 0.75) < 0.03, `${where}: preview ratio ${image.ratio}`)
        }

        // 2. Nothing artist-shaped.
        assert.equal(first.mentionsArtist, false, `${where}: the dialog mentions an artist`)
        assert.equal(/artist/i.test(first.searchPlaceholder || ""), false, `${where}: placeholder`)
        assert.equal(/artist/i.test(first.searchLabel || ""), false, `${where}: search label`)

        // 3. Select all favorites is a shared button.
        assert.ok(first.selectAll && first.selectAll.visible, `${where}: Select all is missing`)
        assert.equal(first.selectAll.tag, "BUTTON", `${where}: Select all is not a button`)
        assert.match(first.selectAll.className, /\bicono-button\b/, `${where}: Select all style`)
        assert.equal(first.selectAll.text, "Select all 22 favorites", `${where}: Select all label`)
        assert.equal(first.selectAllInsideBrowse, true, `${where}: Select all is fixed chrome`)

        // 4. Two views only.
        assert.deepEqual(
          first.views.map((v) => v.key),
          ["favorites", "all"],
          `${where}: views`,
        )
        assert.match(first.views[0].text, /^Favorites/, `${where}: Favorites label`)
        assert.match(first.views[1].text, /^All styles/, `${where}: All styles label`)

        // 5. Queued styles are marked on the card, and nothing explains it in prose.
        assert.equal(first.mentionsOpenRequests, false, `${where}: open-requests prose`)
        assert.deepEqual(
          first.queuedBadges,
          [{ card: String(QUEUED_SLOT), text: "2 queued" }],
          `${where}: queued badge`,
        )

        // 6. Phones: only the title and the method switch stay fixed.
        assert.equal(first.searchInsideBrowse, true, `${where}: search is outside the scroller`)
        assert.equal(first.viewsInsideBrowse, true, `${where}: views are outside the scroller`)
        assert.equal(first.tabsInsideBrowse, false, `${where}: tabs scroll away`)
        assert.ok(
          first.browse.top - first.tabs.bottom < 20,
          `${where}: ${Math.round(first.browse.top - first.tabs.bottom)} px of fixed chrome between the method switch and the grid`,
        )
        assert.equal(first.horizontalOverflow, false, `${where}: sideways scroll`)

        // 7. Primary bottom-right.
        const p = first.primary
        assert.ok(first.panel.right - p.right < 36, `${where}: primary is not at the right edge`)
        assert.ok(first.panel.bottom - p.bottom < 40, `${where}: primary is not at the bottom`)
        assert.ok(p.left > (first.panel.left + first.panel.right) / 2, `${where}: primary is left`)
        assert.match(p.className, /icono-button--primary/, `${where}: primary style`)

        // 14. Nothing sits on top of the Queue button (the consent box did).
        const topmost = await page.evaluate(() => {
          const b = document.querySelector("[data-icono-request-free-submit]")
          const r = b.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return hit === b || b.contains(hit) ? "queue" : hit?.closest("[class]")?.className || "?"
        })
        assert.equal(topmost, "queue", `${where}: ${topmost} covers the Queue button`)
        assert.match(first.cardFont, /IBM Plex Mono/, `${where}: card label font`)

        // 8 + 9. Labels and tray follow the batch.
        assert.equal(p.text, "Queue random", `${where}: empty-batch label`)
        const desktop = size === "desktop"
        assert.equal(first.trayVisible, desktop, `${where}: tray visibility`)
        if (desktop) assert.equal(first.trayCount, "0 of 20", `${where}: empty tray count`)

        await page.click(card(36978))
        let m = await page.evaluate(measurePicker)
        assert.equal(m.primary.text, "Queue 36978", `${where}: one-pick label`)
        await page.click(card(31261))
        m = await page.evaluate(measurePicker)
        assert.equal(m.primary.text, "Queue 2 candidates", `${where}: two-pick label`)
        if (desktop) {
          assert.equal(m.trayCount, "2 of 20", `${where}: tray count`)
          assert.equal(m.trayRows, 2, `${where}: tray rows`)
        }
        await page.screenshot({ path: shot("two-picked") })
        if (desktop) {
          await page.click("[data-icono-request-batch-remove='anima-v1-36978']")
          m = await page.evaluate(measurePicker)
          assert.equal(m.trayCount, "1 of 20", `${where}: tray count after remove`)
          assert.equal(m.primary.text, "Queue 31261", `${where}: label after remove`)
        } else {
          await page.click(card(36978))
          m = await page.evaluate(measurePicker)
          assert.equal(m.primary.text, "Queue 31261", `${where}: label after un-pick`)
        }

        // 11. Specific batch payload.
        await page.click("[data-icono-request-free-submit]")
        await page.waitForTimeout(400)
        assert.equal(posts.length, 1, `${where}: specific batch was not posted`)
        assert.equal(posts[0].request_mode, "specific", `${where}: batch mode`)
        assert.deepEqual(posts[0].requested_vision_ids, ["anima-v1-31261"], `${where}: batch ids`)

        // 10. Select all respects the 20-style limit.
        await page.click("[data-icono-request-select-all-favorites]")
        m = await page.evaluate(measurePicker)
        assert.equal(m.primary.text, "Queue 20 candidates", `${where}: select-all label`)
        if (desktop) assert.equal(m.trayCount, "20 of 20", `${where}: select-all tray`)
        await page.screenshot({ path: shot("all-favorites") })

        // 2 again: typing an artist name finds nothing; a number finds its card.
        await page.click("[data-icono-request-view='all']")
        await page.fill("[data-icono-request-query]", "secret")
        await page.waitForTimeout(350)
        m = await page.evaluate(measurePicker)
        assert.equal(m.visibleCards, 0, `${where}: artist search found ${m.visibleCards} styles`)
        await page.fill("[data-icono-request-query]", "2561")
        await page.waitForTimeout(350)
        m = await page.evaluate(measurePicker)
        assert.deepEqual(m.cardLabels, ["2561"], `${where}: number search`)
        await page.fill("[data-icono-request-query]", "")
        await page.waitForTimeout(350)

        // All styles shows every style, not six.
        m = await page.evaluate(measurePicker)
        const allCount = await page.$$eval("[data-icono-request-card]", (els) => els.length)
        assert.equal(allCount, OPTIONS.length, `${where}: All styles count`)
        assert.equal(m.browseScrolls, true, `${where}: 24 styles do not scroll inside the dialog`)
        assert.ok(m.browse.bottom <= m.panel.bottom + 0.5, `${where}: the grid overflows the panel`)
        assert.match(m.views[1].text, new RegExp(`${OPTIONS.length}`), `${where}: All count`)

        // 12. The card star toggles a favorite.
        const star = `[data-icono-request-card='${ARTIST_SLOT}'] [data-icono-emulsion-favorite]`
        const before = await page.getAttribute(star, "aria-pressed")
        await page.click(star)
        await page.waitForFunction(
          ([selector, previous]) =>
            document.querySelector(selector)?.getAttribute("aria-pressed") !== previous,
          [star, before],
          { timeout: 5_000 },
        )

        // 6 again: on a phone the search scrolls away with the grid.
        if (!desktop) {
          await page.$eval("[data-icono-request-browse]", (el) => el.scrollTo(0, 400))
          await page.waitForTimeout(150)
          const searchTop = await page.$eval(
            "[data-icono-request-query]",
            (el) => el.getBoundingClientRect().bottom,
          )
          m = await page.evaluate(measurePicker)
          assert.ok(searchTop < m.browse.top, `${where}: search did not scroll away`)
          await page.screenshot({ path: shot("scrolled") })
        }

        // 11 again: an empty batch queues a random candidate.
        // All styles: the star click above un-favorited a picked style, so
        // Favorites no longer lists every card in the batch.
        await page.$eval("[data-icono-request-browse]", (el) => el.scrollTo(0, 0))
        await page.click("[data-icono-request-view='all']")
        const selected = await page.$$eval(
          "[data-icono-request-option][aria-pressed='true']",
          (els) => els.map((el) => el.getAttribute("data-icono-request-option")),
        )
        for (const visionId of selected) {
          await page.click(`[data-icono-request-option='${visionId}']`)
        }
        m = await page.evaluate(measurePicker)
        assert.equal(m.primary.text, "Queue random", `${where}: cleared label`)
        await page.click("[data-icono-request-free-submit]")
        await page.waitForTimeout(300)
        assert.equal(posts.length, 2, `${where}: random was not posted`)
        assert.equal(posts[1].request_mode, "random", `${where}: random mode`)

        await context.close()
      }
    }
  } finally {
    writeFileSync(path.join(OUT, "style-picker.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})
