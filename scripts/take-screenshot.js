#!/usr/bin/env node
/**
 * Takes a screenshot of the GeneGuessr render page using Playwright.
 * Uses software WebGL rendering for headless environments without GPU.
 *
 * Usage: node take-screenshot.js <url> <output-file>
 */

import { chromium } from "playwright"

const url = process.argv[2]
const outputFile = process.argv[3] || "screenshot.png"
const MAX_ATTEMPTS = 2

if (!url) {
  console.error("Usage: node take-screenshot.js <url> <output-file>")
  process.exit(1)
}

function buildAttemptUrl(baseUrl, attempt) {
  const parsed = new URL(baseUrl)
  parsed.searchParams.set("_ss_attempt", String(attempt))
  parsed.searchParams.set("_ss_ts", String(Date.now()))
  return parsed.toString()
}

async function captureAttempt(browser, attempt) {
  const attemptUrl = buildAttemptUrl(url, attempt)
  const runtimeErrors = []
  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
  })
  const page = await context.newPage()

  // Capture console and errors for debugging and failure detection.
  page.on("console", (msg) => {
    const text = msg.text()
    console.log(`[page:${msg.type()}] ${text}`)
    if (msg.type() === "error") runtimeErrors.push(text)
  })
  page.on("pageerror", (err) => {
    const text = String(err?.stack || err)
    console.log(`[pageerror] ${text}`)
    runtimeErrors.push(text)
  })

  try {
    await page.goto(attemptUrl, { waitUntil: "networkidle" })
    console.log(`Page loaded for attempt ${attempt}, waiting for structure to render...`)

    // Wait for data-loaded attribute (true = success, timeout = failure)
    const loadState = await page
      .waitForSelector("body[data-loaded]", { timeout: 70000 })
      .catch(() => null)

    if (loadState) {
      const state = await page.getAttribute("body", "data-loaded")
      console.log(`Load state: ${state}`)

      if (state !== "true") {
        throw new Error(`Render did not complete successfully (data-loaded=${state || "missing"})`)
      }
    } else {
      throw new Error("Render did not complete (data-loaded attribute never set)")
    }

    // WebGL + pixel probe. Reject fully-black/empty frames.
    const probe = await page.evaluate(() => {
      const canvas = document.querySelector("canvas")
      if (!canvas) return { ok: false, reason: "no_canvas" }

      const gl =
        canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false }) ||
        canvas.getContext("webgl", { failIfMajorPerformanceCaveat: false })

      if (!gl) return { ok: false, reason: "no_webgl_context" }

      const dbg = gl.getExtension("WEBGL_debug_renderer_info")
      const renderer = dbg
        ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER)

      const vendor = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR)

      let nonDarkRatio = null
      let sampleError = null
      try {
        const sample = document.createElement("canvas")
        sample.width = 96
        sample.height = 72
        const ctx = sample.getContext("2d", { willReadFrequently: true })
        ctx.drawImage(canvas, 0, 0, sample.width, sample.height)
        const data = ctx.getImageData(0, 0, sample.width, sample.height).data
        let visible = 0
        let nonDark = 0
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const a = data[i + 3]
          if (a <= 8) continue
          visible += 1
          if (r + g + b > 24) nonDark += 1
        }
        nonDarkRatio = visible > 0 ? nonDark / visible : 0
      } catch (err) {
        sampleError = String(err?.message || err)
      }

      return { ok: true, vendor, renderer, w: canvas.width, h: canvas.height, nonDarkRatio, sampleError }
    })

    console.log("WebGL/pixel probe:", JSON.stringify(probe))

    if (!probe.ok) {
      throw new Error(`WebGL failed: ${probe.reason}`)
    }

    // Hard-fail on parser/runtime errors that are known to yield black captures.
    const hasCriticalRuntimeError = runtimeErrors.some((line) =>
      /Unexpected token\. Expected data_|reading 'transform'|Failed to load structure/i.test(line),
    )
    if (hasCriticalRuntimeError) {
      throw new Error("Mol* runtime/parsing error detected while rendering structure")
    }

    if (typeof probe.nonDarkRatio === "number" && probe.nonDarkRatio < 0.01) {
      throw new Error(`Rendered frame appears empty/black (nonDarkRatio=${probe.nonDarkRatio})`)
    }

    // Additional settle time to reduce partially rendered captures.
    // We keep posting even on failures, but this gives Mol* more time to paint.
    await page.waitForTimeout(3000)

    await page.screenshot({ path: outputFile, type: "png" })
    console.log(`Screenshot saved to ${outputFile} (attempt ${attempt})`)
  } finally {
    await context.close()
  }
}

async function main() {
  console.log(`Taking screenshot of ${url}`)

  const browser = await chromium.launch({
    headless: false, // Headful mode for WebGL under Xvfb
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu-sandbox",
      "--ignore-gpu-blocklist",
      "--use-angle=swiftshader",
      "--use-gl=angle",
    ],
  })

  let lastError = null
  try {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      try {
        await captureAttempt(browser, attempt)
        lastError = null
        break
      } catch (err) {
        lastError = err
        console.error(`Screenshot attempt ${attempt} failed:`, err)
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((resolve) => setTimeout(resolve, 1500))
        }
      }
    }
    if (lastError) {
      throw lastError
    }
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error("Screenshot failed:", err)
  process.exit(1)
})
