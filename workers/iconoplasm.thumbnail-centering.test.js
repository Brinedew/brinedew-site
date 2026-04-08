import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"

const css = readFileSync(new URL("../quartz/static/iconoplasm/styles.css", import.meta.url), "utf8")
const app = readFileSync(new URL("../quartz/static/iconoplasm/app.js", import.meta.url), "utf8")

function expectCenteredCover(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const rule = new RegExp(`${escaped}\\s*\\{[^}]*object-fit:\\s*cover;[^}]*object-position:\\s*center\\s+center;`, "m")
  assert.match(css, rule, `${selector} should keep thumbnail crops centered`)
}

function expectPortraitBiasedCover(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const rule = new RegExp(`${escaped}\\s*\\{[^}]*object-position:\\s*center\\s+58%;`, "m")
  assert.match(css, rule, `${selector} should bias request previews away from empty top-space`)
}

test("Iconoplasm thumbnail viewports keep request previews portrait-sized and subject-biased", () => {
  expectCenteredCover(".icono-thumbnail-viewport-image")
  assert.match(app, /icono-search-result-portrait icono-thumbnail-viewport-image/, "search results should use the shared thumbnail viewport class")
  assert.match(
    app,
    /icono-thumbnail-viewport-image icono-request-option-thumb-image\" src=/,
    "request option thumbnails should opt into the dedicated request-preview viewport class",
  )
  expectPortraitBiasedCover(".icono-request-option-thumb-image")
  assert.match(
    css,
    /\.icono-request-option-thumb\s*\{[^}]*width:\s*84px;[^}]*height:\s*112px;/m,
    "request option previews should keep a doubled portrait viewport",
  )
})
