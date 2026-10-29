// A gene page names its caretaker for every reader. On 2026-10-29 a guest on
// NOTUM saw no caretaker at all: the gene object stopped carrying one when it
// moved to the CDN, and only a signed-in caretaker's own chip was left. The
// first fix reused that chip, whose name a narrow bar drops, so a phone showed a
// face and a badge and no name; the owner: "not what a front-end developer
// would do". The line the owner approved (picture, name, "Caretaker since …")
// keeps the name at every width.
//
// Fails if a guest or a signed-in reader, on desktop or a 360, 375 or 400 px
// phone, doesn't see the caretaker's whole name and start date as a link to
// /caretakers inside the toolbar; if the caretaker doesn't see the same line, as
// the one button that opens their tools; if a phone card has empty space under
// its footer; or if a gene with no caretaker shows one.
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
const WIDTHS = [...VIEWPORTS, [375, 812, "phone-375"], [360, 780, "phone-360"]]
// A 64 px picture, so the avatar never waits on Discord and shows in the screenshots.
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAoklEQVR42u3ZSRHAMAwEwYUTEMHkd5AGTyj4UGwdUyUA0z9b0tVa6BEAAAAAAAAAAAAAq3mfu2c8AjrTzRk6km7I0Nn6dYPOpq8z5KR+2iA/9XOGeoBf6ycM8lY/aqgE2FY/ZCgD2FzfbwAAAAAAAAAAAADAczoEgC+lA0D4rQSLLR+A8LvRDNvpDPeBJBeaDDeyJFdKDt0AAAAAAAAAgIDzAeNSzL2xzCemAAAAAElFTkSuQmCC",
  "base64",
)

// The caretaker themself: signed in, with TP53 as their gene.
function asCaretaker(pathname, request) {
  if (pathname === "/api/auth/me") {
    return {
      authenticated: true,
      user: {
        id: "u1",
        user_id: "u1",
        account_id: "u1",
        username: CARETAKER.username,
        avatar_url: "/api/avatar?src=e2e",
      },
    }
  }
  if (pathname === "/api/iconoplasm/caretaker/me") {
    return {
      ok: true,
      caretaker: {
        caretaker_assignment_id: "assignment_tp53",
        canonical_symbol: "TP53",
        assignment_status: "active",
        href: "/gene/TP53",
      },
    }
  }
  if (pathname.startsWith("/api/iconoplasm/caretaker/") && request.method() === "GET") {
    return {
      gene: { gene_id: "gene_tp53", symbol: "TP53" },
      viewer: { is_caretaker: true, can_edit: true, can_accept: false, suspended: false },
      assignment: {
        caretaker_assignment_id: "assignment_tp53",
        assignment_version: 3,
        status: "active",
        leave_policy: "retain",
      },
      head: {
        head_version: 4,
        gene_revision: 9,
        canonical_selection_id: "selection_4",
        canonical_revision_id: "revision_1",
      },
      manifestations: [],
    }
  }
  return undefined
}

async function openGene(browser, origin, { viewport, reader, caretaker }) {
  const context = await browser.newContext({
    viewport: { width: viewport[0], height: viewport[1] },
  })
  await routeProduction(context, origin, reader === "caretaker" ? asCaretaker : undefined, {
    session: reader !== "guest",
  })
  const picture = (route) => route.fulfill({ status: 200, contentType: "image/png", body: PICTURE })
  await context.route("https://cdn.discordapp.com/**", picture)
  await context.route(`${HOST}/api/avatar*`, picture)
  await context.route("**/genes/v3/TP53.json", async (route) => {
    const response = await route.fetch()
    const gene = await response.json()
    await route.fulfill({ response, json: { ...gene, caretaker } })
  })
  const page = await context.newPage()
  await page.goto(`${HOST}/gene/TP53`)
  // The toolbar is drawn from the gene object, caretaker and all.
  await page.waitForSelector("[data-icono-canonical-rail]", { timeout: 30_000 })
  return { context, page }
}

test("every reader sees a gene's caretaker on its page", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const viewport of WIDTHS) {
      for (const reader of ["guest", "signed-in", "caretaker"]) {
        const where = `${reader} ${viewport[2]}`
        const { context, page } = await openGene(browser, origin, {
          viewport,
          reader,
          caretaker: CARETAKER,
        })
        const line = page.locator("[data-icono-gene-caretaker]")
        const own = reader === "caretaker"
        // The caretaker's line turns into their button once their role is known.
        await page.waitForSelector(
          own
            ? "[data-icono-gene-caretaker][data-icono-caretaker-open]"
            : "[data-icono-gene-caretaker]",
          { state: "visible", timeout: 30_000 },
        )
        await page.waitForTimeout(500)
        const seen = await line.evaluate((el) => {
          const railEl = el.closest("[data-icono-canonical-rail]")
          const name = el.querySelector(".icono-gene-caretaker__name")
          const rail = railEl.getBoundingClientRect()
          const box = el.getBoundingClientRect()
          const card = document.querySelector(".icono-gene-lead-card")
          const sheet = card.querySelector(".icono-label-dossier-shell")
          return {
            href: el.getAttribute("href"),
            name: name.textContent,
            nameCut: name.scrollWidth > name.clientWidth,
            since: el.querySelector(".icono-gene-caretaker__since").textContent,
            insideRail: box.left >= rail.left - 1 && box.right <= rail.right + 1,
            railOverflow: railEl.scrollWidth - railEl.clientWidth,
            chips: document.querySelectorAll("[data-icono-caretaker-open]").length,
            // Phones: the card ends just under its footer (up to 114 px of empty
            // card at 360 px before 2026-10-29).
            emptyCardBelowSheet:
              innerWidth > 720
                ? 0
                : Math.max(
                    0,
                    Math.round(
                      card.getBoundingClientRect().bottom - sheet.getBoundingClientRect().bottom,
                    ) - 16,
                  ),
          }
        })
        assert.deepEqual(
          seen,
          {
            href: own ? null : "/caretakers",
            name: CARETAKER.username,
            nameCut: false,
            since: "Caretaker since Oct 22, 2026",
            insideRail: true,
            railOverflow: 0,
            chips: own ? 1 : 0,
            emptyCardBelowSheet: 0,
          },
          where,
        )
        await page.locator("[data-icono-canonical-rail]").scrollIntoViewIfNeeded()
        await page.screenshot({
          path: path.join(OUT, `gene-page-caretaker-${reader}-${viewport[2]}.png`),
        })
        if (own) {
          await line.click()
          await page.waitForSelector(".icono-caretaker-dialog[open]", { timeout: 10_000 })
        }
        await context.close()
      }
    }

    const { context, page } = await openGene(browser, origin, {
      viewport: VIEWPORTS[0],
      reader: "guest",
      caretaker: null,
    })
    await page.waitForTimeout(1_500)
    assert.equal(
      await page.locator("[data-icono-gene-caretaker]").count(),
      0,
      "a gene with no caretaker shows none",
    )
    await context.close()
  } finally {
    await browser.close()
    server.close()
  }
})
