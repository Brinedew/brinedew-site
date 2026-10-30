// A signed-in reader sees their own FIT and MISFIT votes when they come back.
//
// The scene, 2026-10-30: TP53's caretaker opened the gene page. Their FIT of
// Oct 21 had put the armoured portrait on the card, but the page drew only the
// public tallies, so the box showed no vote, and they pressed FIT again to give
// it. The press took the vote back (fixed in vote-press.e2e.mjs). The page now
// asks once for the reader's own votes on the gene, whatever its portrait count.
//
// Ways this can fail, written before the check, at 1280 and 400 px:
// 1. The reader's FIT on the lead or MISFIT on a strip portrait isn't lit.
// 2. The page asks more than once, or names portraits instead of the gene, so
//    a gene with 1,000 portraits would cost 10 requests a view.
// 3. A vote that moves the winner rebuilds the card and the strip, and the
//    rebuilt boxes go dark or ask again.
// 4. A guest's page asks at all, or shows a vote this device remembers from a
//    session that has ended.
//
// What is real: the built site, TP53's published gene object (71 candidates),
// Chrome. The vote routes are mocked at /api/*. Screenshots land in artifacts/e2e.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, VIEWPORTS, launchChrome, routeProduction, startSite } from "./harness.mjs"

const LEAD = "[data-icono-gene-vote-box]"
const STRIP_BOX = "[data-icono-candidate-vote-box]"

// The server's side. /votes/mine answers only once the test has read which
// portraits the page shows and named the reader's votes on them.
function createApi(calls, server) {
  return (pathname, request) => {
    if (pathname === "/api/iconoplasm/votes/mine") {
      const body = JSON.parse(request.postData() || "{}")
      calls.push({ route: "mine", symbols: body.symbols, items: body.items })
      return server.ready.then(() => ({
        ok: true,
        authenticated: true,
        votes: [...server.votes].map(([asset, vote]) => ({
          symbol: "TP53",
          asset_sha256: asset,
          vote,
        })),
      }))
    }
    if (pathname === "/api/iconoplasm/votes/snapshot") {
      calls.push({ route: "snapshot" })
      return { authenticated: true, snapshot: { user_vote: 0 } }
    }
    if (pathname === "/api/iconoplasm/votes/set") {
      const body = JSON.parse(request.postData() || "{}")
      calls.push({ route: "set", asset: body.asset_sha256, vote: body.vote_value })
      server.votes.set(body.asset_sha256, body.vote_value)
      const up = 3 + (body.vote_value === 1 ? 1 : 0)
      return {
        ok: true,
        asset_sha256: body.asset_sha256,
        snapshot: {
          image_upvotes: up,
          image_downvotes: 0,
          image_score: up,
          user_vote: body.vote_value,
        },
        // The press puts this portrait on the card, as a vote that tips the tie does.
        winner: { asset_sha256: body.asset_sha256, vote_version: 1e9 },
      }
    }
    return undefined
  }
}

// Runs in the page: each visible vote box's portrait and what it shows.
function readBoxes([lead, strip]) {
  const show = (box) => ({
    fit: !!box.querySelector("[data-icono-vote-up]")?.classList.contains("active"),
    misfit: !!box.querySelector("[data-icono-vote-down]")?.classList.contains("active"),
  })
  const leadBoxes = [...document.querySelectorAll(lead)]
  const leadBox = leadBoxes.find((el) => el.getClientRects().length) || leadBoxes[0]
  const stripVotes = {}
  for (const box of document.querySelectorAll(strip)) {
    stripVotes[box.getAttribute("data-icono-candidate-vote-box")] = show(box)
  }
  return {
    lead: { asset: leadBox?.getAttribute("data-icono-gene-vote-box") || "", ...show(leadBox) },
    strip: stripVotes,
  }
}

async function waitFor(check, label, timeout = 15_000) {
  const end = Date.now() + timeout
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out: ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}

async function openTP53(browser, origin, width, height, api, options) {
  const context = await browser.newContext({ viewport: { width, height } })
  await routeProduction(context, origin, api, options)
  const page = await context.newPage()
  const errors = []
  page.on("pageerror", (error) => errors.push(String(error.message)))
  await page.goto(`${HOST}/gene/TP53`)
  await page.locator(`${LEAD} [data-icono-vote-up]`).filter({ visible: true }).first().waitFor({
    timeout: 45_000,
  })
  await page.locator(STRIP_BOX).first().waitFor({ state: "attached", timeout: 45_000 })
  return { context, page, errors }
}

test("a signed-in reader sees their own votes, asked for once per page", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const [width, height, label] of VIEWPORTS) {
      const calls = []
      let release
      const votes = { votes: new Map(), ready: new Promise((resolve) => (release = resolve)) }
      const { context, page, errors } = await openTP53(
        browser,
        origin,
        width,
        height,
        createApi(calls, votes),
      )
      const before = await page.evaluate(readBoxes, [LEAD, STRIP_BOX])
      const lead = before.lead.asset
      const shown = Object.keys(before.strip)
      assert.ok(lead, `${label}: no lead vote box`)
      assert.ok(shown.length >= 2, `${label}: TP53's strip has fewer than 2 candidates`)
      const [pressed, flagged] = shown.filter((asset) => asset !== lead)

      // 2.
      await waitFor(() => calls.some((call) => call.route === "mine"), `${label}: /votes/mine`)
      const mine = calls.filter((call) => call.route === "mine")
      assert.equal(mine.length, 1, `${label}: one request for the reader's votes`)
      assert.deepEqual(
        { symbols: mine[0].symbols, items: mine[0].items },
        { symbols: ["TP53"], items: undefined },
        `${label}: the request names the gene, not its ${shown.length + 1} portraits`,
      )

      // 1.
      votes.votes.set(lead, 1)
      votes.votes.set(flagged, -1)
      release()
      await page.waitForFunction(
        ([leadSelector, flaggedAsset]) => {
          const box = [...document.querySelectorAll(leadSelector)].find(
            (el) => el.getClientRects().length,
          )
          const flaggedBox = document.querySelector(
            `[data-icono-candidate-vote-box="${flaggedAsset}"]`,
          )
          return (
            box?.querySelector("[data-icono-vote-up]")?.classList.contains("active") &&
            flaggedBox?.querySelector("[data-icono-vote-down]")?.classList.contains("active")
          )
        },
        [LEAD, flagged],
        { timeout: 10_000 },
      )
      const lit = await page.evaluate(readBoxes, [LEAD, STRIP_BOX])
      assert.deepEqual(lit.lead, { asset: lead, fit: true, misfit: false }, label)
      assert.deepEqual(lit.strip[flagged], { fit: false, misfit: true }, label)
      assert.deepEqual(lit.strip[pressed], { fit: false, misfit: false }, label)
      await page.screenshot({ path: path.join(OUT, `reader-votes-${label}-lit.png`) })

      // 3. FIT on a strip portrait puts it on the card.
      const up = page.locator(`[data-icono-candidate-vote-box="${pressed}"] [data-icono-vote-up]`)
      await up.scrollIntoViewIfNeeded()
      await up.click()
      await page.waitForFunction(
        ([leadSelector, asset]) =>
          [...document.querySelectorAll(leadSelector)].some(
            (el) =>
              el.getAttribute("data-icono-gene-vote-box") === asset &&
              !el.querySelector("[data-icono-vote-pending]"),
          ),
        [LEAD, pressed],
        { timeout: 10_000 },
      )
      await page.waitForTimeout(500)
      const swapped = await page.evaluate(readBoxes, [LEAD, STRIP_BOX])
      assert.deepEqual(swapped.lead, { asset: pressed, fit: true, misfit: false }, label)
      assert.deepEqual(swapped.strip[lead], { fit: true, misfit: false }, `${label}: old lead`)
      assert.deepEqual(swapped.strip[flagged], { fit: false, misfit: true }, label)
      assert.deepEqual(
        calls.map((call) => call.route),
        ["mine", "set"],
        `${label}: the rebuilt boxes don't ask again, and nothing reads a snapshot`,
      )
      await page.screenshot({ path: path.join(OUT, `reader-votes-${label}-swapped.png`) })
      assert.deepEqual(errors, [], label)
      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})

test("a guest's page asks for no votes and shows none it remembers", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    for (const [width, height, label] of VIEWPORTS) {
      const calls = []
      const votes = { votes: new Map(), ready: Promise.resolve() }
      const { context, page, errors } = await openTP53(
        browser,
        origin,
        width,
        height,
        createApi(calls, votes),
        { session: false },
      )
      const lead = (await page.evaluate(readBoxes, [LEAD, STRIP_BOX])).lead.asset
      // This device remembers a FIT from a session that has since ended.
      await page.evaluate((asset) => {
        localStorage.setItem(
          `iconoplasm.vote.a:TP53|${asset}`,
          JSON.stringify({ image_upvotes: 9, image_downvotes: 0, image_score: 9, user_vote: 1 }),
        )
      }, lead)
      await page.reload()
      await page.locator(`${LEAD} [data-icono-vote-up]`).filter({ visible: true }).first().waitFor({
        timeout: 45_000,
      })
      await page.waitForTimeout(1500)
      const shown = await page.evaluate(readBoxes, [LEAD, STRIP_BOX])
      assert.deepEqual(shown.lead, { asset: lead, fit: false, misfit: false }, label)
      assert.deepEqual(calls, [], `${label}: a guest sends no vote request`)
      assert.deepEqual(errors, [], label)
      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})
