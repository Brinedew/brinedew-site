// B-883: the New candidate > Free queue style picker, checked in a real browser.
// Owner decision (27 Sep 2026): 3:4 style cards, built from the design system.
// Owner decision (26 Oct 2026, B-1179): no picking; a tap on a style requests
// it, "Request all favorites" sits at the bottom-left, and a deck of what is
// requested sits beside "Request random".
//
// Ways this picker can fail, written before the code, each asserted below at
// 1280 and 400 px in light and dark:
// 1. a card or a preview is not 3:4, or a preview uses the square `thumb` crop
//    (retired 2026-10-28);
// 2. anything artist-shaped reaches the page: the search offers artists, a
//    card shows an artist label, or typing an artist name finds a style;
// 3. "Request all favorites" is not a shared `.icono-button`, or it is not at
//    the footer's left on the Request random row;
// 4. the view switch offers anything beyond Favorites and All styles;
// 5. the dialog explains open requests in prose instead of marking the card
//    ("2 requested", on its picture's corner) of a style already requested on
//    this gene;
// 6. on a phone, anything besides the view switch sits between the top of
//    the dialog (the method switch, or the dialog header for a reader without
//    an image API key) and the first card, or the search is above the grid
//    instead of docked below it (where it stays visible while the grid
//    scrolls);
// 7. Request random is not at the bottom-right of the dialog;
// 8. a tap on a style card (its picture or its number) does not request that
//    style at once, as one specific order;
// 9. the deck (every candidate requested and not yet received, with its count on the top card)
//    is missing, is not between "Request all favorites" and Request random, or
//    tapping it does not take the reader to their requests;
// 10. "Request all favorites" requests other than every favorite (22 here,
//     under the 100-style order limit), in one order;
// 11. the request payload changes shape (random vs specific batch);
// 12. the card star no longer toggles a favorite, covers the art, or leaves
//     the style number's line (it sits right after the number, as on the gene
//     page); clicking the star requests the style;
// 13. the dialog scrolls sideways at phone width;
// 14. the analytics consent box (EU/UK, bottom-right, top z-index) covers the
//     bottom-right Request random button while the dialog is open;
// 15. the first style-list request fails (the free plan ends a request that
//     runs past its CPU cap: the edge answers 503) and the grid stays blank,
//     or shows a bare "HTTP 503", until the reader switches views (B-884);
// 16. the list keeps failing and the grid offers no way to try again, or the
//     Try again button does not load the styles once the server recovers;
// 17. a card shows other than its style's published portraits, up to four,
//     tiled to fill the 3:4 card, or one gene shows on two cards (B-896,
//     migration 0130);
// 18. All styles stops at the first answer: scrolling to the end of the grid
//     does not load the next page, or the label claims a count (B-1014);
// 19. opening the picker asks the Worker for the style list although the CDN
//     object has it and every favourite (B-896), or the picker shows nothing
//     when the CDN cannot be reached;
// 20. the view switch (and, on desktop, the search) scrolls out of view while
//     the cards scroll (B-1044: the owner lost it on scrolling down);
// 21. a Request random click waits for the server before the reader sees
//     anything: five fast clicks against a slow server must put "+5" on the
//     deck at once and still send five requests one after another (B-1177);
// 22. the deck drops what was requested (B-1178, the owner on 2026-10-26: "you
//     just implemented happy path"): random and style requests miss the count,
//     or closing the dialog or reloading the page forgets requests still open;
// 23. a double click on a card requests the style twice (double-clicking is
//     how people open a picture), or Enter on a focused card moves the focus;
// 24. a style request waits for the server before the deck and the card's
//     "N requested" move;
// 25. a refused request stays in the deck or on its card, or the reader is not
//     told;
// 26. the server's refresh after the clicks disagrees with the deck;
// 27. a card's number or caption is cut off, "N requested" leaves its picture,
//     or the footer's three controls leave one row at 360 px;
// 28. a picture is a blank cell while its file loads: no blurred copy of
//     itself (its ThumbHash placeholder) under it (owner, 2026-10-28: "a lot
//     of white squares");
// 29. a grid cell downloads the 384 px medium file where the 192 px small one
//     covers it (a medium the page had already fetched before the picker
//     opened is fine: the browser reuses it rather than fetch the small);
// 30. the placeholder still lies under a picture that has loaded, where a
//     cell of fractional width shows it as a coloured line down one edge.
//
// Needs `pnpm run build` (public-iconoplasm-edge) and an installed Chrome.
// Screenshots and the measurements land in artifacts/e2e/.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
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
// How long the test server takes to answer a random request (21).
const RANDOM_DELAY = 1_000

// The server's shape since migration 0130: the style's published portraits
// only, most upvoted first, at most four, medium (3:4) only; canonical_count
// is every published portrait, so it can exceed four. Styles get one to four
// so every tiling shows.
const GENE_BY_SHA = new Map()
function previewCount(slot) {
  if (slot === EMPTY_SLOT) return 0
  return slot === SINGLE_PREVIEW_SLOT ? 1 : (slot % 4) + 1
}
function previewAssets(slot) {
  return Array.from({ length: previewCount(slot) }, (_, i) => {
    const sha = `${String(slot).padStart(6, "0")}${i}`.padEnd(64, "a")
    const gene = `G${slot}${"ABCD"[i]}`
    GENE_BY_SHA.set(sha, gene)
    return {
      gene_symbol: gene,
      asset_sha256: sha,
      is_current: true,
      medium_url: `${HOST}/portraits/v1/${sha.slice(0, 2)}/${sha}/medium.webp`,
      small_url: `${HOST}/portraits/v1/${sha.slice(0, 2)}/${sha}/small.webp`,
      // A real ThumbHash, from the workstation's encoder on a 3:4 test image.
      placeholder: "mygGJQxgh3GHaIhXiHeIh6GACfeI",
    }
  })
}
// One, two, three or four tiles of a 3:4 card, as width over height.
const TILE_RATIOS = {
  1: [0.75],
  2: [0.375, 0.375],
  3: [0.375, 0.75, 0.75],
  4: [0.75, 0.75, 0.75, 0.75],
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
  canonical_count: previewCount(slot) === 4 ? 7 : previewCount(slot),
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
  canonical_count: previewCount(slot),
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
  let pageCalls = 0
  const api = (pathname, request) => {
    if (/^\/api\/iconoplasm\/requests\/gene\/[^/]+\/summary$/.test(pathname)) {
      // One of this reader's requests and one of someone else's were open
      // before the dialog opened; every request posted since joins its lane.
      const lanes = [
        {
          request_mode: "specific",
          requested_vision_id: `anima-v1-${QUEUED_SLOT}`,
          requested_emulsion_id: `C9-${QUEUED_SLOT}`,
          requested_emulsion_label: `C9-${QUEUED_SLOT}`,
          request_count: 2,
          my_request_count: 1,
        },
        { request_mode: "random", request_count: 1, my_request_count: 1 },
      ]
      const join = (match, lane) => {
        let found = lanes.find(match)
        if (!found) lanes.push((found = { ...lane, request_count: 0, my_request_count: 0 }))
        found.request_count += 1
        found.my_request_count += 1
      }
      for (const body of posts) {
        if (body.refused) continue
        if (body.request_mode === "random") {
          join((lane) => lane.request_mode === "random", { request_mode: "random" })
          continue
        }
        for (const id of body.requested_vision_ids || []) {
          if ((body.refusedIds || []).includes(id)) continue
          join((lane) => lane.requested_vision_id === id, {
            request_mode: "specific",
            requested_vision_id: id,
            requested_emulsion_id: id.replace(/^anima-v1-/, "0-"),
          })
        }
      }
      return { authenticated: true, my_lane_summary: lanes, gene_lane_summary: lanes }
    }
    if (pathname === "/api/iconoplasm/requests/options") {
      if (new URL(request.url()).searchParams.get("after") === FIRST_CURSOR) {
        pageCalls += 1
        if (options.pagesFailing?.()) return new HttpStatus(503, { error: "unavailable" })
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
      let answer = { ok: true, queued_count: count, failures: [] }
      // `options.refuse`: the server turns away that random click (by number)
      // and that style wherever it is asked for.
      const refuse = options.refuse
      if (refuse && body.request_mode === "random") {
        if (posts.filter((post) => post.request_mode === "random").length === refuse.random) {
          body.refused = true
          answer = new HttpStatus(503, { error: "Queue is busy" })
        }
      } else if (refuse) {
        body.refusedIds = body.requested_vision_ids.filter((id) => id === refuse.visionId)
        const failures = body.refusedIds.map((id) => ({
          requested_vision_id: id,
          error: "Unavailable",
        }))
        if (body.refusedIds.length === count) {
          body.refused = true
          answer = new HttpStatus(400, { ok: false, error: "Unavailable", failures })
        } else
          answer = {
            ok: true,
            queued_count: count - body.refusedIds.length,
            failures,
          }
      }
      const delay = body.request_mode === "random" ? options.randomDelay : options.styleDelay
      if (!delay) return answer
      return new Promise((resolve) => setTimeout(() => resolve(answer), delay))
    }
    return undefined
  }
  api.optionsCalls = () => optionsCalls
  api.pageCalls = () => pageCalls
  return api
}

// Every portrait is served as a 384x512 (3:4) picture, a distinct hue per URL.
// The picker's first page on the CDN (B-896): served, or unreachable.
async function routePicker(context, reachable) {
  await context.route("https://img.brinedew.bio/picker/v1/styles.json", (route) =>
    reachable
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ request_options: OPTIONS, next_cursor: FIRST_CURSOR }),
        })
      : route.abort("namenotresolved"),
  )
}

async function routePortraits(context, requested = []) {
  await context.route(/\/portraits\/.+\.webp(\?.*)?$/, (route) => {
    const url = route.request().url()
    requested.push(url)
    let hash = 0
    for (const ch of url) hash = (hash * 31 + ch.charCodeAt(0)) % 360
    const [w, h] = url.includes("/small.webp") ? [192, 256] : [384, 512]
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
  const addAll = [...dialog.querySelectorAll("[data-icono-request-add-favorites]")].find(visible)
  const primary = dialog.querySelector("[data-icono-request-free-submit]")
  const footer = dialog.querySelector("[data-icono-request-free-footer]")
  const deck = dialog.querySelector("[data-icono-request-deck]")
  const deckBadge = deck && deck.querySelector("[data-icono-request-random-count]")
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
    // The lowest fixed chrome above the grid: the method switch for a key
    // holder, the dialog header for everyone else (B-1181).
    top: visible(tabs) ? box(tabs) : box(header),
    browse: box(browse),
    browseScrolls: browse ? browse.scrollHeight > browse.clientHeight : false,
    viewsInsideBrowse: views.length > 0 && views.every((v) => browse && browse.contains(v)),
    addAllInFooter: !!(footer && addAll && footer.contains(addAll)),
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
      card: img.closest("[data-icono-request-card]")?.getAttribute("data-icono-request-card"),
      src: img.getAttribute("src") || "",
      currentSrc: img.currentSrc || "",
      placeholder: getComputedStyle(img.parentElement, "::before").backgroundImage.startsWith(
        'url("data:image/png',
      ),
      placeholderShown:
        getComputedStyle(img.parentElement, "::before").backgroundImage !== "none" &&
        getComputedStyle(img.parentElement, "::before").opacity !== "0",
      loaded: img.complete && img.naturalWidth > 0,
      width: img.getBoundingClientRect().width,
      sizes: img.getAttribute("sizes") || "",
      ratio: img.getBoundingClientRect().width / img.getBoundingClientRect().height,
    })),
    queuedBadges: [...dialog.querySelectorAll("[data-icono-request-queued]")]
      .filter(visible)
      .map((b) => {
        const art = box(
          b.closest("[data-icono-request-card]").querySelector(".icono-request-card-art"),
        )
        const chip = box(b)
        return {
          card: b.closest("[data-icono-request-card]")?.getAttribute("data-icono-request-card"),
          text: b.textContent.trim(),
          onArt:
            chip.left >= art.left &&
            chip.right <= art.right &&
            chip.top >= art.top &&
            chip.bottom <= art.bottom,
        }
      }),
    addAll: addAll
      ? {
          tag: addAll.tagName,
          className: String(addAll.className),
          text: addAll.innerText.trim(),
          ...box(addAll),
        }
      : null,
    primary: primary
      ? { text: primary.textContent.trim(), className: String(primary.className), ...box(primary) }
      : null,
    deck: visible(deck)
      ? (() => {
          const d = box(deck)
          const b = box(deckBadge)
          return {
            ...d,
            count: deckBadge.lastElementChild?.textContent || "",
            onTopCard:
              b.left >= d.left && b.right <= d.right && b.top >= d.top && b.bottom <= d.bottom,
          }
        })()
      : null,
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
  await page.waitForSelector("[data-icono-request-card]", { timeout: 15_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(400) // dialog open animation
}

const card = (slot) => `[data-icono-request-card='${slot}'] [data-icono-request-option]`

test("the Free queue picker is a 3:4 style grid where a tap requests a style", async (t) => {
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
        // 19. Light runs read the first page from the CDN. Dark runs cannot
        // reach the CDN, and 15. the Worker's first answer is the edge's 503.
        const cdn = theme === "light"
        const api = createApi(posts, { failFirst: cdn ? 0 : 1, randomDelay: RANDOM_DELAY })
        await routeProduction(context, origin, api)
        await routePicker(context, cdn)
        const portraitRequests = []
        await routePortraits(context, portraitRequests)
        const page = await context.newPage()
        await page.goto(`${HOST}/gene/TP53`)
        await page.waitForSelector("[data-icono-request-dialog-open]", { timeout: 30_000 })
        const fetchedBeforeOpen = new Set(portraitRequests)
        await openPicker(page)
        await page.screenshot({ path: shot("open") })

        const first = await page.evaluate(measurePicker)
        report.push({ where, moment: "open", ...first })

        if (cdn) {
          assert.equal(api.optionsCalls(), 0, `${where}: the Worker was asked for the list`)
        } else {
          assert.ok(api.optionsCalls() >= 2, `${where}: the failed load was not retried`)
        }
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
          // 28. Each picture sits on its blurred placeholder.
          assert.ok(image.placeholder, `${where}: no placeholder under ${image.src}`)
          // 29. One device pixel per CSS pixel here, so a cell narrower than
          // the small file loads the small one, unless the page already had
          // the medium.
          if (image.width <= 192 && !fetchedBeforeOpen.has(image.currentSrc)) {
            assert.match(
              image.currentSrc,
              /small\.webp$/,
              `${where}: a ${Math.round(image.width)} px cell loaded ${image.currentSrc} ` +
                `(sizes "${image.sizes}"; ${fetchedBeforeOpen.size} portrait files fetched ` +
                `before the picker opened)`,
            )
          }
        }
        // 30. Once a picture has faded in, its placeholder is gone from under it.
        await page.waitForTimeout(600)
        for (const image of (await page.evaluate(measurePicker)).images) {
          if (!image.loaded) continue
          assert.equal(image.placeholderShown, false, `${where}: placeholder under ${image.src}`)
        }
        for (const label of new Set(first.images.map((image) => image.card))) {
          const tiles = first.images.filter((image) => image.card === label)
          const expected = TILE_RATIOS[previewCount(Number(label))]
          assert.equal(tiles.length, expected.length, `${where}: card ${label} tiles`)
          tiles.forEach((tile, i) =>
            assert.ok(
              Math.abs(tile.ratio - expected[i]) < 0.03,
              `${where}: card ${label} tile ${i} ratio ${tile.ratio}`,
            ),
          )
        }

        // 2. Nothing artist-shaped.
        assert.equal(first.mentionsArtist, false, `${where}: the dialog mentions an artist`)
        assert.equal(/artist/i.test(first.searchPlaceholder || ""), false, `${where}: placeholder`)
        assert.equal(/artist/i.test(first.searchLabel || ""), false, `${where}: search label`)

        // 3. "Request all favorites" is a shared button at the footer's left,
        // on Request random's row; 9. the deck sits between them.
        const desktop = size === "desktop"
        assert.ok(first.addAll, `${where}: Request all favorites is missing`)
        assert.equal(first.addAll.tag, "BUTTON", `${where}: Request all favorites is not a button`)
        assert.match(first.addAll.className, /\bicono-button\b/, `${where}: its style`)
        assert.equal(
          first.addAll.text.replace(/\s+/g, " "),
          "Request all favorites",
          `${where}: label`,
        )
        assert.equal(first.addAllInFooter, true, `${where}: it is not in the footer`)
        assert.ok(first.addAll.left - first.panel.left < 40, `${where}: it is not at the left`)
        const sameRow = (a, b) => a.top < b.bottom && b.top < a.bottom
        assert.ok(
          sameRow(first.addAll, first.primary),
          `${where}: it is not on Request random's row`,
        )
        // This reader's open random request and their 51084 are in the deck.
        assert.equal(first.deck?.count, "2", `${where}: the deck does not count open requests`)
        assert.ok(
          first.addAll.right < first.deck.left && first.deck.right < first.primary.left,
          `${where}: the deck is not between the two buttons`,
        )
        assert.ok(sameRow(first.deck, first.primary), `${where}: the deck left the footer row`)

        // 4. Two views only.
        assert.deepEqual(
          first.views.map((v) => v.key),
          ["favorites", "all"],
          `${where}: views`,
        )
        assert.match(first.views[0].text, /^Favorites/, `${where}: Favorites label`)
        assert.match(first.views[1].text, /^All styles/, `${where}: All styles label`)

        // 5. Requested styles are marked on the card's picture, and nothing
        // explains it in prose.
        assert.equal(first.mentionsOpenRequests, false, `${where}: open-requests prose`)
        assert.deepEqual(
          first.queuedBadges,
          [{ card: String(QUEUED_SLOT), text: "2 requested", onArt: true }],
          `${where}: requested badge`,
        )

        // 6. Only the view switch sits between the top of the dialog and
        // the cards; on a phone the search is docked below the grid, in view.
        assert.equal(first.viewsInsideBrowse, true, `${where}: views are outside the scroller`)
        assert.equal(first.tabsInsideBrowse, false, `${where}: tabs scroll away`)
        assert.ok(
          first.browse.top - first.top.bottom < 20,
          `${where}: ${Math.round(first.browse.top - first.top.bottom)} px of fixed chrome between the top of the dialog and the grid`,
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

        // 7. Request random at the bottom-right.
        const p = first.primary
        assert.ok(first.panel.right - p.right < 36, `${where}: primary is not at the right edge`)
        assert.ok(first.panel.bottom - p.bottom < 40, `${where}: primary is not at the bottom`)
        assert.ok(p.left > (first.panel.left + first.panel.right) / 2, `${where}: primary is left`)
        assert.match(p.className, /icono-button--primary/, `${where}: primary style`)
        assert.equal(p.text, "Request random", `${where}: primary label`)

        // 14. Nothing sits on top of Request random (the consent box did).
        const topmost = await page.evaluate(() => {
          const b = document.querySelector("[data-icono-request-free-submit]")
          const r = b.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return hit === b || b.contains(hit)
            ? "request"
            : hit?.closest("[class]")?.className || "?"
        })
        assert.equal(topmost, "request", `${where}: ${topmost} covers Request random`)
        assert.match(first.cardFont, /IBM Plex Mono/, `${where}: card label font`)

        // 8 + 24. A tap on a card requests it: the deck and the card's count
        // move on the click, and one specific order goes out.
        await page.click(card(36978))
        let m = await page.evaluate(measurePicker)
        assert.equal(m.deck?.count, "3", `${where}: the deck did not take the tapped style`)
        assert.ok(
          m.queuedBadges.some((b) => b.card === "36978" && b.text === "1 requested" && b.onArt),
          `${where}: the tapped card does not say "1 requested"`,
        )
        // 8 + 12. The number requests its card too.
        await page.click(`[data-icono-request-card='31261'] .icono-request-card-label`)
        m = await page.evaluate(measurePicker)
        assert.equal(m.deck?.count, "4", `${where}: tapping the number did not request`)
        await page.screenshot({ path: shot("two-requested") })

        // 11. Specific order payload, one per tap.
        await page.waitForTimeout(400)
        assert.equal(posts.length, 2, `${where}: ${posts.length} orders for two taps`)
        assert.equal(posts[0].request_mode, "specific", `${where}: order mode`)
        assert.deepEqual(posts[0].requested_vision_ids, ["anima-v1-36978"], `${where}: order ids`)
        assert.deepEqual(posts[1].requested_vision_ids, ["anima-v1-31261"], `${where}: order ids`)
        // The server refuses an order without an id of this shape, so every tap would fail.
        assert.match(
          String(posts[0].client_batch_id),
          /^[a-z0-9][a-z0-9._:-]*$/i,
          `${where}: client batch id`,
        )

        // 10. "Request all favorites" requests every favorite, in one order.
        await page.click("[data-icono-request-add-favorites]")
        m = await page.evaluate(measurePicker)
        assert.equal(m.deck?.count, "26", `${where}: the deck did not take 22 favorites`)
        await page.waitForTimeout(400)
        assert.equal(
          posts.length,
          3,
          `${where}: the favorites went out as ${posts.length - 2} orders`,
        )
        assert.deepEqual(
          posts[2].requested_vision_ids,
          FAVORITES.map((id) => id.replace(/^0-/, "anima-v1-")),
          `${where}: the favorites order`,
        )
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

        // 12. The card star toggles a favorite, and requests nothing.
        const star = `[data-icono-request-card='${ARTIST_SLOT}'] [data-icono-emulsion-favorite]`
        const before = await page.getAttribute(star, "aria-pressed")
        await page.click(star)
        await page.waitForFunction(
          ([selector, previous]) =>
            document.querySelector(selector)?.getAttribute("aria-pressed") !== previous,
          [star, before],
          { timeout: 5_000 },
        )
        m = await page.evaluate(measurePicker)
        assert.equal(posts.length, 3, `${where}: the star click sent a request`)
        assert.equal(m.deck?.count, "26", `${where}: the star click moved the deck`)

        // 6 and 20: while the cards scroll, the view switch stays pinned at the
        // top of the scroller, and the search with it on desktop; on a phone
        // the search stays docked at the bottom.
        await page.$eval("[data-icono-request-browse]", (el) => el.scrollTo(0, 400))
        await page.waitForTimeout(150)
        m = await page.evaluate(measurePicker)
        const inView = (part) => part.top >= m.browse.top - 1 && part.bottom <= m.browse.bottom + 1
        assert.ok(inView(m.viewSwitch), `${where}: the view switch scrolled out of view`)
        assert.ok(inView(m.find), `${where}: the search scrolled out of view`)
        assert.ok(
          desktop ? m.find.top < m.browse.top + 60 : m.find.bottom > m.browse.bottom - 80,
          `${where}: the search left its place (desktop: top row; phone: docked at the bottom)`,
        )
        await page.screenshot({ path: shot("scrolled") })

        // 21 (B-1177). Five fast random clicks against a slow server: each
        // click answers at once on the deck, and the five go out one after
        // another.
        for (let i = 0; i < 5; i++) await page.click("[data-icono-request-free-submit]")
        await page.waitForTimeout(250) // the count's last digit finishes rolling
        m = await page.evaluate(measurePicker)
        assert.ok(posts.length < 8, `${where}: the test server answered too fast to prove anything`)
        assert.equal(m.primary.text, "Request random", `${where}: label after random clicks`)
        assert.equal(m.deck?.count, "31", `${where}: the deck did not follow the clicks`)
        assert.ok(m.deck.onTopCard, `${where}: the count is not on the deck's top card`)
        await page.screenshot({ path: shot("random-clicks") })
        const deadline = Date.now() + RANDOM_DELAY * 5 + 5_000
        while (posts.length < 8 && Date.now() < deadline) await page.waitForTimeout(100)
        assert.equal(posts.length, 8, `${where}: five random clicks did not make five requests`)
        assert.ok(
          posts.slice(3).every((post) => post.request_mode === "random"),
          `${where}: random mode`,
        )

        // 9. The deck takes the reader to their requests.
        await page.click("[data-icono-request-deck]")
        await page.waitForSelector(`${DIALOG}:not([open])`, { state: "attached" })

        await context.close()
      }
    }
  } finally {
    writeFileSync(path.join(OUT, "style-picker.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})

// Runs in the page: what the reader sees of their requests right now.
function measureQueue() {
  const visible = (el) => !!el && el.checkVisibility()
  const deck = document.querySelector("[data-icono-request-deck]")
  const footer = document.querySelector("[data-icono-request-free-footer]")
  const controls = [...footer.querySelectorAll(":scope > button")].filter(visible)
  const box = footer.getBoundingClientRect()
  const rows = controls.map((el) => el.getBoundingClientRect())
  return {
    label: document.querySelector("[data-icono-request-free-submit]").textContent.trim(),
    count: visible(deck)
      ? deck.querySelector("[data-icono-request-random-count]").lastElementChild?.textContent || ""
      : "",
    chips: Object.fromEntries(
      [...document.querySelectorAll("[data-icono-request-queued]")].map((chip) => [
        chip.closest("[data-icono-request-card]").getAttribute("data-icono-request-card"),
        chip.textContent.trim(),
      ]),
    ),
    chipsOffArt: [...document.querySelectorAll("[data-icono-request-queued]")].filter((chip) => {
      const art = chip.closest("[data-icono-request-card]").querySelector(".icono-request-card-art")
      const a = art.getBoundingClientRect()
      const c = chip.getBoundingClientRect()
      return c.left < a.left || c.right > a.right || c.top < a.top || c.bottom > a.bottom
    }).length,
    // Every control shares one row, inside the footer.
    oneRow: rows.every((a) => rows.every((b) => a.top < b.bottom && b.top < a.bottom)),
    inFooter: rows.every((r) => r.left >= box.left - 1 && r.right <= box.right + 1),
    focus: document.activeElement?.getAttribute("data-icono-request-option") || "",
    open: !!document.querySelector("[data-icono-request-dialog][open]"),
    note: (
      document.querySelector("[data-icono-request-dialog] [data-icono-request-note]")
        ?.textContent || ""
    ).trim(),
    cutLabels: [...document.querySelectorAll(".icono-request-card-label")].filter(
      (label) => label.scrollWidth > label.clientWidth + 1,
    ).length,
    metaOverflow: [...document.querySelectorAll(".icono-request-card-meta")].filter(
      (meta) => meta.checkVisibility() && meta.scrollWidth > meta.clientWidth + 1,
    ).length,
  }
}

// 22-27 (B-1178, B-1179). The reader leaves the happy path: random clicks
// mixed with style taps, a double click, Enter on a card, refusals, closing the
// dialog and reloading the page. Every click answers at once, nothing requested
// leaves the deck unless the server refuses it, and the deck's count is what
// the server holds once it answers.
test("random and style requests share one deck that survives every detour", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const [width, height, size] of [...VIEWPORTS, [360, 780, "phone360"]]) {
      const where = size
      const shot = (name) => path.join(OUT, `request-mixes-${size}-${name}.png`)
      const posts = []
      const context = await browser.newContext({ viewport: { width, height } })
      await context.addInitScript(() =>
        localStorage.setItem("iconoplasm.new-candidate-tab", "free"),
      )
      // The server refuses the second random click and the style 31261.
      const api = createApi(posts, {
        randomDelay: 600,
        styleDelay: 600,
        refuse: { random: 2, visionId: "anima-v1-31261" },
      })
      await routeProduction(context, origin, api)
      await routePicker(context, true)
      await routePortraits(context)
      const page = await context.newPage()
      await page.goto(`${HOST}/gene/TP53`)
      await page.waitForSelector("[data-icono-request-dialog-open]", { timeout: 30_000 })
      await openPicker(page)
      const settle = async (count) => {
        const deadline = Date.now() + 10_000
        while (posts.length < count && Date.now() < deadline) await page.waitForTimeout(100)
        await page.waitForTimeout(1_200) // the last answer and the refresh behind it
      }

      // Before anything: this reader's open random request and their 51084.
      let q = await page.evaluate(measureQueue)
      assert.equal(q.count, "2", `${where}: the requests already open are not counted`)
      assert.equal(q.oneRow && q.inFooter, true, `${where}: the footer controls left their row`)

      // 1. Two random clicks, then a style tap: all three join the deck at
      // once (22, 24).
      await page.click("[data-icono-request-free-submit]")
      await page.click("[data-icono-request-free-submit]")
      await page.click(card(36978))
      q = await page.evaluate(measureQueue)
      assert.equal(q.count, "5", `${where}: the deck missed a click`)
      assert.equal(q.chips["36978"], "1 requested", `${where}: the tapped card's count`)
      assert.equal(q.label, "Request random", `${where}: the main button changed`)
      assert.equal(q.oneRow && q.inFooter, true, `${where}: the deck pushed a control out (27)`)
      await page.screenshot({ path: shot("mixed") })

      // 2. A double click on a card is one request; Enter on a focused card
      // is another, and the focus stays on that card (23).
      await page.dblclick(card(1184))
      await page.focus(card(21006))
      await page.keyboard.press("Enter")
      q = await page.evaluate(measureQueue)
      assert.equal(q.count, "7", `${where}: count after the double click and Enter`)
      assert.equal(q.chips["1184"], "1 requested", `${where}: the double click requested twice`)
      assert.equal(q.focus, "anima-v1-21006", `${where}: Enter moved the focus off the card`)

      // 3. The second random click was refused (25): it leaves the deck, and
      // the reader is told; the server's refresh agrees with the deck (26).
      await settle(5)
      assert.equal(
        posts.filter((post) => (post.requested_vision_ids || []).includes("anima-v1-1184")).length,
        1,
        `${where}: the double click sent two orders`,
      )
      q = await page.evaluate(measureQueue)
      assert.equal(q.count, "6", `${where}: the refused random click stayed in the deck`)
      assert.match(q.note, /Queue is busy/, `${where}: the refusal was not shown`)

      // 4. A refused style leaves the deck and its card, with the reason.
      await page.click(card(31261))
      q = await page.evaluate(measureQueue)
      assert.equal(q.count, "7", `${where}: the style tap did not count at once`)
      await settle(6)
      q = await page.evaluate(measureQueue)
      assert.equal(q.count, "6", `${where}: the refused style stayed in the deck`)
      assert.equal(q.chips["31261"], undefined, `${where}: the refused card says requested`)
      assert.match(q.note, /Unavailable/, `${where}: the style refusal was not shown`)

      // 5. All 22 favorites at once; the server turns away 31261 among them.
      await page.click("[data-icono-request-add-favorites]")
      q = await page.evaluate(measureQueue)
      assert.equal(q.count, "28", `${where}: the favorites did not count at once`)
      await settle(7)
      q = await page.evaluate(measureQueue)
      assert.equal(q.count, "27", `${where}: the deck after the favorites`)
      assert.match(q.note, /Requested 21; 1 could not be requested/, `${where}: refusal note`)
      assert.equal(q.chips["36978"], "2 requested", `${where}: a favorite's count`)
      assert.equal(q.chips["31261"], undefined, `${where}: the refused favorite says requested`)
      assert.equal(q.cutLabels, 0, `${where}: a style number is cut off (27)`)
      assert.equal(q.metaOverflow, 0, `${where}: a caption line overflows its card (27)`)
      assert.equal(q.chipsOffArt, 0, `${where}: "N requested" leaves its picture (27)`)
      await page.screenshot({ path: shot("refused") })

      // 6. A tap, then the dialog closes before the server answers and opens
      // again: the request is still in the deck.
      await page.click(card(22811))
      await page.keyboard.press("Escape")
      await page.waitForSelector(`${DIALOG}:not([open])`, { state: "attached" })
      await page.click("[data-icono-request-dialog-open]")
      await page.waitForSelector(`${DIALOG}[open]`)
      await page.waitForTimeout(300)
      q = await page.evaluate(measureQueue)
      assert.equal(q.count, "28", `${where}: closing the dialog dropped a request`)
      await settle(8)

      // 7. Reload: the server's open requests rebuild the same deck.
      await page.reload()
      await page.waitForSelector("[data-icono-request-dialog-open]", { timeout: 30_000 })
      await openPicker(page)
      await page.waitForTimeout(800)
      q = await page.evaluate(measureQueue)
      assert.equal(q.count, "28", `${where}: the reload forgot open requests`)
      assert.equal(q.chips["22811"], "2 requested", `${where}: the reload forgot a card's count`)
      await page.screenshot({ path: shot("reloaded") })
      await context.close()
    }
  } finally {
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
    let pagesFailing = false
    const api = createApi([], { failing: () => failing, pagesFailing: () => pagesFailing })
    await routeProduction(context, origin, api)
    await routePicker(context, false)
    await routePortraits(context)
    const page = await context.newPage()
    await page.goto(`${HOST}/gene/TP53`)
    await page.waitForSelector("[data-icono-request-dialog-open]", { timeout: 30_000 })
    await page.click("[data-icono-request-dialog-open]")
    await page.waitForSelector(`${DIALOG}[open]`)

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
    pagesFailing = true
    await page.click("[data-icono-request-retry]")
    await page.waitForSelector("[data-icono-request-card]", { timeout: 15_000 })
    m = await page.evaluate(measurePicker)
    assert.ok(m.visibleCards >= 4, `only ${m.visibleCards} cards after Try again`)

    // 18 again (B-1014): a next page that keeps failing is asked for once plus two
    // retries, not in a loop; the cards already shown stay.
    await page.click("[data-icono-request-view='all']")
    await page.$eval("[data-icono-request-browse]", (el) => el.scrollTo(0, el.scrollHeight))
    await page.waitForTimeout(5_000)
    assert.equal(api.pageCalls(), 3, `a failing page was asked ${api.pageCalls()} times`)
    m = await page.evaluate(measurePicker)
    assert.ok(m.visibleCards >= 4, "the failed page cleared the grid")
    await context.close()
  } finally {
    server.close()
    await browser.close()
  }
})
