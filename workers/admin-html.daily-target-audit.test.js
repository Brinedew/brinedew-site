import assert from "node:assert/strict"
import test from "node:test"

import { ADMIN_HTML } from "./admin-html.js"

test("daily target rejection audit displays the recorded UniProt id", () => {
  assert.match(
    ADMIN_HTML,
    /r\?\.gene \|\| r\?\.hgnc \|\| r\?\.symbol \|\| r\?\.uniprot_id \|\| 'Unknown'/,
  )
})

test("admin can regenerate and update an already-posted recap without duplicating it", () => {
  assert.match(ADMIN_HTML, /id="btn-repair-posted-recap"/)
  assert.match(ADMIN_HTML, /\/api\/admin\/repair-posted-recap/)
  assert.match(ADMIN_HTML, /renderAndUploadDayImage\(day, \{ silent: true \}\)/)
})
