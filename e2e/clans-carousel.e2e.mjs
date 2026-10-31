// The clans page's member reel is the gene page's sideways strip
// (candidate-strip.js), not a 2x2 page of four tiles that swaps wholesale.
// A clan's first page is four members; reaching the end of the loaded frames
// fetches the next four.
//
// Ways this can fail, written before the check:
// 1. The reel stays a 2x2 grid, so a phone shows four 120 px tiles with cut
//    captions and a page counter.
// 2. A clan with more members never fetches them, or the arrows disappear
//    without Embla.
// 3. A fetch appends the next page but jumps the reader back to the first
//    frame, or leaves the new frames out of view.
// 4. A failed page read hides the error and never offers a retry.
// 5. The strip runs past the page on a phone, so the page scrolls sideways.
// 6. The first phone frame is too narrow to read (the old 2x2 showed two).
//
// What is real: the built site, Embla, Chrome, the portrait files. The
// signed-in session and the two clan API answers are fixtures; a clan needs a
// sign-in to exist, so CI cannot read the owner's own list.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
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

const CLAN = "TPR"
const IMAGES = [
  "https://img.brinedew.bio/portraits/v1/00/0075996be28f1ab13aa12caa3b40e12d2ff6b72d36100d9bc1e1544332fd00a9/medium.webp",
  "https://img.brinedew.bio/portraits/v1/84/84fbfc428e095faab0466fce4db3ff5f4ad39795ed9994fa9eaed545a4359564/medium.webp",
  "https://img.brinedew.bio/portraits/v1/33/333e5d23383ef3c51b872920d3fcac33c0ae7fddb89f1f594a95973875ab632a/medium.webp",
  "https://img.brinedew.bio/portraits/v1/7a/7ab8c81fab910280de271bbcb878289b37a2350146b6a7686df58e5fd01d831f/medium.webp",
]
const SYMBOLS = [
  "CTNNB1",
  "VIPAS39",
  "APC",
  "DOHH",
  "RNF224",
  "MNAT1",
  "RNF168",
  "RNF212",
  "TP53",
  "BRCA1",
  "PTEN",
  "KRAS",
]
const NAMES = [
  "catenin beta 1",
  "VPS33B interacting protein, apical-basolateral polarity regulator",
  "APC regulator of Wnt signaling pathway",
  "deoxyhypusine hydroxylase",
  "ring finger protein 224",
  "MNAT1 component of CDK activating kinase",
  "ring finger protein 168",
  "ring finger protein 212",
  "tumor protein p53",
  "BRCA1 DNA repair associated",
  "phosphatase and tensin homolog",
  "KRAS proto-oncogene",
]
const MEMBERS = SYMBOLS.map((symbol, i) => ({
  symbol,
  full_name: NAMES[i],
  has_portrait: true,
  medium_url: IMAGES[i % IMAGES.length],
}))
const PAGE_SIZE = 4
const TOTAL = MEMBERS.length
const TOTAL_PAGES = Math.ceil(TOTAL / PAGE_SIZE)

function overview() {
  return {
    ok: true,
    authenticated: true,
    total_clans: 1,
    discovered_clan_count: 1,
    sealed_count: 0,
    clans: [
      {
        clan: CLAN,
        accession: "CL0020",
        pfam_url: "https://www.ebi.ac.uk/interpro/set/pfam/CL0020/",
        aesthetic: "Movida Madrileña",
        aesthetic_url: "https://aesthetics.fandom.com/wiki/Movida_Madrile%C3%B1a",
        discovered_count: TOTAL,
        members: MEMBERS.slice(0, PAGE_SIZE),
      },
    ],
  }
}

function membersPage(request) {
  const page = Math.max(0, Number(new URL(request.url()).searchParams.get("page") || 0) || 0)
  return {
    ok: true,
    authenticated: true,
    clan: CLAN,
    members: MEMBERS.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
    page,
    page_size: PAGE_SIZE,
    total_members: TOTAL,
    total_pages: TOTAL_PAGES,
  }
}

function clanApi(failPage = () => false) {
  return (pathname, request) => {
    if (pathname === "/api/iconoplasm/clans") return overview()
    if (pathname === `/api/iconoplasm/clans/${CLAN}/members`) {
      const page = Number(new URL(request.url()).searchParams.get("page") || 0) || 0
      if (failPage(page)) return new HttpStatus(503, { ok: false, error: "Try later" })
      return membersPage(request)
    }
  }
}

function readClan(clan) {
  const card = document.querySelector(`.icono-clan[data-clan="${clan}"]`)
  const section = card.querySelector(".icono-clan-reel")
  const viewport = section.querySelector("[data-icono-strip-viewport]")
  const track = section.querySelector("[data-icono-clan-track]")
  const frames = [...track.children]
  const viewBox = viewport.getBoundingClientRect()
  const focused = document.activeElement?.closest?.(".icono-clan-tile")
  return {
    ready: section.classList.contains("is-strip-ready"),
    frames: frames.length,
    foot: card.querySelector("[data-icono-clan-foot]")?.textContent.trim() || "",
    nextDisabled: !!section.querySelector("[data-icono-strip-next]")?.disabled,
    prevDisabled: !!section.querySelector("[data-icono-strip-prev]")?.disabled,
    navHidden: !!section.querySelector("[data-icono-strip-nav]")?.hidden,
    pageOverflow: card.getBoundingClientRect().right - document.documentElement.clientWidth,
    viewport: viewBox.toJSON(),
    trackWidth: track.scrollWidth,
    oneRow:
      frames.length > 0 &&
      frames.every(
        (frame) =>
          Math.abs(frame.getBoundingClientRect().top - frames[0].getBoundingClientRect().top) <= 2,
      ),
    boxes: frames.map((frame) => frame.getBoundingClientRect().toJSON()),
    focusIndex: focused ? frames.indexOf(focused) : -1,
  }
}

function showsFrame(state, index) {
  const box = state.boxes[index]
  const view = state.viewport
  return !!box && box.left < view.right - 1 && box.right > view.left + 1
}

async function settle(page, settled) {
  const deadline = Date.now() + 5_000
  let state = await page.evaluate(readClan, CLAN)
  while (!settled(state) && Date.now() < deadline) {
    await page.waitForTimeout(100)
    state = await page.evaluate(readClan, CLAN)
  }
  return state
}

function trackOffset() {
  const track = document.querySelector(".icono-clan-track")
  return new DOMMatrixReadOnly(getComputedStyle(track).transform).m41
}

async function openClan(context) {
  const page = await context.newPage()
  await page.goto(`${HOST}/clans`)
  await page.waitForSelector(`.icono-clan[data-clan="${CLAN}"]`, { timeout: 30_000 })
  await page.waitForSelector(`.icono-clan[data-clan="${CLAN}"] .icono-clan-reel`, {
    timeout: 30_000,
  })
  await page.waitForTimeout(700)
  return page
}

test("clan members: one sideways strip pages in the next members and keeps a phone width", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const [width, height, name] of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: "dark",
      })
      await routeProduction(context, origin, clanApi())
      const page = await openClan(context)
      await page.waitForSelector(
        `.icono-clan[data-clan="${CLAN}"] .icono-clan-reel.is-strip-ready`,
        {
          timeout: 30_000,
        },
      )
      await page.waitForTimeout(500)

      // 1 and 6: one row, the first frame readable and the next peeking.
      let state = await page.evaluate(readClan, CLAN)
      assert.equal(state.frames, PAGE_SIZE, `${name}: first page is not four members`)
      assert.ok(state.oneRow, `${name}: members wrap into a grid instead of one row`)
      assert.ok(state.trackWidth > state.viewport.width + 4, `${name}: the strip does not peek`)
      assert.ok(
        state.pageOverflow <= 0,
        `${name}: the strip runs ${state.pageOverflow} px past the page`,
      )
      assert.equal(state.foot, `${TOTAL} recorded`, `${name}: the page counter is back`)
      assert.ok(state.prevDisabled, `${name}: Previous is live at the start`)
      assert.ok(!state.nextDisabled, `${name}: Next is disabled while more members exist`)
      assert.ok(!state.navHidden, `${name}: the arrows are hidden`)
      if (name === "phone") {
        const first = state.boxes[0]
        assert.ok(
          first.width >= state.viewport.width * 0.55,
          `${name}: the first member is only ${Math.round(first.width)} px wide`,
        )
        assert.ok(
          state.boxes[1].left < state.viewport.right && state.boxes[1].left > first.right,
          `${name}: the next member does not peek`,
        )
      }
      await page.screenshot({ path: path.join(OUT, `clans-carousel-${name}.png`), fullPage: false })

      // 2 and 3: End reaches the last loaded frame; Next fetches the next four
      // and lands on the first new one.
      await page.focus(`.icono-clan[data-clan="${CLAN}"] .icono-clan-track .icono-image-only-link`)
      await page.keyboard.press("End")
      state = await settle(page, (state) => state.focusIndex === PAGE_SIZE - 1)
      assert.equal(state.focusIndex, PAGE_SIZE - 1, `${name}: End missed the last loaded frame`)
      await page.click(`.icono-clan[data-clan="${CLAN}"] [data-icono-strip-next]`)
      state = await settle(page, (state) => state.frames === PAGE_SIZE * 2)
      assert.equal(state.frames, PAGE_SIZE * 2, `${name}: Next did not append the next page`)
      assert.equal(state.foot, `${TOTAL} recorded`, `${name}: the foot changed while loading`)
      assert.ok(
        showsFrame(state, PAGE_SIZE),
        `${name}: the first new member is not in view after the append`,
      )
      assert.ok(!state.nextDisabled, `${name}: Next is disabled while page 2 is unread`)

      // The last page appends and the end of the strip disables Next.
      await page.keyboard.press("End")
      await settle(page, (state) => state.focusIndex === state.frames - 1)
      await page.click(`.icono-clan[data-clan="${CLAN}"] [data-icono-strip-next]`)
      state = await settle(page, (state) => state.frames === TOTAL)
      assert.equal(state.frames, TOTAL, `${name}: the last page did not append`)
      await page.keyboard.press("End")
      state = await settle(page, (state) => state.focusIndex === TOTAL - 1 && state.nextDisabled)
      assert.equal(state.focusIndex, TOTAL - 1, `${name}: End missed the last member`)
      assert.ok(state.nextDisabled, `${name}: Next is still live at the end of the clan`)

      // 5: a drag rests where it was let go, as the gene strip does.
      await page.keyboard.press("Home")
      await settle(page, (state) => state.focusIndex === 0)
      const box = await page
        .locator(`.icono-clan[data-clan="${CLAN}"] [data-icono-strip-viewport]`)
        .boundingBox()
      const y = box.y + Math.min(box.height / 2, 100)
      const x0 = box.x + box.width * 0.75
      await page.mouse.move(x0, y)
      await page.mouse.down()
      for (let moved = 0; moved <= 137; moved += 4) {
        await page.mouse.move(x0 - moved, y)
        await page.waitForTimeout(30)
      }
      await page.waitForTimeout(300)
      const held = await page.evaluate(trackOffset)
      await page.mouse.up()
      await page.waitForTimeout(1500)
      const rested = await page.evaluate(trackOffset)
      assert.ok(held < -100, `${name}: the drag moved the strip only ${Math.round(held)} px`)
      assert.ok(
        Math.abs(rested - held) <= 2,
        `${name}: the strip moved from ${held} to ${rested} px after release`,
      )

      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})

test("clan members: a failed page read says so, and the next press tries again", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      colorScheme: "dark",
    })
    let fail = true
    await routeProduction(
      context,
      origin,
      clanApi((page) => fail && page === 1),
    )
    const page = await openClan(context)
    await page.waitForSelector(`.icono-clan[data-clan="${CLAN}"] .icono-clan-reel.is-strip-ready`, {
      timeout: 30_000,
    })
    await page.focus(`.icono-clan[data-clan="${CLAN}"] .icono-clan-track .icono-image-only-link`)
    await page.keyboard.press("End")
    await settle(page, (state) => state.focusIndex === PAGE_SIZE - 1)
    await page.click(`.icono-clan[data-clan="${CLAN}"] [data-icono-strip-next]`)
    let state = await settle(page, (state) => /Could not load more members/.test(state.foot))
    assert.equal(state.frames, PAGE_SIZE, "a failed read added frames")
    assert.match(state.foot, /Could not load more members\. Try again\./)
    fail = false
    await page.click(`.icono-clan[data-clan="${CLAN}"] [data-icono-strip-next]`)
    state = await settle(page, (state) => state.frames === PAGE_SIZE * 2)
    assert.equal(state.frames, PAGE_SIZE * 2, "the retry did not append the page")
    assert.equal(state.foot, `${TOTAL} recorded`, "the retry did not restore the foot")
    await context.close()
  } finally {
    await browser.close()
    server.close()
  }
})

test("clan members: the arrows still load pages when Embla cannot load", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 860 },
      colorScheme: "dark",
    })
    await routeProduction(context, origin, clanApi())
    await context.route(/vendor\/embla-carousel/, (route) => route.abort())
    const page = await openClan(context)
    await page.waitForSelector(
      `.icono-clan[data-clan="${CLAN}"] .icono-clan-reel[data-icono-strip-fallback]`,
      { timeout: 30_000 },
    )
    let state = await page.evaluate(readClan, CLAN)
    assert.equal(state.ready, false, "Embla was not blocked")
    assert.ok(!state.navHidden, "the arrows hid when Embla failed")
    assert.ok(!state.nextDisabled, "Next disabled while more members exist without Embla")
    await page.click(`.icono-clan[data-clan="${CLAN}"] [data-icono-strip-next]`)
    state = await settle(page, (state) => state.frames === PAGE_SIZE * 2)
    assert.equal(state.frames, PAGE_SIZE * 2, "the native arrows did not append the page")
    await context.close()
  } finally {
    await browser.close()
    server.close()
  }
})

