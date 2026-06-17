import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("../quartz/static/iconoplasm/styles.css", import.meta.url), "utf8")
const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")

function expectCenteredCover(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const rule = new RegExp(
    `${escaped}\\s*\\{[^}]*object-fit:\\s*cover;[^}]*object-position:\\s*center\\s+center;`,
    "m",
  )
  assert.match(css, rule, `${selector} should keep thumbnail crops centered`)
}

test("Iconoplasm thumbnail viewports reuse the centered search portrait behavior", () => {
  expectCenteredCover(".icono-thumbnail-viewport-image")
  assert.match(
    app,
    /icono-search-result-portrait icono-thumbnail-viewport-image/,
    "search results should use the shared thumbnail viewport class",
  )
  assert.match(
    app,
    /icono-thumbnail-viewport-image\" src=/,
    "request option thumbnails should reuse the shared thumbnail viewport class directly",
  )
  assert.doesNotMatch(
    css,
    /\.icono-request-option-thumb-image\s*\{/m,
    "request option thumbnails should not carry a picker-only crop override",
  )
  assert.match(
    css,
    /\.icono-request-option-thumb\s*\{[^}]*width:\s*96px;[^}]*height:\s*128px;/m,
    "request option previews should keep a true 2x portrait viewport",
  )
})
