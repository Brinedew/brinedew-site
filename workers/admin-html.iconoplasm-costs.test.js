import assert from "node:assert/strict"
import test from "node:test"

import { ADMIN_HTML } from "./admin-html.js"

test("main admin exposes iconoplasm cost control through the GUI", () => {
  assert.match(ADMIN_HTML, /<h2>Iconoplasm Cost Control<\/h2>/)
  assert.match(ADMIN_HTML, /id="iconoplasm-cost-refresh"/)
  assert.match(ADMIN_HTML, /\/api\/iconoplasm\/admin\/cost\/usage/)
  assert.match(ADMIN_HTML, /Open full Iconoplasm ops/)
  assert.match(ADMIN_HTML, /Cycle spend by source/)
  assert.match(ADMIN_HTML, /Top route families/)
})
