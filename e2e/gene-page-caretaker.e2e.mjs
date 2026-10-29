// A gene page names its caretaker for every reader. On 2026-10-29 a guest on
// NOTUM saw no caretaker at all: the gene object stopped carrying one when it
// moved to the CDN, and only a signed-in caretaker's own chip was left.
//
// Fails if a guest or a signed-in reader doesn't see the caretaker's name and
// picture linking to /caretakers, on desktop or phone, or if a gene with no
// caretaker shows one.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, VIEWPORTS, launchChrome, routeProduction, startSite } from "./harness.mjs"

const CARETAKER = {
  username: "e2e-caretaker",
  avatar_url: "https://cdn.discordapp.com/embed/avatars/1.png",
  since: "2026-10-22",
}
// One transparent pixel, so the avatar never waits on Discord.
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
)

async function openGene(browser, origin, { viewport, session, caretaker }) {
  const context = await browser.newContext({
    viewport: { width: viewport[0], height: viewport[1] },
  })
  await routeProduction(context, origin, undefined, { session })
  await context.route("https://cdn.discordapp.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }),
  )
  await context.route("**/genes/v3/TP53.json", async (route) => {
    const response = await route.fetch()
    const gene = await response.json()
    await route.fulfill({ response, json: { ...gene, caretaker } })
  })
  const page = await context.newPage()
  await page.goto(`${HOST}/gene/TP53`)
  // The toolbar is drawn from the gene object, caretaker and all.
  await page.waitForSelector(".icono-canonical-toolbar-actions", { timeout: 30_000 })
  return { context, page }
}

test("every reader sees a gene's caretaker on its page", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const viewport of VIEWPORTS) {
      for (const session of [false, true]) {
        const { context, page } = await openGene(browser, origin, {
          viewport,
          session,
          caretaker: CARETAKER,
        })
        const chip = page.locator("a.icono-caretaker-identity--toolbar")
        await chip.waitFor({ state: "visible", timeout: 30_000 })
        const who = session ? "signed-in" : "guest"
        assert.equal(await chip.getAttribute("href"), "/caretakers", `${who} ${viewport[2]}`)
        assert.match(await chip.innerText(), /e2e-caretaker/, `${who} ${viewport[2]}`)
        const avatar = chip.locator("img")
        assert.equal(await avatar.getAttribute("src"), CARETAKER.avatar_url)
        const box = await chip.boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= viewport[0], "the chip fits the screen")
        await page.screenshot({
          path: path.join(OUT, `gene-page-caretaker-${who}-${viewport[2]}.png`),
        })
        await context.close()
      }
    }

    const { context, page } = await openGene(browser, origin, {
      viewport: VIEWPORTS[0],
      session: false,
      caretaker: null,
    })
    await page.waitForTimeout(1_500)
    assert.equal(
      await page.locator(".icono-caretaker-identity--toolbar").count(),
      0,
      "a gene with no caretaker shows none",
    )
    await context.close()
  } finally {
    await browser.close()
    server.close()
  }
})
