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
// B-1104: the dialog lists what stays on the old gene and what is undone there.
// 5. A column is missing, or names the wrong gene (the old one where the new
//    one belongs).
// 6. The supervote line shows for a caretaker who never cast a supervote.
// 7. On a small phone the dialog scrolls (the owner, 2026-10-17: "having a scroll
//    bar at the dialogue is not acceptable" for an informational dialog). The
//    smallest screen checked is an iPhone SE in Safari, 375 x 548, leaving a
//    long gene symbol (ARHGEF10L), with the terms box shown.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import test from "node:test"

import { HOST, launchChrome, routeProduction, startSite } from "./harness.mjs"

const TERMS = {
  terms_version_id: "terms_2026_09_25_v4",
  document_url: "/caretaker-terms",
  display_label: "Caretaker terms - 25 September 2026 (v4)",
}

function claimFor(acceptedVersion, hasSupervote, from) {
  return {
    enabled: true,
    gene: { gene_id: "HGNC:11998", canonical_symbol: "TP53" },
    claim: {
      available: true,
      reason: null,
      mode: "switch",
      switch_from: {
        caretaker_assignment_id: "assignment_mfng",
        canonical_symbol: from,
        assignment_version: 1,
        gene_revision: 0,
        terms_version_id: acceptedVersion,
        has_supervote: hasSupervote,
      },
      gene_revision: 0,
      entitlement_policy_version: "caretaker_entitlement_v1",
      terms: TERMS,
    },
  }
}

function caretakerOf(from) {
  return {
    ok: true,
    caretaker: {
      caretaker_assignment_id: "assignment_mfng",
      canonical_symbol: from,
      assignment_status: "active",
      href: `/gene/${from}`,
    },
  }
}

async function openSwitchDialog(
  browser,
  origin,
  acceptedVersion,
  hasSupervote,
  { from = "MFNG", viewport = { width: 1280, height: 900 } } = {},
) {
  const context = await browser.newContext({ viewport })
  const claims = []
  await routeProduction(context, origin, (pathname, request) => {
    if (pathname === "/api/iconoplasm/caretaker/me") return caretakerOf(from)
    if (pathname === "/api/iconoplasm/caretaker/genes/TP53/claim") {
      if (request.method() === "POST") {
        claims.push(request.postDataJSON())
        return { ok: false, code: "TEST_STOP" }
      }
      return claimFor(acceptedVersion, hasSupervote, from)
    }
    return undefined
  })
  const page = await context.newPage()
  await page.goto(`${HOST}/gene/TP53`)
  // On a phone the switch button sits in the toolbar's More menu; the dialog it
  // opens is the same one.
  const open = page.locator("[data-icono-caretaker-claim-open]")
  await open.waitFor({ state: "attached", timeout: 30_000 })
  await open.evaluate((button) => button.click())
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
      headings: Array.from(node.querySelectorAll(".icono-caretaker-switch-inventory h3"), (h) =>
        h.textContent.trim(),
      ),
      kept: column("kept"),
      undone: column("undone"),
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
    const kept = [
      "MFNG keeps showing your lore unless a new caretaker of MFNG saves their own. Every version stays in MFNG's lore history.",
      "You can become MFNG's caretaker again later, if nobody else has taken it.",
    ]
    const undone = ["You can no longer edit MFNG's lore. You can now edit TP53's lore."]
    const supervote =
      "Your MFNG supervote is withdrawn, so ordinary votes decide MFNG's portrait. You gain a supervote on TP53's portraits."
    const headings = ["What stays the same on MFNG", "What is undone on MFNG"]
    const inventory = { headings, kept, undone: [supervote, ...undone] }
    // 1, 3, 4 and 5: the account accepted v4, which is on offer, and holds a supervote.
    const accepted = await openSwitchDialog(browser, origin, TERMS.terms_version_id, true)
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

    // 2 and 6: the account accepted an older version, so the box starts unchecked,
    // and it never cast a supervote, so no supervote line.
    const older = await openSwitchDialog(browser, origin, "terms_2026_09_02_v3", false)
    assert.deepEqual(await readDialog(older.dialog), {
      headings,
      kept,
      undone,
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

test("the switch dialog fits a small phone without a scroll bar", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    for (const viewport of [
      { width: 375, height: 548 },
      { width: 360, height: 640 },
    ]) {
      for (const accepted of [TERMS.terms_version_id, "terms_2026_09_02_v3"]) {
        const opened = await openSwitchDialog(browser, origin, accepted, true, {
          from: "ARHGEF10L",
          viewport,
        })
        await opened.page.evaluate(() => document.fonts.ready)
        const overflow = await opened.dialog.evaluate((node) => {
          const body = node.querySelector(".icono-dialog__body")
          return body.scrollHeight - body.clientHeight
        })
        assert.equal(overflow, 0, `${viewport.width}x${viewport.height}, ${accepted}: body scrolls`)
        await opened.context.close()
      }
    }
  } finally {
    server.close()
    await browser.close()
  }
})
