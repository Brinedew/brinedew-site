// Run this file with the existing signed-in Playwright MCP browser:
// browser_run_code_unsafe({ filename: "Website/scripts/the-only-iconoplasm-live-journey-do-not-duplicate.js" })
// This is a visitor check. It never votes, queues generation, or changes a caretaker role.
// The installed extension may merge discoveries into the signed-in account as a real visitor does.
;async (page) => {
  const runId = new Date().toISOString().replace(/[:.]/g, "-")
  const artifacts = "D:/Coding/Website/artifacts/B-801"
  const checks = []
  const record = (name, status, detail) => checks.push({ name, status, detail })
  const mutationRequests = []
  const trackRequest = (request) => {
    if (
      request.url().startsWith("https://iconoplasm.brinedew.bio/") &&
      !["GET", "HEAD", "OPTIONS"].includes(request.method())
    )
      mutationRequests.push({ method: request.method(), url: request.url().split("?")[0] })
  }
  page.context().on("request", trackRequest)
  let genePage

  async function inspectGene(symbol) {
    await genePage.goto(`https://iconoplasm.brinedew.bio/gene/${symbol}?journey=${runId}`, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    })
    await genePage.getByRole("heading", { name: `Character profile for ${symbol}` }).waitFor({
      timeout: 15000,
    })
    const portrait = genePage.locator(`img[alt^="${symbol} character portrait"]`).first()
    await portrait.waitFor({ timeout: 15000 })
    await genePage.waitForFunction(
      (gene) => {
        const image = document.querySelector(`img[alt^="${gene} character portrait"]`)
        return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0
      },
      symbol,
      { timeout: 15000 },
    )
    const candidate = genePage.locator(`img[alt="${symbol} candidate blot"]`).first()
    await candidate.scrollIntoViewIfNeeded({ timeout: 15000 })
    await genePage.waitForFunction(
      (gene) => {
        const image = document.querySelector(`img[alt="${gene} candidate blot"]`)
        return image?.complete && image.naturalWidth > 0 && image.naturalHeight > 0
      },
      symbol,
      { timeout: 15000 },
    )
    const details = await genePage.evaluate((gene) => {
      const portrait = document.querySelector(`img[alt^="${gene} character portrait"]`)
      const candidates = [...document.querySelectorAll(`img[alt="${gene} candidate blot"]`)]
      return {
        title: document.title,
        portraitWidth: portrait.naturalWidth,
        candidateCount: candidates.length,
        firstCandidateWidth: candidates[0].naturalWidth,
      }
    }, symbol)
    await genePage.screenshot({ path: `${artifacts}/${runId}-${symbol}-gene.png` })
    return details
  }

  async function inspectBlot(symbol) {
    const response = await page.request.get(
      `https://iconoplasm.brinedew.bio/blot/${symbol}.webp?journey=${runId}`,
      { timeout: 15000 },
    )
    const bytes = await response.body()
    const mime = response.headers()["content-type"] || ""
    const webp =
      bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
    if (response.status() !== 200 || !mime.startsWith("image/webp") || !webp || bytes.length < 1024)
      throw new Error(
        `${symbol} blot: HTTP ${response.status()}, ${mime}, ${bytes.length} bytes, webp=${webp}`,
      )
    return { status: response.status(), mime, bytes: bytes.length }
  }

  try {
    await page.goto("https://www.uniprot.org/uniprotkb/P35716/entry", {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    })
    await page.getByText("SOX11", { exact: true }).first().waitFor({ timeout: 15000 })
    try {
      await page.locator(".iconoplasm-tooltip").waitFor({ state: "attached", timeout: 8000 })
      await page.waitForFunction(
        () =>
          [...(CSS.highlights.get("iconoplasm-gene-ranges") || [])].some(
            (range) =>
              range.toString() === "SOX11" &&
              range.startContainer.parentElement?.matches(".decorated-list-item__content strong"),
          ),
        null,
        { timeout: 15000 },
      )
      const highlight = await page.evaluate(() => {
        const range = [...CSS.highlights.get("iconoplasm-gene-ranges")].find(
          (entry) =>
            entry.toString() === "SOX11" &&
            entry.startContainer.parentElement?.matches(".decorated-list-item__content strong"),
        )
        const rect = range.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })
      await page.mouse.move(highlight.x, highlight.y)
      await page.locator(".iconoplasm-tooltip-visible").waitFor({ timeout: 10000 })
      await page.waitForFunction(
        () => {
          const tooltip = document.querySelector(".iconoplasm-tooltip-visible")
          const image = tooltip?.querySelector(".iconoplasm-tooltip-portrait-img")
          return tooltip?.textContent.includes("SOX11") && image?.complete && image.naturalWidth > 0
        },
        null,
        { timeout: 15000 },
      )
      await page.screenshot({ path: `${artifacts}/${runId}-SOX11-extension-hover.png` })
      const popupPromise = page.waitForEvent("popup", { timeout: 10000 })
      await page.locator(".iconoplasm-tooltip-symbol", { hasText: "SOX11" }).click()
      const popup = await popupPromise
      await popup.waitForURL(/iconoplasm\.brinedew\.bio\/gene\/SOX11/, { timeout: 10000 })
      await popup.close()
      record(
        "installed extension hover and real click",
        "passed",
        "SOX11 portrait loaded and click opened the SOX11 gene page",
      )
    } catch (error) {
      const mounted = await page.locator(".iconoplasm-tooltip").count()
      record(
        "installed extension hover and real click",
        mounted ? "failed" : "unverified",
        String(error.message || error),
      )
    }
  } catch (error) {
    record("UniProt host page", "failed", String(error.message || error))
  }

  try {
    genePage = await page.context().newPage()
    for (const symbol of ["SOX11", "TP53"]) {
      try {
        record(`${symbol} gene page`, "passed", await inspectGene(symbol))
      } catch (error) {
        record(`${symbol} gene page`, "failed", String(error.message || error))
      }
      try {
        record(`${symbol} public blot`, "passed", await inspectBlot(symbol))
      } catch (error) {
        record(`${symbol} public blot`, "failed", String(error.message || error))
      }
    }
  } catch (error) {
    record("public gene browser", "failed", String(error.message || error))
  } finally {
    if (genePage && !genePage.isClosed()) await genePage.close()
  }
  page.context().off("request", trackRequest)
  const unexpectedWrites = mutationRequests.filter(
    (request) =>
      request.method !== "POST" ||
      ![
        "https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/batch",
        "https://iconoplasm.brinedew.bio/api/iconoplasm/discoveries/merge",
        "https://iconoplasm.brinedew.bio/cdn-cgi/rum",
      ].includes(request.url),
  )
  record("no vote, generation, or caretaker write", unexpectedWrites.length ? "failed" : "passed", {
    expectedBackgroundWrites: mutationRequests.length - unexpectedWrites.length,
    unexpectedWrites,
  })

  const receipt = {
    runId,
    result: checks.some((check) => check.status === "failed")
      ? "failed"
      : checks.some((check) => check.status === "unverified")
        ? "unverified"
        : "passed",
    checks,
    screenshots: `${artifacts}/${runId}-*.png`,
    observedWriteRequests: mutationRequests,
  }
  return receipt
}
