import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { parseHTML } from "linkedom"

await import("./content-tooltip.js")

test("tooltip shell exposes separate mobile close and navigation controls", () => {
  const { document, window } = parseHTML("<html><body></body></html>")
  let closed = 0
  let dismissed = 0
  const tooltip = globalThis.IconoplasmContentTooltip.createTooltipShell({
    documentRef: document,
    windowRef: window,
    onCloseClick: () => {
      closed += 1
    },
    onBackdropClick: () => {
      dismissed += 1
    },
  })

  const close = tooltip.querySelector(".iconoplasm-tooltip-mobile-close")
  const open = tooltip.querySelector("[data-icono-tooltip-open]")
  const backdrop = document.querySelector(".iconoplasm-tooltip-backdrop")

  assert.ok(close)
  assert.equal(close.getAttribute("aria-label"), "Close gene preview")
  assert.ok(open)
  assert.equal(open.getAttribute("target"), "_blank")
  assert.match(open.getAttribute("rel"), /noopener/)
  assert.ok(backdrop)

  close.click()
  backdrop.click()
  assert.equal(closed, 1)
  assert.equal(dismissed, 1)
})

test("touch preview contract separates preview activation from navigation", async () => {
  const [content, frame, css] = await Promise.all([
    readFile(new URL("./content.js", import.meta.url), "utf8"),
    readFile(new URL("./lit-archival-frame.js", import.meta.url), "utf8"),
    readFile(new URL("./content.css", import.meta.url), "utf8"),
  ])

  assert.match(content, /showTooltipForTarget\(gene, \{ touchSheet: true \}\)/)
  assert.match(content, /navigationMode: touchSheetActive \? "explicit" : "card"/)
  assert.match(content, /event\.preventDefault\(\)[\s\S]*event\.stopPropagation\(\)/)
  assert.match(frame, /currentPayload\.navigationMode === "explicit"/)
  assert.match(css, /\.iconoplasm-tooltip--touch-sheet/)
  assert.match(css, /\.iconoplasm-tooltip-mobile-open[\s\S]*min-height: 44px/)
})
