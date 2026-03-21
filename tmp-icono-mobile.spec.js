import { test, expect } from "playwright/test"

async function waitForBrickCards(page) {
  await page.waitForSelector(".icono-card.icono-card--brick:not(.icono-card--skeleton)", {
    timeout: 30000,
  })
}

test.describe("Iconoplasm mobile card regressions", () => {
  test("shows mobile skeleton rows while detail fetch is pending", async ({ page }) => {
    await page.route("**/api/gene/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1600))
      await route.continue()
    })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("http://127.0.0.1:8093/")
    await waitForBrickCards(page)
    await page.waitForTimeout(250)

    const state = await page
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

    expect(state.hasSkeletonGrid).toBeTruthy()
    expect(state.skeletonRows).toBeGreaterThan(0)
    expect(state.loadingMeta).toBeTruthy()
    expect(state.cardHeight).toBeGreaterThan(300)
  })

  test("keeps mobile card ink stable after click-through and All genes return", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("http://127.0.0.1:8093/")
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
    await page.waitForURL("http://127.0.0.1:8093/")
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

    expect(after).toEqual(before)
  })

  test("brick card portraits use eager loading on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto("http://127.0.0.1:8093/")
    await waitForBrickCards(page)
    await page.waitForTimeout(1800)

    const attrs = await page.evaluate(() => {
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

    expect(attrs.length).toBeGreaterThan(0)
    for (const attr of attrs) {
      expect(attr.loading).toBe("eager")
      expect(attr.fetchpriority).toBeTruthy()
      expect(attr.hasSrc).toBeTruthy()
    }
  })
})
