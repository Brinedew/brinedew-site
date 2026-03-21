import { chromium } from "playwright"

async function waitForBrickCards(page) {
  await page.waitForSelector(".icono-card.icono-card--brick:not(.icono-card--skeleton)", {
    timeout: 30000,
  })
}

async function run() {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE || undefined
  const baseUrl = process.env.ICONO_BASE_URL || "http://127.0.0.1:8093/"
  const browser = await chromium.launch({
    headless: true,
    executablePath: executablePath,
  })
  const results = {}
  try {
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      await page.route("**/api/gene/**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1600))
        await route.continue()
      })
      await page.goto(baseUrl)
      await waitForBrickCards(page)
      await page.waitForTimeout(250)
      results.skeleton = await page
        .locator(".icono-card.icono-card--brick:not(.icono-card--skeleton)")
        .first()
        .evaluate((el) => {
          const skeletonGrid = el.querySelector(".iconoplasm-tooltip-mobile-rowgrid--skeleton")
          const meta = el.querySelector("[data-icono-card-meta]")
          return {
            hasSkeletonGrid: !!skeletonGrid,
            skeletonRows: skeletonGrid
              ? skeletonGrid.querySelectorAll(".iconoplasm-tooltip-mobile-row").length
              : 0,
            loadingMeta: !!(meta && meta.classList.contains("iconoplasm-tooltip-meta--loading")),
            cardHeight: Math.round(el.getBoundingClientRect().height),
          }
        })
      await context.close()
    }

    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      await page.goto(baseUrl)
      await waitForBrickCards(page)
      await page.waitForTimeout(1800)
      const firstCard = page
        .locator(".icono-card.icono-card--brick:not(.icono-card--skeleton)")
        .first()
      const before = await firstCard.evaluate((el) => {
        const charCell = el.querySelector(
          ".iconoplasm-tooltip-mobile-cell--character .iconoplasm-tooltip-meta-value",
        )
        const molCell = el.querySelector(
          ".iconoplasm-tooltip-mobile-cell--molecular .iconoplasm-tooltip-meta-value",
        )
        const symbol = el.querySelector(".iconoplasm-tooltip-symbol")
        return {
          charColor: charCell ? getComputedStyle(charCell).color : null,
          molColor: molCell ? getComputedStyle(molCell).color : null,
          symbolColor: symbol ? getComputedStyle(symbol).color : null,
        }
      })
      await firstCard.click()
      await page.waitForURL(/\/gene\//)
      await page.locator("#iconoplasm-root .icono-nav a[data-icono-nav]").click()
      await page.waitForURL(baseUrl)
      await waitForBrickCards(page)
      await page.waitForTimeout(300)
      const after = await page
        .locator(".icono-card.icono-card--brick:not(.icono-card--skeleton)")
        .first()
        .evaluate((el) => {
          const charCell = el.querySelector(
            ".iconoplasm-tooltip-mobile-cell--character .iconoplasm-tooltip-meta-value",
          )
          const molCell = el.querySelector(
            ".iconoplasm-tooltip-mobile-cell--molecular .iconoplasm-tooltip-meta-value",
          )
          const symbol = el.querySelector(".iconoplasm-tooltip-symbol")
          return {
            charColor: charCell ? getComputedStyle(charCell).color : null,
            molColor: molCell ? getComputedStyle(molCell).color : null,
            symbolColor: symbol ? getComputedStyle(symbol).color : null,
          }
        })
      results.colors = { before, after, stable: JSON.stringify(before) === JSON.stringify(after) }
      await context.close()
    }

    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      await page.goto(baseUrl)
      await waitForBrickCards(page)
      await page.waitForTimeout(1800)
      results.loadingAttrs = await page.evaluate(() => {
        return Array.from(
          document.querySelectorAll(
            ".icono-card.icono-card--brick:not(.icono-card--skeleton) .iconoplasm-tooltip-portrait-img",
          ),
        )
          .slice(0, 12)
          .map((img) => ({
            loading: img.getAttribute("loading"),
            fetchpriority: img.getAttribute("fetchpriority"),
            hasSrc: !!img.getAttribute("src"),
          }))
      })
      await context.close()
    }
  } finally {
    await browser.close()
  }

  const errors = []
  if (!results.skeleton?.hasSkeletonGrid || results.skeleton.skeletonRows < 1) {
    errors.push("mobile skeleton grid missing")
  }
  if (!results.skeleton?.loadingMeta) {
    errors.push("detail loading class missing while skeleton visible")
  }
  if (!results.colors?.stable) {
    errors.push("card colors changed after round trip")
  }
  if (!Array.isArray(results.loadingAttrs) || !results.loadingAttrs.length) {
    errors.push("no portrait loading attrs collected")
  } else {
    for (const row of results.loadingAttrs) {
      if (row.loading !== "eager" || !row.fetchpriority || !row.hasSrc) {
        errors.push("portrait eager loading attrs missing")
        break
      }
    }
  }

  console.log(JSON.stringify({ results, errors }, null, 2))
  if (errors.length) process.exit(1)
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
