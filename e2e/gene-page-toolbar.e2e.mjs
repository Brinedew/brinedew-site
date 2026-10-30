// B-1191: the toolbar under the gene card keeps its buttons in place for every
// reader. On 2026-10-30 the sliders sat 105 px from the bar's left for a guest's
// neighbour, 396 px for a reader who looks after another gene, 380 px for the
// gene's own caretaker and 532 px for someone asking for a swap, and on phones
// the caretaker buttons hid behind a "…" menu. The owner: "the sliders button
// goes from left to right unpredictably … this is not how people standardize
// toolbars in 2026".
//
// Ways this can fail, written before the check:
// 1. The star, print, sliders or Add portraits button sits somewhere else, or
//    is missing, for one of the seven readers below, at the same width.
// 2. A reader's caretaker button is missing, or hides in a menu.
// 3. The caretaker's own button doesn't read "Your caretaker panel".
// 4. The bar overflows its card.
// 5. A guest's sliders open nothing instead of asking them to log in.
//
// What is real: the built site, TP53's published gene object (with its
// caretaker swapped per reader), Chrome. Sign-ins and the claim answers are
// mocked at /api/*. Screenshots land in artifacts/e2e.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, VIEWPORTS, launchChrome, routeProduction, startSite } from "./harness.mjs"

const SYMBOL = "TP53"
const WIDTHS = [...VIEWPORTS, [360, 780, "phone-360"]]
const OTHER = {
  username: "e2e-neighbour",
  avatar_url: "https://cdn.discordapp.com/embed/avatars/1.png",
  since: "2026-10-22",
}
const PICTURE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAoklEQVR42u3ZSRHAMAwEwYUTEMHkd5AGTyj4UGwdUyUA0z9b0tVa6BEAAAAAAAAAAAAAq3mfu2c8AjrTzRk6km7I0Nn6dYPOpq8z5KR+2iA/9XOGeoBf6ycM8lY/aqgE2FY/ZCgD2FzfbwAAAAAAAAAAAADAczoEgC+lA0D4rQSLLR+A8LvRDNvpDPeBJBeaDDeyJFdKDt0AAAAAAAAAgIDzAeNSzL2xzCemAAAAAElFTkSuQmCC",
  "base64",
)
const terms = {
  terms_version_id: "terms_e2e",
  document_url: "/caretaker-terms",
  display_label: "Caretaker terms",
}
const later = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString()

// Who reads, who looks after TP53, what the claim route answers, and the
// caretaker button the reader should see.
const READERS = [
  { id: "guest-nobody", reader: "guest", caretaker: null, button: "" },
  { id: "guest-neighbour", reader: "guest", caretaker: OTHER, button: "" },
  {
    id: "new-nobody",
    reader: "new",
    caretaker: null,
    claim: { enabled: true, claim: { available: true, mode: "claim", terms } },
    button: "Become a TP53 caretaker",
  },
  {
    id: "switch-cooldown",
    reader: "mfng",
    caretaker: null,
    claim: {
      enabled: true,
      claim: {
        available: false,
        reason: "switch_cooldown",
        switch_from: "MFNG",
        available_at: later(14.8),
        cooldown_seconds: 900,
      },
    },
    button: /^Switch to TP53/,
  },
  {
    id: "swap",
    reader: "mfng",
    caretaker: OTHER,
    claim: {
      enabled: true,
      request: {
        available: true,
        mode: "swap",
        terms,
        note_max_length: 280,
        offered: { canonical_symbol: "MFNG", terms_version_id: "terms_old" },
      },
    },
    button: "Request swap",
  },
  {
    id: "swap-pending",
    reader: "mfng",
    caretaker: OTHER,
    claim: {
      enabled: true,
      request: { pending: { request_id: "r1", created_at: later(-30), mode: "swap" } },
    },
    button: "Cancel request",
  },
  {
    id: "own",
    reader: "own",
    caretaker: { ...OTHER, username: "e2e-caretaker" },
    button: "",
  },
]

function mockApi(state) {
  return (pathname, request) => {
    if (pathname === "/api/auth/me") {
      if (state.reader === "guest") return { authenticated: false }
      return {
        authenticated: true,
        user: {
          id: "u1",
          user_id: "u1",
          account_id: "u1",
          username: state.reader === "own" ? "e2e-caretaker" : "e2e",
          avatar_url: "/api/avatar?src=e2e",
        },
      }
    }
    if (pathname === "/api/iconoplasm/caretaker/me") {
      const symbol = { mfng: "MFNG", own: SYMBOL }[state.reader]
      return {
        ok: true,
        caretaker: symbol
          ? {
              caretaker_assignment_id: `a_${symbol}`,
              canonical_symbol: symbol,
              assignment_status: "active",
              href: `/gene/${symbol}`,
            }
          : null,
      }
    }
    if (pathname === `/api/iconoplasm/caretaker/genes/${SYMBOL}/claim`) {
      return state.claim || { enabled: true }
    }
    if (
      state.reader === "own" &&
      pathname.startsWith("/api/iconoplasm/caretaker/") &&
      request.method() === "GET"
    ) {
      return {
        gene: { gene_id: "gene_tp53", symbol: SYMBOL },
        viewer: { is_caretaker: true, can_edit: true, can_accept: false, suspended: false },
        assignment: {
          caretaker_assignment_id: "a_TP53",
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
}

// Runs in the page: where each fixed button sits, from the bar's left edge and
// its bottom edge, and what the caretaker part shows.
function toolbarPlaces() {
  const rail = document.querySelector("[data-icono-canonical-rail]")
  const r = rail.getBoundingClientRect()
  const place = (selector) => {
    const el = rail.querySelector(selector)
    if (!el || !el.checkVisibility()) return null
    const b = el.getBoundingClientRect()
    return [Math.round(b.left - r.left), Math.round(r.bottom - b.bottom), Math.round(b.width)]
  }
  const claim = rail.querySelector("[data-icono-caretaker-claim-action] button")
  return {
    fixed: {
      star: place("[data-icono-emulsion-favorite]"),
      print: place("[data-icono-print-copy]"),
      sliders: place(".icono-canonical-edit-btn"),
      add: place("[data-icono-request-dialog-open]"),
    },
    button: claim && claim.checkVisibility() ? claim.textContent.trim() : "",
    own:
      rail
        .querySelector("[data-icono-caretaker-open] .icono-gene-caretaker__name")
        ?.textContent.trim() || "",
    overflow: rail.scrollWidth - rail.clientWidth,
  }
}

test("gene toolbar: the same buttons in the same places for every reader", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const [width, height, viewportName] of WIDTHS) {
      const places = []
      for (const state of READERS) {
        const where = `${viewportName} ${state.id}`
        const context = await browser.newContext({ viewport: { width, height } })
        await routeProduction(context, origin, mockApi(state), {
          session: state.reader !== "guest",
        })
        const picture = (route) =>
          route.fulfill({ status: 200, contentType: "image/png", body: PICTURE })
        await context.route("https://cdn.discordapp.com/**", picture)
        await context.route(`${HOST}/api/avatar*`, picture)
        await context.route(`**/genes/v3/${SYMBOL}.json`, async (route) => {
          const response = await route.fetch()
          const gene = await response.json()
          await route.fulfill({ response, json: { ...gene, caretaker: state.caretaker } })
        })
        const page = await context.newPage()
        const errors = []
        page.on("pageerror", (error) => errors.push(String(error.message)))
        await page.goto(`${HOST}/gene/${SYMBOL}`)
        await page.waitForSelector("[data-icono-canonical-rail] [data-icono-request-dialog-open]", {
          timeout: 30_000,
        })
        if (state.reader === "own") {
          await page.waitForSelector("[data-icono-caretaker-open]", { timeout: 20_000 })
        }
        if (state.claim) {
          await page.waitForSelector(
            "[data-icono-caretaker-claim-action] button:not([aria-busy])",
            {
              timeout: 20_000,
            },
          )
        }
        await page.waitForTimeout(800)
        const seen = await page.evaluate(toolbarPlaces)
        await page.locator("[data-icono-canonical-rail]").scrollIntoViewIfNeeded()
        await page.screenshot({
          path: path.join(OUT, `gene-page-toolbar-${viewportName}-${state.id}.png`),
        })

        // 2, 3, 4.
        if (state.button instanceof RegExp) assert.match(seen.button, state.button, where)
        else assert.equal(seen.button, state.button, `${where}: caretaker button`)
        assert.equal(seen.own, state.reader === "own" ? "Your caretaker panel" : "", where)
        assert.equal(seen.overflow, 0, `${where}: the toolbar overflows`)
        for (const [name, box] of Object.entries(seen.fixed)) {
          assert.ok(box, `${where}: no ${name} button`)
        }
        places.push([state.id, JSON.stringify(seen.fixed)])

        // 5.
        if (state.id === "guest-nobody" && viewportName === "desktop") {
          await page.click(".icono-canonical-edit-btn")
          await page.waitForSelector("[data-icono-vote-login-prompt][open]", { timeout: 5_000 })
        }
        assert.deepEqual(errors, [], where)
        await context.close()
      }

      // 1.
      const distinct = new Set(places.map(([, fixed]) => fixed))
      assert.equal(
        distinct.size,
        1,
        `${viewportName}: the toolbar's buttons move between readers:\n` +
          places.map(([id, fixed]) => `  ${id}: ${fixed}`).join("\n"),
      )
    }
  } finally {
    await browser.close()
    server.close()
  }
})
