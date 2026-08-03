import assert from "node:assert/strict"
import test from "node:test"

import { ADMIN_HTML } from "./admin-html.js"

test("admin inline runtime is valid JavaScript", () => {
  const start = ADMIN_HTML.indexOf("<script>")
  const end = ADMIN_HTML.indexOf("</script>", start)
  assert.ok(start >= 0 && end > start)
  assert.doesNotThrow(() => new Function(ADMIN_HTML.slice(start + "<script>".length, end)))
})

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

test("recap uploads are target-bound and require stable molecule pixels", () => {
  assert.match(ADMIN_HTML, /uniprot_id: uniprot/)
  assert.match(ADMIN_HTML, /function getCanvasContentMetrics\(canvas\)/)
  assert.match(ADMIN_HTML, /consecutiveHealthyFrames >= 3/)
  assert.match(ADMIN_HTML, /Preview never produced stable molecule pixels/)
  assert.doesNotMatch(ADMIN_HTML, /getCanvasNonDarkRatio/)
  assert.doesNotMatch(ADMIN_HTML, /Let Mol\* settle before pixel capture/)
})
