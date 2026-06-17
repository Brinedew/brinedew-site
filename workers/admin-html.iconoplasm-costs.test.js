import assert from "node:assert/strict"
import test from "node:test"

import { ADMIN_HTML } from "./admin-html.js"

test("main admin exposes iconoplasm ops through a dedicated launcher instead of mixing the full dashboard into the page", () => {
  assert.match(ADMIN_HTML, /<h2>Iconoplasm Ops<\/h2>/)
  assert.match(ADMIN_HTML, /Open Iconoplasm ops/)
  assert.match(ADMIN_HTML, /href="\/admin\/iconoplasm#costs"/)
  assert.doesNotMatch(ADMIN_HTML, /id="iconoplasm-cost-refresh"/)
})
