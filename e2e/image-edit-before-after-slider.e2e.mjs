// Regression coverage for Cluster 1:
// - B-1228: before/after image comparison slider must align "Before" and "After"
//   images identically with zero margin shift, zero inline gap, matching shadow
//   wrappers (.first and .second), and zero bottom clipping across desktop and
//   phone viewports and slight aspect-ratio differences.
// - B-1230: Editing API dropdown lists only the two active local free models
//   (FLUX.3 Klein default + Qwen-Image-2.1 Turbo without INT8).
// - B-1231: returning from an external tab while an order is open refreshes an
//   initially empty Ready inbox and shows the Ready popup notice immediately.
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import path from "node:path"
import test from "node:test"

import { HOST, launchChrome, routeProduction, startSite } from "./harness.mjs"

function svgPortrait(width, height, label, fill) {
  const cx = width / 2
  const cy = height / 2
  const rx = Math.round(Math.min(width, height) * 0.24)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="${fill}"/>` +
    `<rect x="10" y="10" width="${width - 20}" height="${height - 20}" fill="none" stroke="#1b120b" stroke-width="6"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${rx}" fill="none" stroke="#8b2615" stroke-width="6"/>` +
    `<text x="${cx}" y="54" text-anchor="middle" font-size="28" fill="#1b120b">${label} ${width}x${height}</text>` +
    `</svg>`
  )
}

function providersPayload() {
  return {
    ok: true,
    encryption_configured: false,
    supported_providers: [
      {
        provider_id: "comfyui",
        label: "ComfyUI Workstation",
        default_model: "flux-3-klein",
        free_queue: true,
        capabilities: ["edit"],
        model_options: [
          {
            model: "flux-3-klein",
            label: "(Free) FLUX.3 Klein",
            pricing_label: "Free · queued",
            free_queue: true,
            edit_capable: true,
            generate_capable: false,
          },
          {
            model: "qwen-image-2.1-turbo",
            label: "(Free) Qwen-Image-2.1 Turbo",
            pricing_label: "Free · queued",
            free_queue: true,
            edit_capable: true,
            generate_capable: false,
          },
        ],
      },
    ],
    configured_providers: [],
    last_used: null,
  }
}

function editJobPayload({ jobId, beforeUrl, afterUrl }) {
  return {
    ok: true,
    job: {
      id: jobId,
      status: "succeeded",
      provider_id: "comfyui",
      model: "flux-3-klein",
      source_gene_symbol: "TP53",
      source_asset_sha256: "a".repeat(64),
      published: false,
      source_asset: { renditions: { medium: { canonical_url: beforeUrl } } },
      result_asset: { renditions: { medium: { canonical_url: afterUrl } } },
    },
  }
}

async function measureComparisonGeometry(page) {
  return page.evaluate(() => {
    const slider = document.querySelector("[data-icono-image-edit-comparison]")
    const before = document.querySelector("[data-icono-image-edit-before]")
    const after = document.querySelector("[data-icono-image-edit-after]")
    const first = slider && slider.shadowRoot && slider.shadowRoot.querySelector(".first")
    const second = slider && slider.shadowRoot && slider.shadowRoot.querySelector(".second")
    if (!slider || !before || !after || !first || !second) return null
    const sr = slider.getBoundingClientRect()
    const csSlider = getComputedStyle(slider)
    const innerTop = sr.top + parseFloat(csSlider.borderTopWidth || "0")
    const innerBottom = sr.bottom - parseFloat(csSlider.borderBottomWidth || "0")
    const innerLeft = sr.left + parseFloat(csSlider.borderLeftWidth || "0")
    const innerWidth = slider.clientWidth
    const innerHeight = slider.clientHeight
    const fr = first.getBoundingClientRect()
    const secr = second.getBoundingClientRect()
    const br = before.getBoundingClientRect()
    const ar = after.getBoundingClientRect()
    const csBefore = getComputedStyle(before)
    const csAfter = getComputedStyle(after)
    return {
      sliderRendered: slider.classList.contains("rendered"),
      inner: {
        top: innerTop,
        bottom: innerBottom,
        left: innerLeft,
        width: innerWidth,
        height: innerHeight,
      },
      first: { top: fr.top, left: fr.left, width: fr.width, height: fr.height },
      second: { top: secr.top, left: secr.left, width: secr.width, height: secr.height },
      before: {
        top: br.top,
        bottom: br.bottom,
        left: br.left,
        width: br.width,
        height: br.height,
        marginTop: csBefore.marginTop,
        marginBottom: csBefore.marginBottom,
        display: csBefore.display,
        objectFit: csBefore.objectFit,
      },
      after: {
        top: ar.top,
        bottom: ar.bottom,
        left: ar.left,
        width: ar.width,
        height: ar.height,
        marginTop: csAfter.marginTop,
        marginBottom: csAfter.marginBottom,
        display: csAfter.display,
        objectFit: csAfter.objectFit,
      },
    }
  })
}

function assertComparisonAligned(metrics, label) {
  assert.ok(metrics, `${label}: slider metrics missing`)
  assert.equal(metrics.sliderRendered, true, `${label}: slider not rendered`)
  for (const [side, img] of [
    ["before", metrics.before],
    ["after", metrics.after],
  ]) {
    assert.equal(img.marginTop, "0px", `${label} ${side} marginTop`)
    assert.equal(img.marginBottom, "0px", `${label} ${side} marginBottom`)
    assert.equal(img.display, "block", `${label} ${side} display`)
    assert.equal(img.objectFit, "contain", `${label} ${side} objectFit`)
    assert.ok(
      Math.abs(img.width - metrics.inner.width) <= 1,
      `${label} ${side} width=${img.width} vs inner=${metrics.inner.width}`,
    )
    assert.ok(
      Math.abs(img.height - metrics.inner.height) <= 1,
      `${label} ${side} height=${img.height} vs inner=${metrics.inner.height}`,
    )
    assert.ok(
      img.top >= metrics.inner.top - 1 && img.bottom <= metrics.inner.bottom + 1,
      `${label} ${side} clipped: [${img.top}, ${img.bottom}] vs inner [${metrics.inner.top}, ${metrics.inner.bottom}]`,
    )
  }
  assert.ok(
    Math.abs(metrics.first.width - metrics.second.width) <= 1 &&
      Math.abs(metrics.first.height - metrics.second.height) <= 1,
    `${label} shadow wrappers differ: first=${JSON.stringify(metrics.first)} second=${JSON.stringify(metrics.second)}`,
  )
  assert.ok(
    Math.abs(metrics.before.top - metrics.after.top) <= 1 &&
      Math.abs(metrics.before.height - metrics.after.height) <= 1,
    `${label} before/after misaligned: before=${JSON.stringify(metrics.before)} after=${JSON.stringify(metrics.after)}`,
  )
}

test("B-1228/B-1230/B-1231: slider geometry, streamlined edit models, and fast return notification", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  try {
    let notifPhase = "open"
    const setupContext = async (viewport) => {
      const context = await browser.newContext({ viewport })
      await routeProduction(context, origin, (pathname) => {
        if (pathname === "/api/iconoplasm/image-edit/providers") return providersPayload()
        if (pathname === "/api/iconoplasm/image-edit/jobs/request-short") {
          return editJobPayload({
            jobId: "request-short",
            beforeUrl: `${HOST}/_e2e/before-384x512.svg`,
            afterUrl: `${HOST}/_e2e/after-384x501.svg`,
          })
        }
        if (pathname === "/api/iconoplasm/image-edit/jobs/request-tall") {
          return editJobPayload({
            jobId: "request-tall",
            beforeUrl: `${HOST}/_e2e/before-880x1100.svg`,
            afterUrl: `${HOST}/_e2e/after-880x1200.svg`,
          })
        }
        if (pathname === "/api/iconoplasm/notifications") {
          if (notifPhase === "ready") {
            return {
              ok: true,
              authenticated: true,
              unread_count: 1,
              ready_count: 1,
              open_count: 0,
              ready_requests: [
                {
                  notification_id: 901,
                  request_id: 77,
                  request_kind: "edit_image",
                  edit_job_id: "request-short",
                  unread: true,
                  gene_symbol: "TP53",
                  gene_url: "/gene/TP53",
                  requested_emulsion_label: "Edited portrait",
                  image_url: `${HOST}/_e2e/after-384x501.svg`,
                },
              ],
              open_requests: [],
            }
          }
          return {
            ok: true,
            authenticated: true,
            unread_count: 0,
            ready_count: 0,
            open_count: 1,
            ready_requests: [],
            open_requests: [
              {
                request_id: 77,
                request_kind: "edit_image",
                gene_symbol: "TP53",
                gene_url: "/gene/TP53",
                created_at: new Date().toISOString(),
              },
            ],
          }
        }
        return undefined
      })
      await context.route(`${HOST}/_e2e/*.svg`, async (route) => {
        const file = new URL(route.request().url()).pathname
        let body = svgPortrait(384, 512, "BEFORE", "#f1eadf")
        if (file.endsWith("after-384x501.svg")) body = svgPortrait(384, 501, "AFTER", "#dde8de")
        else if (file.endsWith("before-880x1100.svg"))
          body = svgPortrait(880, 1100, "BEFORE", "#f1eadf")
        else if (file.endsWith("after-880x1200.svg"))
          body = svgPortrait(880, 1200, "AFTER", "#dde8de")
        return route.fulfill({ status: 200, contentType: "image/svg+xml", body })
      })
      return context
    }

    // 1. Desktop (1280x860): B-1230 dropdown options, B-1228 shorter & taller after, B-1231 return notice
    {
      const context = await setupContext({ width: 1280, height: 860 })
      const page = await context.newPage()
      await page.goto(`${HOST}/gene/TP53?edit_job=request-short`)
      const dialog = page.locator("#icono-image-edit-dialog")
      await dialog.waitFor({ state: "visible", timeout: 30_000 })
      await page.waitForFunction(
        () => {
          const select = document.querySelector("[data-icono-image-edit-provider]")
          const opts = select ? [...select.querySelectorAll("sl-option")] : []
          const before = document.querySelector("[data-icono-image-edit-before]")
          const after = document.querySelector("[data-icono-image-edit-after]")
          const slider = document.querySelector("[data-icono-image-edit-comparison]")
          return (
            opts.length >= 2 &&
            Boolean(select && select.value) &&
            slider &&
            slider.classList.contains("rendered") &&
            before &&
            before.complete &&
            before.naturalWidth > 0 &&
            after &&
            after.complete &&
            after.naturalWidth > 0
          )
        },
        null,
        { timeout: 20_000 },
      )
      const dropdown = await page.evaluate(async () => {
        const select = document.querySelector("[data-icono-image-edit-provider]")
        if (customElements && customElements.whenDefined) {
          await customElements.whenDefined("sl-select")
          await customElements.whenDefined("sl-option")
          if (select && select.updateComplete) await select.updateComplete
        }
        return {
          value: select && select.value,
          attr: select && select.getAttribute("value"),
          upgraded: Boolean(customElements && customElements.get("sl-select")),
          displayLabel: select && select.displayLabel,
          options: [...(select ? select.querySelectorAll("sl-option") : [])].map((o) => ({
            value: o.value,
            label: o.textContent.trim().replace(/\s+/g, " "),
          })),
        }
      })
      assert.equal(dropdown.value, "comfyui:flux-3-klein", JSON.stringify(dropdown))
      assert.deepEqual(dropdown.options, [
        { value: "comfyui:flux-3-klein", label: "(Free) FLUX.3 Klein" },
        { value: "comfyui:qwen-image-2.1-turbo", label: "(Free) Qwen-Image-2.1 Turbo" },
      ])

      const shortMetrics = await measureComparisonGeometry(page)
      assertComparisonAligned(shortMetrics, "desktop 384x512 vs 384x501")
      if (process.env.ICONO_E2E_SCREENSHOT_DIR) {
        await page.locator("[data-icono-image-edit-comparison]").screenshot({
          path: path.join(process.env.ICONO_E2E_SCREENSHOT_DIR, "after-desktop-short.png"),
        })
      }

      // Close dialog and test B-1231 fast return from Discord (<30s, >2s) while an order is waiting
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "hidden", timeout: 10_000 })
      await page.waitForSelector('[data-icono-request-tab="waiting"][aria-selected="true"]', {
        timeout: 10_000,
      })
      await page.waitForTimeout(2300)
      notifPhase = "ready"
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await page.waitForSelector("#icono-request-ready-notice", { timeout: 10_000 })
      const readyHref = await page.locator("#icono-request-ready-notice").getAttribute("href")
      assert.equal(readyHref, "/gene/TP53?edit_job=request-short")
      await page.waitForSelector('[data-icono-request-tab="ready"][aria-selected="true"]', {
        timeout: 10_000,
      })

      // Also check taller-after case
      notifPhase = "open"
      await page.goto(`${HOST}/gene/TP53?edit_job=request-tall`)
      await dialog.waitFor({ state: "visible", timeout: 30_000 })
      await page.waitForFunction(
        () => {
          const before = document.querySelector("[data-icono-image-edit-before]")
          const after = document.querySelector("[data-icono-image-edit-after]")
          const slider = document.querySelector("[data-icono-image-edit-comparison]")
          return (
            slider &&
            slider.classList.contains("rendered") &&
            before &&
            before.complete &&
            before.naturalWidth === 880 &&
            after &&
            after.complete &&
            after.naturalHeight === 1200
          )
        },
        null,
        { timeout: 20_000 },
      )
      const tallMetrics = await measureComparisonGeometry(page)
      assertComparisonAligned(tallMetrics, "desktop 880x1100 vs 880x1200")
      if (process.env.ICONO_E2E_SCREENSHOT_DIR) {
        await page.locator("[data-icono-image-edit-comparison]").screenshot({
          path: path.join(process.env.ICONO_E2E_SCREENSHOT_DIR, "after-desktop-tall.png"),
        })
      }
      await context.close()
    }

    // 2. Phone (400x820): B-1228 alignment at narrow width
    {
      const context = await setupContext({ width: 400, height: 820 })
      const page = await context.newPage()
      await page.goto(`${HOST}/gene/TP53?edit_job=request-short`)
      const dialog = page.locator("#icono-image-edit-dialog")
      await dialog.waitFor({ state: "visible", timeout: 30_000 })
      await page.waitForFunction(
        () => {
          const before = document.querySelector("[data-icono-image-edit-before]")
          const after = document.querySelector("[data-icono-image-edit-after]")
          const slider = document.querySelector("[data-icono-image-edit-comparison]")
          return (
            slider &&
            slider.classList.contains("rendered") &&
            before &&
            before.complete &&
            before.naturalWidth > 0 &&
            after &&
            after.complete &&
            after.naturalWidth > 0
          )
        },
        null,
        { timeout: 20_000 },
      )
      const phoneMetrics = await measureComparisonGeometry(page)
      assertComparisonAligned(phoneMetrics, "phone 400x820")
      if (process.env.ICONO_E2E_SCREENSHOT_DIR) {
        await page.locator("[data-icono-image-edit-comparison]").screenshot({
          path: path.join(process.env.ICONO_E2E_SCREENSHOT_DIR, "after-phone-short.png"),
        })
      }
      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})
