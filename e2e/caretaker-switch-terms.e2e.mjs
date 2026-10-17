// B-1092: switching genes asks for the caretaker terms the same way a first claim
// does. On 2026-10-16 the switch dialog had no checkbox at all, just "Switching
// accepts the Caretaker terms" above the button, so a caretaker could not decline.
// The owner: "I want the check mark pre-checked, not absent."
//
// Ways this can fail, written before the check:
// 1. The switch dialog has no terms checkbox (the 2026-10-16 state).
// 2. The box is pre-checked for terms the account never accepted (a newer version).
// 3. Unchecking the box leaves "Switch to TP53" live, or clicking it still posts.
// 4. The box starts unchecked for terms the account already accepted.
// B-1104: the dialog answers what a caretaker fears losing by switching.
// 5. A column is missing, or names the wrong gene (the old one where the new
//    one belongs).
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import test from "node:test"

import { HOST, launchChrome, routeProduction, startSite } from "./harness.mjs"

const TERMS = {
  terms_version_id: "terms_2026_09_25_v4",
  document_url: "/caretaker-terms",
  display_label: "Caretaker terms - 25 September 2026 (v4)",
}

function claimFor(acceptedVersion) {
  return {
    enabled: true,
    gene: { gene_id: "HGNC:11998", canonical_symbol: "TP53" },
    claim: {
      available: true,
      reason: null,
      mode: "switch",
      switch_from: {
        caretaker_assignment_id: "assignment_mfng",
        canonical_symbol: "MFNG",
        assignment_version: 1,
        gene_revision: 0,
        terms_version_id: acceptedVersion,
      },
      gene_revision: 0,
      entitlement_policy_version: "caretaker_entitlement_v1",
      terms: TERMS,
    },
  }
}

const CARETAKER = {
  ok: true,
  caretaker: {
    caretaker_assignment_id: "assignment_mfng",
    canonical_symbol: "MFNG",
    assignment_status: "active",
    href: "/gene/MFNG",
  },
}

async function openSwitchDialog(browser, origin, acceptedVersion) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const claims = []
  await routeProduction(context, origin, (pathname, request) => {
    if (pathname === "/api/iconoplasm/caretaker/me") return CARETAKER
    if (pathname === "/api/iconoplasm/caretaker/genes/TP53/claim") {
      if (request.method() === "POST") {
        claims.push(request.postDataJSON())
        return { ok: false, code: "TEST_STOP" }
      }
      return claimFor(acceptedVersion)
    }
    return undefined
  })
  const page = await context.newPage()
  await page.goto(`${HOST}/gene/TP53`)
  await page.getByRole("button", { name: "Switch to TP53" }).first().click()
  const dialog = page.locator("#icono-caretaker-claim-dialog-TP53")
  await dialog.waitFor({ state: "visible", timeout: 30_000 })
  return { context, page, dialog, claims }
}

// The box itself: the middle of the label is the terms link, which opens the terms.
function termsBox(dialog) {
  return dialog.locator('[data-icono-caretaker-claim-terms] [part~="control"]')
}

function readDialog(dialog) {
  return dialog.evaluate((node) => {
    const box = node.querySelector("[data-icono-caretaker-claim-terms]")
    const column = (name) =>
      Array.from(node.querySelectorAll(`.icono-caretaker-switch-inventory__${name} li`), (li) =>
        li.textContent.trim(),
      )
    return {
      kept: column("kept"),
      moved: column("moved"),
      hasBox: !!box,
      checked: !!box?.checked,
      submitDisabled: !!node.querySelector("[data-icono-caretaker-claim-submit]")?.disabled,
    }
  })
}

test("switching genes shows the terms checkbox, pre-checked only for accepted terms", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    const inventory = {
      kept: [
        "Nothing you wrote is deleted, and every version remains in its history",
        "You may return to MFNG later if it is still unclaimed",
      ],
      moved: [
        "Your supervote moves from MFNG to TP53",
        "Your editing moves from MFNG to TP53, nothing more",
      ],
    }
    // 1, 3, 4 and 5: the account accepted v4, which is on offer.
    const accepted = await openSwitchDialog(browser, origin, TERMS.terms_version_id)
    assert.deepEqual(await readDialog(accepted.dialog), {
      ...inventory,
      hasBox: true,
      checked: true,
      submitDisabled: false,
    })
    await termsBox(accepted.dialog).click()
    assert.deepEqual(await readDialog(accepted.dialog), {
      ...inventory,
      hasBox: true,
      checked: false,
      submitDisabled: true,
    })
    await accepted.dialog
      .locator("[data-icono-caretaker-claim-submit]")
      .click({ force: true })
      .catch(() => {})
    await accepted.page.waitForTimeout(500)
    assert.equal(accepted.claims.length, 0, "an unchecked box still posted a switch")
    await accepted.context.close()

    // 2: the account accepted an older version, so the box starts unchecked.
    const older = await openSwitchDialog(browser, origin, "terms_2026_09_02_v3")
    assert.deepEqual(await readDialog(older.dialog), {
      ...inventory,
      hasBox: true,
      checked: false,
      submitDisabled: true,
    })
    await termsBox(older.dialog).click()
    assert.equal((await readDialog(older.dialog)).submitDisabled, false)
    await older.context.close()
  } finally {
    server.close()
    await browser.close()
  }
})
