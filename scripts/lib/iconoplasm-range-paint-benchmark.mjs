// Run against the actual DEV extension in the existing browser profile.
// This fixture covers browser painting behavior that a DOM-only test cannot.
export async function measureRangePaint(page, { extensionId, artifactDirectory }) {
  const worker = page
    .context()
    .serviceWorkers()
    .find((worker) => worker.url().startsWith(`chrome-extension://${extensionId}/`))
  if (!worker) throw new Error("The requested installed extension worker is unavailable")
  const keys = ["iconoplasm_highlight_mode", "iconoplasm_highlight_visibility"]
  const original = await worker.evaluate((keys) => chrome.storage.local.get(keys), keys)
  const base = "https://iconoplasm-range-paint-benchmark.invalid"
  const handler = (route) =>
    route.fulfill({
      contentType: "text/html",
      headers: {
        "Content-Security-Policy":
          "default-src 'none'; style-src 'nonce-iconoplasm-fixture'; img-src 'none'",
      },
      body: `<!doctype html><html><head><title>Native range painting regression</title><style nonce="iconoplasm-fixture">
      body{font:20px/1.8 Georgia;margin:36px;min-height:2200px}
      #native{margin:0 0 24px} #nested{overflow:auto;width:720px;height:260px;padding:24px;border:6px solid #999;background:#faf5ee}
      #flow{height:900px} #surface{padding:24px;background:linear-gradient(90deg,#edf4fc,#faf4fc);font-style:italic}
      .responsive #surface{background:linear-gradient(90deg,#f8e9d5,#e4f8ef);padding-left:56px}
      #after{margin-top:500px} #edit{margin-top:20px}
    </style></head><body><p id="native">TP53 BRCA1</p>
      <div id="nested"><div id="flow"><div id="surface">EGFR EZH2 DNMT3A<br>EGFR EZH2 DNMT3A<br>EGFR EZH2 DNMT3A</div></div></div>
      <p id="after">TP53 BRCA1</p><div id="edit" contenteditable="true">TP53 BRCA1</div></body></html>`,
    })
  await page.route(`${base}/**`, handler)
  const results = []
  const paintErrors = []
  const consoleMessage = (message) => {
    if (message.type() === "error" && message.text().includes("data-iconoplasm-decoration"))
      paintErrors.push(message.text().slice(-200))
  }
  page.on("console", consoleMessage)
  try {
    await worker.evaluate(() =>
      chrome.storage.local.set({
        iconoplasm_highlight_mode: "pill",
        iconoplasm_highlight_visibility: "always",
      }),
    )
    await page.goto(`${base}/article`, { waitUntil: "load", timeout: 15000 })
    await page.waitForFunction(
      () => CSS.highlights.get("iconoplasm-gene-ranges")?.size === 13,
      null,
      { timeout: 10000 },
    )
    await page.bringToFront()
    const baseline = await page.evaluate(() => {
      const ids = ["native", "nested", "flow", "surface", "after", "edit"]
      window.__paintFixture = {
        nodes: ids.map((id) => document.getElementById(id)),
        text: document.body.textContent,
        textNodes: [...CSS.highlights.get("iconoplasm-gene-ranges")].map(
          (range) => range.startContainer,
        ),
      }
      return ids.map((id) => ({
        id,
        box: document.getElementById(id).getBoundingClientRect().toJSON(),
      }))
    })
    for (const mode of ["underline", "pill", "pill-outline", "ellipse"]) {
      await worker.evaluate(
        (mode) => chrome.storage.local.set({ iconoplasm_highlight_mode: mode }),
        mode,
      )
      await page.waitForTimeout(250)
      const state = await page.evaluate(() => {
        const ranges = [...CSS.highlights.get("iconoplasm-gene-ranges")]
        return {
          count: ranges.length,
          originalText: document.body.textContent === window.__paintFixture.text,
          originalNodes: ranges.every(
            (range, index) => range.startContainer === window.__paintFixture.textNodes[index],
          ),
          copies: document.querySelectorAll(".iconoplasm-range-anchor,.iconoplasm-gene-copy")
            .length,
          boxes: window.__paintFixture.nodes.map((node) => ({
            id: node.id,
            box: node.getBoundingClientRect().toJSON(),
          })),
          existingBackground: document
            .getElementById("surface")
            .style.backgroundImage.includes("linear-gradient"),
        }
      })
      if (
        state.count !== 13 ||
        !state.originalText ||
        !state.originalNodes ||
        state.copies ||
        !state.existingBackground ||
        JSON.stringify(state.boxes) !== JSON.stringify(baseline)
      )
        throw new Error(`Native painting contract failed in ${mode}: ${JSON.stringify(state)}`)
      await page.screenshot({
        path: `${artifactDirectory}/native-paint-${mode}.png`,
        timeout: 5000,
      })
      if (paintErrors.length)
        throw new Error(`Decoration resource policy failure: ${paintErrors.join("; ")}`)
      results.push({ mode, ...state })
    }
    // Scroll without a geometry refresh: painted backgrounds and native text
    // must travel with the same browser scrolling surface.
    const before = await page.evaluate(() => ({
      positions: [...document.querySelectorAll('[style*="data:image/svg+xml"]')].map(
        (node) => node.style.backgroundPosition,
      ),
      nativeTop: document.querySelector("#native").getBoundingClientRect().top,
      nestedTop: document.querySelector("#surface").getBoundingClientRect().top,
    }))
    await page.locator("#nested").hover()
    await page.mouse.wheel(0, 90)
    await page.waitForTimeout(200)
    await page.screenshot({
      path: `${artifactDirectory}/native-paint-nested-scroll.png`,
      timeout: 5000,
    })
    const nested = await page.evaluate(() => ({
      positions: [...document.querySelectorAll('[style*="data:image/svg+xml"]')].map(
        (node) => node.style.backgroundPosition,
      ),
      nativeTop: document.querySelector("#native").getBoundingClientRect().top,
      nestedTop: document.querySelector("#surface").getBoundingClientRect().top,
      scrollTop: document.querySelector("#nested").scrollTop,
    }))
    if (
      JSON.stringify(before.positions) !== JSON.stringify(nested.positions) ||
      before.nativeTop !== nested.nativeTop ||
      Math.abs(before.nestedTop - nested.nestedTop - nested.scrollTop) > 0.1 ||
      !nested.scrollTop
    )
      throw new Error(
        `Nested scroll changed the paint coordinates: ${JSON.stringify({ before, nested })}`,
      )
    await page.mouse.move(1100, 300)
    await page.mouse.wheel(0, 450)
    await page.waitForTimeout(200)
    await page.screenshot({
      path: `${artifactDirectory}/native-paint-document-scroll.png`,
      timeout: 5000,
    })
    const documentScroll = await page.evaluate(() => ({
      positions: [...document.querySelectorAll('[style*="data:image/svg+xml"]')].map(
        (node) => node.style.backgroundPosition,
      ),
      scrollTop: scrollY,
    }))
    if (
      !documentScroll.scrollTop ||
      JSON.stringify(before.positions) !== JSON.stringify(documentScroll.positions)
    )
      throw new Error("Document scrolling rewrote decoration positions")
    await page.evaluate(() => {
      scrollTo(0, 0)
      document.querySelector("#nested").scrollTop = 0
      document.body.classList.add("responsive")
    })
    await page.waitForTimeout(250)
    const responsive = await page.evaluate(() => ({
      gradient: document
        .querySelector("#surface")
        .style.backgroundImage.includes("rgb(248, 233, 213)"),
      padding: getComputedStyle(document.querySelector("#surface")).paddingLeft,
    }))
    if (!responsive.gradient || responsive.padding !== "56px")
      throw new Error("Host responsive styles were frozen")
    await page.evaluate(() => {
      document.querySelector("#surface").style.backgroundPositionX = "17px"
    })
    await page.waitForTimeout(100)
    await page.evaluate(() => {
      document.querySelector("#surface").textContent = "ordinary prose"
    })
    await page.waitForTimeout(250)
    const cleanup = await page.evaluate(() => ({
      inlineStyle: document.querySelector("#surface").getAttribute("style"),
      positionX: document.querySelector("#surface").style.backgroundPositionX,
      properties: [...document.querySelector("#surface").style],
      gradient: getComputedStyle(document.querySelector("#surface")).backgroundImage,
    }))
    if (
      cleanup.positionX !== "17px" ||
      cleanup.properties.join() !== "background-position-x" ||
      !cleanup.gradient.includes("rgb(248, 233, 213)")
    )
      throw new Error(
        `Removed text did not release its painting surface: ${JSON.stringify(cleanup)}`,
      )
    return {
      verdict: "pass",
      results,
      nestedScroll: nested.scrollTop,
      documentScroll: documentScroll.scrollTop,
      responsive,
      cleanup,
    }
  } finally {
    page.off("console", consoleMessage)
    await worker.evaluate(
      async ({ original, keys }) => {
        await chrome.storage.local.set(original)
        await chrome.storage.local.remove(keys.filter((key) => !(key in original)))
      },
      { original, keys },
    )
    await page.unroute(`${base}/**`, handler)
  }
}
