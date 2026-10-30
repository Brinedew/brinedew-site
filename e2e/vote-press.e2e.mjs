// A press on a vote box means what the box shows when the reader presses it.
//
// The scene, 2026-10-30: TP53's caretaker opened the gene page. Their FIT of
// Oct 21 had put the armoured portrait on the card, but the page never loads a
// reader's own votes, so the box showed no vote. They pressed FIT. The press
// fetched their stored vote first, found FIT, took it back, and a portrait they
// had flagged MISFIT in June replaced the one they had just approved.
//
// Ways this can fail, written before the check, each asserted at 1280 and 400 px:
// 1. FIT pressed on an unmarked box sends anything but vote_value 1 (the bug sent 0).
// 2. The press reads the reader's stored vote first (a /votes/snapshot request).
// 3. FIT is not lit after the server answers, or another portrait takes the card.
// 4. FIT pressed again, on the box that now shows FIT, doesn't take it back (vote_value 0).
// 5. MISFIT pressed on an unmarked box sends anything but -1.
//
// What is real: the built site, TP53's published gene object, Chrome. The vote
// routes are mocked at /api/*: the reader's stored vote on the lead portrait is
// FIT, as the caretaker's was. Screenshots land in artifacts/e2e.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, VIEWPORTS, launchChrome, routeProduction, startSite } from "./harness.mjs"

const BOX = "[data-icono-gene-vote-box]"
const UP = `${BOX} [data-icono-vote-up]`
const DOWN = `${BOX} [data-icono-vote-down]`

// The server's side: the reader's stored vote on every portrait starts at FIT.
// A set answers with the tally that vote leaves, as /votes/set does.
function createApi(calls) {
  const stored = new Map()
  return (pathname, request) => {
    if (pathname === "/api/iconoplasm/votes/snapshot") {
      calls.push({ route: "snapshot" })
      return { authenticated: true, snapshot: tally(1) }
    }
    if (pathname === "/api/iconoplasm/votes/set") {
      const body = JSON.parse(request.postData() || "{}")
      calls.push({ route: "set", asset: body.asset_sha256, vote: body.vote_value })
      stored.set(body.asset_sha256, body.vote_value)
      return {
        ok: true,
        asset_sha256: body.asset_sha256,
        snapshot: tally(body.vote_value),
      }
    }
    return undefined
  }
}

// Two other readers said FIT; the reader's own vote comes on top.
function tally(userVote) {
  const up = 2 + (userVote === 1 ? 1 : 0)
  const down = userVote === -1 ? 1 : 0
  return { image_upvotes: up, image_downvotes: down, image_score: up - down, user_vote: userVote }
}

// Runs in the page: the lead card's portrait and what its visible vote box shows.
function leadVote() {
  const boxes = [...document.querySelectorAll("[data-icono-gene-vote-box]")]
  const box = boxes.find((el) => el.getClientRects().length) || boxes[0]
  return {
    asset: box?.getAttribute("data-icono-gene-vote-box") || "",
    fit: !!box?.querySelector("[data-icono-vote-up]")?.classList.contains("active"),
    misfit: !!box?.querySelector("[data-icono-vote-down]")?.classList.contains("active"),
  }
}

async function openTP53(browser, origin, width, height, calls) {
  const context = await browser.newContext({ viewport: { width, height } })
  await routeProduction(context, origin, createApi(calls))
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error.message)))
  await page.goto(`${HOST}/gene/TP53`)
  const up = page.locator(UP).filter({ visible: true }).first()
  const down = page.locator(DOWN).filter({ visible: true }).first()
  await up.waitFor({ timeout: 45_000 })
  await up.evaluate((element) => element.scrollIntoView({ block: "center" }))
  return { context, page, up, down, errors }
}

// Waits until the server has answered `count` sets and the box has settled.
async function answered(page, calls, count) {
  await page.waitForFunction(
    (selector) => {
      const box = [...document.querySelectorAll(selector)].find((el) => el.getClientRects().length)
      return box && !box.querySelector("[data-icono-vote-pending]")
    },
    BOX,
    { timeout: 10_000 },
  )
  assert.equal(calls.filter((call) => call.route === "set").length, count)
}

test("a vote press means what the box shows, not the reader's unseen stored vote", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const [width, height, label] of VIEWPORTS) {
      const calls = []
      const { context, page, up, down, errors } = await openTP53(
        browser,
        origin,
        width,
        height,
        calls,
      )
      const before = await page.evaluate(leadVote)
      assert.ok(before.asset, `${label}: no lead vote box`)
      assert.equal(before.fit, false, `${label}: a fresh page shows the reader no vote`)

      // 1, 2, 3.
      await up.click()
      await answered(page, calls, 1)
      assert.deepEqual(
        calls,
        [{ route: "set", asset: before.asset, vote: 1 }],
        `${label}: FIT on an unmarked box sets FIT and reads nothing first`,
      )
      const afterFit = await page.evaluate(leadVote)
      assert.equal(afterFit.fit, true, `${label}: FIT is lit after the answer`)
      assert.equal(afterFit.asset, before.asset, `${label}: the same portrait keeps the card`)
      await page.screenshot({ path: path.join(OUT, `vote-press-${label}-fit.png`) })

      // 4.
      await up.click()
      await answered(page, calls, 2)
      assert.deepEqual(calls[1], { route: "set", asset: before.asset, vote: 0 }, label)
      assert.equal((await page.evaluate(leadVote)).fit, false, `${label}: FIT taken back`)
      assert.deepEqual(errors, [], label)
      await context.close()

      // 5. A fresh page again: MISFIT on an unmarked box.
      const misfitCalls = []
      const second = await openTP53(browser, origin, width, height, misfitCalls)
      await second.down.click()
      await answered(second.page, misfitCalls, 1)
      assert.deepEqual(
        misfitCalls,
        [{ route: "set", asset: before.asset, vote: -1 }],
        `${label}: MISFIT on an unmarked box sets MISFIT`,
      )
      assert.equal((await second.page.evaluate(leadVote)).misfit, true, label)
      assert.deepEqual(second.errors, [], label)
      await second.context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})
