// B-839: the caretaker dialog is checked in a real browser, by computed geometry
// and fonts, instead of regexes over CSS and markup. Those regexes failed a pure
// refactor and passed while Close was clipped by 19 px.
//
// Ways the dialog has broken before, each asserted below at 400 and 1280 px, in
// light and dark:
// 1. the dialog is wider than the viewport;
// 2. the footer overflows horizontally;
// 3. a button sits outside the dialog (the clipped Close);
// 4. a button falls back from IBM Plex Mono;
// 5. the title renders in the blog serif;
// 6. the title and the Close button overlap;
// 7. a button label wraps onto a second line.
//
// Needs `pnpm run build` (public-iconoplasm-edge) and an installed Chrome.
// Screenshots and the measured geometry land in artifacts/e2e/.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, VIEWPORTS, launchChrome, routeProduction, startSite } from "./harness.mjs"

const DOSSIER = {
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
  manifestations: [
    {
      manifestation_id: "manifestation_current",
      author_is_viewer: true,
      belongs_to_current_assignment: true,
      can_withdraw: true,
      status: "active",
      row_version: 2,
      head_body: "A guardian in a lab coat who stops damaged cells from dividing.",
      revisions: [
        {
          manifestation_revision_id: "revision_2",
          revision_number: 2,
          lifecycle: "active",
          body: "A guardian in a lab coat who stops damaged cells from dividing.",
        },
        {
          manifestation_revision_id: "revision_1",
          revision_number: 1,
          lifecycle: "active",
          body: "A guardian who stops damaged cells.",
        },
      ],
    },
    {
      manifestation_id: "manifestation_seed",
      origin: "system_seed",
      author_is_viewer: false,
      can_withdraw: false,
      status: "active",
      revisions: [],
    },
  ],
}

function measure() {
  const rect = (el) => el && el.getBoundingClientRect()
  const dialog = document.querySelector(".icono-caretaker-dialog[open]")
  const footer = document.querySelector(".icono-caretaker-panel__footer")
  const title = document.querySelector(".icono-caretaker-panel__header h2")
  const close = document.querySelector(".icono-caretaker-dialog__close")
  const d = rect(dialog)
  const buttons = [...dialog.querySelectorAll("button, .icono-button")]
    .filter((el) => el.offsetParent)
    .map((el) => {
      const r = rect(el)
      const range = document.createRange()
      range.selectNodeContents(el)
      const lineTops = new Set([...range.getClientRects()].map((line) => Math.round(line.top)))
      return {
        lines: lineTops.size,
        text: el.textContent.trim().slice(0, 24),
        font: getComputedStyle(el).fontFamily,
        left: r.left,
        right: r.right,
        top: r.top,
        bottom: r.bottom,
        icon: el === close,
      }
    })
  const t = rect(title)
  const c = rect(close)
  return {
    viewport: innerWidth,
    theme: document.documentElement.getAttribute("saved-theme"),
    dialog: { left: d.left, right: d.right, top: d.top, bottom: d.bottom },
    footerOverflow: footer ? footer.scrollWidth - footer.clientWidth : 0,
    titleFont: title ? getComputedStyle(title).fontFamily : null,
    titleCloseOverlap:
      t && c
        ? !(t.right <= c.left || c.right <= t.left || t.bottom <= c.top || c.bottom <= t.top)
        : false,
    buttons,
  }
}

// B-862: a caretaker reaches their tools by clicking their own badge in the gene
// toolbar, not by reading a sentence that says where to go. Fails if the chip is
// not a button, lacks the Caretaker badge, or clicking it does not open the panel.
test("the caretaker's own toolbar badge opens the caretaker panel", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const [width, height, name] of VIEWPORTS) {
      const context = await browser.newContext({ viewport: { width, height } })
      await routeProduction(context, origin, (pathname, request) => {
        if (pathname === "/api/auth/me") {
          return {
            authenticated: true,
            user: {
              id: "u1",
              user_id: "u1",
              account_id: "u1",
              username: "e2e",
              avatar_url: "/api/avatar?src=e2e",
            },
          }
        }
        if (pathname.startsWith("/api/iconoplasm/caretaker/")) {
          return request.method() === "GET" ? DOSSIER : { ok: true }
        }
        return undefined
      })
      const page = await context.newPage()
      await page.goto(`${HOST}/gene/TP53`)
      const badge = await page.waitForSelector("button[data-icono-caretaker-open]", {
        timeout: 30_000,
      })
      assert.match(await badge.textContent(), /Caretaker/, `${name}: badge text`)
      assert.equal(
        await page.$(".icono-caretaker-dialog[open]"),
        null,
        `${name}: panel opened by itself`,
      )
      await badge.click()
      await page.waitForSelector(".icono-caretaker-dialog[open]", { timeout: 10_000 })
      await page.screenshot({ path: path.join(OUT, `caretaker-badge-${name}.png`) })
      await context.close()
    }
  } finally {
    server.close()
    await browser.close()
  }
})

test("the caretaker dialog fits, uses the UI fonts and never clips its buttons", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const report = []
  try {
    for (const [width, height, name] of VIEWPORTS) {
      for (const theme of ["light", "dark"]) {
        const context = await browser.newContext({ viewport: { width, height } })
        await context.addInitScript((value) => localStorage.setItem("theme", value), theme)
        await routeProduction(context, origin, (pathname, request) =>
          pathname.startsWith("/api/iconoplasm/caretaker/")
            ? request.method() === "GET"
              ? DOSSIER
              : { ok: true }
            : undefined,
        )
        const page = await context.newPage()
        await page.goto(`${HOST}/gene/TP53?caretaker=open`)
        await page.waitForSelector(".icono-caretaker-dialog[open]", { timeout: 30_000 })
        await page.evaluate(() => document.fonts.ready)
        await page.screenshot({ path: path.join(OUT, `caretaker-${name}-${theme}.png`) })
        const m = await page.evaluate(measure)
        report.push({ name, theme, ...m })
        const where = `${name}/${theme}`
        assert.ok(m.dialog.left >= 0 && m.dialog.right <= m.viewport + 0.5, `${where}: dialog fits`)
        assert.ok(m.footerOverflow <= 1, `${where}: footer overflows by ${m.footerOverflow}px`)
        for (const button of m.buttons) {
          assert.ok(
            button.left >= m.dialog.left - 0.5 && button.right <= m.dialog.right + 0.5,
            `${where}: "${button.text}" sits outside the dialog`,
          )
          if (!button.icon) {
            assert.match(button.font, /IBM Plex Mono/, `${where}: "${button.text}" font`)
          }
          assert.ok(
            button.lines <= 1,
            `${where}: "${button.text}" wraps onto ${button.lines} lines`,
          )
        }
        assert.doesNotMatch(String(m.titleFont), /Crimson/, `${where}: title in blog serif`)
        assert.equal(m.titleCloseOverlap, false, `${where}: title overlaps Close`)
        await context.close()
      }
    }
  } finally {
    writeFileSync(path.join(OUT, "caretaker-dialog-geometry.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})
