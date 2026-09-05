// Run only in the existing, packaged-extension browser. These operations model
// frameworks that retain Text references; inspecting final HTML alone misses
// the detached-node failure that used to discard subsequent streamed text.
export async function measureStreamingHighlights(page, { timeoutMs = 10000 } = {}) {
  if (timeoutMs < 1000 || timeoutMs > 15000) throw new Error("Invalid benchmark deadline")
  const base = "https://iconoplasm-streaming-benchmark.invalid"
  const handler = (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><html><head><title>Iconoplasm streaming regression</title><style>body{font:16px/20px Arial;margin:24px}#stream{white-space:pre-wrap;margin:16px 0}</style></head><body><h1>TP53</h1><p id="stream"></p><input value="BRCA1" aria-label="Unmodified editable"><div contenteditable="true">EGFR</div></body></html>',
    })
  await page.route(`${base}/**`, handler)
  try {
    await page.goto(`${base}/stream`, { waitUntil: "load", timeout: timeoutMs })
    await page.waitForFunction(() => CSS.highlights.get("iconoplasm-gene-ranges")?.size > 0, null, {
      timeout: timeoutMs,
    })
    return await page.evaluate(async () => {
      const host = document.querySelector("#stream")
      const original = document.createTextNode("")
      host.append(original)
      const results = []
      const annotations = (node) =>
        Array.from(CSS.highlights.get("iconoplasm-gene-ranges") || []).filter(
          (range) => range.startContainer === node,
        )
      const waitFor = async (check) => {
        const start = performance.now()
        while (!check()) {
          if (performance.now() - start > 1500)
            throw new Error("Streaming annotation deadline exceeded")
          await new Promise((resolve) => setTimeout(resolve, 20))
        }
        return performance.now() - start
      }
      const assert = (condition, message) => {
        if (!condition) throw new Error(message)
      }
      original.appendData("TP")
      original.appendData("53")
      results.push({
        operation: "split-token",
        milliseconds: await waitFor(() => annotations(original).length === 1),
      })
      assert(host.firstChild === original, "Scanner replaced the framework's Text node")
      original.data = ""
      await waitFor(() => annotations(original).length === 0)
      const line = "TP53 BRCA1 EGFR EZH2 DNMT3A"
      let expected = ""
      for (let row = 0; row < 10; row++) {
        const addition = (row ? "\n" : "") + line
        expected += addition
        original.appendData(addition)
        const before = host.getBoundingClientRect().toJSON()
        const milliseconds = await waitFor(() => annotations(original).length === (row + 1) * 5)
        assert(
          host.textContent === expected &&
            host.firstChild === original &&
            host.childNodes.length === 1,
          "Streaming text or node identity changed",
        )
        assert(
          JSON.stringify(host.getBoundingClientRect().toJSON()) === JSON.stringify(before),
          "Highlighting changed host geometry",
        )
        results.push({
          operation: "appendData",
          row,
          milliseconds,
          highlights: annotations(original).length,
        })
      }
      original.replaceData(0, original.length, "EGFR")
      await waitFor(
        () => annotations(original).length === 1 && annotations(original)[0].toString() === "EGFR",
      )
      assert(host.textContent === "EGFR", "replaceData lost host text")
      original.insertData(0, "TP53 ")
      await waitFor(() => annotations(original).length === 2)
      original.deleteData(0, 5)
      await waitFor(
        () => annotations(original).length === 1 && annotations(original)[0].toString() === "EGFR",
      )
      const selection = document.getSelection()
      const range = document.createRange()
      range.selectNodeContents(host)
      selection.removeAllRanges()
      selection.addRange(range)
      assert(annotations(original).length === 1, "Selection changed native annotations")
      assert(selection.toString() === "EGFR", "Selection includes duplicate overlay text")
      selection.removeAllRanges()
      await waitFor(() => annotations(original).length === 1)
      host.removeChild(original)
      await waitFor(() => annotations(original).length === 0)
      host.textContent = "BRCA1"
      await waitFor(() => annotations(host.firstChild).length === 1)
      assert(document.querySelector("input").value === "BRCA1", "Editable input changed")
      assert(
        document.querySelector("[contenteditable]").textContent === "EGFR",
        "Editable content changed",
      )
      assert(
        !document.querySelector("body .iconoplasm-gene"),
        "Scanner inserted anchors in host content",
      )
      const busy = document.createElement("p")
      const noise = document.createTextNode("counter 0")
      const longText = document.createTextNode("TP53 ".repeat(240))
      busy.append(longText)
      document.body.append(busy, noise)
      let ticks = 0
      const ticker = setInterval(() => {
        noise.data = `counter ${++ticks}`
      }, 8)
      try {
        results.push({
          operation: "long-text-during-continuous-unrelated-mutations",
          milliseconds: await waitFor(() => annotations(longText).length === 240),
          highlights: annotations(longText).length,
          ticks,
        })
        assert(
          ticks > 0 && busy.firstChild === longText,
          "Busy-page fixture did not exercise retained text",
        )
      } finally {
        clearInterval(ticker)
        busy.remove()
        noise.remove()
      }
      return {
        verdict: "pass",
        results,
        preserved: [
          "Text identity",
          "appendData",
          "replaceData",
          "insertData",
          "deleteData",
          "selection",
          "removeChild",
          "textContent replacement",
          "host geometry",
          "editables",
        ],
      }
    })
  } finally {
    await page.unroute(`${base}/**`, handler)
  }
}
