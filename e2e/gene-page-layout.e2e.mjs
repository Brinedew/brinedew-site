// B-1096: the gene page's controls stay on one sizing system (the tokens comment
// at the top of quartz/static/iconoplasm/styles.css). On 2026-10-16 the live page
// had controls of 36, 37.7, 37.8, 40.8 and 44 px and icons of 16 to 20 px, a
// toolbar that floated apart from its card, an edit button 14 px over the print
// button, and a viewer that opened when a drag ended on a portrait.
//
// Ways this can fail, written before the check:
// 1. A control in the toolbar or a tile footer is not 40 px tall, or its glyph
//    is not 16 px square.
// 2. Controls in one row don't share a vertical centre.
// 3. Two controls overlap, or a row's gap is off the 4 px grid.
// 4. A label isn't 13 px.
// 5. The toolbar leaves its card: different left or right edge, or a seam.
// 6. Tiles' footers sit at different heights (portraits come at 7:9 and 3:4).
// 7. A tile footer shows more than four controls (✓ ✗ ☆ ⋮), for any reader.
// 8. A score shows that isn't the published tally, or shows when it isn't
//    positive.
// 9. ⋮ opens nothing, or its menu leaves the window, or Escape leaves it open.
// 10. The toolbar folds into ⋮ when it fits, or overflows when it doesn't; a ⋮
//     shows with nothing in it, or none shows while actions are folded; the
//     folded row still overflows, or squeezes an item (the id cut to "A…").
// 11. Ending a drag on a portrait opens the viewer; a second click stacks a
//     second viewer.
// 12. A tile loses the asset attribute the caretaker's "Made from version N"
//     link hangs on.
// 13. A handwritten note on the label covers a printed option's words (on
//     2026-10-29 every phone drew "pro-control" across "TUMOR SUPPRESSOR").
//
// What is real: the built site, TP53's published candidates and tallies,
// PhotoSwipe, Embla, Chrome. The signed-in reader (an admin who looks after
// MFNG) is mocked at /api/*. Screenshots land in artifacts/e2e.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, VIEWPORTS, launchChrome, routeProduction, startSite } from "./harness.mjs"

const SYMBOL = "TP53"
const STRIP = "[data-icono-candidate-strip]"

const SIGNED_IN = (pathname) => {
  if (pathname === "/api/auth/me") {
    return {
      authenticated: true,
      user: { id: "u1", user_id: "u1", account_id: "u1", username: "e2e", is_admin: true },
    }
  }
  if (pathname === "/api/iconoplasm/caretaker/me") {
    return {
      ok: true,
      caretaker: {
        caretaker_assignment_id: "a1",
        canonical_symbol: "MFNG",
        assignment_status: "active",
        href: "/gene/MFNG",
      },
    }
  }
  if (pathname === `/api/iconoplasm/caretaker/genes/${SYMBOL}/claim`) {
    return {
      enabled: true,
      gene: { gene_id: "HGNC:11998", canonical_symbol: SYMBOL },
      claim: {
        available: true,
        reason: null,
        mode: "switch",
        switch_from: {
          caretaker_assignment_id: "a1",
          canonical_symbol: "MFNG",
          assignment_version: 1,
          gene_revision: 0,
          terms_version_id: "terms_2026_09_25_v4",
        },
        gene_revision: 0,
        entitlement_policy_version: "caretaker_entitlement_v1",
        terms: {
          terms_version_id: "terms_2026_09_25_v4",
          document_url: "/caretaker-terms",
          display_label: "Caretaker terms",
        },
      },
    }
  }
  return undefined
}

// Runs in the page: every rule above that geometry can answer, as a list of
// sentences. Rows are the toolbar and the footer of each fully shown tile.
function layoutProblems() {
  const problems = []
  const box = (el) => el.getBoundingClientRect()
  const near = (a, b, tolerance = 0.5) => Math.abs(a - b) <= tolerance
  const round = (n) => Math.round(n * 10) / 10
  const shown = (el) => el.checkVisibility() && box(el).width > 0 && !el.closest("[popover]")
  const name = (el) =>
    el.getAttribute("aria-label") ||
    el.textContent.trim().replace(/\s+/g, " ").slice(0, 24) ||
    String(el.className).split(" ")[0]

  const rail = document.querySelector(".icono-gene-toolbar-rail")
  const card = document.querySelector(".icono-gene-lead-card")
  const viewport = box(document.querySelector("[data-icono-strip-viewport]"))
  const tiles = [
    ...document.querySelectorAll(".icono-candidate-grid > .icono-candidate-card"),
  ].filter((tile) => box(tile).left >= viewport.left - 1 && box(tile).right <= viewport.right + 1)
  const rows = [["toolbar", rail]]
  tiles.forEach((tile, i) =>
    rows.push([`tile ${i + 1}`, tile.querySelector(".icono-candidate-footer")]),
  )

  for (const [rowName, row] of rows) {
    // The vote box is one control: ⇧, the score, ⇩.
    const controls = [
      ...row.querySelectorAll(".icono-vote-box, button, .icono-button, summary"),
    ].filter((el) => shown(el) && (el.matches(".icono-vote-box") || !el.closest(".icono-vote-box")))
    const centre = controls.length ? box(controls[0]).top + box(controls[0]).height / 2 : 0

    for (const el of controls) {
      const b = box(el)
      if (!near(b.height, 40))
        problems.push(`${rowName}: ${name(el)} is ${round(b.height)} px tall`)
      if (
        el.matches(
          ".icono-vote-box, .icono-button--icon, [class*='icon-btn'], .icono-emulsion-favorite-button--toolbar",
        )
      ) {
        if (!el.matches(".icono-vote-box") && !near(b.width, 40)) {
          problems.push(`${rowName}: ${name(el)} is ${round(b.width)} px wide`)
        }
      }
      const label =
        [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) ||
        [...el.querySelectorAll("span")].some(
          (s) =>
            shown(s) &&
            s.textContent.trim() &&
            !s.matches(".icono-vote-score, .icono-visually-hidden, .sr-only"),
        )
      if (label && getComputedStyle(el).fontSize !== "13px") {
        problems.push(`${rowName}: ${name(el)} label is ${getComputedStyle(el).fontSize}`)
      }
    }
    for (const el of controls) {
      const b = box(el)
      if (!near(b.top + b.height / 2, centre)) {
        problems.push(
          `${rowName}: ${name(el)} is off the row's centre by ${round(b.top + b.height / 2 - centre)} px`,
        )
      }
    }
    for (const svg of row.querySelectorAll("svg")) {
      if (!shown(svg)) continue
      const b = box(svg)
      if (!near(b.width, 16) || !near(b.height, 16)) {
        problems.push(
          `${rowName}: an icon in ${name(svg.closest("button, .icono-button") || svg)} is ${round(b.width)}×${round(b.height)}`,
        )
      }
    }
    const items = controls
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        const a = box(items[i])
        const b = box(items[j])
        const overlap =
          Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5
        if (overlap) problems.push(`${rowName}: ${name(items[i])} overlaps ${name(items[j])}`)
      }
    }
    for (const el of [row, ...row.querySelectorAll("*")]) {
      if (!shown(el)) continue
      const style = getComputedStyle(el)
      if (!/flex|grid/.test(style.display)) continue
      const gap = parseFloat(style.columnGap)
      if (Number.isFinite(gap) && Math.abs(gap / 4 - Math.round(gap / 4)) > 0.01) {
        problems.push(`${rowName}: ${String(el.className).split(" ")[0]} gap is ${gap} px`)
      }
    }
  }

  const footerCount = (tile) =>
    [
      ...tile.querySelectorAll(".icono-candidate-footer button, .icono-candidate-footer summary"),
    ].filter(shown).length
  for (const [i, tile] of tiles.entries()) {
    if (footerCount(tile) !== 4)
      problems.push(`tile ${i + 1} footer shows ${footerCount(tile)} controls`)
  }
  const tops = tiles.map((tile) => box(tile.querySelector(".icono-candidate-footer")).top)
  if (tops.some((top) => !near(top, tops[0]))) {
    problems.push(`tile footers sit at ${tops.map(round).join(", ")}`)
  }

  const r = box(rail)
  const c = box(card)
  if (!near(r.left, c.left) || !near(r.right, c.right)) {
    problems.push(
      `toolbar spans ${round(r.left)}–${round(r.right)}, its card ${round(c.left)}–${round(c.right)}`,
    )
  }
  if (!near(r.top, c.bottom, 1))
    problems.push(`toolbar starts ${round(r.top - c.bottom)} px below its card`)
  return problems
}

// Runs in the page: whether the toolbar folds exactly when its full row overflows.
function toolbarFit() {
  const rail = document.querySelector(".icono-gene-toolbar-rail")
  const collapsed = rail.classList.contains("is-collapsed")
  rail.classList.remove("is-collapsed")
  rail.classList.add("is-measuring")
  // A rail whose caretaker line has its own row wraps instead of scrolling, so
  // the buttons overflow when they drop under the gene's name, not when the rail
  // grows wider.
  const meta = rail.querySelector(".icono-canonical-toolbar-meta")
  const actions = rail.querySelector(".icono-canonical-toolbar-actions")
  const overflows =
    rail.scrollWidth > rail.clientWidth + 1 ||
    (!!meta && !!actions && actions.offsetTop >= meta.offsetTop + meta.offsetHeight)
  rail.classList.remove("is-measuring")
  if (collapsed) rail.classList.add("is-collapsed")
  const more = rail.querySelector(".icono-toolbar-more")
  const clipped = [...rail.querySelectorAll("button")]
    .filter((el) => el.checkVisibility() && el.scrollWidth > el.clientWidth + 1)
    .map((el) => (el.getAttribute("aria-label") || el.textContent).trim().slice(0, 24))
  return {
    collapsed,
    overflows,
    foldable: rail.querySelectorAll(".icono-toolbar-menu button").length > 0,
    moreShown: !!more && more.checkVisibility(),
    stillOverflows: rail.scrollWidth > rail.clientWidth + 1,
    clipped,
  }
}

// Runs in the page: each handwritten note on the lead card that covers a printed
// option's letters, as "note over option". The words are drawn, not text, so the
// letters are taken as the middle half of the option's line; a note that only
// grazes the line, as "female" does above SOLUBLE, is fine.
function notesOverPrintedWords() {
  const card = document.querySelector(".icono-gene-lead-card")
  const words = [...card.querySelectorAll(".icono-label-option")].map((option) => {
    const box = option.getBoundingClientRect()
    const inset = box.height / 4
    return {
      name: option.className.match(/icono-label-option--(\S+)/)?.[1] ?? "option",
      left: box.left,
      right: box.right,
      top: box.top + inset,
      bottom: box.bottom - inset,
    }
  })
  return [...card.querySelectorAll(".icono-label-hand-note")]
    .filter((note) => note.textContent.trim() && note.checkVisibility())
    .flatMap((note) => {
      const n = note.getBoundingClientRect()
      return words
        .filter((w) => n.left < w.right && n.right > w.left && n.top < w.bottom && n.bottom > w.top)
        .map((w) => `${note.textContent.trim()} over ${w.name}`)
    })
}

// Runs in the page: each tile's shown score next to its vote box's asset.
function shownScores() {
  return [...document.querySelectorAll("[data-icono-candidate-vote-box]")].map((box) => [
    String(box.getAttribute("data-icono-candidate-vote-box") || "").toLowerCase(),
    (box.querySelector(".icono-vote-score")?.textContent || "").trim(),
  ])
}

// Runs in the page: the index of the first tile fully inside the strip.
// The tile that shows the most of itself. The strip drags freely (owner,
// 2026-10-17), so after a drag it can rest with no tile fully in view.
function mostShownTile() {
  const viewport = document.querySelector("[data-icono-strip-viewport]").getBoundingClientRect()
  let best = -1
  let shown = 0
  ;[...document.querySelectorAll(".icono-candidate-grid > .icono-candidate-card")].forEach(
    (tile, index) => {
      const b = tile.getBoundingClientRect()
      const width = Math.min(b.right, viewport.right) - Math.max(b.left, viewport.left)
      if (width > shown) {
        shown = width
        best = index
      }
    },
  )
  return best
}

// The track's sideways offset; it stops changing once a drag's glide ends.
function trackOffset() {
  const track = document.querySelector("[data-icono-candidate-strip] .icono-candidate-grid")
  return new DOMMatrixReadOnly(getComputedStyle(track).transform).m41
}

function firstWholeTile() {
  const viewport = document.querySelector("[data-icono-strip-viewport]").getBoundingClientRect()
  return [...document.querySelectorAll(".icono-candidate-grid > .icono-candidate-card")].findIndex(
    (tile) => {
      const b = tile.getBoundingClientRect()
      return b.left >= viewport.left - 1 && b.right <= viewport.right + 1
    },
  )
}

test("gene page layout: TP53's toolbar and tiles stay on one sizing system", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const [width, height, viewportName] of VIEWPORTS) {
      for (const reader of ["guest", "signed-in"]) {
        const name = `${viewportName} ${reader}`
        const context = await browser.newContext({ viewport: { width, height } })
        await routeProduction(context, origin, reader === "guest" ? () => undefined : SIGNED_IN, {
          session: reader !== "guest",
        })
        const page = await context.newPage()
        const errors = []
        page.on("pageerror", (error) => errors.push(String(error.message)))
        await page.goto(`${HOST}/gene/${SYMBOL}`)
        await page.waitForSelector(`${STRIP}.is-strip-ready`, { timeout: 30_000 })
        await page.waitForSelector(".icono-gene-toolbar-rail", { timeout: 30_000 })
        if (reader === "signed-in") {
          await page
            .waitForSelector(".icono-gene-toolbar-rail [data-icono-caretaker-claim-open]", {
              timeout: 15_000,
            })
            .catch(() => {})
        }
        await page.waitForTimeout(1500)
        await page.screenshot({
          path: path.join(OUT, `gene-page-layout-${viewportName}-${reader}.png`),
        })

        // 1–7.
        assert.deepEqual(await page.evaluate(layoutProblems), [], `${name}: layout`)

        // 10.
        const fit = await page.evaluate(toolbarFit)
        assert.equal(
          fit.collapsed,
          fit.overflows,
          `${name}: toolbar folded=${fit.collapsed} but overflows=${fit.overflows}`,
        )
        assert.equal(
          fit.moreShown,
          fit.collapsed && fit.foldable,
          `${name}: the toolbar's ⋮ shows=${fit.moreShown}, folded=${fit.collapsed}, ` +
            `something to fold=${fit.foldable}`,
        )
        assert.equal(fit.stillOverflows, false, `${name}: the toolbar still overflows`)
        assert.deepEqual(fit.clipped, [], `${name}: toolbar items cut short`)

        // 13.
        assert.deepEqual(
          await page.evaluate(notesOverPrintedWords),
          [],
          `${name}: handwriting covers printed words`,
        )

        // 12: every tile names its picture, which the caretaker's "Made from
        // version N" link needs (B-1095's strip dropped it and the links vanished).
        const unnamed = await page.$$eval(
          `${STRIP} .icono-candidate-grid > .icono-candidate-card`,
          (tiles) =>
            tiles.filter((tile) => !tile.getAttribute("data-icono-candidate-asset")).length,
        )
        assert.equal(unnamed, 0, `${name}: ${unnamed} tiles lack data-icono-candidate-asset`)

        // 8: a guest sees the published tally.
        if (reader === "guest") {
          const payload = await (
            await context.request.get(`https://img.brinedew.bio/genes/v3/${SYMBOL}.json`)
          ).json()
          const expected = new Map(
            payload.portrait_candidates.map((candidate) => {
              const score =
                Math.max(0, Number(candidate.image_upvotes || 0)) -
                Math.max(0, Number(candidate.image_downvotes || 0))
              return [String(candidate.asset_sha256).toLowerCase(), score > 0 ? `+${score}` : ""]
            }),
          )
          const shown = await page.evaluate(shownScores)
          assert.ok(shown.length > 0, `${name}: no vote boxes`)
          for (const [sha, text] of shown) {
            assert.equal(
              text,
              expected.get(sha) ?? "",
              `${name}: ${sha.slice(0, 12)} shows "${text}"`,
            )
          }
        }

        // 9.
        const index = await page.evaluate(firstWholeTile)
        const tile = page
          .locator(`${STRIP} .icono-candidate-grid > .icono-candidate-card`)
          .nth(index)
        await tile.locator(".icono-candidate-more").click()
        const menu = page.locator(".icono-candidate-menu:popover-open")
        await menu.waitFor({ timeout: 3_000 })
        const menuBox = await menu.evaluate((el) => {
          const b = el.getBoundingClientRect()
          const rows = [...el.querySelectorAll(".icono-candidate-menu-item")].filter((row) =>
            row.checkVisibility(),
          )
          return {
            inside: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight,
            rows: rows.map((row) => Math.round(row.getBoundingClientRect().height)),
          }
        })
        assert.ok(menuBox.inside, `${name}: the ⋮ menu leaves the window`)
        assert.ok(menuBox.rows.length > 0, `${name}: the ⋮ menu is empty`)
        assert.ok(
          menuBox.rows.every((h) => h === 40),
          `${name}: menu rows are ${menuBox.rows.join(", ")} px`,
        )
        await page.screenshot({
          path: path.join(OUT, `gene-page-layout-${viewportName}-${reader}-menu.png`),
        })
        await page.keyboard.press("Escape")
        await page
          .waitForSelector(".icono-candidate-menu:popover-open", {
            state: "detached",
            timeout: 3_000,
          })
          .catch(() => {})
        assert.equal(
          await page.locator(".icono-candidate-menu:popover-open").count(),
          0,
          `${name}: Escape left the menu open`,
        )

        // 11, once per viewport.
        if (reader === "guest") {
          const media = tile.locator(".icono-candidate-media-button")
          const b = await media.boundingBox()
          await page.mouse.move(b.x + b.width * 0.8, b.y + b.height / 2)
          await page.mouse.down()
          for (let step = 1; step <= 10; step += 1) {
            await page.mouse.move(b.x + b.width * 0.8 - step * (b.width * 0.06), b.y + b.height / 2)
          }
          await page.mouse.up()
          // Let the glide end before reading where the strip rests.
          {
            const deadline = Date.now() + 5_000
            let last = await page.evaluate(trackOffset)
            for (;;) {
              await page.waitForTimeout(200)
              const now = await page.evaluate(trackOffset)
              if (Math.abs(now - last) < 0.5 || Date.now() > deadline) break
              last = now
            }
          }
          assert.equal(
            await page.locator(".pswp").count(),
            0,
            `${name}: ending a drag opened the viewer`,
          )

          // Click the shown part of that tile with the mouse: a locator click
          // would first scroll a half-shown tile into view, moving the strip
          // under Embla.
          const shown = await page.evaluate(mostShownTile)
          const point = await page.evaluate((index) => {
            const viewport = document
              .querySelector("[data-icono-strip-viewport]")
              .getBoundingClientRect()
            const media = document
              .querySelectorAll(".icono-candidate-grid > .icono-candidate-card")
              [index].querySelector(".icono-candidate-media-button")
              .getBoundingClientRect()
            const left = Math.max(media.left, viewport.left)
            const right = Math.min(media.right, viewport.right)
            return { x: (left + right) / 2, y: media.top + media.height / 2 }
          }, shown)
          await page.mouse.click(point.x, point.y)
          await page.waitForSelector(".pswp--open", { timeout: 5_000 })
          // A second press on the same tile while the viewer is open.
          await page.evaluate((index) => {
            document
              .querySelectorAll(".icono-candidate-grid > .icono-candidate-card")
              [index].querySelector(".icono-candidate-media-button")
              .click()
          }, shown)
          await page.waitForTimeout(500)
          assert.equal(
            await page.locator(".pswp").count(),
            1,
            `${name}: a second click stacked a viewer`,
          )
          await page.keyboard.press("Escape")
          await page.waitForSelector(".pswp", { state: "detached", timeout: 5_000 })
        }

        assert.deepEqual(errors, [], `${name}: page errors`)
        await context.close()
      }
    }
  } finally {
    await browser.close()
    server.close()
  }
})
