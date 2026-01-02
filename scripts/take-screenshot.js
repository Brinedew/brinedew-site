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
    args: [
      "--use-gl=angle",
      "--use-angle=swiftshader",
      "--disable-gpu-sandbox",
      "--ignore-gpu-blocklist",
    ],
  })

  const context = await browser.newContext({
    viewport: { width: 800, height: 600 },
  })

  const page = await context.newPage()

  try {
    await page.goto(url, { waitUntil: "domcontentloaded" })
    console.log("Page loaded, waiting for structure to render...")

    // Wait for the data-loaded attribute or timeout after 15s
    await page.waitForSelector("body[data-loaded='true']", { timeout: 15000 }).catch(() => {
      console.log("data-loaded not found, using fallback wait")
    })

    // Additional wait to ensure rendering is complete
    await page.waitForTimeout(2000)

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
