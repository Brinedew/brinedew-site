/**
 * Generic headless Playwright render verifier for any built Quartz wiki article.
 *
 * Usage:
 *   node verify_article_render.mjs --slug <slug> --out <dir> [--public <public_dir>]
 */
import fs from "node:fs"
import http from "node:http"
import path from "node:path"
import { pathToFileURL } from "node:url"

function parseArgs(argv) {
  const opts = { publicDir: path.resolve(process.cwd(), "public") }
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i]
    const val = argv[i + 1]
    if (key === "--slug" && val) {
      opts.slug = val
      i += 1
    } else if (key === "--out" && val) {
      opts.outDir = path.resolve(val)
      i += 1
    } else if (key === "--public" && val) {
      opts.publicDir = path.resolve(val)
      i += 1
    }
  }
  if (!opts.slug || !opts.outDir) {
    throw new Error(
      "Usage: node verify_article_render.mjs --slug <slug> --out <dir> [--public <dir>]",
    )
  }
  return opts
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".csv": "text/csv; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ico": "image/x-icon",
}

function findBrowserExecutable() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]
  const found = candidates.find((p) => fs.existsSync(p))
  if (!found) throw new Error("No Chromium/Edge executable found for Playwright render check")
  return found
}

function createStaticServer(publicDir) {
  return http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0])
    let filePath = path.join(publicDir, urlPath === "/" ? "index.html" : urlPath)
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, "index.html")
    }
    if (!fs.existsSync(filePath) && fs.existsSync(`${filePath}.html`)) {
      filePath = `${filePath}.html`
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404)
      res.end(`Not found: ${urlPath}`)
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" })
    fs.createReadStream(filePath).pipe(res)
  })
}

async function setTheme(page, mode) {
  await page.evaluate((m) => {
    document.documentElement.setAttribute("saved-theme", m)
    localStorage.setItem("theme", m)
    document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: m } }))
  }, mode)
  await page.waitForTimeout(450)
}

async function main() {
  const { slug, outDir, publicDir } = parseArgs(process.argv)
  fs.mkdirSync(outDir, { recursive: true })

  const playwrightEntry = path.resolve(
    publicDir,
    "..",
    "node_modules",
    "playwright-core",
    "index.mjs",
  )
  const { chromium } = await import(pathToFileURL(playwrightEntry).href)

  const server = createStaticServer(publicDir)
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const port = server.address().port
  const targetUrl = `http://127.0.0.1:${port}/wiki/${encodeURIComponent(slug)}`
  const browser = await chromium.launch({
    channel: "chrome",
    chromiumSandbox: true,
    headless: true,
    args: ["--disable-gpu"],
  })

  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  const httpErrors = []
  const screenshots = []

  const unlockDraftCurtain = async (targetPage) => {
    await targetPage.evaluate(() => {
      document.body.classList.add("draft-unlocked")
    })
    await targetPage.waitForTimeout(150)
  }

  try {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 920 },
      deviceScaleFactor: 2,
    })
    const page = await ctx.newPage()
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text())
    })
    page.on("pageerror", (err) => pageErrors.push(String(err)))
    page.on("requestfailed", (req) =>
      failedRequests.push(`${req.url()} :: ${req.failure()?.errorText}`),
    )
    page.on("response", (res) => {
      if (res.status() >= 400) {
        httpErrors.push(`${res.status()} ${res.url()}`)
      }
    })

    await page.goto(targetUrl, { waitUntil: "networkidle" })
    // `draft: true` is an independent publishing flag, not a quality gate —
    // unlock `.draft-locked` in headless verification so charts and body render.
    await unlockDraftCurtain(page)
    await setTheme(page, "light")

    const chartFigs = page.locator("figure.vega-figure")
    const chartCount = await chartFigs.count()
    if (chartCount > 0) {
      for (let i = 0; i < chartCount; i += 1) {
        await chartFigs.nth(i).scrollIntoViewIfNeeded()
      }
      await page.waitForSelector(
        ".vega-chart svg, .vega-embed svg, .vega-chart canvas, .vega-embed canvas",
        {
          timeout: 15000,
        },
      )
      await page.waitForTimeout(600)
    }

    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(250)

    const diagLight = await page.evaluate(() => {
      const imgs = [...document.querySelectorAll("article img")].map((img) => ({
        src: img.getAttribute("src"),
        ok: img.complete && img.naturalWidth > 0,
        w: img.naturalWidth,
        h: img.naturalHeight,
      }))
      const katexErrors = [...document.querySelectorAll(".katex-error")].map((e) => e.textContent)
      const vegaCount = document.querySelectorAll(".vega-embed").length
      const hScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth
      const bindings = [...document.querySelectorAll(".vega-bindings input[type='range']")].map(
        (el) => ({
          val: el.value,
          min: el.min,
          max: el.max,
        }),
      )
      return {
        title: document.title,
        imgs,
        brokenImages: imgs.filter((i) => !i.ok).length,
        katexErrors,
        vegaCount,
        hScroll,
        scrollW: document.documentElement.scrollWidth,
        clientW: document.documentElement.clientWidth,
        bindings,
      }
    })

    const topLightPath = path.join(outDir, "top_light.png")
    await page.screenshot({ path: topLightPath })
    screenshots.push(topLightPath)

    const sliderChecks = []
    if (diagLight.vegaCount > 0) {
      const chartBox = page.locator(".vega-figure").first()
      await chartBox.scrollIntoViewIfNeeded()
      await page.waitForTimeout(300)
      const chartLightPath = path.join(outDir, "chart_light.png")
      await chartBox.screenshot({ path: chartLightPath })
      screenshots.push(chartLightPath)

      await setTheme(page, "dark")
      const chartDarkPath = path.join(outDir, "chart_dark.png")
      await chartBox.screenshot({ path: chartDarkPath })
      screenshots.push(chartDarkPath)

      const firstSlider = page.locator(".vega-bindings input[type='range']").first()
      if ((await firstSlider.count()) > 0) {
        const beforeTexts = await page.evaluate(() =>
          [...document.querySelectorAll(".vega-embed text")].map((t) => t.textContent),
        )
        await page.evaluate(() => {
          const inp = document.querySelector(".vega-bindings input[type='range']")
          if (!inp) return
          const target = Number(inp.max) > Number(inp.value) ? inp.max : inp.min
          inp.value = String(target)
          inp.dispatchEvent(new Event("input", { bubbles: true }))
          inp.dispatchEvent(new Event("change", { bubbles: true }))
        })
        await page.waitForTimeout(400)
        const afterTexts = await page.evaluate(() =>
          [...document.querySelectorAll(".vega-embed text")].map((t) => t.textContent),
        )
        sliderChecks.push({ changed: JSON.stringify(beforeTexts) !== JSON.stringify(afterTexts) })
        const sliderPath = path.join(outDir, "chart_slider.png")
        await chartBox.screenshot({ path: sliderPath })
        screenshots.push(sliderPath)
      }
    } else {
      await setTheme(page, "dark")
      const topDarkPath = path.join(outDir, "top_dark.png")
      await page.screenshot({ path: topDarkPath })
      screenshots.push(topDarkPath)
    }

    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    })
    const mpage = await mctx.newPage()
    await mpage.goto(targetUrl, { waitUntil: "networkidle" })
    await unlockDraftCurtain(mpage)
    const mFigs = mpage.locator("figure.vega-figure")
    if ((await mFigs.count()) > 0) {
      await mFigs.first().scrollIntoViewIfNeeded()
      await mpage.waitForSelector(".vega-embed svg, .vega-embed canvas", { timeout: 15000 })
      await mpage.waitForTimeout(600)
      await mFigs.first().scrollIntoViewIfNeeded()
    }
    const diagMobile = await mpage.evaluate(() => ({
      hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    }))
    const mobilePath = path.join(outDir, "mobile.png")
    await mpage.screenshot({ path: mobilePath })
    screenshots.push(mobilePath)

    const report = {
      slug,
      url: targetUrl,
      status: "ok",
      diagLight,
      diagMobile,
      sliderChecks,
      screenshots,
      consoleErrors,
      pageErrors,
      failedRequests,
      httpErrors,
    }
    fs.writeFileSync(
      path.join(outDir, "render_report.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      "utf8",
    )
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await browser.close()
    server.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
