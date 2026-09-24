import assert from "node:assert/strict"
import test from "node:test"

import {
  ICONOPLASM_OBSERVABILITY_FRESHNESS_POLICY,
  iconoplasmObservabilitySnapshotForAdmin,
} from "./iconoplasm-observability-freshness.js"

const NOW = Date.parse("2026-07-20T04:00:00.000Z")

function snapshotMinutesOld(minutes) {
  return {
    generatedAt: new Date(NOW - minutes * 60000).toISOString(),
    source: { mode: "out_of_band_snapshot" },
  }
}

test("observability freshness distinguishes old history from missing history", () => {
  assert.equal(
    iconoplasmObservabilitySnapshotForAdmin(snapshotMinutesOld(60), NOW).freshness.state,
    "fresh",
  )
  assert.equal(
    iconoplasmObservabilitySnapshotForAdmin(snapshotMinutesOld(91), NOW).freshness.state,
    "stale",
  )
  const overdue = iconoplasmObservabilitySnapshotForAdmin(snapshotMinutesOld(241), NOW)
  assert.equal(overdue.freshness.state, "overdue")
  assert.equal(overdue.freshness.headline, "Historical snapshot overdue")
  assert.match(overdue.freshness.detail, /Live account meters are queried separately/)
  assert.equal(iconoplasmObservabilitySnapshotForAdmin({}, NOW).freshness.state, "unavailable")
})

test("observability freshness exposes intended cadence and intentional retirement", () => {
  const report = iconoplasmObservabilitySnapshotForAdmin(snapshotMinutesOld(10), NOW)
  assert.deepEqual(report.freshness.policy, ICONOPLASM_OBSERVABILITY_FRESHNESS_POLICY)
  assert.equal(report.retiredMetrics[0].state, "retired")
  assert.match(report.retiredMetrics[0].reason, /Cloudflare GraphQL/)
})
