// B-1027: the gene page draws its caretaker button before the sidebar learns which gene
// the account already looks after. On 2026-10-06 the button read "Become a STAT5A
// caretaker" (228 px) for about a second, then shrank to "Switch to STAT5A" (157 px),
// on every gene page, for every caretaker. The owner: "a flash of unstyled button
// that's very noticeable because its length changes."
//
// Fails if a returning caretaker's button ever shows words other than its final ones
// while caretaker/me is still on its way.
import assert from "node:assert/strict"
import test from "node:test"

import { HOST, launchChrome, routeProduction, startSite } from "./harness.mjs"

const CARETAKER = {
  ok: true,
  caretaker: {
    caretaker_assignment_id: "assignment_mfng",
    canonical_symbol: "MFNG",
    assignment_status: "active",
    href: "/gene/MFNG",
  },
}

test("a returning caretaker's switch button keeps its words while the page loads", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await routeProduction(context, origin, (pathname) => {
      if (pathname === "/api/iconoplasm/caretaker/me") return CARETAKER
      if (pathname === "/api/iconoplasm/caretaker/genes/TP53/claim") {
        return {
          enabled: true,
          claim: {
            available: false,
            reason: "switch_cooldown",
            switch_from: "MFNG",
            available_at: new Date(Date.now() + 10 * 60_000).toISOString(),
            cooldown_seconds: 900,
          },
        }
      }
      return undefined
    })
    await context.addInitScript(() => {
      window.__claimLabels = []
      const note = () => {
        const label = document
          .querySelector("[data-icono-caretaker-claim-action] button > span:not([class])")
          ?.textContent.trim()
        if (label && window.__claimLabels.at(-1) !== label) window.__claimLabels.push(label)
      }
      new MutationObserver(note).observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
      })
    })
    const page = await context.newPage()
    // First visit: the browser learns this account's gene.
    await page.goto(`${HOST}/gene/TP53`)
    await page.waitForSelector(".icono-caretaker-claim-btn--cooldown", { timeout: 30_000 })
    // Second visit, with caretaker/me slow, as it is on a cold Worker.
    await page.route("**/api/iconoplasm/caretaker/me*", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 2_500))
      await route.fallback()
    })
    await page.goto(`${HOST}/gene/TP53`)
    await page.waitForSelector(".icono-caretaker-claim-btn--cooldown", { timeout: 30_000 })
    await page.waitForTimeout(3_000)
    const labels = await page.evaluate(() => window.__claimLabels)
    assert.deepEqual(
      labels,
      ["Switch to TP53"],
      `the button's words changed: ${labels.join(" → ")}`,
    )
    await context.close()
  } finally {
    server.close()
    await browser.close()
  }
})
