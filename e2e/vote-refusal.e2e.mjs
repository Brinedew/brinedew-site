// B-909 and B-912: a vote the server refuses tells the reader why, puts the tick back, and then
// the box stops asking, checked in a real browser.
//
// The scene: the daily vote budget is spent, a biologist taps the checkmark on a gene page,
// and the server answers 429 with its own sentence and the seconds to the reset. The tick used
// to light, then vanish about 300 ms later, with no message (B-909); and every further tap sent
// another refused request (B-912).
//
// Ways this can fail, written before the code, each asserted below at 1280 and 400 px, with
// the analytics consent prompt showing (every visitor from the EU/EEA/UK, and the prompt is
// bottom-right at the top z-index) and already answered:
//  1. the page shows no message at all after a refused vote;
//  2. the message is not the server's own sentence (it reads "HTTP 429", or is generic);
//  3. the sentence is put into the page as HTML instead of text;
//  4. the message is not announced to a screen reader (role="status"), or it sits outside the
//     viewport, or another element covers it (the consent prompt did), so a reader cannot see
//     it; with the prompt showing the message must sit above it, not on it;
//  5. the tick stays lit after the refusal (the vote the server did not take);
//  6. a refused vote costs more than the one refused request (no second snapshot read);
//  7. further taps still reach the server (B-912): three more taps send nothing;
//  8. a tap on the paused box is silent: each one must put a fresh notice on screen;
//  9. the paused box looks live: nothing dimmed, no aria-disabled, or the buttons are really
//     disabled so the tap never arrives;
// 10. the pause never ends: after the seconds the server named the box must take a tap and the
//     vote must land (tick lit, no notice);
// 11. a 429 with no number unlocks by itself, or survives a reload (a reload is the one thing
//     that must clear it).
//
// Needs `pnpm run build` (public-iconoplasm-edge), an installed Chrome and the live published
// gene object for TP53 (as in production). The measurements and screenshots land in
// artifacts/e2e/ (or E2E_OUT).
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

const PAUSED = "Voting is paused until 00:00 UTC to protect the site's daily database allowance."
const MARKUP_SENTENCE = "<b>Voting</b> is paused until 00:00 UTC."
// Short on purpose: the real value is the seconds to 00:00 UTC, the box treats it the same.
const RESET_SECONDS = 6
const NOTICE = "[data-icono-candidate-delete-notice]"
const BOX = "[data-icono-gene-vote-box]"
const UP = `${BOX} [data-icono-vote-up]`

const SNAPSHOT = { image_upvotes: 3, image_downvotes: 1, image_score: 2, user_vote: 0 }

// `mode.open` flips the mocked server from refusing to taking the vote.
function createApi(requests, mode) {
  return (pathname) => {
    if (pathname === "/api/iconoplasm/votes/snapshot") {
      requests.push("snapshot")
      return { authenticated: true, snapshot: SNAPSHOT }
    }
    if (pathname === "/api/iconoplasm/votes/set") {
      requests.push("set")
      if (mode.open) {
        return {
          ok: true,
          snapshot: { image_upvotes: 4, image_downvotes: 1, image_score: 3, user_vote: 1 },
        }
      }
      return new HttpStatus(429, {
        ok: false,
        code: "VOTE_DAILY_BUDGET_EXHAUSTED",
        error: mode.sentence,
        ...(mode.retryAfterSeconds ? { retry_after_seconds: mode.retryAfterSeconds } : {}),
      })
    }
    return undefined
  }
}

// Runs in the page: the vote button's lit and paused state, how it looks, the consent prompt's
// top edge, and the notice's text, role, box and whatever element sits on top of its centre.
function measure() {
  const box = document.querySelector("[data-icono-gene-vote-box]")
  const up = box?.querySelector("[data-icono-vote-up]")
  const down = box?.querySelector("[data-icono-vote-down]")
  const notice = document.querySelector("[data-icono-candidate-delete-notice]")
  const consent = document.querySelector(".brinedew-analytics-consent")
  const rect = notice?.getBoundingClientRect()
  const top = rect
    ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    : null
  const look = up ? getComputedStyle(up) : null
  return {
    tickLit: up ? up.classList.contains("active") : null,
    upDisabled: up ? up.disabled === true : null,
    downDisabled: down ? down.disabled === true : null,
    paused: box ? box.hasAttribute("data-icono-vote-paused") : null,
    upAria: up ? up.getAttribute("aria-disabled") : null,
    downAria: down ? down.getAttribute("aria-disabled") : null,
    upOpacity: look ? Number(look.opacity) : null,
    upCursor: look ? look.cursor : null,
    consentTop: consent ? consent.getBoundingClientRect().top : null,
    notice: notice
      ? {
          text: notice.textContent,
          role: notice.getAttribute("role"),
          childElements: notice.children.length,
          box: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
          viewport: { width: innerWidth, height: innerHeight },
          topmostIsNotice: top === notice || notice.contains(top),
          coveredBy: top
            ? `${top.tagName.toLowerCase()}.${String(top.className).slice(0, 80)}`
            : null,
        }
      : null,
  }
}

// The notice fades in over 0.18 s; measure and photograph it once that has finished.
function animationsFinished(page) {
  return page.evaluate((selector) => {
    const notice = document.querySelector(selector)
    return Promise.all(notice.getAnimations().map((animation) => animation.finished))
  }, NOTICE)
}

async function openGenePage(browser, origin, { width, height }, requests, mode, consent) {
  const context = await browser.newContext({ viewport: { width, height } })
  await routeProduction(context, origin, createApi(requests, mode))
  if (consent === "answered") {
    await context.addCookies([
      {
        name: "brinedew_analytics_consent",
        value: "declined",
        domain: "iconoplasm.brinedew.bio",
        path: "/",
        secure: true,
        sameSite: "Lax",
      },
    ])
  }
  const page = await context.newPage()
  await page.goto(`${HOST}/gene/TP53`)
  const up = page.locator(UP).filter({ visible: true }).first()
  await up.waitFor({ timeout: 45_000 })
  await up.scrollIntoViewIfNeeded()
  if (consent === "prompt") {
    await page.waitForSelector(".brinedew-analytics-consent", { timeout: 10_000 })
  }
  return { context, page, up }
}

test("a refused vote shows the server's sentence, then the box stops asking until the reset", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const report = []
  try {
    for (const [width, height, label] of VIEWPORTS) {
      for (const consent of ["prompt", "answered"]) {
        const where = `${label}, consent ${consent}`
        const requests = []
        const mode = { open: false, sentence: PAUSED, retryAfterSeconds: RESET_SECONDS }
        const { context, page, up } = await openGenePage(
          browser,
          origin,
          { width, height },
          requests,
          mode,
          consent,
        )
        const live = await page.evaluate(measure)
        assert.equal(live.paused, false, `${where}: a box nobody has refused is not paused`)
        assert.equal(live.upAria, null, `${where}: a live box carries no aria-disabled`)

        await up.click()
        // 1. A message appears.
        await page.waitForSelector(NOTICE, { timeout: 5_000 })
        await animationsFinished(page)
        const first = await page.evaluate(measure)
        await page.screenshot({ path: path.join(OUT, `vote-refusal-${label}-${consent}.png`) })

        // 2. It is the server's sentence.
        assert.equal(
          first.notice.text,
          PAUSED,
          `${where}: the notice must be the server's sentence`,
        )
        // 4. Announced, on screen, uncovered, and above the consent prompt when it shows.
        assert.equal(first.notice.role, "status", `${where}: the notice must be announced`)
        const { box, viewport } = first.notice
        assert.ok(
          box.left >= 0 &&
            box.top >= 0 &&
            box.right <= viewport.width &&
            box.bottom <= viewport.height,
          `${where}: the notice must sit inside the viewport (${JSON.stringify(box)})`,
        )
        assert.equal(
          first.notice.topmostIsNotice,
          true,
          `${where}: ${first.notice.coveredBy} covers the notice`,
        )
        if (consent === "prompt") {
          assert.notEqual(first.consentTop, null, `${where}: the consent prompt is not showing`)
          assert.ok(
            box.bottom <= first.consentTop,
            `${where}: the notice (bottom ${box.bottom}) must sit above the prompt (top ${first.consentTop})`,
          )
        } else {
          assert.equal(first.consentTop, null, `${where}: the prompt must be gone`)
          assert.ok(
            viewport.height - box.bottom < 40,
            `${where}: the notice must sit in the corner, not float (${viewport.height - box.bottom}px up)`,
          )
        }
        // 5. The tick is back.
        assert.equal(first.tickLit, false, `${where}: the refused tick must not stay lit`)
        // 6. One snapshot read to open the deferred box, one refused vote, nothing more.
        assert.deepEqual(requests, ["snapshot", "set"], `${where}: requests after one tap`)

        // 9. The box looks paused, and the buttons still take the tap that shows why.
        assert.equal(first.paused, true, `${where}: the refused box must be marked paused`)
        assert.equal(first.upAria, "true", `${where}: aria-disabled on the approve button`)
        assert.equal(first.downAria, "true", `${where}: aria-disabled on the reject button`)
        assert.equal(first.upDisabled, false, `${where}: a disabled button swallows the tap`)
        assert.equal(first.downDisabled, false, `${where}: a disabled button swallows the tap`)
        assert.ok(
          first.upOpacity < live.upOpacity,
          `${where}: the paused button must look dimmer (${first.upOpacity} vs live ${live.upOpacity})`,
        )
        assert.equal(first.upCursor, "not-allowed", `${where}: the paused cursor`)

        // 7 + 8. Three more taps send nothing and each one brings a fresh notice.
        const tapsAfter = []
        for (let tap = 1; tap <= 3; tap += 1) {
          await page.evaluate((selector) => {
            const old = document.querySelector(selector)
            old.dataset.old = "yes"
          }, NOTICE)
          // `force`: Playwright treats aria-disabled="true" as "not enabled" and would wait out
          // the pause instead of tapping; a reader's finger taps it.
          await up.click({ force: true })
          await page.waitForFunction(
            (selector) => {
              const current = document.querySelector(selector)
              return current !== null && current.dataset.old !== "yes"
            },
            NOTICE,
            { timeout: 3_000 },
          )
          tapsAfter.push(await page.evaluate(measure))
        }
        for (const shown of tapsAfter) {
          assert.equal(
            shown.notice.text,
            PAUSED,
            `${where}: a tap on the paused box shows the sentence again`,
          )
          assert.equal(shown.tickLit, false, `${where}: a tap on the paused box lights nothing`)
        }
        assert.equal(await page.locator(NOTICE).count(), 1, `${where}: notices replace, not stack`)
        assert.deepEqual(requests, ["snapshot", "set"], `${where}: three paused taps send nothing`)
        await animationsFinished(page)
        await page.screenshot({ path: path.join(OUT, `vote-paused-${label}-${consent}.png`) })

        // 10. The pause ends at the reset and the next tap lands.
        mode.open = true
        await page.waitForFunction(
          (selector) => !document.querySelector(selector).hasAttribute("aria-disabled"),
          UP,
          { timeout: (RESET_SECONDS + 5) * 1000 },
        )
        // The button fades back over 160 ms; measure once it has.
        await page.waitForTimeout(300)
        const reopened = await page.evaluate(measure)
        assert.equal(reopened.paused, false, `${where}: the box must be live after the reset`)
        assert.equal(reopened.upOpacity, live.upOpacity, `${where}: back to the live look`)
        await page.evaluate((selector) => document.querySelector(selector)?.remove(), NOTICE)
        await up.click()
        await page.waitForFunction(
          (selector) => document.querySelector(selector).classList.contains("active"),
          UP,
          { timeout: 5_000 },
        )
        const landed = await page.evaluate(measure)
        assert.equal(landed.tickLit, true, `${where}: the vote after the reset must land`)
        assert.equal(landed.notice, null, `${where}: a vote the server took shows no notice`)
        assert.deepEqual(
          requests,
          ["snapshot", "set", "set"],
          `${where}: exactly one request after the reset`,
        )

        report.push({ where, width, height, live, first, tapsAfter, reopened, landed, requests })
        await context.close()
      }
    }
  } finally {
    writeFileSync(path.join(OUT, "vote-refusal.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})

test("a 429 with no number stays paused until the page is reloaded, and the sentence is text", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const requests = []
  const mode = { open: false, sentence: MARKUP_SENTENCE, retryAfterSeconds: 0 }
  const [width, height] = VIEWPORTS[0]
  try {
    const { context, page, up } = await openGenePage(
      browser,
      origin,
      { width, height },
      requests,
      mode,
      "answered",
    )
    await up.click()
    await page.waitForSelector(NOTICE, { timeout: 5_000 })
    await animationsFinished(page)
    const first = await page.evaluate(measure)
    // 3. The server's sentence has markup in it; the page shows it as text.
    assert.equal(first.notice.text, MARKUP_SENTENCE)
    assert.equal(first.notice.childElements, 0, "the sentence must be text, not HTML")
    assert.equal(first.paused, true)

    // 11. Past the seconds that would have unlocked it, the box is still paused and sends nothing.
    await page.waitForTimeout((RESET_SECONDS + 2) * 1000)
    assert.equal((await page.evaluate(measure)).paused, true, "no number, no guess")
    await up.click({ force: true })
    await page.waitForTimeout(300)
    assert.deepEqual(requests, ["snapshot", "set"], "a paused tap sends nothing")
    await page.screenshot({ path: path.join(OUT, "vote-paused-no-number.png") })

    // ... and a reload is what clears it: the first tap on the fresh page asks again.
    mode.open = true
    await page.reload()
    const freshUp = page.locator(UP).filter({ visible: true }).first()
    await freshUp.waitFor({ timeout: 45_000 })
    assert.equal((await page.evaluate(measure)).paused, false, "a reload clears the pause")
    await freshUp.click()
    await page.waitForFunction(
      (selector) => document.querySelector(selector).classList.contains("active"),
      UP,
      { timeout: 5_000 },
    )
    assert.equal(requests.filter((call) => call === "set").length, 2)
    await context.close()
  } finally {
    server.close()
    await browser.close()
  }
})
