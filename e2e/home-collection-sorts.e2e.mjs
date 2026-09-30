// B-885: a signed-in home collection sorted by anything but "newest" or A-Z,
// checked in a real browser against the live published catalog.
//
// Ways this can fail, written before the code:
// 1. the page asks /discoveries/me for the enriched shape (the server then
//    joins every discovered gene: ~4.6 D1 rows per gene per home view, and a
//    Cloudflare 1102 for the largest shelves);
// 2. the compact shelf renders in the server's order instead of the chosen
//    sort (popularity must never rise down the list; heaviest must never gain
//    weight, with unknown weights last);
// 3. a gene the catalog has no metrics for vanishes, or jumps ahead of genes
//    with a higher value;
// 4. the collection stays on "Loading collection..." or shows "Loading stopped".
//
// Needs `pnpm run build` (public-iconoplasm-edge), an installed Chrome and the
// live published catalog (the sort fields come from it, as in production).
// The measured orders land in artifacts/e2e/home-collection-sorts.json.
import assert from "node:assert/strict"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, launchChrome, routeProduction, startSite } from "./harness.mjs"

// Real genes with very different popularity and weight, plus one symbol the
// catalog does not know.
const SHELF = ["C1orf112", "TP53", "ZNF25", "INS", "GAPDH", "BRCA1", "ACTB", "NOTAGENE1"]

function vm(symbol) {
  return {
    __complete: true,
    schema_version: "iconoplasm.mobileCard.v1",
    snapshot_version: "e2e",
    symbol,
    full_name: `${symbol} full name`,
    display_color: "#423D37",
    portrait: { status: "published", url: "", width: 768, height: 1024 },
    field_status: {
      symbol: "present",
      full_name: "present",
      color: "present",
      portrait: "present",
    },
    payload: { symbol, full_name: `${symbol} full name`, color: "#423D37", portrait: {} },
  }
}

// `calls` gets each shelf request's query; `requested` each symbol the page
// asks the card manifest for, in order. That order is the sort (the image-only
// layout can skip a card without a portrait, so the DOM is not the measure).
function createApi(calls, requested) {
  return (pathname, request) => {
    if (pathname === "/api/iconoplasm/discoveries/me") {
      const url = new URL(request.url())
      calls.push(url.search)
      if (url.searchParams.get("shape") !== "compact") return { discoveries: [] }
      return {
        ok: true,
        authenticated: true,
        shape: "compact",
        user: { id: "u1", username: "e2e" },
        order: url.searchParams.get("order"),
        discoveries: SHELF.map((symbol, index) => ({
          gene_symbol: symbol.toUpperCase(),
          first_discovered_at: `2026-09-${String(10 + index).padStart(2, "0")}T00:00:00Z`,
          last_encountered_at: `2026-09-${String(10 + index).padStart(2, "0")}T00:00:00Z`,
          encounter_count: 1,
        })),
        discovered_count: SHELF.length,
      }
    }
    if (pathname === "/api/iconoplasm/mobile-card-manifest") {
      const body = JSON.parse(request.postData() || "{}")
      for (const symbol of body.symbols || [])
        if (!requested.includes(symbol)) requested.push(symbol)
      return {
        schema: "iconoplasm.mobileCardManifest.v1",
        snapshot_version: "e2e",
        cards: (body.symbols || []).map(vm),
        missing: [],
      }
    }
    return undefined
  }
}

test("a signed-in shelf sorts in the browser from the published catalog", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  const report = []
  try {
    for (const order of ["popularity", "heaviest"]) {
      const calls = []
      const requested = []
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
      await routeProduction(context, origin, createApi(calls, requested))
      const page = await context.newPage()
      const consoleLines = []
      page.on("console", (message) => consoleLines.push(`${message.type()}: ${message.text()}`))
      await page.goto(`${HOST}/?order=${order}`)
      try {
        await page.waitForFunction(
          () =>
            /End of collection/.test(
              document.getElementById("icono-feed-status")?.textContent || "",
            ),
          null,
          { timeout: 45_000 },
        )
      } catch (error) {
        // 4. Keep the evidence of a stuck collection.
        await page.screenshot({ path: path.join(OUT, `home-collection-${order}-stuck.png`) })
        const state = await page.evaluate(() => ({
          grid: document.getElementById("icono-grid")?.innerHTML.slice(0, 600) || "(no grid)",
          status: document.getElementById("icono-feed-status")?.textContent || "",
        }))
        report.push({ order, calls, stuck: state, console: consoleLines.slice(-15) })
        throw error
      }
      await page.evaluate((list) => (window.__requested = list), requested)
      const measured = await page.evaluate(async () => {
        const metrics = await window.IconoplasmPublicationReader.geneMetrics()
        const { ICONOPLASM_WIKI_PAGEVIEWS: pageviews } =
          await import("/static/iconoplasm/wiki-pageviews.js")
        const symbols = window.__requested
        return {
          symbols,
          metrics: symbols.map((symbol) => ({
            symbol,
            ...(metrics.get(symbol) || {}),
            popularity_score: Number(pageviews[symbol] || 0),
          })),
          text: document.body.innerText,
        }
      })
      report.push({ order, calls, ...measured, text: undefined })

      // 1. Only the compact shape is ever requested.
      assert.ok(calls.length >= 1, `${order}: the shelf was never requested`)
      for (const search of calls) {
        assert.match(search, /[?&]shape=compact(&|$)/, `${order}: enriched shape requested`)
      }
      // 3. Every discovered gene is shown, the unknown one included.
      assert.deepEqual(
        [...measured.symbols].sort(),
        SHELF.map((s) => s.toUpperCase()).sort(),
        `${order}: shelf membership`,
      )
      // 2. The chosen sort holds on the catalog's own values.
      // A gene without metrics counts as popularity 0 / weight unknown, so it
      // may tie with real genes, but never jumps ahead of a higher value.
      const known = measured.metrics
      for (let i = 1; i < known.length; i++) {
        const [prev, next] = [known[i - 1], known[i]]
        if (order === "popularity") {
          assert.ok(
            prev.popularity_score >= next.popularity_score,
            `${order}: ${prev.symbol} (${prev.popularity_score}) before ${next.symbol} (${next.popularity_score})`,
          )
        } else if (next.weight_kg != null) {
          assert.ok(
            prev.weight_kg != null && prev.weight_kg >= next.weight_kg,
            `${order}: ${prev.symbol} (${prev.weight_kg}) before ${next.symbol} (${next.weight_kg})`,
          )
        }
      }
      // 4. Loaded, not stuck.
      assert.doesNotMatch(measured.text, /Loading stopped|LOADING COLLECTION/i, `${order}: stuck`)
      await page.screenshot({ path: path.join(OUT, `home-collection-${order}.png`) })
      await context.close()
    }
  } finally {
    writeFileSync(path.join(OUT, "home-collection-sorts.json"), JSON.stringify(report, null, 2))
    server.close()
    await browser.close()
  }
})
