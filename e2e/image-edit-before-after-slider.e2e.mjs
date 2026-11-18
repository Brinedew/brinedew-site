// Regression coverage for portrait editing workflows:
// - B-1228: before/after image comparison slider must align "Before" and "After"
//   images identically with zero margin shift, zero inline gap, matching shadow
//   wrappers (.first and .second), and zero bottom clipping across desktop and
//   phone viewports and slight aspect-ratio differences.
// - B-1230: Editing API dropdown lists only the two active local free models
//   (FLUX.3 Klein default + Qwen-Image-2.1 Turbo without INT8).
// - B-1231: returning from an external tab while an order is open refreshes an
//   initially empty Ready inbox and shows the Ready popup notice immediately.
// - B-1232: Edit modal splits cleanly into Request mode ([Edit] only, wide) and
//   Review mode (no request controls, centered [Discard] + [Publish] together),
//   transitioning automatically when an open modal's edit finishes (Scenario 1)
//   and opening directly in Review mode from the Ready inbox / ?edit_job (Scenario 2).
// E2E scope: quartz shared/ content/apps/ scripts/prepare-iconoplasm-edge-assets.mjs !quartz/static/geneguessr/ !quartz/static/iconoplasm/admin !quartz/static/iconoplasm/caretaker-admin !workers/iconoplasm-admin !workers/iconoplasm-caretaker-admin
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
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

function editJobPayload({
  jobId,
  beforeUrl,
  afterUrl,
  status = "succeeded",
  model = "flux-3-klein",
  modelLabel = model === "qwen-image-2.1-turbo" ? "Qwen-Image-2.1 Turbo" : "FLUX.3 Klein",
  adjustments = [
    { kind: "surface_tone_hex", value: "#483a36" },
    { kind: "age_years", value: 20 },
  ],
}) {
  return {
    ok: true,
    job: {
      id: jobId,
      status,
      provider_id: "comfyui",
      model,
      model_label: modelLabel,
      source_gene_symbol: "TP53",
      source_asset_sha256: "a".repeat(64),
      published: false,
      adjustments,
      source_asset: { renditions: { medium: { canonical_url: beforeUrl } } },
      result_asset: afterUrl ? { renditions: { medium: { canonical_url: afterUrl } } } : null,
    },
  }
}

async function readDialogModeState(page) {
  return page.evaluate(() => {
    const dialog = document.querySelector("[data-icono-image-edit-dialog]")
    const controls = dialog?.querySelector("[data-icono-image-edit-controls]")
    const summary = dialog?.querySelector("[data-icono-image-edit-review-summary]")
    const editBtn = dialog?.querySelector("[data-icono-image-edit-submit]")
    const discardBtn = dialog?.querySelector("[data-icono-image-edit-discard]")
    const publishBtn = dialog?.querySelector("[data-icono-image-edit-publish]")
    const footer = dialog?.querySelector(".icono-image-edit-actions")
    const title = dialog?.querySelector("[data-icono-dialog-title]")
    const status = dialog?.querySelector("[data-icono-image-edit-status]")
    const box = (el) => {
      if (!el || !el.checkVisibility()) return null
      const r = el.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }
    }
    return {
      mode: dialog?.getAttribute("data-icono-image-edit-mode") || "",
      isWide: Boolean(dialog?.classList.contains("icono-dialog--wide")),
      isStandard: Boolean(dialog?.classList.contains("icono-dialog--standard")),
      title: title ? title.textContent.trim() : "",
      status: status && !status.hidden ? status.textContent.trim() : "",
      controlsVisible: Boolean(controls && controls.checkVisibility()),
      summaryVisible: Boolean(summary && summary.checkVisibility()),
      chips: summary
        ? [...summary.querySelectorAll(".icono-image-edit-review-chip")].map((el) =>
            el.textContent.trim(),
          )
        : [],
      edit: {
        visible: Boolean(editBtn && editBtn.checkVisibility()),
        disabled: Boolean(editBtn && editBtn.disabled),
        text: editBtn ? editBtn.textContent.trim() : "",
        box: box(editBtn),
      },
      discard: {
        visible: Boolean(discardBtn && discardBtn.checkVisibility()),
        disabled: Boolean(discardBtn && discardBtn.disabled),
        text: discardBtn ? discardBtn.textContent.trim() : "",
        box: box(discardBtn),
      },
      publish: {
        visible: Boolean(publishBtn && publishBtn.checkVisibility()),
        disabled: Boolean(publishBtn && publishBtn.disabled),
        text: publishBtn ? publishBtn.textContent.trim() : "",
        box: box(publishBtn),
      },
      footerBox: box(footer),
    }
  })
}

function assertCenteredReviewFooter(state, { label, discardDisabled, publishDisabled }) {
  assert.equal(state.mode, "review", `${label}: expected review mode`)
  assert.equal(state.isStandard, true, `${label}: expected standard dialog width`)
  assert.equal(state.isWide, false, `${label}: expected wide class removed`)
  assert.equal(state.title, "Review portrait edit", `${label}: expected review title`)
  assert.equal(state.controlsVisible, false, `${label}: editing controls must be hidden`)
  assert.equal(state.edit.visible, false, `${label}: Edit button must be hidden`)
  assert.equal(state.discard.visible, true, `${label}: Discard must be visible`)
  assert.equal(state.publish.visible, true, `${label}: Publish must be visible`)
  assert.equal(state.discard.disabled, discardDisabled, `${label}: Discard disabled mismatch`)
  assert.equal(state.publish.disabled, publishDisabled, `${label}: Publish disabled mismatch`)
  assert.ok(state.discard.box && state.publish.box && state.footerBox, `${label}: boxes missing`)
  const gap = state.publish.box.left - state.discard.box.right
  assert.ok(gap >= 4 && gap <= 20, `${label}: Discard and Publish should sit together, gap=${gap}`)
  const pairCenter = (state.discard.box.left + state.publish.box.right) / 2
  const footerCenter = (state.footerBox.left + state.footerBox.right) / 2
  assert.ok(
    Math.abs(pairCenter - footerCenter) <= 8,
    `${label}: pairCenter=${pairCenter} not centered in footerCenter=${footerCenter}`,
  )
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

test("B-1228/B-1230/B-1231/B-1232: request vs review modes, slider geometry, streamlined models, and fast return notification", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  const screenshotDir = process.env.ICONO_E2E_SCREENSHOT_DIR || ""
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true })
  try {
    let notifPhase = "open"
    let liveJobStatus = "queued"
    const setupContext = async (viewport) => {
      const context = await browser.newContext({ viewport })
      await routeProduction(context, origin, (pathname, request) => {
        if (pathname === "/api/iconoplasm/image-edit/providers") return providersPayload()
        if (pathname === "/api/iconoplasm/image-edit/jobs" && request.method() === "POST") {
          return {
            ok: true,
            queued: true,
            provider_id: "comfyui",
            model: "flux-3-klein",
            job: {
              id: "request-live-1",
              status: "queued",
              published: false,
            },
            request: { id: 991 },
          }
        }
        if (pathname === "/api/iconoplasm/image-edit/jobs/request-live-1") {
          if (liveJobStatus === "succeeded") {
            return editJobPayload({
              jobId: "request-live-1",
              beforeUrl: `${HOST}/_e2e/before-384x512.svg`,
              afterUrl: `${HOST}/_e2e/after-384x501.svg`,
              status: "succeeded",
              adjustments: [
                { kind: "remove_ai_generation_errors", text: "Remove visible AI errors" },
              ],
            })
          }
          return editJobPayload({
            jobId: "request-live-1",
            beforeUrl: `${HOST}/_e2e/before-384x512.svg`,
            afterUrl: null,
            status: "queued",
            adjustments: [
              { kind: "remove_ai_generation_errors", text: "Remove visible AI errors" },
            ],
          })
        }
        if (pathname === "/api/iconoplasm/image-edit/jobs/request-pending") {
          return editJobPayload({
            jobId: "request-pending",
            beforeUrl: `${HOST}/_e2e/before-384x512.svg`,
            afterUrl: null,
            status: "running",
            adjustments: [{ kind: "surface_tone_hex", value: "#483a36" }],
          })
        }
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
        if (pathname === "/api/iconoplasm/image-edit/jobs/request-model-flux") {
          return editJobPayload({
            jobId: "request-model-flux",
            beforeUrl: `${HOST}/_e2e/before-384x512.svg`,
            afterUrl: `${HOST}/_e2e/after-384x501.svg`,
            model: "flux-3-klein",
            modelLabel: "FLUX.3 Klein",
            adjustments: [
              { kind: "remove_ai_generation_errors", text: "Remove visible AI errors" },
            ],
          })
        }
        if (pathname === "/api/iconoplasm/image-edit/jobs/request-model-qwen") {
          return editJobPayload({
            jobId: "request-model-qwen",
            beforeUrl: `${HOST}/_e2e/before-384x512.svg`,
            afterUrl: `${HOST}/_e2e/after-384x501.svg`,
            model: "qwen-image-2.1-turbo",
            modelLabel: "Qwen-Image-2.1 Turbo",
            adjustments: [
              { kind: "remove_ai_generation_errors", text: "Remove visible AI errors" },
            ],
          })
        }
        if (pathname === "/api/iconoplasm/notifications") {
          if (notifPhase === "ready-multi-model") {
            return {
              ok: true,
              authenticated: true,
              unread_count: 2,
              ready_count: 2,
              open_count: 0,
              ready_requests: [
                {
                  notification_id: 911,
                  request_id: 801,
                  request_kind: "edit_image",
                  edit_job_id: "request-model-flux",
                  edit_provider_id: "comfyui",
                  edit_model: "flux-3-klein",
                  edit_model_label: "FLUX.3 Klein",
                  unread: true,
                  gene_symbol: "TP53",
                  gene_url: "/gene/TP53",
                  requested_emulsion_label: "FLUX.3 Klein",
                  image_url: `${HOST}/_e2e/after-384x501.svg`,
                },
                {
                  notification_id: 912,
                  request_id: 802,
                  request_kind: "edit_image",
                  edit_job_id: "request-model-qwen",
                  edit_provider_id: "comfyui",
                  edit_model: "qwen-image-2.1-turbo",
                  edit_model_label: "Qwen-Image-2.1 Turbo",
                  unread: true,
                  gene_symbol: "TP53",
                  gene_url: "/gene/TP53",
                  requested_emulsion_label: "Qwen-Image-2.1 Turbo",
                  image_url: `${HOST}/_e2e/after-384x501.svg`,
                },
              ],
              open_requests: [],
            }
          }
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

    // 1. Desktop (1280x860): Request mode + B-1230 models + Scenario 1 transition + Scenario 2 review + B-1228/B-1231
    {
      const context = await setupContext({ width: 1280, height: 860 })
      const page = await context.newPage()
      await page.goto(`${HOST}/gene/TP53`)
      await page.waitForSelector("[data-icono-edit-source]", { state: "attached", timeout: 30_000 })
      await page.$eval("[data-icono-edit-source]", (button) => button.click())
      const dialog = page.locator("#icono-image-edit-dialog")
      await dialog.waitFor({ state: "visible", timeout: 20_000 })
      await page.waitForFunction(
        () => {
          const select = document.querySelector("[data-icono-image-edit-provider]")
          const opts = select ? [...select.querySelectorAll("sl-option")] : []
          return opts.length >= 2 && Boolean(select && select.value)
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

      const requestState = await readDialogModeState(page)
      assert.equal(requestState.mode, "request")
      assert.equal(requestState.isWide, true)
      assert.equal(requestState.controlsVisible, true)
      assert.equal(requestState.summaryVisible, false)
      assert.equal(requestState.edit.visible, true)
      assert.equal(requestState.edit.disabled, true)
      assert.equal(requestState.discard.visible, false)
      assert.equal(requestState.publish.visible, false)

      await page.locator('[data-icono-image-edit-adjustment="remove_ai_generation_errors"]').click()
      await page.waitForFunction(
        () => {
          const btn = document.querySelector("[data-icono-image-edit-submit]")
          return Boolean(btn && !btn.disabled)
        },
        null,
        { timeout: 10_000 },
      )
      if (screenshotDir) {
        await page.waitForTimeout(300)
        await dialog.screenshot({ path: path.join(screenshotDir, "request-desktop.png") })
      }

      // Scenario 1: submit queued free edit and keep modal open until it completes
      await page.locator("[data-icono-image-edit-submit]").click()
      await page.waitForFunction(
        () => {
          const status = document.querySelector("[data-icono-image-edit-status]")
          return Boolean(status && !status.hidden && /queued/i.test(status.textContent || ""))
        },
        null,
        { timeout: 10_000 },
      )
      const whileQueuedState = await readDialogModeState(page)
      assert.equal(whileQueuedState.mode, "request")
      assert.equal(whileQueuedState.discard.visible, false)
      assert.equal(whileQueuedState.publish.visible, false)

      liveJobStatus = "succeeded"
      await page.evaluate(() => window.dispatchEvent(new Event("focus")))
      await page.waitForFunction(
        () => {
          const dlg = document.querySelector("[data-icono-image-edit-dialog]")
          const slider = document.querySelector("[data-icono-image-edit-comparison]")
          const before = document.querySelector("[data-icono-image-edit-before]")
          const after = document.querySelector("[data-icono-image-edit-after]")
          return (
            dlg?.getAttribute("data-icono-image-edit-mode") === "review" &&
            slider &&
            slider.classList.contains("rendered") &&
            before?.complete &&
            before.naturalWidth > 0 &&
            after?.complete &&
            after.naturalWidth > 0
          )
        },
        null,
        { timeout: 20_000 },
      )
      const scenario1State = await readDialogModeState(page)
      assertCenteredReviewFooter(scenario1State, {
        label: "scenario 1 open-modal transition",
        discardDisabled: false,
        publishDisabled: false,
      })
      assert.equal(scenario1State.summaryVisible, true)
      assert.deepEqual(scenario1State.chips, ["Model · FLUX.3 Klein", "Remove visible AI errors"])

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

      // Scenario 2 (pending edit opened directly): both Discard and Publish visible & disabled together
      await page.goto(`${HOST}/gene/TP53?edit_job=request-pending`)
      await dialog.waitFor({ state: "visible", timeout: 30_000 })
      await page.waitForFunction(
        () => {
          const status = document.querySelector("[data-icono-image-edit-status]")
          return Boolean(status && !status.hidden && /still queued/i.test(status.textContent || ""))
        },
        null,
        { timeout: 15_000 },
      )
      const pendingState = await readDialogModeState(page)
      assertCenteredReviewFooter(pendingState, {
        label: "scenario 2 pending review",
        discardDisabled: true,
        publishDisabled: true,
      })
      assert.deepEqual(pendingState.chips, ["Model · FLUX.3 Klein", "Surface tone · #483a36"])
      if (screenshotDir) {
        await page.waitForTimeout(300)
        await dialog.screenshot({ path: path.join(screenshotDir, "review-pending-desktop.png") })
      }

      // Scenario 2 (ready edit opened via ?edit_job=request-short): aligned slider + centered footer
      await page.goto(`${HOST}/gene/TP53?edit_job=request-short`)
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
      const reviewShortState = await readDialogModeState(page)
      assertCenteredReviewFooter(reviewShortState, {
        label: "scenario 2 ready desktop short",
        discardDisabled: false,
        publishDisabled: false,
      })
      assert.equal(reviewShortState.summaryVisible, true)
      assert.deepEqual(reviewShortState.chips, [
        "Model · FLUX.3 Klein",
        "Surface tone · #483a36",
        "Age · 20 years",
      ])
      const shortMetrics = await measureComparisonGeometry(page)
      assertComparisonAligned(shortMetrics, "desktop 384x512 vs 384x501")
      if (screenshotDir) {
        await page.waitForTimeout(300)
        await dialog.screenshot({ path: path.join(screenshotDir, "review-desktop-short.png") })
      }

      // B-1262: two simultaneous Ready sidebar edit receipts distinguish models and open Review modals labeled with each model
      notifPhase = "ready-multi-model"
      await page.goto(`${HOST}/gene/TP53`)
      await page.waitForSelector('[data-icono-edit-job-id="request-model-flux"]', {
        timeout: 15_000,
      })
      await page.waitForSelector('[data-icono-edit-job-id="request-model-qwen"]', {
        timeout: 15_000,
      })
      assert.equal(
        (
          await page
            .locator(
              '[data-icono-edit-job-id="request-model-flux"] .icono-request-inbox__receipt-meta',
            )
            .textContent()
        )?.trim(),
        "FLUX.3 Klein",
      )
      assert.equal(
        (
          await page
            .locator(
              '[data-icono-edit-job-id="request-model-qwen"] .icono-request-inbox__receipt-meta',
            )
            .textContent()
        )?.trim(),
        "Qwen-Image-2.1 Turbo",
      )
      await page.locator('[data-icono-edit-job-id="request-model-qwen"]').click()
      await dialog.waitFor({ state: "visible", timeout: 15_000 })
      await page.waitForFunction(
        () => {
          const el = document.querySelector("[data-icono-image-edit-review-model]")
          return Boolean(el && /Qwen-Image-2\.1 Turbo/.test(el.textContent || ""))
        },
        null,
        { timeout: 15_000 },
      )
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "hidden", timeout: 10_000 })
      await page.locator('[data-icono-edit-job-id="request-model-flux"]').click()
      await dialog.waitFor({ state: "visible", timeout: 15_000 })
      await page.waitForFunction(
        () => {
          const el = document.querySelector("[data-icono-image-edit-review-model]")
          return Boolean(el && /FLUX\.3 Klein/.test(el.textContent || ""))
        },
        null,
        { timeout: 15_000 },
      )
      await page.keyboard.press("Escape")
      await dialog.waitFor({ state: "hidden", timeout: 10_000 })

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
      await context.close()
    }

    // 2. Phone (400x820): B-1228 alignment & B-1232 review footer at narrow width
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
      const phoneState = await readDialogModeState(page)
      assertCenteredReviewFooter(phoneState, {
        label: "phone 400x820",
        discardDisabled: false,
        publishDisabled: false,
      })
      const phoneMetrics = await measureComparisonGeometry(page)
      assertComparisonAligned(phoneMetrics, "phone 400x820")
      if (screenshotDir) {
        await page.waitForTimeout(300)
        await dialog.screenshot({ path: path.join(screenshotDir, "review-phone-short.png") })
      }
      await context.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})
