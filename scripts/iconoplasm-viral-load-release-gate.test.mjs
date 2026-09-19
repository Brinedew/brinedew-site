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
import {
  reconcileProviderAttribution,
  validateTask5ViralLoadEvidence,
} from "./lib/iconoplasm-release-evidence.mjs"
import {
  assessHostedSchedule,
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
      providerMeterNames.map((name) => [name, meterOverrides[name] || { before: 0, after: 0 }]),
    ),
  }
}

const zeroExpectedProviderOperations = Object.fromEntries(
  providerMeterNames.map((name) => [name, 0]),
)

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

function shedReceipt({ operation, tierReaders, refused, coverage }) {
  const prefix = `viral-load:${tierReaders}:${operation}:`
  const identity = {
    prefix,
    first: `${prefix}000000000`,
    last: `${prefix}${String(refused - 1).padStart(9, "0")}`,
    count: refused,
    digestAlgorithm: "sha256-canonical-contiguous-range",
  }
  identity.digest = createHash("sha256").update(JSON.stringify(identity)).digest("hex")
  return {
    schemaVersion: 1,
    kind: "iconoplasm_operation_shed_receipt",
    commitSha: "c".repeat(40),
    environment: "staging",
    startedAt: "2026-09-19T00:00:00Z",
    endedAt: "2026-09-19T00:10:00Z",
    operation,
    tierReaders,
    attempted: refused,
    accepted: 0,
    refused,
    pending: 0,
    identity,
    coverage,
  }
}

function task5Bundle() {
  const expected = {
    workerRequests: 60_000,
    kvReads: 0,
    kvWrites: 0,
    kvLists: 0,
    d1RowsRead: 0,
    d1RowsWritten: 40_000,
    durableObjectRequests: 20_000,
    durableObjectRowsRead: 80_000,
    durableObjectRowsWritten: 80_000,
    queueOperations: 3,
    externalRequests: 0,
    transferBytes: 1_000_000,
  }
  const provider = {
    ...providerEvidence(
      Object.fromEntries(
        Object.entries(expected).map(([name, value]) => [name, { before: 0, after: value }]),
      ),
    ),
    identity: {
      accountIdHash: "b".repeat(64),
      environment: "staging",
      runId: "hosted-run-1",
    },
  }
  const rawArtifacts = {
    "hosted-driver.json": JSON.stringify({
      kind: "iconoplasm_viral_load_task5_driver_receipt",
      certificationReady: true,
      schedule: {
        elapsedMs: 600_000,
        windows: Array.from({ length: 600 }, (_, second) => ({
          second,
          scheduled: 100,
          started: 100,
          startedAtOffsetMs: second * 1_000,
        })),
      },
      physicalStaticRequests: 500_000,
      commandsAttempted: 60_000,
      transferBytes: 1_000_000,
      actualOperations: {
        workerRequests: 60_000,
        d1RowsRead: 0,
        d1RowsWritten: 40_000,
        durableObjectRequests: 20_000,
        durableObjectRowsRead: 80_000,
        durableObjectRowsWritten: 80_000,
        queueOperations: 3,
        externalRequests: 0,
        transferBytes: 1_000_000,
      },
      providerOperations: expected,
      refusalByResource: {
        workerRequests: 50_000,
        d1RowsRead: 50_000,
        durableObjectRequests: 50_000,
        durableObjectRowsWritten: 50_000,
        user_action: 50_000,
        publication: 50_000,
      },
      commandOutcomes: {
        acceptedDurable: 10_000,
        capacityRefused: 50_000,
        invalidCommandReceipts: 0,
      },
    }),
    "provider-query.json": JSON.stringify(provider),
  }
  const shedReceipts = [
    shedReceipt({
      operation: "discovery",
      tierReaders: 100_000,
      refused: 110_000,
      coverage: { lanes: { user_action: 110_000 }, resources: {} },
    }),
    shedReceipt({
      operation: "vote",
      tierReaders: 100_000,
      refused: 10_000,
      coverage: { lanes: { user_action: 10_000 }, resources: {} },
    }),
    shedReceipt({
      operation: "publication",
      tierReaders: 100_000,
      refused: 78_000,
      coverage: { lanes: { publication: 78_000 }, resources: {} },
    }),
    shedReceipt({
      operation: "discovery",
      tierReaders: 1_000_000,
      refused: 1_500_000,
      coverage: { lanes: { user_action: 1_500_000 }, resources: {} },
    }),
    shedReceipt({
      operation: "vote",
      tierReaders: 1_000_000,
      refused: 60_000,
      coverage: { lanes: { user_action: 60_000 }, resources: {} },
    }),
    shedReceipt({
      operation: "publication",
      tierReaders: 1_000_000,
      refused: 870_000,
      coverage: { lanes: { publication: 870_000 }, resources: {} },
    }),
    shedReceipt({
      operation: "worker",
      tierReaders: 1_000_000,
      refused: 200_227,
      coverage: { lanes: {}, resources: { workerRequests: 200_227 } },
    }),
    shedReceipt({
      operation: "durable_object",
      tierReaders: 1_000_000,
      refused: 700_000,
      coverage: {
        lanes: {},
        resources: { durableObjectRequests: 100_000, durableObjectRowsWritten: 700_000 },
      },
    }),
  ]
  for (const receipt of shedReceipts)
    rawArtifacts[`shed-${receipt.tierReaders}-${receipt.operation}.json`] = JSON.stringify(receipt)
  for (const name of ["browser", "region-apac", "region-eu", "region-us", "bunny"])
    rawArtifacts[`${name}.json`] = JSON.stringify({
      kind:
        name === "browser"
          ? "authenticated_browser_receipt"
          : name.startsWith("region-")
            ? "regional_read_receipt"
            : "bunny_delivery_receipt",
      commitSha: "c".repeat(40),
      environment: "staging",
      startedAt: "2026-09-19T00:00:00Z",
      endedAt: "2026-09-19T00:01:00Z",
      successfulRequests: 1,
      region: name.startsWith("region-") ? name.slice(7) : undefined,
      deliveredBytes: name === "bunny" ? 1_000 : undefined,
    })
  for (const name of [
    "stale-pointer",
    "bunny-outage",
    "expired-artifact",
    "laptop-off",
    "d1-exhaustion",
    "queue-exhaustion",
    "delayed-projection",
  ])
    rawArtifacts[`fault-${name}.json`] = JSON.stringify({
      kind: "fault_injection_receipt",
      commitSha: "c".repeat(40),
      environment: "staging",
      startedAt: "2026-09-19T00:00:00Z",
      endedAt: "2026-09-19T00:01:00Z",
      injectedRequests: 1,
      anonymousStatefulOperations: 0,
      lostAcceptedCommands: 0,
    })
  const kindFor = (name) =>
    name === "hosted-driver.json"
      ? "hosted_driver"
      : name === "provider-query.json"
        ? "provider_query"
        : name === "browser.json"
          ? "authenticated_browser"
          : name.startsWith("region-")
            ? "region"
            : name === "bunny.json"
              ? "bunny_delivery"
              : name.startsWith("shed-")
                ? "operation_shed_receipt"
                : "fault_injection"
  const rawManifest = Object.entries(rawArtifacts).map(([name, value]) => ({
    name,
    kind: kindFor(name),
    sha256: createHash("sha256").update(value).digest("hex"),
  }))
  const receipt = {
    schemaVersion: 1,
    kind: "iconoplasm_viral_load_task5_evidence",
    run: {
      id: "hosted-run-1",
      environment: "staging",
      accountIdHash: "b".repeat(64),
      commitSha: "c".repeat(40),
      startedAt: "2026-09-19T00:00:00Z",
      endedAt: "2026-09-19T00:10:00Z",
    },
    provenance: {
      workflowPath: ".github/workflows/deploy-quartz.yml",
      runId: 123,
      jobId: 456,
      conclusion: "success",
      commitSha: "c".repeat(40),
      environment: "staging",
    },
    rawArtifacts: rawManifest,
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
    provider,
  }
  const evidence = {
    ...receipt,
    digestAlgorithm: "sha256",
    digest: createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),
  }
  return { evidence, rawArtifacts }
}

function task5Evidence() {
  return task5Bundle().evidence
}

const trustedRunVerifier = async () => ({
  verified: true,
  workflowPath: ".github/workflows/deploy-quartz.yml",
  runId: 123,
  jobId: 456,
  conclusion: "success",
  headSha: "c".repeat(40),
  environment: "staging",
})

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

test("hostile schedule rejects one missed 100-command second and excessive elapsed time", () => {
  const complete = Array.from({ length: 600 }, (_, second) => ({
    second,
    scheduled: 100,
    started: 100,
    startedAtOffsetMs: second * 1_000,
  }))
  assert.equal(assessHostedSchedule(complete, 600_000).verified, true)
  complete[311].started = 99
  assert.equal(assessHostedSchedule(complete, 600_000).verified, false)
  complete[311].started = 100
  assert.equal(assessHostedSchedule(complete, 700_000).verified, false)
  delete complete[311].startedAtOffsetMs
  assert.equal(assessHostedSchedule(complete, 600_000).verified, false)
})

test("self-hashed Task 5 evidence is rejected without a trusted workflow verifier", async () => {
  const result = await validateTask5ViralLoadEvidence(task5Evidence(), {
    expectedCommit: "c".repeat(40),
    now: Date.parse("2026-09-19T00:11:00Z"),
  })
  assert.equal(result.verified, false)
  assert.equal(result.verdict, "blocked_unverified_workflow_provenance")
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
      d1RowsWritten: { before: 100, after: 200 },
      queueOperations: { before: 20, after: 30 },
    }),
    {
      now: Date.parse("2026-09-19T00:11:00Z"),
      expectedOperations: {
        ...zeroExpectedProviderOperations,
        d1RowsWritten: 96,
        queueOperations: 10,
      },
    },
  )
  assert.equal(result.observedNonStaticOperations, 110)
  assert.equal(result.explainedNonStaticOperations, 106)
  assert.equal(result.attributionFraction, 106 / 110)
  assert.equal(result.verdict, "pass")
  assert.equal(result.verified, true)
  const belowThreshold = reconcileProviderAttribution(
    providerEvidence({
      d1RowsWritten: { before: 0, after: 100 },
      workerRequests: { before: 0, after: 10 },
    }),
    {
      now: Date.parse("2026-09-19T00:11:00Z"),
      expectedOperations: { ...zeroExpectedProviderOperations, d1RowsWritten: 100 },
    },
  )
  assert.equal(belowThreshold.verdict, "blocked_below_attribution_threshold")
  assert.equal(belowThreshold.verified, false)
  assert.equal(
    reconcileProviderAttribution(
      providerEvidence({ d1RowsWritten: { before: 0, after: 1, expected: 1 } }),
      {
        now: Date.parse("2026-09-19T00:11:00Z"),
        expectedOperations: { ...zeroExpectedProviderOperations, d1RowsWritten: 1 },
      },
    ).verdict,
    "blocked_invalid_provider_evidence",
  )
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
  assert.equal(report.task5Evidence.verdict, "blocked_unverified_workflow_provenance")
  assert.equal(report.overallVerdict, "blocked")
})

test("Task 5 evidence cannot certify only one request per 100,000-reader journey", async () => {
  const bundle = task5Bundle()
  const incomplete = bundle.evidence
  incomplete.hostedLoad.physicalRequests = 100_000
  const receipt = { ...incomplete }
  delete receipt.digest
  delete receipt.digestAlgorithm
  incomplete.digest = createHash("sha256").update(JSON.stringify(receipt)).digest("hex")
  const report = await runViralLoadReleaseGate({
    runTopologyProof: false,
    task5Evidence: incomplete,
    rawArtifacts: bundle.rawArtifacts,
    trustedRunVerifier,
    expectedCommit: "c".repeat(40),
    now: Date.parse("2026-09-19T00:11:00Z"),
  })
  assert.equal(report.task5Evidence.verdict, "blocked_invalid_task5_evidence")
})

test("canonical digest-checked Task 5 evidence is consumable without bypassing local topology", async () => {
  const bundle = task5Bundle()
  const report = await runViralLoadReleaseGate({
    runTopologyProof: false,
    task5Evidence: bundle.evidence,
    rawArtifacts: bundle.rawArtifacts,
    trustedRunVerifier,
    expectedCommit: "c".repeat(40),
    now: Date.parse("2026-09-19T00:11:00Z"),
  })
  assert.equal(report.task5Evidence.verdict, "pass")
  assert.equal(report.attribution.verdict, "pass")
  assert.equal(report.attribution.perMeter.workerRequests.expected, 60_000)
  assert.equal(report.attribution.perMeter.d1RowsWritten.expected, 40_000)
  assert.equal(report.attribution.perMeter.externalRequests.expected, 0)
  assert.equal(report.overallChecks.externalResourcesResolved, true)
  assert.equal(report.tiers["10000"].resources.externalRequests.evidence.status, "measured_hosted")
  assert.equal(
    report.tiers["1000000"].mutationResourceDisposition.workerRequests.disposition,
    "intentional_shed_pending",
  )
  assert.equal(
    report.tiers["1000000"].mutationResourceDisposition.workerRequests.coverageVerified,
    true,
  )
  assert.equal(report.overallChecks.hundredThousandActionsExplicitlyShed, true)
  assert.equal(report.overallChecks.millionOverLimitMutationsExplicitlyShed, true)
  assert.equal(report.hostileProfile.hostedExecution, "verified")
  assert.ok(report.failureProfiles.every(({ verdict }) => verdict === "verified"))
  assert.equal(report.overallVerdict, "blocked")
})

test("generic refusal labels cannot replace quantitative operation-specific shed receipts", async () => {
  const bundle = task5Bundle()
  bundle.evidence.rawArtifacts = bundle.evidence.rawArtifacts.filter(
    ({ kind }) => kind !== "operation_shed_receipt",
  )
  for (const name of Object.keys(bundle.rawArtifacts))
    if (name.startsWith("shed-")) delete bundle.rawArtifacts[name]
  const receipt = { ...bundle.evidence }
  delete receipt.digest
  delete receipt.digestAlgorithm
  bundle.evidence.digest = createHash("sha256").update(JSON.stringify(receipt)).digest("hex")
  const report = await runViralLoadReleaseGate({
    runTopologyProof: false,
    task5Evidence: bundle.evidence,
    rawArtifacts: bundle.rawArtifacts,
    trustedRunVerifier,
    expectedCommit: "c".repeat(40),
    now: Date.parse("2026-09-19T00:11:00Z"),
  })
  assert.equal(report.task5Evidence.verdict, "blocked_missing_raw_artifacts")
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
  assert.match(workflow, /deploy-viral-load-staging:/)
  assert.match(workflow, /collect-viral-load-staging-evidence:/)
  assert.match(workflow, /needs:[\s\S]*collect-viral-load-staging-evidence/)
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
