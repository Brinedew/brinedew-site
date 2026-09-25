// B-839: the shared button system (B-835) checked in a real browser, by computed
// style, on the surfaces that used to be pinned by CSS regexes: the request
// picker's two tabs, the image-edit dialog and the logged-out Join Discord
// prompt. Each is opened at 400 and 1280 px, in light and dark.
//
// Ways these surfaces have broken before, each asserted below:
// 1. a button label wraps onto a second line (the counted batch action);
// 2. a button falls back from IBM Plex Mono to a page display font;
// 3. a button sits outside its dialog;
// 4. the primary button is not dark ink that inverts with the theme;
// 5. a disabled button keeps a filled, translucent pill background;
// 6. image-edit controls use the display face, or its values lose it.
//
// Needs `pnpm run build` (public-iconoplasm-edge) and an installed Chrome.
// Screenshots and the measurements land in artifacts/e2e/.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import {
  HOST,
  OUT,
  VIEWPORTS,
  launchChrome,
  measureButtons,
  routeProduction,
  startSite,
} from "./harness.mjs"

const SIGNED_IN = (pathname) => {
  if (/^\/api\/iconoplasm\/requests\/gene\/[^/]+\/summary$/.test(pathname)) {
    return { authenticated: true, my_lane_summary: [], gene_lane_summary: [] }
  }
  if (pathname === "/api/iconoplasm/requests/options") {
    return {
      request_options: [
        { emulsion_id: "E2E-1", label: "Copperplate etching", vote_h_index: 3, live_count: 2 },
        { emulsion_id: "E2E-2", label: "Noir", vote_h_index: 1, live_count: 1 },
      ],
    }
  }
  if (pathname === "/api/iconoplasm/image-edit/providers") {
    return {
      providers: [{ provider_id: "openai" }],
      supported_providers: [
        {
          provider_id: "openai",
          label: "OpenAI",
          model_options: [{ model: "gpt-image-1", label: "GPT Image 1" }],
        },
      ],
      last_used: null,
      encryption_configured: true,
    }
  }
  return undefined
}
const GUEST = (pathname) => (pathname === "/api/auth/me" ? { authenticated: false } : undefined)

const REQUEST = "[data-icono-request-dialog]"
const EDIT = "[data-icono-image-edit-dialog]"

async function openRequest(page, tab) {
  await page.click("[data-icono-request-dialog-open]")
  await page.waitForSelector(`${REQUEST}[open]`)
  if (tab) {
    await page.click(`[data-icono-request-tab='${tab}']`)
    await page.waitForSelector(`[data-icono-request-lane='${tab}']:not([hidden])`)
  }
}

const SURFACES = [
  {
    name: "request-free",
    api: SIGNED_IN,
    root: REQUEST,
    open: (page) => openRequest(page, "free"),
    ready: "[data-icono-request-free-submit]",
  },
  {
    name: "request-api",
    api: SIGNED_IN,
    root: REQUEST,
    open: (page) => openRequest(page, "api"),
    ready: "[data-icono-request-image-generate]",
  },
  {
    name: "image-edit",
    api: SIGNED_IN,
    root: EDIT,
    open: async (page) => {
      // The edit control is revealed on hover at desktop width; the click is what matters.
      await page.$eval("[data-icono-edit-source]", (button) => button.click())
      await page.waitForSelector(`${EDIT}[open]`)
    },
    ready: ".icono-image-edit-adjustment-value",
  },
  {
    name: "guest-join",
    api: GUEST,
    root: REQUEST,
    open: (page) => openRequest(page),
    ready: `${REQUEST} .icono-button--primary`,
  },
]

// Runs in the page: fonts of the image-edit controls, including shadow parts.
function editFonts() {
  const dialog = document.querySelector("[data-icono-image-edit-dialog]")
  const font = (el) => (el ? getComputedStyle(el).fontFamily : null)
  const part = (host, name) => host?.shadowRoot?.querySelector(`[part~="${name}"]`)
  const checkbox = dialog.querySelector(".icono-image-edit-adjustment-row sl-checkbox")
  const select = dialog.querySelector("sl-select")
  return {
    checkboxLabel: font(part(checkbox, "label")),
    selectLabel: font(part(select, "form-control-label")),
    selectValue: font(part(select, "display-input")),
    adjustmentValue: font(dialog.querySelector(".icono-image-edit-adjustment-value")),
  }
}

// Relative luminance of an [r, g, b] colour in 0-255.
function luminance([r, g, b]) {
  const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

test("buttons keep one face, one line and the ink primary on every modal surface", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const report = []
  try {
    for (const surface of SURFACES) {
      for (const [width, height, size] of VIEWPORTS) {
        for (const theme of ["light", "dark"]) {
          const where = `${surface.name}/${size}/${theme}`
          const context = await browser.newContext({ viewport: { width, height } })
          await context.addInitScript((value) => localStorage.setItem("theme", value), theme)
          await routeProduction(context, origin, surface.api)
          const page = await context.newPage()
          await page.goto(`${HOST}/gene/TP53`)
          await page.waitForSelector("[data-icono-request-dialog-open]", { timeout: 30_000 })
          await surface.open(page)
          await page.waitForSelector(surface.ready, { state: "attached", timeout: 15_000 })
          await page.evaluate(() => document.fonts.ready)
          await page.waitForTimeout(400) // dialog open animation
          await page.screenshot({
            path: path.join(OUT, `buttons-${where.replaceAll("/", "-")}.png`),
          })
          const m = await page.evaluate(measureButtons, surface.root)
          const fonts = surface.root === EDIT ? await page.evaluate(editFonts) : null
          report.push({ where, ...m, fonts })

          // A value escaped for text but not for attributes splits into junk
          // attribute names (seen live: `sex":"female"` on the Edit blot button).
          const badAttributes = await page.evaluate(() =>
            [...document.querySelectorAll("*")].flatMap((el) =>
              [...el.attributes]
                .filter((a) => !/^[a-z_:][a-z0-9_.:-]*$/i.test(a.name))
                .map((a) => `${el.tagName.toLowerCase()} ${a.name}`),
            ),
          )
          assert.deepEqual(badAttributes.slice(0, 5), [], `${where}: malformed attributes`)

          if (surface.root === EDIT) {
            // B-862: the blot edit control adjusts an image, so it shows sliders, not a pencil.
            const icon = await page.$eval("[data-icono-edit-source] svg", (svg) =>
              svg.getAttribute("data-icono-icon"),
            )
            assert.equal(icon, "sliders", `${where}: blot edit icon`)
          }

          const actions = m.buttons.filter((b) => /\bicono-button\b/.test(b.className))
          assert.ok(actions.length > 0, `${where}: no shared buttons found`)
          for (const b of actions) {
            assert.match(b.font, /IBM Plex Mono/, `${where}: "${b.text}" font`)
            assert.ok(b.lines <= 1, `${where}: "${b.text}" wraps onto ${b.lines} lines`)
            assert.ok(
              b.left >= m.root.left - 0.5 && b.right <= m.root.right + 0.5,
              `${where}: "${b.text}" sits outside the dialog`,
            )
            if (b.disabled) {
              assert.equal(b.backgroundRgba[3], 0, `${where}: disabled "${b.text}" is filled`)
            }
          }
          for (const b of actions.filter((a) => /--primary/.test(a.className) && !a.disabled)) {
            const lum = luminance(b.backgroundRgba)
            if (theme === "light") assert.ok(lum < 0.06, `${where}: primary "${b.text}" is not ink`)
            else assert.ok(lum > 0.5, `${where}: primary "${b.text}" does not invert in dark`)
          }
          if (fonts) {
            assert.match(fonts.checkboxLabel, /IBM Plex Mono/, `${where}: checkbox label`)
            assert.match(fonts.selectLabel, /IBM Plex Mono/, `${where}: select label`)
            assert.match(fonts.selectValue, /Special Elite/, `${where}: select value`)
            assert.match(fonts.adjustmentValue, /Special Elite/, `${where}: adjustment value`)
          }
          await context.close()
        }
      }
    }
  } finally {
    writeFileSync(path.join(OUT, "button-system.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})
