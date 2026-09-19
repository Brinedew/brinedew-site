import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"

import {
  buildHostileTp53Profile,
  evaluateFailureProfiles,
  runViralLoadReleaseGate,
} from "./iconoplasm-viral-load-release-gate.mjs"
import { reconcileProviderAttribution } from "./lib/iconoplasm-release-evidence.mjs"

// ARCHITECTURE FENCE [IPD-004]
test("hostile TP53 staging profile has 60,000 exact identities and bounded refusals", () => {
  const profile = buildHostileTp53Profile({ day: "2026-09-19" })
  assert.equal(profile.hostedExecution, "not_run_locally")
  assert.equal(profile.commandsPerSecond, 100)
  assert.equal(profile.durationSeconds, 600)
  assert.equal(profile.commandCount, 60_000)
  assert.equal(profile.commands[0].commandId, "viral-load:tp53:2026-09-19:000000")
  assert.equal(profile.commands.at(-1).commandId, "viral-load:tp53:2026-09-19:059999")
  assert.equal(new Set(profile.commands.map(({ commandId }) => commandId)).size, 60_000)
  assert.equal(profile.capacity.acceptedCommands, 10_000)
  assert.equal(profile.capacity.refusedCommands, 50_000)
  assert.equal(profile.capacity.lostAcceptedCommands, 0)
  assert.equal(profile.concurrentStaticChecks.statefulOperations, 0)
})

test("failure profiles preserve anonymous state isolation and accepted command identity", () => {
  const profiles = evaluateFailureProfiles()
  assert.deepEqual(
    profiles.map(({ name }) => name),
    [
      "stale_pointer",
      "bunny_outage",
      "expired_artifact",
      "laptop_off_accumulation",
      "d1_exhaustion",
      "queue_exhaustion",
      "delayed_projection",
    ],
  )
  for (const profile of profiles) {
    assert.equal(profile.anonymousStatefulRouteEvents, 0, profile.name)
    assert.equal(profile.anonymousStatefulOperations, 0, profile.name)
    assert.equal(profile.anonymousReadAvailability, "complete", profile.name)
    assert.equal(profile.lostAcceptedCommands, 0, profile.name)
  }
})

test("provider attribution blocks missing evidence and reconciles provider observations only", () => {
  assert.deepEqual(reconcileProviderAttribution(), {
    verdict: "blocked_missing_provider_evidence",
    threshold: 0.95,
    verified: false,
  })
  const result = reconcileProviderAttribution({
    schemaVersion: 1,
    source: "cloudflare_provider_meters",
    observedAt: { before: "2026-09-19T00:00:00Z", after: "2026-09-19T00:10:00Z" },
    meters: {
      d1RowsWritten: { before: 100, after: 200, explained: 96 },
      queueOperations: { before: 20, after: 30, explained: 10 },
    },
  })
  assert.equal(result.observedNonStaticOperations, 110)
  assert.equal(result.explainedNonStaticOperations, 106)
  assert.equal(result.attributionFraction, 106 / 110)
  assert.equal(result.verdict, "pass")
  assert.equal(result.verified, true)
  const belowThreshold = reconcileProviderAttribution({
    schemaVersion: 1,
    source: "cloudflare_provider_meters",
    observedAt: { before: "2026-09-19T00:00:00Z", after: "2026-09-19T00:10:00Z" },
    meters: { d1RowsWritten: { before: 0, after: 100, explained: 94 } },
  })
  assert.equal(belowThreshold.verdict, "blocked_below_attribution_threshold")
  assert.equal(belowThreshold.verified, false)
  assert.equal(
    reconcileProviderAttribution({
      schemaVersion: 1,
      source: "application_estimate",
      observedAt: { before: "before", after: "after" },
      meters: { d1RowsWritten: { before: 0, after: 1, explained: 1 } },
    }).verdict,
    "blocked_invalid_provider_evidence",
  )
})

test("release gate emits tier counts and fails closed without external Task 5 evidence", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-load-gate-"))
  const outputPath = path.join(outputRoot, "report.json")
  const report = await runViralLoadReleaseGate({ outputPath, runRouteReplay: false })
  assert.deepEqual(Object.keys(report.tiers), ["10000", "100000", "1000000"])
  assert.equal(report.tiers["10000"].verdict, "pass")
  assert.equal(report.tiers["100000"].evidence.routeReplay.verified, false)
  assert.deepEqual(report.tiers["100000"].mutations.measuredOperations, {
    discoveryD1RowsRead: 0,
    discoveryD1RowsWritten: 0,
    voteCommandReservedD1RowsWritten: 0,
    publicationD1RowsWritten: 0,
  })
  assert.equal(report.tiers["1000000"].readAvailability, "complete")
  assert.equal(report.attribution.verdict, "blocked_missing_provider_evidence")
  assert.equal(report.externalGates.hostedExecution, "pending_task_5")
  assert.equal(report.overallVerdict, "blocked")
  assert.deepEqual(
    JSON.parse(await (await import("node:fs/promises")).readFile(outputPath)),
    report,
  )
})

test("Task 4 callers cannot self-certify hosted Task 5 gates", async () => {
  const report = await runViralLoadReleaseGate({
    runRouteReplay: false,
    externalEvidence: {
      hostedExecution: "verified",
      authenticatedBrowser: "verified",
      multiRegion: "verified",
      bunnyDelivery: "verified",
    },
  })
  assert.deepEqual(report.externalGates, {
    hostedExecution: "pending_task_5",
    authenticatedBrowser: "pending_task_5",
    multiRegion: "pending_task_5",
    bunnyDelivery: "pending_task_5",
  })
  assert.equal(report.overallVerdict, "blocked")
})
