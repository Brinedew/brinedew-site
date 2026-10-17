// B-1095: a gene's other candidate images sit in one sideways strip, moved by
// Embla Carousel, so the page stays the same height at 3 candidates or 300.
// TP53 is the heaviest real case (71 candidates; its two-column grid made the
// page 17,035 px tall).
//
// Ways this can fail, written before the check:
// 1. The strip falls back to a grid, or Embla never loads: the page grows with
//    the candidate count again.
// 2. The keys overshoot: Right jumps a whole page instead of one frame.
// 3. Focus moves to a frame the strip doesn't bring fully into view, or leaves
//    it off to one side instead of in the middle (owner, 2026-10-17: "the
//    selected picture doesn't really stay in the center").
// 4. End and Home don't reach the ends, or Next stays live at the end.
// 5. Up on a frame does nothing (for a guest it must open the Discord login).
// 6. The strip eats a vertical wheel, so a reader can't scroll past it.
// 7. A tile is too narrow for its footer, so buttons sit on top of each other
//    (the old copy button covered the star on a 402 px phone).
// 8. The "soft rise" leaves a loaded image transparent.
// 9. The page scrolls sideways on a phone.
// 10. A drag springs to a page boundary when the reader lets go, instead of
//     resting where it was dropped (owner, 2026-10-17: "it never really stays
//     in the same place you dragged").
//
// What is real: the built site, TP53's published candidates, Embla, Chrome.
// The reader is an anonymous guest; the signed-in /api/* answers are mocked,
// including the 401 a guest's vote gets. Screenshots land in artifacts/e2e.
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

const SYMBOL = "TP53"
const STRIP = "[data-icono-candidate-strip]"

function readStrip() {
  const section = document.querySelector("[data-icono-candidate-strip]")
  const frames = [...section.querySelectorAll(".icono-candidate-grid > .icono-candidate-card")]
  const focused = document.activeElement?.closest?.(".icono-candidate-card")
  return {
    total: frames.length,
    focusIndex: focused ? frames.indexOf(focused) : -1,
    focusInView: (() => {
      if (!focused) return false
      const viewport = section.querySelector("[data-icono-strip-viewport]").getBoundingClientRect()
      const box = focused.getBoundingClientRect()
      return box.left >= viewport.left - 1 && box.right <= viewport.right + 1
    })(),
    // How far the focused frame's middle sits from the strip's middle.
    offCentre: (() => {
      if (!focused) return null
      const viewport = section.querySelector("[data-icono-strip-viewport]").getBoundingClientRect()
      const box = focused.getBoundingClientRect()
      return box.left + box.width / 2 - (viewport.left + viewport.width / 2)
    })(),
    nextDisabled: !!section.querySelector("[data-icono-strip-next]")?.disabled,
    prevDisabled: !!section.querySelector("[data-icono-strip-prev]")?.disabled,
  }
}

// Embla's scroll animation can take over a second on a slow CI runner. Read the
// strip until `settled(state)` holds or 5 s pass, then return the last reading.
async function settle(page, settled) {
  const deadline = Date.now() + 5_000
  let state = await page.evaluate(readStrip)
  while (!settled(state) && Date.now() < deadline) {
    await page.waitForTimeout(100)
    state = await page.evaluate(readStrip)
  }
  return state
}

function shows(state, index) {
  return state.focusIndex === index && state.focusInView
}

function centred(state, index) {
  return shows(state, index) && Math.abs(state.offCentre) <= 8
}

// The track's sideways offset, which Embla moves with a transform.
function trackOffset() {
  const track = document.querySelector("[data-icono-candidate-strip] .icono-candidate-grid")
  return new DOMMatrixReadOnly(getComputedStyle(track).transform).m41
}

// Every pair of visible controls in a fully shown tile's footer, and any control
// that leaves its tile.
function footerCollisions() {
  const viewport = document.querySelector("[data-icono-strip-viewport]").getBoundingClientRect()
  const problems = []
  for (const card of document.querySelectorAll(".icono-candidate-grid > .icono-candidate-card")) {
    const box = card.getBoundingClientRect()
    if (box.left < viewport.left - 1 || box.right > viewport.right + 1) continue
    const controls = [
      ...card.querySelectorAll(".icono-candidate-footer button, .icono-candidate-footer summary"),
    ]
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 && rect.height > 0)
    for (const { node, rect } of controls) {
      if (rect.left < box.left - 1 || rect.right > box.right + 1) {
        problems.push(`${node.getAttribute("aria-label") || node.className} leaves its tile`)
      }
    }
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i].rect
        const b = controls[j].rect
        const overlap =
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1
        if (overlap) {
          problems.push(
            `${controls[i].node.getAttribute("aria-label")} overlaps ${controls[j].node.getAttribute("aria-label")}`,
          )
        }
      }
    }
  }
  return problems
}

test("candidate strip: TP53's 71 candidates stay one strip that keys, wheel and votes can drive", async (t) => {
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
      // A guest's vote gets the production answer, 401 AUTH_REQUIRED (the
      // harness would otherwise answer every signed-in call with {}).
      await routeProduction(
        context,
        origin,
        (pathname) =>
          pathname === "/api/iconoplasm/votes/set"
            ? new HttpStatus(401, { ok: false, code: "AUTH_REQUIRED" })
            : undefined,
        { session: false },
      )
      const page = await context.newPage()
      await page.goto(`${HOST}/gene/${SYMBOL}`)
      await page.waitForSelector(`${STRIP}.is-strip-ready`, { timeout: 30_000 })
      // Let the first frames load and "develop".
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll("[data-icono-candidate-strip] .icono-candidate-media img")]
            .slice(0, 2)
            .every((img) => img.complete && img.naturalWidth > 0),
        null,
        { timeout: 30_000 },
      )
      await page.waitForTimeout(1200)

      // 1 and 9: the page height no longer depends on the candidate count.
      // The strip itself must end inside the window; the root clips sideways
      // overflow, so scrollWidth alone can't say whether a reader sees a scroll.
      const layout = await page.evaluate(() => ({
        height: document.documentElement.scrollHeight,
        overflow:
          document.querySelector("[data-icono-candidate-strip]").getBoundingClientRect().right -
          document.documentElement.clientWidth,
      }))
      assert.ok(layout.height < 4500, `${name}: page is ${layout.height} px tall`)
      assert.ok(
        layout.overflow <= 0,
        `${name}: the strip runs ${layout.overflow} px past the window`,
      )

      // 7: every fully shown tile holds its own footer.
      assert.deepEqual(await page.evaluate(footerCollisions), [], `${name}: tile footer collides`)

      // 8: loaded images end opaque. They fade in once developed, so read them
      // after the fade: one read mid-fade saw 0.795 (CI, 2026-10-17).
      await page
        .waitForFunction(
          () =>
            [
              ...document.querySelectorAll(
                "[data-icono-candidate-strip] .icono-candidate-media img",
              ),
            ]
              .slice(0, 2)
              .every((img) => getComputedStyle(img).opacity === "1"),
          null,
          { timeout: 5000 },
        )
        .catch(() => {})
      const opacities = await page.$$eval(
        "[data-icono-candidate-strip] .icono-candidate-media img",
        (images) =>
          images
            .slice(0, 2)
            .map((img) => [img.classList.contains("is-developed"), getComputedStyle(img).opacity]),
      )
      assert.deepEqual(opacities, [
        [true, "1"],
        [true, "1"],
      ])

      await page.screenshot({ path: path.join(OUT, `candidate-strip-${name}.png`), fullPage: true })

      // 2 and 3: Right moves one frame at a time and brings it to the middle.
      await page.focus(`${STRIP} .icono-candidate-card:first-child .icono-candidate-media-button`)
      let state = await page.evaluate(readStrip)
      assert.equal(state.total, 71)
      assert.equal(state.focusIndex, 0)
      assert.ok(state.prevDisabled)
      for (let step = 1; step <= 4; step += 1) {
        await page.keyboard.press("ArrowRight")
        state = await settle(page, (state) => centred(state, step))
        assert.equal(
          state.focusIndex,
          step,
          `${name}: Right #${step} landed on ${state.focusIndex}`,
        )
        assert.ok(state.focusInView, `${name}: frame ${step + 1} is focused but not fully in view`)
        assert.ok(
          Math.abs(state.offCentre) <= 8,
          `${name}: frame ${step + 1} sits ${Math.round(state.offCentre)} px off the middle`,
        )
      }
      await page.keyboard.press("ArrowLeft")
      state = await page.evaluate(readStrip)
      assert.equal(state.focusIndex, 3)

      // 4: End and Home reach the ends.
      await page.keyboard.press("End")
      state = await settle(page, (state) => shows(state, 70) && state.nextDisabled)
      assert.equal(state.focusIndex, 70)
      assert.ok(state.focusInView, `${name}: End left the last frame out of view`)
      assert.ok(state.nextDisabled, `${name}: Next is live at the end`)
      await page.keyboard.press("Home")
      state = await settle(page, (state) => shows(state, 0) && state.prevDisabled)
      assert.equal(state.focusIndex, 0)
      assert.ok(state.prevDisabled)

      // 10: a slow drag, held still and let go, rests where it was dropped.
      {
        const box = await page.locator(`${STRIP} [data-icono-strip-viewport]`).boundingBox()
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
        assert.ok(held < -100, `${name}: the drag moved the strip only ${held} px`)
        assert.ok(
          Math.abs(rested - held) <= 2,
          `${name}: the strip moved from ${held} to ${rested} px after the drag was let go`,
        )
        await page.keyboard.press("Home")
        await settle(page, (state) => shows(state, 0) && state.prevDisabled)
      }

      // 5: Up approves the focused frame; a guest is asked to log in.
      await page.keyboard.press("ArrowUp")
      await page.waitForSelector(".icono-vote-login-dialog[open]", { timeout: 5_000 })
      await page.keyboard.press("Escape")
      await page.waitForSelector(".icono-vote-login-dialog", { state: "detached", timeout: 5_000 })

      // 6: a vertical wheel over the strip scrolls the page.
      await page.evaluate(() => {
        const viewport = document.querySelector("[data-icono-strip-viewport]")
        // The strip is the Overview's last part, so the page may end before
        // the strip can reach the top: stop 200 px short of the end, or the
        // wheel has nothing left to scroll. Instant: the site scrolls
        // smoothly, and a scroll still in flight would pass for the wheel's.
        const end = document.documentElement.scrollHeight - window.innerHeight
        window.scrollTo({
          top: Math.min(viewport.getBoundingClientRect().top + window.scrollY - 80, end - 200),
          behavior: "instant",
        })
      })
      await page.waitForTimeout(300)
      const strip = await page.locator(`${STRIP} [data-icono-strip-viewport]`).boundingBox()
      await page.mouse.move(strip.x + strip.width / 2, strip.y + Math.min(strip.height / 2, 200))
      const before = await page.evaluate(() => window.scrollY)
      await page.mouse.wheel(0, 400)
      await page.waitForTimeout(500)
      const after = await page.evaluate(() => window.scrollY)
      assert.ok(after > before, `${name}: the wheel over the strip didn't scroll the page`)

      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})
