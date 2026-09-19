import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  MEASURED_MUTATION_ENVELOPES,
  MUTATION_LANES,
  releaseTierAssessment,
} from "./iconoplasm-first-principles-capacity.mjs"
import {
  createGitHubActionsRunVerifier,
  reconcileProviderAttribution,
  validateTask5ViralLoadEvidence,
} from "./lib/iconoplasm-release-evidence.mjs"
import { proveAnonymousRouteTopology } from "./lib/iconoplasm-static-topology-proof.mjs"

// ARCHITECTURE FENCE [IPD-004]: release arithmetic consumes the named mutation
// lanes and measured receipts; it never invents a second admission authority.

export function buildHostileTp53Profile({ day = "staging-day", observation } = {}) {
  const commandsPerSecond = 100
  const durationSeconds = 10 * 60
  const commandCount = commandsPerSecond * durationSeconds
  const prefix = `viral-load:tp53:${day}:`
  const digest = createHash("sha256")
  for (let index = 0; index < commandCount; index++)
    digest.update(`${prefix}${String(index).padStart(6, "0")}\n`)
  const unitsPerCommand = MEASURED_MUTATION_ENVELOPES.voteCommand.reservedD1RowsWritten
  const acceptedCommands = Math.floor(MUTATION_LANES.user_action / unitsPerCommand)
  return {
    profile: "hostile_tp53_authenticated_votes",
    verdict: observation ? "verified" : "blocked_pending_hosted_execution",
    hostedExecution: observation ? "verified" : "not_run_locally",
    commandsPerSecond,
    durationSeconds,
    commandCount,
    commandIdentity: {
      prefix,
      first: `${prefix}000000`,
      last: `${prefix}${String(commandCount - 1).padStart(6, "0")}`,
      digestAlgorithm: "sha256-newline-delimited",
      digest: digest.digest("hex"),
    },
    capacity: {
      lane: "user_action",
      unitsPerCommand,
      laneLimit: MUTATION_LANES.user_action,
      modeledAcceptedCommands: acceptedCommands,
      modeledRefusedCommands: commandCount - acceptedCommands,
      observedAcceptedCommands: observation?.commandReceipts.acceptedCommands ?? null,
      observedCapacityRefusedCommands: observation?.commandReceipts.capacityRefusedCommands ?? null,
      observedLostAcceptedCommands: observation?.commandReceipts.lostAcceptedCommands ?? null,
    },
    concurrentStaticChecks: {
      path: "/gene/TP53",
      verdict: observation ? "verified" : "pending_hosted_execution",
      physicalChecks: observation?.hostedLoad.concurrentStaticChecks ?? 0,
    },
    driver: {
      script: "scripts/iconoplasm-viral-load-task5-driver.mjs",
      anonymousArticleLoads: 500_000,
      outputKind: "iconoplasm_viral_load_task5_driver_receipt",
    },
  }
}

export function evaluateFailureProfiles(observations) {
  const observedByName = new Map((observations || []).map((profile) => [profile.name, profile]))
  return [
    "stale_pointer",
    "bunny_outage",
    "expired_artifact",
    "laptop_off_accumulation",
    "d1_exhaustion",
    "queue_exhaustion",
    "delayed_projection",
  ].map((name) => {
    const observation = observedByName.get(name)
    return observation
      ? { ...observation, observation: "canonical_task5_evidence" }
      : {
          name,
          verdict: "pending_fault_injection",
          observation: null,
          anonymousStatefulRouteEvents: null,
          anonymousStatefulOperations: null,
          lostAcceptedCommands: null,
        }
  })
}

export function jsonErrorEnvelope(error) {
  return {
    schemaVersion: 1,
    gate: "iconoplasm_viral_load_release",
    overallVerdict: "error",
    error: {
      code: String(error?.code || "UNEXPECTED_ERROR"),
      message: String(error?.message || error || "unknown error"),
    },
  }
}

export async function runViralLoadReleaseGate({
  outputPath,
  task5Evidence,
  runTopologyProof = true,
  expectedCommit = process.env.GITHUB_SHA,
  trustedRunVerifier,
  rawArtifacts,
  now = Date.now(),
} = {}) {
  const topologyProof = runTopologyProof
    ? await proveAnonymousRouteTopology({ expectedCommit })
    : { kind: "exact_build_topology_proof", verified: false, reason: "not_run" }
  const task5 = await validateTask5ViralLoadEvidence(task5Evidence, {
    expectedCommit,
    trustedRunVerifier,
    rawArtifacts,
    now,
  })
  const driver = task5.verified ? task5.raw.hostedDriver : null
  const expectedProviderOperations = driver?.providerOperations || null
  const attribution = reconcileProviderAttribution(
    task5.verified ? task5.evidence.provider : null,
    { now, expectedOperations: expectedProviderOperations },
  )
  const externalEvidenceVerified =
    task5.verified &&
    attribution.verified &&
    task5.evidence.commandReceipts.lostAcceptedCommands === 0
  const tiers = Object.fromEntries(
    [10_000, 100_000, 1_000_000].map((readers) => {
      const tier = releaseTierAssessment(readers)
      const resources = task5.verified
        ? {
            ...tier.resources,
            externalRequests: {
              ...tier.resources.externalRequests,
              evidence: {
                status: "measured_hosted",
                source: task5.evidence.digest,
                observedAtReaders: 100_000,
              },
            },
            transferBytes: {
              ...tier.resources.transferBytes,
              operations: Math.ceil(task5.raw.bunnyDelivery.deliveredBytes * (readers / 100_000)),
              evidence: {
                status: readers === 100_000 ? "measured_cdn" : "reviewed_cdn_projection",
                source: task5.evidence.digest,
                observation: "bunny_delivery_receipt",
                observedAtReaders: 100_000,
              },
            },
          }
        : tier.resources
      const readPlane = {
        ...tier.readPlane,
        verdict: topologyProof.verified ? "topology_proven" : "blocked_missing_topology_proof",
        evidence: { topologyProof },
      }
      let tierVerdict =
        topologyProof.verified && externalEvidenceVerified
          ? readers === 10_000
            ? "pass"
            : readers === 100_000
              ? "read_pass_interactions_safely_shed"
              : "read_pass_personalized_overflow_pending_or_refused"
          : "blocked_missing_evidence"
      const shedReceipts = (task5.raw?.shedReceipts || []).filter(
        (receipt) => receipt.tierReaders === readers,
      )
      const shedCoverage = (kind, name, requiredOperations) => {
        const requiredReceiptOperations =
          kind === "lane"
            ? name === "user_action"
              ? ["discovery", "vote"]
              : ["publication"]
            : name === "workerRequests"
              ? ["worker"]
              : ["durable_object"]
        const matching = shedReceipts.filter((receipt) =>
          requiredReceiptOperations.includes(receipt.operation),
        )
        const observedShedUnits = matching.reduce(
          (sum, receipt) => sum + (receipt.coverage?.[`${kind}s`]?.[name] || 0),
          0,
        )
        return {
          requiredReceiptOperations,
          receiptDigests: matching.map((receipt) => receipt.identity.digest),
          observedShedUnits,
          coverageVerified:
            requiredReceiptOperations.every((operation) =>
              matching.some((receipt) => receipt.operation === operation),
            ) && observedShedUnits === requiredOperations,
        }
      }
      const mutationResourceDisposition = Object.fromEntries(
        Object.entries(resources)
          .filter(([, resource]) => resource.withinLimit === false)
          .map(([name, resource]) => [
            name,
            {
              operations: resource.operations,
              limit: resource.limit,
              disposition: "intentional_shed_pending",
              ...shedCoverage("resource", name, resource.operations - resource.limit),
            },
          ]),
      )
      const laneDisposition = Object.fromEntries(
        Object.entries(tier.mutations.lanes)
          .filter(([, lane]) => !lane.fits)
          .map(([name, lane]) => [
            name,
            {
              pendingOrRefused: lane.pendingOrRefused,
              disposition: "intentional_shed_pending",
              ...shedCoverage("lane", name, lane.pendingOrRefused),
            },
          ]),
      )
      if (
        task5.verified &&
        [...Object.values(mutationResourceDisposition), ...Object.values(laneDisposition)].some(
          (entry) => !entry.coverageVerified,
        )
      )
        tierVerdict = "blocked_invalid_shed_coverage"
      return [
        String(readers),
        {
          ...tier,
          resources,
          mutationResourceDisposition,
          laneDisposition,
          readAvailability: topologyProof.verified ? "topology_proven" : "blocked",
          readPlane,
          interactionPlane: {
            ...tier.interactionPlane,
            verdict: externalEvidenceVerified
              ? tier.interactionPlane.verdict
              : "blocked_missing_task5_evidence",
            lostAcceptedCommands: task5.verified
              ? task5.evidence.commandReceipts.lostAcceptedCommands
              : null,
          },
          verdict: tierVerdict,
        },
      ]
    }),
  )
  const hostileProfile = buildHostileTp53Profile({
    day: task5.verified ? task5.evidence.hostedLoad.day : "staging-day",
    observation: task5.verified ? task5.evidence : undefined,
  })
  const failureProfiles = evaluateFailureProfiles(
    task5.verified ? task5.evidence.failureProfiles : undefined,
  )
  const tenThousand = tiers["10000"]
  const sheddingObserved = (tier) =>
    [
      ...Object.values(tier.mutationResourceDisposition),
      ...Object.values(tier.laneDisposition),
    ].every((entry) => entry.coverageVerified)
  const overallChecks = {
    tenThousandLanesFit: Object.values(tenThousand.mutations.lanes).every((lane) => lane.fits),
    tenThousandBoundedResourcesFit: Object.values(tenThousand.resources)
      .filter((resource) => resource.limit != null)
      .every((resource) => resource.withinLimit),
    externalResourcesResolved:
      externalEvidenceVerified &&
      expectedProviderOperations != null &&
      Object.values(tenThousand.resources).every(
        (resource) => resource.evidence.status !== "pending_external",
      ),
    hundredThousandHostedReadObserved:
      topologyProof.verified && driver?.physicalStaticRequests >= 500_000,
    hundredThousandActionsExplicitlyShed:
      tiers["100000"].interactionPlane.pendingOrRefusedUnits > 0 &&
      sheddingObserved(tiers["100000"]),
    millionReadAndNoLoss:
      topologyProof.verified &&
      task5.verified &&
      task5.evidence.commandReceipts.lostAcceptedCommands === 0,
    millionOverLimitMutationsExplicitlyShed: sheddingObserved(tiers["1000000"]),
    attributionVerified: attribution.verified,
  }
  const overallPass = Object.values(overallChecks).every(Boolean)
  const report = {
    schemaVersion: 2,
    gate: "iconoplasm_viral_load_release",
    tiers,
    hostileProfile,
    failureProfiles,
    attribution,
    overallChecks,
    task5Evidence: {
      verdict: task5.verdict,
      verified: task5.verified,
      digest: task5.verified ? task5.evidence.digest : null,
      runIdentity: task5.verified ? task5.evidence.run : null,
    },
    externalGates: task5.verified
      ? task5.evidence.externalGates
      : {
          hostedExecution: "pending_task_5",
          authenticatedBrowser: "pending_task_5",
          multiRegion: "pending_task_5",
          bunnyDelivery: "pending_task_5",
        },
    overallVerdict: overallPass ? "pass" : "blocked",
  }
  if (outputPath) {
    await mkdir(path.dirname(outputPath), { recursive: true })
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  }
  return report
}

async function main() {
  const args = process.argv.slice(2)
  const valueFor = (name) => {
    const prefix = `${name}=`
    return args.find((argument) => argument.startsWith(prefix))?.slice(prefix.length)
  }
  const outputPath = path.resolve(
    valueFor("--output") || "artifacts/iconoplasm-viral-load-gates/report.json",
  )
  const task5EvidencePath = valueFor("--task5-evidence")
  const task5Evidence = task5EvidencePath
    ? JSON.parse(await readFile(path.resolve(task5EvidencePath), "utf8"))
    : undefined
  const task5RawRoot = valueFor("--task5-raw-root")
  const rawArtifacts = {}
  if (task5Evidence && task5RawRoot) {
    for (const artifact of task5Evidence.rawArtifacts || []) {
      rawArtifacts[artifact.name] = await readFile(
        path.join(path.resolve(task5RawRoot), artifact.name),
        "utf8",
      )
    }
  }
  const trustedRunVerifier = createGitHubActionsRunVerifier({
    token: process.env.GITHUB_TOKEN,
    repository: process.env.GITHUB_REPOSITORY,
  })
  const report = await runViralLoadReleaseGate({
    outputPath,
    task5Evidence,
    rawArtifacts,
    trustedRunVerifier,
    expectedCommit: process.env.GITHUB_SHA,
    runTopologyProof: !args.includes("--skip-topology-proof"),
  })
  process.stdout.write(`${JSON.stringify(report)}\n`)
  if (report.overallVerdict !== "pass") process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await main()
  } catch (error) {
    process.stdout.write(`${JSON.stringify(jsonErrorEnvelope(error))}\n`)
    process.exitCode = 2
  }
}
