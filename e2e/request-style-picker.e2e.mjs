// B-883: the New candidate > Free queue style picker, checked in a real browser.
// Owner decision (27 Sep 2026): mockup C on desktop (3:4 style cards plus a
// "Your batch" tray) and A-mobile on phones, built from the design system.
//
// Ways this picker can fail, written before the code, each asserted below at
// 1280 and 400 px in light and dark:
// 1. a card or a preview is not 3:4, or a preview uses the square `thumb` crop;
// 2. anything artist-shaped reaches the page: the search offers artists, a
//    card shows an artist label, or typing an artist name finds a style;
// 3. "Select all N favorites" is not a shared `.icono-button`, or it is not
//    in the footer on the Queue button's row, to its left (B-884: in the top
//    panel it cost phones a whole row). On a phone it reads "Select all N" so
//    it fits beside "Queue 20 candidates" without wrapping;
// 4. the view switch offers anything beyond Favorites and All styles;
// 5. the dialog explains open requests in prose instead of marking the card
//    ("2 queued") of a style that is already queued for this gene;
// 6. on a phone, anything besides the view switch sits between the method
//    switch and the first card, or the search is above the grid instead of
//    docked below it (where it stays visible while the grid scrolls);
// 7. the primary action is not at the bottom-right of the dialog;
// 8. the primary label does not follow the batch (random, one number, N);
// 9. the desktop tray is missing, miscounts, or cannot remove a style, or the
//    tray shows on a phone;
// 10. Select all favorites breaks the 20-style limit;
// 11. the queue request payload changes shape (random vs specific batch);
// 12. the card star no longer toggles a favorite, covers the art, or leaves
//     the style number's line (it sits right after the number, as on the gene
//     page); clicking the star picks the card, or clicking the number doesn't;
// 13. the dialog scrolls sideways at phone width;
// 14. the analytics consent box (EU/UK, bottom-right, top z-index) covers the
//     bottom-right Queue button while the dialog is open;
// 15. the first style-list request fails (the free plan ends a request that
//     runs past its CPU cap: the edge answers 503) and the grid stays blank,
//     or shows a bare "HTTP 503", until the reader switches views (B-884);
// 16. the list keeps failing and the grid offers no way to try again, or the
//     Try again button does not load the styles once the server recovers;
// 17. one gene shows on two cards (B-896: every style below also has an
//     ACVR2B candidate, as the owner's Favorites did on 2026-10-05);
// 18. All styles stops at the first answer: scrolling to the end of the grid
//     does not load the next page, or the label claims a count (B-1014).
//
// Needs `pnpm run build` (public-iconoplasm-edge) and an installed Chrome.
// Screenshots and the measurements land in artifacts/e2e/.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
  HOST,
  HttpStatus,
  OUT,
  VIEWPORTS,
  launchChrome,
  routeProduction,
  startSite,
} from "./harness.mjs"

const SLOTS = [
  36978, 51084, 31261, 1184, 21006, 22811, 20128, 20910, 55908, 2561, 21404, 30593, 255, 21329,
  21103, 343, 28999, 28478, 29469, 34047, 45472, 11111, 22222, 33333,
]
const FAVORITES = SLOTS.slice(0, 22).map((slot) => `0-${slot}`)
const ARTIST_SLOT = 28478
const SINGLE_PREVIEW_SLOT = 11111
const EMPTY_SLOT = 33333
const QUEUED_SLOT = 51084

// The server's shape since B-896: at most 5 previews, canonical first, medium
// (3:4) only.
const GENE_BY_SHA = new Map()
function previewAssets(slot) {
  if (slot === EMPTY_SLOT) return []
  const count = slot === SINGLE_PREVIEW_SLOT ? 1 : 5
  return Array.from({ length: count }, (_, i) => {
    const sha = `${String(slot).padStart(6, "0")}${i}`.padEnd(64, "a")
    const gene = i === 3 ? "ACVR2B" : `G${slot}${"ABCDE"[i]}`
    GENE_BY_SHA.set(sha, gene)
    return {
      gene_symbol: gene,
      asset_sha256: sha,
      is_current: i === 0,
      medium_url: `${HOST}/portraits/v1/${sha.slice(0, 2)}/${sha}/medium.webp`,
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

// B-1014: the first answer carries a cursor at its weakest style; the next
// page is weaker still (no votes), so it lands after every first-page card.
const NEXT_SLOTS = Array.from({ length: 30 }, (_, i) => 70001 + i)
const NEXT_OPTIONS = NEXT_SLOTS.map((slot) => ({
  vision_id: `anima-v1-${slot}`,
  label: String(slot),
  primary_label: String(slot),
  secondary_label: "",
  search_text: `0-${slot} anima-v1-${slot}`,
  emulsion_id: `0-${slot}`,
  emulsion_family_id: `0-${slot}`,
  image_count: 2,
  live_count: 0,
  score: 0,
  vote_h_index: 0,
  preview_assets: previewAssets(slot),
  is_favorite: false,
}))
const LAST = OPTIONS[OPTIONS.length - 1]
const FIRST_CURSOR = JSON.stringify([
  LAST.vote_h_index,
  LAST.live_count,
  LAST.score,
  LAST.image_count,
  LAST.vision_id,
])

// `options.failFirst` answers that many style-list requests with the edge's
// 503; `options.failing()` keeps answering 503 while it returns true.
function createApi(posts, options = {}) {
  let optionsCalls = 0
  const api = (pathname, request) => {
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
    if (pathname === "/api/iconoplasm/requests/options") {
      if (new URL(request.url()).searchParams.get("after") === FIRST_CURSOR) {
        return { request_options: NEXT_OPTIONS, next_cursor: "" }
      }
      optionsCalls += 1
      if (optionsCalls <= (options.failFirst || 0) || options.failing?.()) {
        return new HttpStatus(503, {
          error: "The only allowed stateful worker is unavailable",
          code: "THE_ONLY_ALLOWED_STATEFUL_WORKER_UNAVAILABLE",
        })
      }
      return { request_options: OPTIONS, next_cursor: FIRST_CURSOR }
    }
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
  api.optionsCalls = () => optionsCalls
  return api
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
  const panel = dialog
  const header = dialog.querySelector(".icono-dialog__header")
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
  const footer = dialog.querySelector("[data-icono-request-free-footer]")
  const tray = dialog.querySelector("[data-icono-request-batch]")
  const viewSwitch = dialog.querySelector(".icono-request-views")
  const find = dialog.querySelector(".icono-request-find")
  const firstCard = cards.find(visible)
  // Each visible card's star against its number and its art.
  const stars = cards.filter(visible).map((c) => ({
    card: c.getAttribute("data-icono-request-card"),
    art: box(c.querySelector(".icono-request-card-art")),
    label: box(c.querySelector(".icono-request-card-label")),
    star: box(c.querySelector("[data-icono-emulsion-favorite]")),
  }))
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
    viewsInsideBrowse: views.length > 0 && views.every((v) => browse && browse.contains(v)),
    selectAllInFooter: !!(footer && selectAll && footer.contains(selectAll)),
    tabsInsideBrowse: !!(browse && tabs && browse.contains(tabs)),
    viewSwitch: box(viewSwitch),
    find: box(find),
    firstCard: box(firstCard),
    stars,
    gridText: dialog.querySelector("[data-icono-request-results]")?.innerText.trim() || "",
    retryVisible: visible(dialog.querySelector("[data-icono-request-retry]")),
    bareHttpStatus: /HTTP \d{3}/.test(text),
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
          text: selectAll.innerText.trim(),
          ariaLabel: selectAll.getAttribute("aria-label") || "",
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
        // 15. Every run starts with the edge's 503 on the first style-list load.
        const api = createApi(posts, { failFirst: 1 })
        await routeProduction(context, origin, api)
        await routePortraits(context)
        const page = await context.newPage()
        await page.goto(`${HOST}/gene/TP53`)
        await page.waitForSelector("[data-icono-request-dialog-open]", { timeout: 30_000 })
        await openPicker(page)
        await page.screenshot({ path: shot("open") })

        const first = await page.evaluate(measurePicker)
        report.push({ where, moment: "open", ...first })

        assert.ok(api.optionsCalls() >= 2, `${where}: the failed load was not retried`)
        assert.equal(first.bareHttpStatus, false, `${where}: the dialog shows a bare HTTP status`)

        // 1. 3:4 cards from 3:4 previews, never the square thumb crop.
        assert.ok(first.visibleCards >= 4, `${where}: only ${first.visibleCards} cards visible`)
        for (const ratio of first.arts) {
          assert.ok(Math.abs(ratio - 0.75) < 0.02, `${where}: card art ratio ${ratio}`)
        }
        assert.ok(first.images.length > 0, `${where}: no card previews rendered`)
        // 17. Each gene once across the visible cards.
        const shownGenes = first.images.map((image) =>
          GENE_BY_SHA.get((/[0-9a-f]{64}/.exec(image.src) || [""])[0]),
        )
        assert.equal(new Set(shownGenes).size, shownGenes.length, `${where}: ${shownGenes}`)
        assert.ok(!shownGenes.includes(undefined), `${where}: unknown preview src`)
        for (const image of first.images) {
          assert.equal(/thumb\.webp/.test(image.src), false, `${where}: square thumb ${image.src}`)
          assert.ok(Math.abs(image.ratio - 0.75) < 0.03, `${where}: preview ratio ${image.ratio}`)
        }

        // 2. Nothing artist-shaped.
        assert.equal(first.mentionsArtist, false, `${where}: the dialog mentions an artist`)
        assert.equal(/artist/i.test(first.searchPlaceholder || ""), false, `${where}: placeholder`)
        assert.equal(/artist/i.test(first.searchLabel || ""), false, `${where}: search label`)

        // 3. Select all favorites is a shared button in the footer, left of Queue.
        const desktop = size === "desktop"
        assert.ok(first.selectAll && first.selectAll.visible, `${where}: Select all is missing`)
        assert.equal(first.selectAll.tag, "BUTTON", `${where}: Select all is not a button`)
        assert.match(first.selectAll.className, /\bicono-button\b/, `${where}: Select all style`)
        assert.equal(
          first.selectAll.text,
          desktop ? "Select all 22 favorites" : "Select all 22",
          `${where}: Select all label`,
        )
        assert.equal(first.selectAll.ariaLabel, "Select all 22 favorites", `${where}: aria-label`)
        assert.equal(first.selectAllInFooter, true, `${where}: Select all is not in the footer`)
        assert.ok(first.selectAll.right < first.primary.left, `${where}: Select all is not left`)
        assert.ok(
          Math.abs(first.selectAll.top - first.primary.top) < 2,
          `${where}: Select all and Queue are on different rows`,
        )

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

        // 6. Only the view switch sits between the method switch and the
        // cards; on a phone the search is docked below the grid, in view.
        assert.equal(first.viewsInsideBrowse, true, `${where}: views are outside the scroller`)
        assert.equal(first.tabsInsideBrowse, false, `${where}: tabs scroll away`)
        assert.ok(
          first.browse.top - first.tabs.bottom < 20,
          `${where}: ${Math.round(first.browse.top - first.tabs.bottom)} px of fixed chrome between the method switch and the grid`,
        )
        assert.ok(
          first.firstCard.top - first.viewSwitch.bottom < 24,
          `${where}: ${Math.round(first.firstCard.top - first.viewSwitch.bottom)} px between the view switch and the first card`,
        )
        if (desktop) {
          assert.ok(
            Math.abs(first.find.top - first.viewSwitch.top) < 8,
            `${where}: search is not on the view switch's row`,
          )
        } else {
          assert.ok(first.find.top >= first.firstCard.bottom, `${where}: search is above the grid`)
          assert.ok(
            first.find.bottom <= first.browse.bottom + 1 && first.find.top >= first.browse.top,
            `${where}: the docked search is out of view`,
          )
        }
        assert.equal(first.horizontalOverflow, false, `${where}: sideways scroll`)

        // 12. The star sits right after the number, on its line, off the art.
        for (const s of first.stars) {
          const at = `${where} card ${s.card}`
          if (!s.star) continue // a style without portraits has no star
          assert.ok(s.star.top >= s.art.bottom - 0.5, `${at}: the star covers the art`)
          const starMid = (s.star.top + s.star.bottom) / 2
          assert.ok(
            starMid > s.label.top && starMid < s.label.bottom,
            `${at}: the star is off the number's line`,
          )
          assert.ok(
            s.star.left >= s.label.right - 1 && s.star.left - s.label.right < 12,
            `${at}: the star is not right after the number`,
          )
        }

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
        assert.equal(first.trayVisible, desktop, `${where}: tray visibility`)
        if (desktop) assert.equal(first.trayCount, "0 of 20", `${where}: empty tray count`)

        await page.click(card(36978))
        let m = await page.evaluate(measurePicker)
        assert.equal(m.primary.text, "Queue 36978", `${where}: one-pick label`)
        // 12. The number picks its card too.
        await page.click(`[data-icono-request-card='31261'] .icono-request-card-label`)
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
        // The server refuses a batch without an id of this shape, so every Queue click would fail.
        assert.match(
          String(posts[0].client_batch_id),
          /^[a-z0-9][a-z0-9._:-]*$/i,
          `${where}: client batch id`,
        )

        // 10. Select all respects the 20-style limit.
        await page.click("[data-icono-request-select-all-favorites]")
        m = await page.evaluate(measurePicker)
        assert.equal(m.primary.text, "Queue 20 candidates", `${where}: select-all label`)
        if (desktop) assert.equal(m.trayCount, "20 of 20", `${where}: select-all tray`)
        // 3. The longest Queue label still shares the row, on one line each.
        assert.ok(
          Math.abs(m.selectAll.top - m.primary.top) < 2 && m.selectAll.right < m.primary.left,
          `${where}: Select all and "Queue 20 candidates" do not share the footer row`,
        )
        assert.ok(m.primary.h < 48 && m.selectAll.h < 48, `${where}: a footer label wrapped`)
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

        // All styles shows every style, not six: 18. scrolling to the end of the
        // grid loads the next page, and the label claims no count.
        m = await page.evaluate(measurePicker)
        assert.equal(m.browseScrolls, true, `${where}: 24 styles do not scroll inside the dialog`)
        assert.ok(m.browse.bottom <= m.panel.bottom + 0.5, `${where}: the grid overflows the panel`)
        assert.equal(m.views[1].text, "All styles", `${where}: All styles label`)
        await page.$eval("[data-icono-request-browse]", (el) => el.scrollTo(0, el.scrollHeight))
        await page.waitForFunction(
          (total) => document.querySelectorAll("[data-icono-request-card]").length === total,
          OPTIONS.length + NEXT_OPTIONS.length,
          { timeout: 5_000 },
        )
        const allLabels = await page.$$eval("[data-icono-request-card]", (els) =>
          els.map((el) => el.getAttribute("data-icono-request-card")),
        )
        assert.deepEqual(
          allLabels.slice(-NEXT_OPTIONS.length),
          NEXT_SLOTS.map(String),
          `${where}: the next page is not after the first`,
        )
        m = await page.evaluate(measurePicker)
        const pagedGenes = m.images.map((image) =>
          GENE_BY_SHA.get((/[0-9a-f]{64}/.exec(image.src) || [""])[0]),
        )
        assert.equal(new Set(pagedGenes).size, pagedGenes.length, `${where}: paged repeats`)
        await page.$eval("[data-icono-request-browse]", (el) => el.scrollTo(0, 0))

        // 12. The card star toggles a favorite.
        // ...and does not pick or un-pick the card it sits on.
        const star = `[data-icono-request-card='${ARTIST_SLOT}'] [data-icono-emulsion-favorite]`
        const before = await page.getAttribute(star, "aria-pressed")
        const pickedBefore = await page.getAttribute(card(ARTIST_SLOT), "aria-pressed")
        await page.click(star)
        await page.waitForFunction(
          ([selector, previous]) =>
            document.querySelector(selector)?.getAttribute("aria-pressed") !== previous,
          [star, before],
          { timeout: 5_000 },
        )
        assert.equal(
          await page.getAttribute(card(ARTIST_SLOT), "aria-pressed"),
          pickedBefore,
          `${where}: the star click toggled the card`,
        )

        // 6 again: on a phone the docked search stays in view while the grid scrolls.
        if (!desktop) {
          await page.$eval("[data-icono-request-browse]", (el) => el.scrollTo(0, 400))
          await page.waitForTimeout(150)
          m = await page.evaluate(measurePicker)
          assert.ok(
            m.find.bottom <= m.browse.bottom + 1 && m.find.top >= m.browse.top,
            `${where}: the docked search scrolled out of view`,
          )
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

test("a style list that keeps failing offers Try again, which loads it once the server recovers", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    const [width, height] = VIEWPORTS.find(([, , size]) => size === "phone")
    const context = await browser.newContext({ viewport: { width, height } })
    await context.addInitScript(() => localStorage.setItem("iconoplasm.new-candidate-tab", "free"))
    let failing = true
    const api = createApi([], { failing: () => failing })
    await routeProduction(context, origin, api)
    await routePortraits(context)
    const page = await context.newPage()
    await page.goto(`${HOST}/gene/TP53`)
    await page.waitForSelector("[data-icono-request-dialog-open]", { timeout: 30_000 })
    await page.click("[data-icono-request-dialog-open]")
    await page.waitForSelector(`${DIALOG}[open]`)
    await page.click("[data-icono-request-tab='free']")

    // 16. After the retries the grid says what happened and offers a retry.
    await page.waitForSelector("[data-icono-request-retry]", { timeout: 15_000 })
    let m = await page.evaluate(measurePicker)
    await page.screenshot({ path: path.join(OUT, "style-picker-phone-light-load-failed.png") })
    assert.equal(api.optionsCalls(), 3, "one load plus two retries")
    assert.match(m.gridText, /Could not load styles/, "failure message")
    assert.equal(m.retryVisible, true, "Try again is not visible")
    assert.equal(m.bareHttpStatus, false, "the dialog shows a bare HTTP status")
    // 6. A short grid still leaves the docked search at the bottom.
    assert.ok(
      m.browse.bottom - m.find.bottom < 20,
      `the search floats ${Math.round(m.browse.bottom - m.find.bottom)} px above the bottom`,
    )

    failing = false
    await page.click("[data-icono-request-retry]")
    await page.waitForSelector("[data-icono-request-card]", { timeout: 15_000 })
    m = await page.evaluate(measurePicker)
    assert.ok(m.visibleCards >= 4, `only ${m.visibleCards} cards after Try again`)
    await context.close()
  } finally {
    server.close()
    await browser.close()
  }
})
