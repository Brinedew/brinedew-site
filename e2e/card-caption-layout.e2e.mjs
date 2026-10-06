// B-1038: the image-only card caption (full name bottom-left, gene symbol
// bottom-right) is laid out with Pretext in shared/iconoplasm-card/caption-layout.js.
// The cards are rendered through the shared renderer the archive and the blot
// renderer use, in a real browser with the real fonts, for the longest symbols that
// stay in the catalogue once readthroughs go (B-1031).
//
// Ways it has failed before (#548, #552), each asserted at the blot's 384 px card
// and a narrower 300 px card:
// 1. the name runs under or into the symbol;
// 2. the symbol is split or wraps onto a second line;
// 3. the symbol leaves the card;
// 4. a name is broken inside a word.
import assert from "node:assert/strict"
import { mkdirSync } from "node:fs"
import path from "node:path"
import test from "node:test"

import { HOST, OUT, launchChrome, routeProduction, startSite } from "./harness.mjs"

const GENES = [
  ["TRAV38-2DV8", "T cell receptor alpha variable 38-2/delta variable 8"],
  ["ANKRD13C-DT", "ANKRD13C divergent transcript"],
  ["CSGALNACT1", "chondroitin sulfate N-acetylgalactosaminyltransferase 1"],
  ["PALM2AKAP2", "PALM2 and AKAP2 fusion"],
  ["C1GALT1C1L", "C1GALT1 specific chaperone 1 like"],
  ["IGHV1-69-2", "immunoglobulin heavy variable 1-69-2"],
  ["WEE1", "WEE1 G2 checkpoint kinase"],
  ["INS", "insulin"],
]
const PORTRAIT =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="4"><rect width="3" height="4" fill="#556"/></svg>',
  )

test("long gene symbols stay whole and the name flows around them", async (t) => {
  const browser = await launchChrome(t)
  if (!browser) return
  const { server, origin } = await startSite()
  mkdirSync(OUT, { recursive: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await routeProduction(context, origin)
    const page = await context.newPage()
    await page.goto(`${HOST}/`)
    await page.waitForFunction(
      () => Boolean(globalThis.IconoplasmCardShared?.layoutImageOnlyCaptions),
      {
        timeout: 30_000,
      },
    )
    for (const width of [384, 300]) {
      const report = await page.evaluate(
        async ({ genes, width, portrait }) => {
          const shared = globalThis.IconoplasmCardShared
          const host = document.createElement("div")
          host.id = "caption-e2e"
          host.style.cssText = "display:flex;flex-wrap:wrap;gap:12px;padding:12px;background:#111"
          host.innerHTML = genes
            .map(
              ([symbol, name]) =>
                `<article class="icono-card icono-card--image-tile icono-card--variant-image-only" data-icono-card-variant="image-only" style="width:${width}px;height:${Math.round((width * 4) / 3)}px;max-width:none">${shared.renderLabLabelCardHtml(
                  { symbol, full_name: name, portrait: { status: "published" } },
                  {
                    mode: "brick",
                    layoutVariant: "image-only",
                    portraitSrc: portrait,
                    portraitAlt: symbol,
                    titleHref: "",
                    voteHtml: "",
                  },
                )}</article>`,
            )
            .join("")
          document.body.prepend(host)
          host
            .querySelectorAll(".icono-image-only-link")
            .forEach((link) => link.classList.add("icono-image-only-link--loaded"))
          await shared.layoutImageOnlyCaptions(host)
          return [...host.querySelectorAll(".icono-image-only-caption-row")].map((row) => {
            const symbol = row.querySelector(".icono-image-only-symbol")
            const symbolBox = symbol.getBoundingClientRect()
            const rowBox = row.getBoundingClientRect()
            const range = document.createRange()
            range.selectNodeContents(symbol)
            const symbolLines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)))
              .size
            const lines = [...row.querySelectorAll(".icono-image-only-caption-line")].map(
              (line) => {
                const text = document.createRange()
                text.selectNodeContents(line)
                const box = text.getBoundingClientRect()
                return {
                  text: line.textContent,
                  left: box.left,
                  right: box.right,
                  top: box.top,
                  bottom: box.bottom,
                }
              },
            )
            return {
              symbol: row.dataset.iconoCaptionSymbol,
              name: row.dataset.iconoCaptionName,
              mode: row.dataset.iconoCaptionMode,
              lines,
              symbolLines,
              symbolBox: {
                left: symbolBox.left,
                right: symbolBox.right,
                top: symbolBox.top,
                bottom: symbolBox.bottom,
              },
              rowRight: rowBox.right,
            }
          })
        },
        { genes: GENES, width, portrait: PORTRAIT },
      )
      await page
        .locator("#caption-e2e")
        .screenshot({ path: path.join(OUT, `card-captions-${width}.png`) })
      assert.equal(report.length, GENES.length, `${width}px: every card laid out`)
      for (const card of report) {
        const where = `${width}px ${card.symbol}`
        assert.ok(
          card.mode === "beside" || card.mode === "above",
          `${where}: laid out (${card.mode})`,
        )
        assert.equal(card.symbolLines, 1, `${where}: symbol on one line`)
        assert.ok(card.symbolBox.right <= card.rowRight + 0.5, `${where}: symbol inside the card`)
        for (const line of card.lines) {
          const overlaps =
            line.right > card.symbolBox.left + 0.5 &&
            line.bottom > card.symbolBox.top + 0.5 &&
            line.top < card.symbolBox.bottom - 0.5
          assert.equal(overlaps, false, `${where}: "${line.text}" runs into the symbol`)
        }
        // Lines rejoin into the name only at spaces or after a hyphen: no word was cut.
        const rejoined = card.lines
          .map((line) => line.text)
          .reduce(
            (text, line) => (text.endsWith("-") ? text + line : text ? `${text} ${line}` : line),
            "",
          )
        assert.equal(rejoined, card.name, `${where}: the name is broken inside a word`)
      }
      await page.evaluate(() => document.getElementById("caption-e2e").remove())
    }
    await context.close()
  } finally {
    server.close()
    await browser.close()
  }
})
