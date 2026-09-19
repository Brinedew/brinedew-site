import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { readFileSync } from "node:fs"

import {
  buildHostileTp53Profile,
  evaluateFailureProfiles,
  jsonErrorEnvelope,
  runViralLoadReleaseGate,
} from "./iconoplasm-viral-load-release-gate.mjs"
import { reconcileProviderAttribution } from "./lib/iconoplasm-release-evidence.mjs"
import {
  buildHostedCommand,
  classifyHostedResponse,
} from "./lib/iconoplasm-viral-load-task5-driver.mjs"

const providerMeterNames = [
  "workerRequests",
  "kvReads",
  "kvWrites",
  "kvLists",
  "d1RowsRead",
  "d1RowsWritten",
  "durableObjectRequests",
  "durableObjectRowsRead",
  "durableObjectRowsWritten",
  "queueOperations",
  "externalRequests",
  "transferBytes",
]

function providerEvidence(meterOverrides = {}) {
  return {
    schemaVersion: 1,
    kind: "cloudflare_provider_meter_delta",
    source: "cloudflare_provider_api",
    identity: { accountIdHash: "a".repeat(64), environment: "production", runId: "run-1" },
    observedAt: { before: "2026-09-19T00:00:00Z", after: "2026-09-19T00:10:00Z" },
    meters: Object.fromEntries(
      providerMeterNames.map((name) => [
        name,
        meterOverrides[name] || { before: 0, after: 0, explained: 0, expected: 0 },
      ]),
    ),
  }
}

function commandIdentity(day) {
  const prefix = `viral-load:tp53:${day}:`
  const digest = createHash("sha256")
  for (let index = 0; index < 60_000; index++)
    digest.update(`${prefix}${String(index).padStart(6, "0")}\n`)
  return {
    prefix,
    first: `${prefix}000000`,
    last: `${prefix}059999`,
    count: 60_000,
    digestAlgorithm: "sha256-newline-delimited",
    digest: digest.digest("hex"),
  }
}

function task5Evidence() {
  const receipt = {
    schemaVersion: 1,
    kind: "iconoplasm_viral_load_task5_evidence",
    run: {
      id: "hosted-run-1",
      environment: "production",
      accountIdHash: "b".repeat(64),
      commitSha: "c".repeat(40),
      startedAt: "2026-09-19T00:00:00Z",
      endedAt: "2026-09-19T00:10:00Z",
    },
    hostedLoad: {
      physicalRequests: 500_000,
      commandsAttempted: 60_000,
      day: "2026-09-19",
      commandIdentity: commandIdentity("2026-09-19"),
      concurrentStaticChecks: 600,
    },
    commandReceipts: {
      acceptedCommands: 10_000,
      capacityRefusedCommands: 50_000,
      lostAcceptedCommands: 0,
      digestAlgorithm: "sha256-tab-newline-delimited",
      digest: "d".repeat(64),
    },
    failureProfiles: [
      "stale_pointer",
      "bunny_outage",
      "expired_artifact",
      "laptop_off_accumulation",
      "d1_exhaustion",
      "queue_exhaustion",
      "delayed_projection",
    ].map((name) => ({
      name,
      verdict: "verified",
      anonymousStatefulOperations: 0,
      lostAcceptedCommands: 0,
    })),
    externalGates: {
      hostedExecution: "verified",
      authenticatedBrowser: "verified",
      multiRegion: "verified",
      bunnyDelivery: "verified",
    },
    provider: {
      ...providerEvidence({
        workerRequests: { before: 10, after: 11, explained: 1, expected: 1 },
        d1RowsRead: { before: 10, after: 11, explained: 1, expected: 1 },
        d1RowsWritten: { before: 10, after: 11, explained: 1, expected: 1 },
        durableObjectRequests: { before: 10, after: 11, explained: 1, expected: 1 },
        durableObjectRowsRead: { before: 10, after: 11, explained: 1, expected: 1 },
        durableObjectRowsWritten: { before: 10, after: 11, explained: 1, expected: 1 },
        queueOperations: { before: 10, after: 11, explained: 1, expected: 1 },
        externalRequests: { before: 10, after: 11, explained: 1, expected: 1 },
        transferBytes: { before: 10, after: 11, explained: 1, expected: 1 },
      }),
      identity: {
        accountIdHash: "b".repeat(64),
        environment: "production",
        runId: "hosted-run-1",
      },
    },
  }
  return {
    ...receipt,
    digestAlgorithm: "sha256",
    digest: createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),
  }
}

// ARCHITECTURE FENCE [IPD-004]
test("hostile TP53 staging profile has 60,000 exact identities and bounded refusals", () => {
  const profile = buildHostileTp53Profile({ day: "2026-09-19" })
  assert.equal(profile.hostedExecution, "not_run_locally")
  assert.equal(profile.commandsPerSecond, 100)
  assert.equal(profile.durationSeconds, 600)
  assert.equal(profile.commandCount, 60_000)
  assert.equal(profile.commandIdentity.prefix, "viral-load:tp53:2026-09-19:")
  assert.equal(profile.commandIdentity.first, "viral-load:tp53:2026-09-19:000000")
  assert.equal(profile.commandIdentity.last, "viral-load:tp53:2026-09-19:059999")
  assert.match(profile.commandIdentity.digest, /^[a-f0-9]{64}$/)
  assert.equal(profile.commands, undefined)
  assert.equal(profile.capacity.modeledAcceptedCommands, 10_000)
  assert.equal(profile.capacity.modeledRefusedCommands, 50_000)
  assert.equal(profile.capacity.observedLostAcceptedCommands, null)
  assert.equal(profile.concurrentStaticChecks.verdict, "pending_hosted_execution")
  assert.equal(profile.verdict, "blocked_pending_hosted_execution")
  assert.equal(profile.driver.script, "scripts/iconoplasm-viral-load-task5-driver.mjs")
})

test("Task 5 driver sends exact identities and refuses responses without durable receipts", async () => {
  const command = buildHostedCommand({
    day: "2026-09-19",
    index: 42,
    assetSha256: "a".repeat(64),
  })
  assert.equal(command.id, "viral-load:tp53:2026-09-19:000042")
  assert.equal(command.body.command_id, command.id)
  assert.equal(command.body.symbol, "TP53")
  assert.equal(
    classifyHostedResponse(command.id, {
      status: 202,
      body: { accepted: true, command_id: command.id, durable: true },
    }).verdict,
    "accepted_durable",
  )
  assert.equal(
    classifyHostedResponse(command.id, { status: 200, body: { ok: true } }).verdict,
    "invalid_missing_exact_receipt",
  )
  assert.equal(
    classifyHostedResponse(command.id, {
      status: 429,
      body: { accepted: false, command_id: command.id, code: "CAPACITY_REFUSED" },
    }).verdict,
    "bounded_capacity_refusal",
  )
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
    assert.equal(profile.verdict, "pending_fault_injection", profile.name)
    assert.equal(profile.observation, null, profile.name)
  }
})

test("provider attribution blocks missing evidence and reconciles provider observations only", () => {
  assert.deepEqual(reconcileProviderAttribution(), {
    verdict: "blocked_missing_provider_evidence",
    threshold: 0.95,
    verified: false,
  })
  const result = reconcileProviderAttribution(
    providerEvidence({
      d1RowsWritten: { before: 100, after: 200, explained: 96, expected: 96 },
      queueOperations: { before: 20, after: 30, explained: 10, expected: 10 },
    }),
  )
  assert.equal(result.observedNonStaticOperations, 110)
  assert.equal(result.explainedNonStaticOperations, 106)
  assert.equal(result.attributionFraction, 106 / 110)
  assert.equal(result.verdict, "pass")
  assert.equal(result.verified, true)
  const belowThreshold = reconcileProviderAttribution(
    providerEvidence({ d1RowsWritten: { before: 0, after: 100, explained: 94, expected: 100 } }),
  )
  assert.equal(belowThreshold.verdict, "blocked_below_attribution_threshold")
  assert.equal(belowThreshold.verified, false)
  assert.equal(
    reconcileProviderAttribution({ ...providerEvidence(), source: "application_estimate" }).verdict,
    "blocked_invalid_provider_evidence",
  )
})

test("release gate emits tier counts and fails closed without external Task 5 evidence", async () => {
  const outputRoot = await mkdtemp(path.join(tmpdir(), "iconoplasm-load-gate-"))
  const outputPath = path.join(outputRoot, "report.json")
  const report = await runViralLoadReleaseGate({ outputPath, runTopologyProof: false })
  assert.deepEqual(Object.keys(report.tiers), ["10000", "100000", "1000000"])
  assert.equal(report.tiers["10000"].verdict, "blocked_missing_evidence")
  assert.equal(report.tiers["100000"].readPlane.evidence.topologyProof.verified, false)
  assert.equal(report.tiers["100000"].activity.savedDiscoveries, 200_000)
  assert.ok(report.tiers["100000"].interactionPlane.pendingOrRefusedUnits > 0)
  assert.equal(report.tiers["1000000"].readAvailability, "blocked")
  assert.equal(report.attribution.verdict, "blocked_missing_provider_evidence")
  assert.equal(report.externalGates.hostedExecution, "pending_task_5")
  assert.equal(report.overallVerdict, "blocked")
  assert.deepEqual(
    JSON.parse(await (await import("node:fs/promises")).readFile(outputPath)),
    report,
  )
})

test("runner consumes canonical Task 5 evidence instead of caller verdict labels", async () => {
  const report = await runViralLoadReleaseGate({
    runTopologyProof: false,
    task5Evidence: { overallVerdict: "pass", hostedExecution: "verified" },
  })
  assert.equal(report.task5Evidence.verdict, "blocked_invalid_task5_evidence")
  assert.equal(report.overallVerdict, "blocked")
})

test("Task 5 evidence cannot certify only one request per 100,000-reader journey", async () => {
  const incomplete = task5Evidence()
  incomplete.hostedLoad.physicalRequests = 100_000
  const receipt = { ...incomplete }
  delete receipt.digest
  delete receipt.digestAlgorithm
  incomplete.digest = createHash("sha256").update(JSON.stringify(receipt)).digest("hex")
  const report = await runViralLoadReleaseGate({
    runTopologyProof: false,
    task5Evidence: incomplete,
  })
  assert.equal(report.task5Evidence.verdict, "blocked_invalid_task5_evidence")
})

test("canonical digest-checked Task 5 evidence is consumable without bypassing local topology", async () => {
  const report = await runViralLoadReleaseGate({
    runTopologyProof: false,
    task5Evidence: task5Evidence(),
  })
  assert.equal(report.task5Evidence.verdict, "pass")
  assert.equal(report.attribution.verdict, "pass")
  assert.equal(report.hostileProfile.hostedExecution, "verified")
  assert.ok(report.failureProfiles.every(({ verdict }) => verdict === "verified"))
  assert.equal(report.overallVerdict, "blocked")
})

test("unexpected runner failures have a compact JSON error envelope", () => {
  assert.deepEqual(jsonErrorEnvelope(new Error("boom")), {
    schemaVersion: 1,
    gate: "iconoplasm_viral_load_release",
    overallVerdict: "error",
    error: { code: "UNEXPECTED_ERROR", message: "boom" },
  })
})

test("production deploy invokes the blocking viral-load gate with Task 5 evidence", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy-quartz.yml", import.meta.url),
    "utf8",
  )
  assert.match(workflow, /pnpm run gate:iconoplasm-viral-load -- --task5-evidence=/)
  assert.match(workflow, /ICONOPLASM_VIRAL_LOAD_TASK5_EVIDENCE/)
})

test("Task 4 callers cannot self-certify hosted Task 5 gates", async () => {
  const report = await runViralLoadReleaseGate({
    runTopologyProof: false,
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
