// A script the page needs is missing: the page was opened before a release
// removed it, or the release has not reached this reader's edge yet. Names
// carry their hash (scripts/lib/iconoplasm-hashed-modules.mjs), so the miss is
// a 404, never last release's bytes, and the page's head reloads it once
// (quartz/components/Head.tsx). Owner, 2026-10-29: "I can't tell all people,
// all our core users, to press Ctrl Shift R every time You push an update."
//
// Ways this can fail:
//  1. A module loaded on demand (here the diagram studio) 404s and the page
//     shows an error, or stays blank, instead of reloading.
//  2. The page reloads but reuses the failed answer, so it fails again.
//  3. The file stays missing and the page reloads forever.
//  4. The entry script itself 404s and nothing notices.
//
// E2E scope: quartz/components/Head.tsx quartz/static/iconoplasm/app.js scripts/prepare-iconoplasm-edge-assets.mjs scripts/lib/iconoplasm-hashed-modules.mjs
import assert from "node:assert/strict"
import test from "node:test"

import { HOST, launchChrome, routeProduction, startSite } from "./harness.mjs"

async function openWithMissing(browser, origin, pattern, misses) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  await routeProduction(context, origin, () => undefined, { session: false })
  const answers = []
  let left = misses
  // Registered after routeProduction, so it is asked first.
  await context.route(pattern, async (route) => {
    const kind = route.request().resourceType()
    if (left > 0) {
      left -= 1
      answers.push([kind, 404])
      return route.fulfill({
        status: 404,
        contentType: "text/html",
        headers: { "cache-control": "public, max-age=31536000, immutable" },
        body: "<!doctype html><title>Page not found</title>",
      })
    }
    answers.push([kind, 200])
    return route.fallback()
  })
  const page = await context.newPage()
  const documents = []
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame())
      documents.push(request.url())
  })
  await page.goto(`${HOST}/studio`)
  return { context, page, answers, documents }
}

test("a missing on-demand script reloads the page once, then works", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    const { page, answers, documents } = await openWithMissing(
      browser,
      origin,
      /\/static\/iconoplasm\/diagram-studio\.[0-9a-f]{16}\.v\.js$/,
      1,
    )
    await page.waitForSelector('[data-studio-root][data-ready="true"]', { timeout: 45_000 })
    assert.equal(documents.length, 2, `one reload: ${documents.join(", ")}`)
    assert.equal(answers[0][1], 404)
    assert.ok(
      answers.some(([kind, status]) => kind === "fetch" && status === 200),
      `the missing file is fetched again past the cache before the reload: ${JSON.stringify(answers)}`,
    )
  } finally {
    await browser.close()
    server.close()
  }
})

test("a script that stays missing reloads once, not forever", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    const { page, documents } = await openWithMissing(
      browser,
      origin,
      /\/static\/iconoplasm\/app\.[0-9a-f]{16}\.v\.js$/,
      Infinity,
    )
    await page.waitForTimeout(8_000)
    assert.equal(documents.length, 2, `one reload: ${documents.join(", ")}`)
  } finally {
    await browser.close()
    server.close()
  }
})
