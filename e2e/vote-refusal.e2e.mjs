// B-909: a vote the server refuses tells the reader why, checked in a real browser.
//
// The scene: the daily vote budget is spent, a biologist taps the checkmark on a gene page,
// and the server answers 429 with its own sentence. The tick used to light, then vanish
// about 300 ms later, with no message.
//
// Ways this can fail, written before the code, each asserted below at 1280 and 400 px, with
// the analytics consent prompt showing (every visitor from the EU/EEA/UK, and the prompt is
// bottom-right at the top z-index) and already answered:
// 1. the page shows no message at all after a refused vote;
// 2. the message is not the server's own sentence (it reads "HTTP 429", or is generic);
// 3. the sentence is put into the page as HTML instead of text;
// 4. the message is not announced to a screen reader (role="status"), or it sits outside the
//    viewport, or another element covers it (the consent prompt did), so a reader cannot see
//    it; with the prompt showing the message must sit above it, not on it;
// 5. the tick stays lit after the refusal (the vote the server did not take);
// 6. the reader cannot tap again afterwards (buttons stay disabled), or the second refusal
//    does not replace the first notice with its own sentence;
// 7. a refused vote costs more than the one refused request (no second snapshot read).
//
// Needs `pnpm run build` (public-iconoplasm-edge), an installed Chrome and the live published
// gene object for TP53 (as in production). The measurements and screenshots land in
// artifacts/e2e/.
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
const NOTICE = "[data-icono-candidate-delete-notice]"
const UP = "[data-icono-gene-vote-box] [data-icono-vote-up]"

function createApi(votes) {
  return (pathname) => {
    if (pathname === "/api/iconoplasm/votes/snapshot") {
      votes.push("snapshot")
      return {
        authenticated: true,
        snapshot: { image_upvotes: 3, image_downvotes: 1, image_score: 2, user_vote: 0 },
      }
    }
    if (pathname === "/api/iconoplasm/votes/set") {
      votes.push("set")
      const sentence =
        votes.filter((call) => call === "set").length === 1 ? PAUSED : MARKUP_SENTENCE
      return new HttpStatus(429, {
        ok: false,
        code: "VOTE_DAILY_BUDGET_EXHAUSTED",
        error: sentence,
      })
    }
    return undefined
  }
}

// Runs in the page: the vote button's lit state, the consent prompt's top edge, and the
// notice's text, role, box and whatever element sits on top of its centre.
function measure() {
  const up = document.querySelector("[data-icono-gene-vote-box] [data-icono-vote-up]")
  const notice = document.querySelector("[data-icono-candidate-delete-notice]")
  const consent = document.querySelector(".brinedew-analytics-consent")
  const box = notice?.getBoundingClientRect()
  const top = box
    ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
    : null
  return {
    tickLit: up ? up.classList.contains("active") : null,
    upDisabled: up ? up.disabled === true : null,
    consentTop: consent ? consent.getBoundingClientRect().top : null,
    notice: notice
      ? {
          text: notice.textContent,
          role: notice.getAttribute("role"),
          childElements: notice.children.length,
          box: { left: box.left, right: box.right, top: box.top, bottom: box.bottom },
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

test("a refused vote shows the server's sentence and puts the tick back", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const report = []
  try {
    for (const [width, height, label] of VIEWPORTS) {
      for (const consent of ["prompt", "answered"]) {
        const where = `${label}, consent ${consent}`
        const votes = []
        const context = await browser.newContext({ viewport: { width, height } })
        await routeProduction(context, origin, createApi(votes))
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
        // 6. The reader can tap again.
        assert.equal(first.upDisabled, false, `${where}: the buttons must stay live`)

        // 7. One snapshot read to open the deferred box, one refused vote, nothing more.
        assert.deepEqual(votes, ["snapshot", "set"], `${where}: requests after one tap`)

        // 3 + 6. A second tap gets a new sentence, shown as text, replacing the first notice.
        await up.click()
        await page.waitForFunction(
          (sentence) =>
            document.querySelector("[data-icono-candidate-delete-notice]")?.textContent ===
            sentence,
          MARKUP_SENTENCE,
          { timeout: 5_000 },
        )
        await animationsFinished(page)
        const second = await page.evaluate(measure)
        assert.equal(
          second.notice.childElements,
          0,
          `${where}: the sentence must be text, not HTML`,
        )
        assert.equal(
          await page.locator(NOTICE).count(),
          1,
          `${where}: a new refusal replaces the notice instead of stacking`,
        )
        assert.equal(second.tickLit, false, `${where}: the second refused tick must not stay lit`)
        assert.deepEqual(votes, ["snapshot", "set", "set"], `${where}: requests after two taps`)

        report.push({ where, width, height, first, second, requests: votes })
        await context.close()
      }
    }
  } finally {
    writeFileSync(path.join(OUT, "vote-refusal.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})
