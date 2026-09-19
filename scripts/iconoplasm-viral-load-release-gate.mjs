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
  reconcileProviderAttribution,
  validateTask5ViralLoadEvidence,
} from "./lib/iconoplasm-release-evidence.mjs"
import { proveAnonymousRouteTopology } from "./lib/iconoplasm-static-topology-proof.mjs"

// ARCHITECTURE FENCE [IPD-004]: release arithmetic consumes the named mutation
// lanes and measured receipts; it never invents a second admission authority.

export function buildHostileTp53Profile({ day = "staging-day" } = {}) {
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
    verdict: "blocked_pending_hosted_execution",
    hostedExecution: "not_run_locally",
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
      observedAcceptedCommands: null,
      observedLostAcceptedCommands: null,
    },
    concurrentStaticChecks: {
      path: "/gene/TP53",
      verdict: "pending_hosted_execution",
      physicalChecks: 0,
    },
    driver: {
      script: "scripts/iconoplasm-viral-load-task5-driver.mjs",
      anonymousArticleLoads: 500_000,
      outputKind: "iconoplasm_viral_load_task5_driver_receipt",
    },
  }
}

export function evaluateFailureProfiles() {
  return [
    "stale_pointer",
    "bunny_outage",
    "expired_artifact",
    "laptop_off_accumulation",
    "d1_exhaustion",
    "queue_exhaustion",
    "delayed_projection",
  ].map((name) => ({
    name,
    verdict: "pending_fault_injection",
    observation: null,
    anonymousStatefulRouteEvents: null,
    anonymousStatefulOperations: null,
    lostAcceptedCommands: null,
  }))
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
} = {}) {
  const topologyProof = runTopologyProof
    ? await proveAnonymousRouteTopology()
    : { kind: "exact_build_topology_proof", verified: false, reason: "not_run" }
  const task5 = validateTask5ViralLoadEvidence(task5Evidence)
  const attribution = reconcileProviderAttribution(task5.verified ? task5.evidence.provider : null)
  const externalEvidenceVerified =
    task5.verified &&
    attribution.verified &&
    task5.evidence.commandReceipts.lostAcceptedCommands === 0
  const tiers = Object.fromEntries(
    [10_000, 100_000, 1_000_000].map((readers) => {
      const tier = releaseTierAssessment(readers)
      const readPlane = {
        ...tier.readPlane,
        verdict: topologyProof.verified ? "topology_proven" : "blocked_missing_topology_proof",
        evidence: { topologyProof },
      }
      const tierVerdict =
        topologyProof.verified && externalEvidenceVerified
          ? readers === 10_000
            ? "pass"
            : readers === 100_000
              ? "read_pass_interactions_safely_shed"
              : "read_pass_personalized_overflow_pending_or_refused"
          : "blocked_missing_evidence"
      return [
        String(readers),
        {
          ...tier,
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
  const hostileProfile = buildHostileTp53Profile({ day: "staging-day" })
  const failureProfiles = evaluateFailureProfiles()
  const overallPass = topologyProof.verified && externalEvidenceVerified
  const report = {
    schemaVersion: 2,
    gate: "iconoplasm_viral_load_release",
    tiers,
    hostileProfile,
    failureProfiles,
    attribution,
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
  const report = await runViralLoadReleaseGate({
    outputPath,
    task5Evidence,
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
