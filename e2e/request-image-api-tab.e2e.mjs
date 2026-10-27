// B-1181: the New candidate dialog's Image API tab, checked in a real browser.
// Owner decision (27 Oct 2026): "only introduce the tab for users who added a
// key in settings (pro users who seek it out deliberately) for now."
//
// Ways this can fail, written before the code:
// 1. a reader without an image API key sees the Free queue / Image API tabs,
//    or lands on the Image API panel because this browser used it last time
//    (a remembered tab, a stale "has a key" hint);
// 2. a reader with a saved key never sees the tabs, or is not taken back to
//    the Image API tab they used last;
// 3. with no last-used model the tab preselects the first model A to Z
//    (Gemini 3 Pro Image, twice Flash's price) instead of the provider's own
//    model (Gemini 3.1 Flash Image);
// 4. viewing a gene page asks the Worker for the provider list: only pointing
//    at New candidate or opening it may;
// 5. a key holder's second open in the same visit waits for the server before
//    the tabs show.
//
// Needs `pnpm run build` (public-iconoplasm-edge) and an installed Chrome.
// Screenshots land in artifacts/e2e/.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, VIEWPORTS, launchChrome, routeProduction, startSite } from "./harness.mjs"

const DIALOG = "[data-icono-request-dialog]"
const GEMINI = {
  provider_id: "gemini",
  label: "Gemini API",
  default_model: "gemini-3.1-flash-image",
  model_options: [
    { model: "gemini-3.1-flash-image", label: "Gemini 3.1 Flash Image", generate_capable: true },
    { model: "gemini-3-pro-image", label: "Gemini 3 Pro Image", generate_capable: true },
    {
      model: "gemini-3.1-flash-lite-image",
      label: "Gemini 3.1 Flash Lite Image",
      generate_capable: true,
    },
  ],
}

function createApi(providers) {
  let providerCalls = 0
  const api = (pathname) => {
    if (/^\/api\/iconoplasm\/requests\/gene\/[^/]+\/summary$/.test(pathname)) {
      return { authenticated: true, my_lane_summary: [], gene_lane_summary: [] }
    }
    if (pathname === "/api/iconoplasm/image-edit/providers") {
      providerCalls += 1
      return {
        ok: true,
        authenticated: true,
        encryption_configured: true,
        providers,
        supported_providers: [GEMINI],
        last_used: null,
      }
    }
    return undefined
  }
  api.providerCalls = () => providerCalls
  return api
}

// Runs in the page: what the reader can see of the method switch.
function measureTabs() {
  const dialog = document.querySelector("[data-icono-request-dialog]")
  const tabs = dialog.querySelector(".icono-request-tabs")
  const lane = (name) => dialog.querySelector(`[data-icono-request-lane='${name}']`)
  const select = dialog.querySelector("[data-icono-request-provider]")
  return {
    tabsVisible: !!tabs && tabs.checkVisibility(),
    selected: dialog.querySelector("[data-icono-request-tab][aria-selected='true']")?.dataset
      .iconoRequestTab,
    freeVisible: lane("free").checkVisibility(),
    apiVisible: lane("api").checkVisibility(),
    model: select ? select.value : "",
    hint: localStorage.getItem("iconoplasm.has-image-api-key"),
  }
}

async function openGene(browser, origin, viewport, providers, storage) {
  const context = await browser.newContext({ viewport })
  await context.addInitScript((values) => {
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value)
  }, storage)
  const api = createApi(providers)
  await routeProduction(context, origin, api)
  const page = await context.newPage()
  await page.goto(`${HOST}/gene/TP53`)
  await page.waitForSelector("[data-icono-request-dialog-open]", { timeout: 30_000 })
  return { context, page, api }
}

async function open(page) {
  // A real click, so the pointer passes over the button first as a mouse would.
  await page.click("[data-icono-request-dialog-open]")
  await page.waitForSelector(`${DIALOG}[open]`)
}

test("the Image API tab shows only for a reader with a saved image API key", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    for (const [width, height, size] of VIEWPORTS) {
      const shot = (name) => path.join(OUT, `image-api-tab-${size}-${name}.png`)

      // 1 and 4: no key, but this browser used the Image API tab last and
      // still holds the "has a key" hint from an account that had one.
      {
        const { context, page, api } = await openGene(browser, origin, { width, height }, [], {
          "iconoplasm.new-candidate-tab": "api",
          "iconoplasm.has-image-api-key": "1",
        })
        await page.waitForTimeout(1_500)
        assert.equal(api.providerCalls(), 0, `${size}: a page view asked for the provider list`)
        await open(page)
        await page.waitForFunction(
          () => !document.querySelector(".icono-request-tabs").checkVisibility(),
          null,
          { timeout: 10_000 },
        )
        const m = await page.evaluate(measureTabs)
        await page.screenshot({ path: shot("no-key") })
        assert.equal(m.tabsVisible, false, `${size}: tabs shown without a key`)
        assert.equal(m.freeVisible, true, `${size}: the free grid is hidden`)
        assert.equal(m.apiVisible, false, `${size}: the Image API panel is shown without a key`)
        assert.equal(m.hint, null, `${size}: the stale hint survived`)
        await context.close()
      }

      // 1: a reader who never had a key sees no tabs at any moment.
      {
        const { context, page } = await openGene(browser, origin, { width, height }, [], {})
        await open(page)
        const m = await page.evaluate(measureTabs)
        assert.equal(m.tabsVisible, false, `${size}: tabs flashed for a reader without a key`)
        await context.close()
      }

      // 2, 3 and 5: a Gemini key saved in Settings, Image API used last time.
      {
        const { context, page, api } = await openGene(
          browser,
          origin,
          { width, height },
          [{ provider_id: "gemini", configured: true, model: "gemini-3.1-flash-image" }],
          { "iconoplasm.new-candidate-tab": "api" },
        )
        await open(page)
        await page.waitForFunction(
          () => {
            const select = document.querySelector("[data-icono-request-provider]")
            return (
              document.querySelector(".icono-request-tabs").checkVisibility() &&
              select &&
              select.value
            )
          },
          null,
          { timeout: 10_000 },
        )
        let m = await page.evaluate(measureTabs)
        await page.screenshot({ path: shot("key-holder") })
        assert.equal(m.tabsVisible, true, `${size}: a key holder sees no tabs`)
        assert.equal(m.selected, "api", `${size}: not back on the Image API tab`)
        assert.equal(m.apiVisible, true, `${size}: the Image API panel is hidden`)
        assert.equal(
          m.model,
          "gemini:gemini-3.1-flash-image",
          `${size}: preselected ${m.model}, not the provider's own model`,
        )

        await page.keyboard.press("Escape")
        await page.waitForSelector(`${DIALOG}[open]`, { state: "detached" })
        const calls = api.providerCalls()
        await open(page)
        m = await page.evaluate(measureTabs)
        assert.equal(m.tabsVisible, true, `${size}: the second open hid the tabs`)
        assert.equal(api.providerCalls(), calls, `${size}: the second open asked again`)
        await context.close()
      }
    }
  } finally {
    server.close()
    await browser.close()
  }
})
