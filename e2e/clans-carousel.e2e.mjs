// A clan's member reel is the gene page's sideways strip filled with the
// genes' blots: the portrait with its full name and symbol painted into the
// image, all members in the page at once. The reader drags, wheels or keys
// through the whole clan; no arrow loads a next page.
//
// Ways this can fail, written before the check:
// 1. The reel shows an HTML caption over a bare portrait instead of the blot.
// 2. Only the four-member preview is present, and the reader has to press an
//    arrow to see the rest.
// 3. The full clan arrives but the strip does not initialise, so drag reaches
//    only the first screenful.
// 4. An arrow or a drag asks the server for members again.
// 5. The strip runs past the page on a phone, or a frame is too narrow to read
//    the painted blot label.
// 6. The last member is missing or the count is wrong.
//
// What is real: the built site, Embla, Chrome, the blot files. The signed-in
// session and the two clan API answers are fixtures; a clan needs a sign-in,
// so CI cannot read the owner's own list.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, VIEWPORTS, launchChrome, routeProduction, startSite } from "./harness.mjs"

const CLAN = "TPR"
const SECOND = "RING"
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
const member = (symbol, i) => ({
  symbol,
  full_name: NAMES[i],
  has_portrait: true,
  blot_url: `${HOST}/blot/${encodeURIComponent(symbol)}.webp`,
})
const MEMBERS = SYMBOLS.map(member)
const SECOND_MEMBERS = SYMBOLS.slice(8, 12).map(member)
const PAGE_SIZE = 4
const TOTAL = MEMBERS.length
const SECOND_TOTAL = SECOND_MEMBERS.length

let allRequests = new Map()

function clan(clanName, members) {
  return {
    state: "revealed",
    clan: clanName,
    accession: clanName === CLAN ? "CL0020" : "CL0229",
    pfam_url: "https://www.ebi.ac.uk/interpro/",
    aesthetic: clanName === CLAN ? "Movida Madrileña" : "Cholo",
    aesthetic_url: "https://aesthetics.fandom.com/",
    discovered_count: members.length,
    members: members.slice(0, PAGE_SIZE),
  }
}

function overview() {
  return {
    ok: true,
    authenticated: true,
    total_clans: 2,
    discovered_clan_count: 2,
    sealed_count: 0,
    clans: [clan(CLAN, MEMBERS), clan(SECOND, SECOND_MEMBERS)],
  }
}

function membersFor(clanName) {
  return clanName === SECOND ? SECOND_MEMBERS : MEMBERS
}

function clanApi() {
  return (pathname, request) => {
    if (pathname === "/api/iconoplasm/clans") return overview()
    const match = pathname.match(/^\/api\/iconoplasm\/clans\/([^/]+)\/members$/)
    if (!match) return
    const clanName = decodeURIComponent(match[1])
    const url = new URL(request.url())
    const all = url.searchParams.get("all") === "1"
    const members = membersFor(clanName)
    const page = Math.max(0, Number(url.searchParams.get("page") || 0) || 0)
    if (all) allRequests.set(clanName, (allRequests.get(clanName) || 0) + 1)
    return {
      ok: true,
      authenticated: true,
      clan: clanName,
      members: all ? members : members.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE),
      page: all ? 0 : page,
      page_size: all ? members.length : PAGE_SIZE,
      total_members: members.length,
      total_pages: all ? 1 : Math.max(1, Math.ceil(members.length / PAGE_SIZE)),
    }
  }
}

function readClan(clanName) {
  const card = document.querySelector(`.icono-clan[data-clan="${clanName}"]`)
  if (!card) return null
  const section = card.querySelector(".icono-clan-reel")
  const viewport = section.querySelector("[data-icono-strip-viewport]")
  const track = section.querySelector("[data-icono-clan-track]")
  const frames = [...track.querySelectorAll(".icono-clan-blot")]
  const viewBox = viewport.getBoundingClientRect()
  return {
    hydrated: card.getAttribute("data-icono-clan-hydrated") === "1",
    ready: section.classList.contains("is-strip-ready"),
    frames: frames.length,
    foot: card.querySelector("[data-icono-clan-foot]")?.textContent.trim() || "",
    fakeCaptions: card.querySelectorAll(
      ".icono-image-only-name, .icono-image-only-symbol, .icono-label-name, .icono-label-symbol",
    ).length,
    imgSources: frames.map((frame) => frame.querySelector("img")?.getAttribute("src") || ""),
    frameTags: frames.map((frame) => frame.tagName),
    pageCounter: /page\s+\d+\s+of/i.test(card.textContent),
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
  }
}

function showsFrame(state, index) {
  const box = state.boxes[index]
  const view = state.viewport
  return !!box && box.left < view.right - 1 && box.right > view.left + 1
}

async function settle(page, clanName, settled) {
  const deadline = Date.now() + 8_000
  let state = await page.evaluate(readClan, clanName)
  while (!settled(state) && Date.now() < deadline) {
    await page.waitForTimeout(100)
    state = await page.evaluate(readClan, clanName)
  }
  return state
}

function trackOffset(clanName) {
  const card = document.querySelector(`.icono-clan[data-clan="${clanName}"]`)
  const track = card.querySelector(".icono-clan-track")
  return new DOMMatrixReadOnly(getComputedStyle(track).transform).m41
}

test("clan members: the whole clan is one strip of blots the reader can drag", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const [width, height, name] of VIEWPORTS) {
      allRequests = new Map()
      const context = await browser.newContext({
        viewport: { width, height },
        colorScheme: "dark",
      })
      await routeProduction(context, origin, clanApi())
      // The blots are Worker routes on the production host, not files in the
      // built static site. Let the image requests reach the real route so the
      // screenshots show the painted blot, not the SPA shell.
      await context.route(`${HOST}/blot/**`, (route) => route.continue())
      const page = await context.newPage()
      await page.goto(`${HOST}/clans`)
      await page.waitForSelector(`.icono-clan[data-clan="${CLAN}"][data-icono-clan-hydrated="1"]`, {
        timeout: 30_000,
      })
      await page.waitForSelector(
        `.icono-clan[data-clan="${CLAN}"] .icono-clan-reel.is-strip-ready`,
        { timeout: 30_000 },
      )

      // 1, 2 and 6: every member is already in one row of blots.
      let state = await settle(page, CLAN, (state) => state.frames === TOTAL)
      assert.equal(state.frames, TOTAL, `${name}: only ${state.frames} of ${TOTAL} members`)
      assert.equal(state.foot, `${TOTAL} recorded`, `${name}: the count is wrong`)
      assert.equal(state.pageCounter, false, `${name}: the page counter is back`)
      assert.equal(state.fakeCaptions, 0, `${name}: an HTML caption is over the blot`)
      assert.ok(state.oneRow, `${name}: the blots wrap into a grid`)
      assert.deepEqual(
        state.frameTags,
        Array(TOTAL).fill("A"),
        `${name}: a frame is not a gene link`,
      )
      for (let index = 0; index < TOTAL; index += 1) {
        assert.match(
          state.imgSources[index],
          new RegExp(`/blot/${SYMBOLS[index]}\\.webp$`),
          `${name}: frame ${index} is not ${SYMBOLS[index]}'s blot`,
        )
      }
      assert.equal(allRequests.get(CLAN), 1, `${name}: the clan was not loaded in one request`)
      assert.ok(
        state.pageOverflow <= 2,
        `${name}: the strip runs ${state.pageOverflow} px past the page`,
      )
      assert.ok(state.trackWidth > state.viewport.width + 4, `${name}: the strip does not peek`)
      assert.ok(state.prevDisabled, `${name}: Previous is live at the start`)
      assert.ok(!state.nextDisabled, `${name}: Next is disabled on a full strip`)
      if (name === "phone") {
        const first = state.boxes[0]
        assert.ok(
          first.width >= state.viewport.width * 0.55,
          `${name}: the first blot is only ${Math.round(first.width)} px wide`,
        )
        assert.ok(
          state.boxes[1].left < state.viewport.right && state.boxes[1].left > first.right,
          `${name}: the next blot does not peek`,
        )
      }
      await page.screenshot({ path: path.join(OUT, `clans-blots-${name}.png`), fullPage: false })

      // 3: a drag reaches members far past the four-member preview, with no
      // second request.
      const box = await page
        .locator(`.icono-clan[data-clan="${CLAN}"] [data-icono-strip-viewport]`)
        .boundingBox()
      const y = box.y + Math.min(box.height / 2, 120)
      const x0 = box.x + box.width * 0.8
      await page.mouse.move(x0, y)
      await page.mouse.down()
      for (let moved = 0; moved <= 320; moved += 8) {
        await page.mouse.move(x0 - moved, y)
        await page.waitForTimeout(15)
      }
      await page.waitForTimeout(300)
      const held = await page.evaluate(trackOffset, CLAN)
      await page.mouse.up()
      await page.waitForTimeout(1200)
      const rested = await page.evaluate(trackOffset, CLAN)
      assert.ok(held < -100, `${name}: the drag moved the strip only ${Math.round(held)} px`)
      assert.ok(
        Math.abs(rested - held) <= 2,
        `${name}: the strip moved from ${held} to ${rested} px after release`,
      )
      state = await page.evaluate(readClan, CLAN)
      assert.ok(
        state.boxes.some((_, index) => index > 0 && showsFrame(state, index)),
        `${name}: the drag never moved the strip to another member`,
      )
      assert.equal(allRequests.get(CLAN), 1, `${name}: dragging asked for members again`)

      // 4: the arrows page within the loaded strip and never fetch.
      const beforeArrow = await page.evaluate(trackOffset, CLAN)
      await page.click(`.icono-clan[data-clan="${CLAN}"] [data-icono-strip-next]`)
      await page.waitForTimeout(700)
      const afterArrow = await page.evaluate(trackOffset, CLAN)
      assert.ok(
        Math.abs(afterArrow - beforeArrow) > 4,
        `${name}: the Next arrow did not move the strip`,
      )
      assert.equal(allRequests.get(CLAN), 1, `${name}: the Next arrow loaded another page`)
      state = await page.evaluate(readClan, CLAN)
      assert.equal(state.frames, TOTAL, `${name}: the Next arrow changed the frame count`)

      // The second clan has its own full strip and is untouched by the first.
      await page.evaluate(() =>
        document
          .querySelector(`.icono-clan[data-clan="RING"]`)
          ?.scrollIntoView({ block: "center" }),
      )
      await page.waitForSelector(
        `.icono-clan[data-clan="${SECOND}"][data-icono-clan-hydrated="1"]`,
        { timeout: 30_000 },
      )
      const second = await settle(page, SECOND, (state) => state.frames === SECOND_TOTAL)
      assert.equal(second.frames, SECOND_TOTAL, `${name}: the second clan is incomplete`)
      assert.equal(second.foot, `${SECOND_TOTAL} recorded`, `${name}: the second count is wrong`)
      assert.equal(allRequests.get(SECOND), 1, `${name}: the second clan was not loaded once`)

      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})
