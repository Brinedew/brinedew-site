import assert from "node:assert/strict"
import test from "node:test"

import {
  ADMIN_HTML,
  buildMissingRecapImageGroups,
  chunkRecapImageDays,
  computeMoleculeContentMetricsFromRgba,
  isRecapDayKey,
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

test("admin reuses an accepted immutable image when updating an already-posted recap", () => {
  assert.match(ADMIN_HTML, /id="btn-repair-posted-recap"/)
  assert.match(ADMIN_HTML, /\/api\/admin\/repair-posted-recap/)
  assert.match(
    ADMIN_HTML,
    /const statuses = await fetchRecapStatusesForDays\(\[day\]\);[\s\S]*if \(statuses\[day\]\?\.exists !== true\) \{[\s\S]*renderAndUploadDayImage\(day, \{ silent: true \}\)/,
  )
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
  assert.match(ADMIN_HTML, /metrics\.moleculeForegroundPixels >= 28/)
  assert.match(ADMIN_HTML, /metrics\.occupiedMoleculeTiles >= 2/)
  assert.match(ADMIN_HTML, /Preview never produced stable molecule pixels/)
  assert.match(ADMIN_HTML, /verifyStructureBytes: opts\.bulk === true/)
  assert.match(ADMIN_HTML, /method: 'HEAD'/)
  assert.match(ADMIN_HTML, /Structure bytes unavailable for/)
  assert.doesNotMatch(ADMIN_HTML, /getCanvasNonDarkRatio/)
  assert.doesNotMatch(ADMIN_HTML, /Let Mol\* settle before pixel capture/)
})

test("molecule readiness ignores the fixed bottom-left Molstar orientation axes", () => {
  const width = 96
  const height = 72
  const background = [17, 12, 10]
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = background[0]
    pixels[offset + 1] = background[1]
    pixels[offset + 2] = background[2]
    pixels[offset + 3] = 255
  }
  const paint = (left, top, right, bottom, color) => {
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const offset = (y * width + x) * 4
        pixels[offset] = color[0]
        pixels[offset + 1] = color[1]
        pixels[offset + 2] = color[2]
      }
    }
  }

  paint(8, 55, 20, 65, [220, 20, 20])
  const axesOnly = computeMoleculeContentMetricsFromRgba(pixels, width, height, background)
  assert.ok(axesOnly.foregroundPixels > 28)
  assert.equal(axesOnly.moleculeForegroundPixels, 0)
  assert.equal(axesOnly.occupiedMoleculeTiles, 0)

  paint(38, 20, 62, 48, [30, 200, 150])
  const molecule = computeMoleculeContentMetricsFromRgba(pixels, width, height, background)
  assert.ok(molecule.moleculeForegroundPixels >= 28)
  assert.ok(molecule.moleculeForegroundRatio >= 0.006)
  assert.ok(molecule.occupiedMoleculeTiles >= 2)
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
  assert.equal(isRecapDayKey(days[0]), true)
  assert.equal(isRecapDayKey("not-a-day"), false)
  assert.match(ADMIN_HTML, /function isRecapDayKey\(day\)[\s\S]*\/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//)
  assert.match(ADMIN_HTML, /\.filter\(\(day\) => isRecapDayKey\(day\)\)/)
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
  assert.match(
    ADMIN_HTML,
    /loadSchedule\(\{ futureDays: DISCORD_IMAGE_UPLOAD_DAYS, required: true \}\)/,
  )
  assert.match(ADMIN_HTML, /days\.length !== DISCORD_IMAGE_UPLOAD_DAYS/)
  assert.match(ADMIN_HTML, /Authoritative yearly schedule is incomplete/)
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

test("annual recap fill replaces only failed automatic targets outside the full horizon", () => {
  assert.match(ADMIN_HTML, /\/api\/admin\/schedule\/availability-replacement/)
  assert.match(ADMIN_HTML, /horizonEntries: horizonEntries/)
  assert.match(ADMIN_HTML, /days\.map\(\(horizonDay\) => \(\{/)
  assert.match(ADMIN_HTML, /row\?\.source !== 'override'/)
  assert.match(ADMIN_HTML, /availability_replacement/)
  assert.match(ADMIN_HTML, /\/api\/admin\/schedule\/availability-replacement\/pin-structure/)
  assert.ok(
    ADMIN_HTML.indexOf("await renderAndUploadDayImage(firstDay") <
      ADMIN_HTML.indexOf("await pinAvailabilityReplacementStructure(firstDay"),
  )
})
