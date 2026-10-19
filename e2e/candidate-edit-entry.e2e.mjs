// A signed-in caretaker gets "Edit candidate portrait" in a candidate's More menu,
// as the admin does (owner, 2026-10-19: the admin had it, a regular caretaker
// didn't). The menus arrive drawn for a guest and are redrawn when the reader's
// account is known; the redraw keyed only on admin or not, so a caretaker whose
// sign-in answered after the first draw kept the guest menu.
//
// Ways this can fail, written before the check:
// 1. The sign-in answer lands after the page is drawn and the menu keeps the
//    guest markup: no edit entry for a signed-in reader.
// 2. A guest is shown the edit entry, which only leads to a sign-in wall (B-612).
// 3. The entry is there but carries no source image, so the editor opens empty.
//
// What is real: the built site, TP53's published candidates, Chrome. The
// reader's /api/auth/me answer is mocked and held back 1.5 s, like a slow
// production answer.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import test from "node:test"

import { HOST, launchChrome, routeProduction, startSite } from "./harness.mjs"

const SYMBOL = "TP53"
const FIRST_MENU = "[data-icono-candidate-strip] .icono-candidate-card .icono-candidate-menu"

function readFirstMenu(selector) {
  const menu = document.querySelector(selector)
  const edit = menu && menu.querySelector(".icono-image-edit-open")
  return {
    hasMenu: !!menu,
    items: menu
      ? [...menu.querySelectorAll(".icono-candidate-menu-item")].map((el) =>
          el.textContent.trim().replace(/\s+/g, " "),
        )
      : [],
    editImage: edit ? edit.getAttribute("data-icono-source-image-url") || "" : null,
  }
}

async function openGene(browser, origin, { session }) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await routeProduction(context, origin, () => undefined, { session })
  if (session) {
    // Registered after the harness's routes, so it answers /api/auth/me first.
    await context.route(`${HOST}/api/auth/me`, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          authenticated: true,
          user: {
            id: "u-caretaker",
            user_id: "u-caretaker",
            account_id: "u-caretaker",
            username: "caretaker",
            display_name: "Caretaker",
            is_admin: false,
          },
        }),
      })
    })
  }
  const page = await context.newPage()
  await page.goto(`${HOST}/gene/${SYMBOL}`)
  await page.waitForSelector(FIRST_MENU, { state: "attached", timeout: 30_000 })
  return { context, page }
}

test("candidate edit entry: a signed-in caretaker gets it even when sign-in answers late; a guest never does", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    {
      const { context, page } = await openGene(browser, origin, { session: true })
      // 1: wait past the held-back sign-in answer for the redraw.
      await page
        .waitForFunction(
          (selector) => !!document.querySelector(selector + " .icono-image-edit-open"),
          FIRST_MENU,
          { timeout: 15_000 },
        )
        .catch(() => {})
      const menu = await page.evaluate(readFirstMenu, FIRST_MENU)
      assert.ok(
        menu.items.includes("Edit candidate portrait"),
        `caretaker's menu: ${JSON.stringify(menu.items)}`,
      )
      // 3: the entry knows which image it edits.
      assert.match(menu.editImage, /^https:\/\//, "edit entry has no source image")
      // An admin-only control stays admin-only.
      assert.ok(!menu.items.includes("Remove"), "a caretaker was offered Remove")
      await context.close()
    }
    {
      const { context, page } = await openGene(browser, origin, { session: false })
      await page.waitForTimeout(2500)
      const menu = await page.evaluate(readFirstMenu, FIRST_MENU)
      // 2: a guest gets the menu without the edit entry.
      assert.ok(menu.hasMenu, "guest has no candidate menu")
      assert.ok(
        !menu.items.includes("Edit candidate portrait"),
        `guest's menu: ${JSON.stringify(menu.items)}`,
      )
      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})
