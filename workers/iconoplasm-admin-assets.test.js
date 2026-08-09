import assert from "node:assert/strict"
import test from "node:test"

import { ICONOPLASM_ADMIN_HTML } from "./iconoplasm-admin-html.js"
import { renderIconoplasmAdminHtml } from "./iconoplasm-admin-assets.js"

test("admin asset URLs use the deployed HTML-shell cache version", () => {
  const first = renderIconoplasmAdminHtml(ICONOPLASM_ADMIN_HTML, {
    ICONOPLASM_HTML_SHELL_CACHE_VERSION: "release/one",
  })
  const second = renderIconoplasmAdminHtml(ICONOPLASM_ADMIN_HTML, {
    ICONOPLASM_HTML_SHELL_CACHE_VERSION: "release-two",
  })

  assert.match(first, /admin\.css\?v=release%2Fone/)
  assert.match(first, /admin\.js\?v=release%2Fone/)
  assert.match(second, /admin\.css\?v=release-two/)
  assert.match(second, /admin\.js\?v=release-two/)
  assert.doesNotMatch(first, /__ICONOPLASM_ADMIN_ASSET_VERSION__/)
  assert.doesNotMatch(second, /__ICONOPLASM_ADMIN_ASSET_VERSION__/)
  assert.notEqual(first, second)
})

test("admin asset URLs have a deterministic local-development fallback", () => {
  const html = renderIconoplasmAdminHtml(ICONOPLASM_ADMIN_HTML, {})
  assert.match(html, /admin\.css\?v=dev/)
  assert.match(html, /admin\.js\?v=dev/)
  assert.doesNotMatch(html, /__ICONOPLASM_ADMIN_ASSET_VERSION__/)
})
