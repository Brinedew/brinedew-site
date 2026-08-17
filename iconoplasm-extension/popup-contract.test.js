import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

const popupHtmlUrl = new URL("./popup.html", import.meta.url)
const popupCssUrl = new URL("./popup.css", import.meta.url)
const popupJsUrl = new URL("./popup.js", import.meta.url)

test("popup header exposes the Iconoplasm website link for store-installed users", async () => {
  const [html, css] = await Promise.all([
    readFile(popupHtmlUrl, "utf8"),
    readFile(popupCssUrl, "utf8"),
  ])

  assert.match(
    html,
    /<a[\s\S]*class="popup-site-link"[\s\S]*href="https:\/\/iconoplasm\.brinedew\.bio\/"/,
  )
  assert.match(html, /target="_blank"/)
  assert.match(html, /rel="noopener"/)
  assert.match(html, /aria-label="Open Iconoplasm website"/)
  assert.match(css, /\.popup-header-actions/)
  assert.match(css, /\.popup-site-link/)
})

test("Appearance exposes one accessible two-state PDF highlighting control", async () => {
  const [html, js] = await Promise.all([
    readFile(popupHtmlUrl, "utf8"),
    readFile(popupJsUrl, "utf8"),
  ])

  assert.match(html, /<legend>PDF highlighting<\/legend>/)
  assert.match(html, /name="pdf-highlighting" value="on"/)
  assert.match(html, /name="pdf-highlighting" value="off"/)
  assert.match(html, /aria-label="PDF highlighting"/)
  assert.doesNotMatch(html, /Open PDFs automatically/)
  assert.doesNotMatch(html, /open-pdf-reader/)
  assert.match(js, /pdfHighlightingEnabled/)
  assert.match(js, /PDF_OWNERSHIP_SET_ENABLED/)
  assert.doesNotMatch(js, /chrome\.mimeHandler/)
  assert.doesNotMatch(js, /pdfAutomaticOpenEnabled/)
})

test("appearance controls normalize through the shared settings policy", async () => {
  const js = await readFile(popupJsUrl, "utf8")
  assert.match(js, /CONTENT_STORAGE_KEYS\.highlightMode/u)
  assert.match(js, /CONTENT_STORAGE_KEYS\.highlightVisibility/u)
  assert.match(js, /IconoplasmContentSettings\.normalizeHighlightMode/u)
  assert.match(js, /IconoplasmContentSettings\.normalizeHighlightVisibility/u)
  assert.match(js, /IconoplasmContentSettings\.normalizeCardVariant/u)
  assert.doesNotMatch(js, /value === "hover" \? "hover" : "always"/u)
})
