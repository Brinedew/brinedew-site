// ARCHITECTURE FENCE [IPD-008]: adversarial startup test in the EXISTING browser.
// Synthetic article, not healthy-site latency evidence. A pending image keeps
// window.load blocked; cached highlighting must not wait or initiate card work.
export function assessBlockedHostStartup(result) {
  const failures = []
  if (!Number.isFinite(result?.first?.at) || result.first.at > 2000)
    failures.push("late-or-missing-highlights")
  if (!(result?.first?.fcp > 0) || result.first.at < result.first.fcp)
    failures.push("host-paint-not-proven-first")
  if (result?.first?.load !== 0 || result?.beforeRelease?.state !== "interactive")
    failures.push("load-was-not-held")
  if (result?.first?.highlights !== 3 || result.first.nested !== 0)
    failures.push("wrong-highlight-inventory")
  if (!Array.isArray(result?.beforeRelease?.requests) || result.beforeRelease.requests.length)
    failures.push("pre-load-network")
  if (!result?.afterReleaseRequests?.some((request) => request.url.endsWith("/card-current")))
    failures.push("post-load-freshness-not-observed")
  return { verdict: failures.length ? "fail" : "pass", failures }
}

export async function measureBlockedHostStartup(page, { holdMs = 20000, timeoutMs = 10000 } = {}) {
  if (holdMs < 1000 || holdMs > 30000 || timeoutMs < 1000 || timeoutMs > holdMs)
    throw new Error("Invalid bounded startup workload")
  const base = "https://iconoplasm-startup-benchmark.invalid"
  const requests = []
  const request = (req) => {
    if (
      /https:\/\/(iconoplasm\.brinedew\.bio|iconoplasmportraits\.b-cdn\.net)\//.test(req.url()) &&
      requests.length < 100
    )
      requests.push({ at: Date.now(), url: req.url().split("?")[0] })
  }
  let releaseImage
  const imageGate = new Promise((resolve) => {
    releaseImage = resolve
  })
  const handler = async (route) => {
    if (route.request().url().endsWith("/slow.svg")) {
      await imageGate
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      })
    } else
      await route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html><head><title>Iconoplasm blocked-load test</title></head><body><article><h1>EZH2 regulation</h1><p>TP53 and DNMT3A are gene symbols. Ordinary prose remains unchanged.</p></article><img src="/slow.svg" width="1" height="1" alt=""></body></html>',
      })
  }
  page.context().on("request", request)
  await page.route(`${base}/**`, handler)
  const started = Date.now()
  try {
    await page.goto(`${base}/article`, { waitUntil: "domcontentloaded", timeout: timeoutMs })
    await page.locator('.iconoplasm-gene[data-gene="EZH2"]').first().waitFor({ timeout: timeoutMs })
    const first = await page.evaluate(() => ({
      at: performance.now(),
      fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null,
      state: document.readyState,
      load: performance.getEntriesByType("navigation")[0]?.loadEventEnd,
      highlights: document.querySelectorAll(".iconoplasm-gene").length,
      nested: document.querySelectorAll(".iconoplasm-gene .iconoplasm-gene").length,
    }))
    await page.waitForTimeout(Math.max(0, holdMs - (Date.now() - started)))
    const beforeRelease = {
      requests: [...requests],
      state: await page.evaluate(() => document.readyState),
    }
    releaseImage()
    await page.waitForLoadState("load", { timeout: 5000 })
    await page.waitForTimeout(1200)
    const result = {
      first,
      beforeRelease,
      afterReleaseRequests: requests.slice(beforeRelease.requests.length),
      holdMs,
      limitation:
        "Synthetic pending-image test in existing warm profile; not a cold install or account-capacity certificate",
    }
    return { ...result, assessment: assessBlockedHostStartup(result) }
  } finally {
    releaseImage()
    page.context().off("request", request)
    await page.unroute(`${base}/**`, handler)
  }
}
