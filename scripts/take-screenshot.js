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

if (!url) {
  console.error("Usage: node take-screenshot.js <url> <output-file>")
  process.exit(1)
}

async function main() {
  console.log(`Taking screenshot of ${url}`)

  const browser = await chromium.launch({
    headless: false, // Headful mode for WebGL under Xvfb
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--ignore-gpu-blocklist",
    ],
  })

  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
  })

  const page = await context.newPage()

  // Capture console and errors for debugging
  page.on("console", (msg) => console.log(`[page:${msg.type()}] ${msg.text()}`))
  page.on("pageerror", (err) => console.log(`[pageerror] ${err.stack || err}`))

  try {
    await page.goto(url, { waitUntil: "networkidle" })
    console.log("Page loaded, waiting for structure to render...")

    // Wait for data-loaded attribute (true = success, timeout = failure)
    const loadState = await page.waitForSelector("body[data-loaded]", { timeout: 70000 }).catch(() => null)

    if (loadState) {
      const state = await page.getAttribute("body", "data-loaded")
      console.log(`Load state: ${state}`)

      if (state === "timeout") {
        console.error("Mol* loadComplete did not fire - structure may not have rendered")
      }
    } else {
      console.error("data-loaded attribute never set")
    }

    // WebGL probe - diagnose what's happening
    const glInfo = await page.evaluate(() => {
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

      const vendor = dbg
        ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR)

      return { ok: true, vendor, renderer, w: canvas.width, h: canvas.height }
    })

    console.log("WebGL probe:", JSON.stringify(glInfo))

    if (!glInfo.ok) {
      console.error(`WebGL failed: ${glInfo.reason}`)
    }

    // Small additional wait for final render
    await page.waitForTimeout(1000)

    await page.screenshot({ path: outputFile, type: "png" })
    console.log(`Screenshot saved to ${outputFile}`)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error("Screenshot failed:", err)
  process.exit(1)
})
