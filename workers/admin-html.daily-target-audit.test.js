import assert from "node:assert/strict"
import test from "node:test"

import {
  ADMIN_HTML,
  buildMissingRecapImageGroups,
  chunkRecapImageDays,
  summarizeRecapImageCoverage,
} from "./admin-html.js"

// ARCHITECTURE FENCE [GG-002]: yearly coverage is resumable reconciliation,
// not an attempted-upload counter or an unbounded browser loop.

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

test("recap coverage warning waits for the authoritative schedule", () => {
  assert.match(
    ADMIN_HTML,
    /async function setupSchedule\(\) \{[\s\S]*await loadSchedule\(\{ futureDays: 120 \}\);[\s\S]*await refreshRecapWarning\(\);/,
  )
  assert.ok(ADMIN_HTML.indexOf("let scheduleData = {};") < ADMIN_HTML.indexOf("setupSchedule();"))
})

test("recap uploads are target-bound and require stable molecule pixels", () => {
  assert.match(ADMIN_HTML, /uniprot_id: uniprot/)
  assert.match(ADMIN_HTML, /function getCanvasContentMetrics\(canvas\)/)
  assert.match(ADMIN_HTML, /consecutiveHealthyFrames >= 3/)
  assert.match(ADMIN_HTML, /Preview never produced stable molecule pixels/)
  assert.doesNotMatch(ADMIN_HTML, /getCanvasNonDarkRatio/)
  assert.doesNotMatch(ADMIN_HTML, /Let Mol\* settle before pixel capture/)
})

test("annual recap fill plans only missing objects and bounds status requests", () => {
  const days = ["2026-08-04", "2026-08-05", "2026-08-06", "2026-08-07"]
  const schedule = {
    "2026-08-04": { uniprot: "Q8WU10" },
    "2026-08-05": { uniprot: "P35270" },
    "2026-08-06": { uniprot: "P35270" },
    "2026-08-07": { uniprot: "Q6PJG6" },
  }
  const exists = { "2026-08-04": true, "2026-08-06": true }

  assert.deepEqual(chunkRecapImageDays(days, 3), [days.slice(0, 3), days.slice(3)])
  assert.deepEqual(buildMissingRecapImageGroups(days, schedule, exists), [
    { uniprot: "P35270", days: ["2026-08-05"] },
    { uniprot: "Q6PJG6", days: ["2026-08-07"] },
  ])
  assert.deepEqual(summarizeRecapImageCoverage(days, exists), {
    total: 4,
    ready: 2,
    missingDays: ["2026-08-05", "2026-08-07"],
  })
})

test("annual recap fill is resumable, memory-bounded, and exact before success", () => {
  assert.match(ADMIN_HTML, /await fetchRecapStatusesForDays\(days\)/)
  assert.match(
    ADMIN_HTML,
    /buildMissingRecapImageGroups\(days, scheduleData, recapImageExistsByDay\)/,
  )
  assert.match(ADMIN_HTML, /Existing verified objects will be skipped/)
  assert.match(ADMIN_HTML, /base64 = null;[\s\S]*await destroyPreviewViewer\(\)/)
  assert.match(ADMIN_HTML, /Rechecking all [\s\S]*await fetchRecapStatusesForDays\(days\)/)
  assert.match(ADMIN_HTML, /finalCoverage\.missingDays\.length > 0/)
  assert.match(ADMIN_HTML, /Yearly coverage verified:/)
  assert.doesNotMatch(
    ADMIN_HTML,
    /const imageByUniprot = new Map\(\);[\s\S]*Yearly upload complete/,
  )
})
