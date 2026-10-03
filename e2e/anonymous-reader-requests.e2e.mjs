// B-972 / ARCHITECTURE FENCE [IPD-008]: an anonymous reader costs the Worker nothing.
//
// The sites are being prepared for a viral moment, and the first thousand visitors have no
// account. The static assets answer them for free; every request that reaches the Worker
// (anything in `run_worker_first` of the stateful config) is a metered Workers request. The
// rule (IPD-008): a guest page reads the two published CDN objects and never probes identity or
// D1. Seven regexes over app.js, Head.tsx and CSS used to hold that rule. This test checks it in
// a real browser, from the outside, the way the meter sees it.
//
// Ways this can fail, written before the code:
//  1. the home page or a gene page asks /api/* anything (an identity probe, a settings read, a
//     gallery window, a stats read, a comments read) without the signed-in hint cookie;
//  2. a page puts a first-party /blot/ or /portraits/ URL in the document, so each view costs a
//     Worker request (B-846);
//  3. the page never loaded at all and the empty request list is a vacuous pass: the home shell
//     must mount, and the gene page must load its card from the CDN's stable gene object;
//  4. the analytics beacon loads before a visitor in a consent country has answered, or after
//     "No thanks", or never loads for a visitor who accepted or lives outside the consent
//     countries (the prompt decision is made in the page, from /cdn-cgi/trace).
//
// What is real: Chrome, the built public-iconoplasm-edge site, and the published CDN objects.
// What is stubbed: every /api/* answer (404, recorded), the /cdn-cgi/trace country, and the
// analytics beacon script (recorded, never fetched).
//
// Needs `pnpm run build` (public-iconoplasm-edge) and an installed Chrome. The measured request
// lists land in artifacts/e2e/anonymous-reader-requests.json.
import assert from "node:assert/strict"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"
import toml from "toml"

import {
  HOST,
  HttpStatus,
  OUT,
  ROOT,
  VIEWPORTS,
  launchChrome,
  routeProduction,
  startSite,
} from "./harness.mjs"

const CDN_HOST = "iconoplasmportraits.b-cdn.net"
const BEACON_HOST = "static.cloudflareinsights.com"
const CONSENT_COOKIE = "brinedew_analytics_consent"

// The paths the production config runs the Worker for before the static assets.
const WORKER_FIRST = toml.parse(
  readFileSync(
    path.join(ROOT, "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml"),
    "utf8",
  ),
).assets.run_worker_first
assert.ok(WORKER_FIRST.length > 0, "run_worker_first must list the Worker-bound paths")
assert.ok(
  WORKER_FIRST.every((rule) => !rule.startsWith("!")),
  "an exclusion rule in run_worker_first needs this test taught about it",
)

function reachesWorker(url) {
  const { host, pathname } = new URL(url)
  if (host !== new URL(HOST).host) return false
  return WORKER_FIRST.some((rule) =>
    rule.endsWith("*") ? pathname.startsWith(rule.slice(0, -1)) : pathname === rule,
  )
}

test("an anonymous reader on the home page and on a gene page sends the Worker nothing", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const report = []
  try {
    for (const [width, height, label] of VIEWPORTS) {
      for (const pagePath of ["/", "/gene/TP53"]) {
        const where = `${label} ${pagePath}`
        const context = await browser.newContext({ viewport: { width, height } })
        // Anything that does reach /api/* is answered 404 so it never touches production.
        await routeProduction(context, origin, () => new HttpStatus(404), { session: false })
        const page = await context.newPage()
        const workerBound = []
        const cdn = []
        page.on("request", (request) => {
          const url = request.url()
          if (reachesWorker(url)) workerBound.push(`${request.method()} ${new URL(url).pathname}`)
          if (new URL(url).host === CDN_HOST) cdn.push(new URL(url).pathname)
        })
        const geneObject =
          pagePath === "/"
            ? null
            : page.waitForResponse(
                (response) => new URL(response.url()).pathname === "/genes/v3/TP53.json",
                {
                  timeout: 45_000,
                },
              )
        await page.goto(`${HOST}${pagePath}`)
        if (pagePath === "/") await page.waitForSelector("#icono-grid", { timeout: 45_000 })
        else await geneObject
        // Lazy work (starter cards, deferred hydration, idle prefetch) starts after first paint.
        await page.waitForLoadState("networkidle")
        await page.waitForTimeout(5_000)
        report.push({ where, workerBound, cdn: [...new Set(cdn)] })

        // 3. The gene page really loaded its card from the published object.
        if (pagePath !== "/") {
          assert.ok(
            cdn.includes("/genes/v3/TP53.json"),
            `${where}: the stable gene object was not read from the CDN (${cdn.join(", ")})`,
          )
        }
        // 1 and 2. Nothing the meter counts.
        assert.deepEqual(
          workerBound,
          [],
          `${where}: an anonymous reader reached the Worker: ${workerBound.join(", ")}`,
        )
        await context.close()
      }
    }
  } finally {
    writeFileSync(path.join(OUT, "anonymous-reader-requests.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})

// Polls the recorded beacon requests: the page loads the script asynchronously.
async function beaconCount(beacon, atLeast, ms) {
  const deadline = Date.now() + ms
  while (beacon.length < atLeast && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return beacon.length
}

async function openWithCountry(browser, origin, country, beacon) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  await routeProduction(context, origin, () => new HttpStatus(404), { session: false })
  // Registered after routeProduction, so these win over its catch-all.
  await context.route(`${HOST}/cdn-cgi/trace`, (route) =>
    route.fulfill({ status: 200, contentType: "text/plain", body: `fl=1\nloc=${country}\n` }),
  )
  await context.route(`https://${BEACON_HOST}/**`, (route) => {
    beacon.push(route.request().url())
    return route.fulfill({ status: 200, contentType: "text/javascript", body: "" })
  })
  const page = await context.newPage()
  await page.goto(`${HOST}/`)
  return { context, page }
}

test("the analytics beacon waits for consent in a consent country and stays off after No thanks", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    // A visitor from Germany: the prompt shows, and nothing loads until they answer.
    const declined = []
    const eu = await openWithCountry(browser, origin, "DE", declined)
    await eu.page.waitForSelector(".brinedew-analytics-consent", { timeout: 15_000 })
    assert.equal(await beaconCount(declined, 1, 1_500), 0, "no beacon while the prompt is open")
    await eu.page.click("[data-analytics-consent-decline]")
    assert.equal(await beaconCount(declined, 1, 1_500), 0, "no beacon after No thanks")
    assert.match(
      await eu.page.evaluate(() => document.cookie),
      new RegExp(`${CONSENT_COOKIE}=declined`),
    )
    await eu.page.reload()
    await eu.page.waitForLoadState("networkidle")
    assert.equal(await eu.page.locator(".brinedew-analytics-consent").count(), 0, "answered once")
    assert.equal(await beaconCount(declined, 1, 1_500), 0, "still no beacon on the next visit")
    await eu.context.close()

    // The same visitor accepting: the beacon loads, once.
    const accepted = []
    const yes = await openWithCountry(browser, origin, "DE", accepted)
    await yes.page.waitForSelector(".brinedew-analytics-consent", { timeout: 15_000 })
    assert.equal(await beaconCount(accepted, 1, 1_000), 0, "no beacon before they accept")
    await yes.page.click("[data-analytics-consent-accept]")
    assert.equal(await beaconCount(accepted, 1, 5_000), 1, "the beacon loads after Allow")
    await yes.context.close()

    // A visitor outside the consent countries gets the cookieless beacon with no prompt.
    const outside = []
    const us = await openWithCountry(browser, origin, "US", outside)
    assert.equal(await beaconCount(outside, 1, 10_000), 1, "the beacon loads without a prompt")
    assert.equal(await us.page.locator(".brinedew-analytics-consent").count(), 0, "no prompt")
    await us.context.close()
  } finally {
    server.close()
    await browser.close()
  }
})
