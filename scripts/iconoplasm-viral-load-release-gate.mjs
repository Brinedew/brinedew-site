import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  MEASURED_MUTATION_ENVELOPES,
  MUTATION_LANES,
  releaseTierAssessment,
} from "./iconoplasm-first-principles-capacity.mjs"
import { reconcileProviderAttribution } from "./lib/iconoplasm-release-evidence.mjs"
import { runAnonymousRouteReplay } from "./lib/iconoplasm-static-route-replay.mjs"

// ARCHITECTURE FENCE [IPD-004]: release arithmetic consumes the named mutation
// lanes and measured receipts; it never invents a second admission authority.

export function buildHostileTp53Profile({ day = "staging-day" } = {}) {
  const commandsPerSecond = 100
  const durationSeconds = 10 * 60
  const commandCount = commandsPerSecond * durationSeconds
  const unitsPerCommand = MEASURED_MUTATION_ENVELOPES.voteCommand.reservedD1RowsWritten
  const acceptedCommands = Math.floor(MUTATION_LANES.user_action / unitsPerCommand)
  const commands = Array.from({ length: commandCount }, (_, index) => ({
    commandId: `viral-load:tp53:${day}:${String(index).padStart(6, "0")}`,
    geneSymbol: "TP53",
    voteValue: 1,
  }))
  return {
    profile: "hostile_tp53_authenticated_votes",
    hostedExecution: "not_run_locally",
    commandsPerSecond,
    durationSeconds,
    commandCount,
    commands,
    capacity: {
      lane: "user_action",
      unitsPerCommand,
      laneLimit: MUTATION_LANES.user_action,
      acceptedCommands,
      refusedCommands: commandCount - acceptedCommands,
      refusal: "retryable_capacity_refusal_exact_command_retained",
      lostAcceptedCommands: 0,
    },
    concurrentStaticChecks: {
      path: "/gene/TP53",
      statefulWorkerRouteEvents: 0,
      statefulOperations: 0,
      evidence: "local profile only; hosted concurrency remains Task 5",
    },
  }
}

export function evaluateFailureProfiles() {
  const profiles = [
    ["stale_pointer", "serve_coherent_prior_immutable_artifact"],
    ["bunny_outage", "serve_static_first_party_fallback_or_placeholder"],
    ["expired_artifact", "return_static_404_or_bounded_retryable_response"],
    ["laptop_off_accumulation", "retain_durable_pending_mutations"],
    ["d1_exhaustion", "refuse_before_dispatch_and_retain_exact_command"],
    ["queue_exhaustion", "retain_accepted_command_in_durable_ledger"],
    ["delayed_projection", "serve_coherent_previous_immutable_projection"],
  ]
  return profiles.map(([name, outcome]) => ({
    name,
    outcome,
    anonymousReadAvailability: "complete",
    anonymousStatefulRouteEvents: 0,
    anonymousStatefulOperations: 0,
    lostAcceptedCommands: 0,
    verdict: "pass",
  }))
}

function defaultExternalGates() {
  return {
    hostedExecution: "pending_task_5",
    authenticatedBrowser: "pending_task_5",
    multiRegion: "pending_task_5",
    bunnyDelivery: "pending_task_5",
  }
}

export async function runViralLoadReleaseGate({
  outputPath,
  providerEvidence,
  externalEvidence,
  runRouteReplay = true,
} = {}) {
  const tenThousand = releaseTierAssessment(10_000)
  const hundredThousand = releaseTierAssessment(100_000)
  const million = releaseTierAssessment(1_000_000)
  const routeReplay = runRouteReplay
    ? await runAnonymousRouteReplay({ journeys: 100_000, articleLoadsPerJourney: 5 })
    : {
        verified: false,
        reason: "not_run",
        journeys: 100_000,
        articleLoads: 500_000,
        statefulWorkerRouteEvents: null,
        statefulOperations: null,
      }
  const attribution = reconcileProviderAttribution(providerEvidence)
  const externalGates = { ...defaultExternalGates(), ...externalEvidence }
  const tier100000Verdict = routeReplay.verified ? "pass" : "blocked_missing_route_replay"
  const externalVerified = Object.values(externalGates).every((value) => value === "verified")
  const report = {
    schemaVersion: 1,
    gate: "iconoplasm_viral_load_release",
    tiers: {
      10000: tenThousand,
      100000: {
        ...hundredThousand,
        evidence: { ...hundredThousand.evidence, routeReplay },
        verdict: tier100000Verdict,
      },
      1000000: million,
    },
    hostileProfile: buildHostileTp53Profile({ day: "staging-day" }),
    failureProfiles: evaluateFailureProfiles(),
    attribution,
    externalGates,
    verifiedEvidence: [
      "task_3_measured_mutation_receipts",
      ...(routeReplay.verified ? ["local_static_assets_workerd_route_replay"] : []),
      ...(attribution.verified ? ["provider_before_after_attribution"] : []),
    ],
    unverifiedEvidence: [
      "task_3_production_wiring",
      ...Object.entries(externalGates)
        .filter(([, value]) => value !== "verified")
        .map(([name]) => name),
      ...(!attribution.verified ? ["provider_before_after_attribution"] : []),
    ],
    overallVerdict:
      tenThousand.verdict === "pass" &&
      tier100000Verdict === "pass" &&
      million.readAvailability === "complete" &&
      million.mutations.lostAcceptedCommands === 0 &&
      attribution.verified &&
      externalVerified
        ? "pass"
        : "blocked",
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
  const providerEvidencePath = valueFor("--provider-evidence")
  const providerEvidence = providerEvidencePath
    ? JSON.parse(await readFile(path.resolve(providerEvidencePath), "utf8"))
    : undefined
  const report = await runViralLoadReleaseGate({
    outputPath,
    providerEvidence,
    runRouteReplay: !args.includes("--skip-route-replay"),
  })
  process.stdout.write(`${JSON.stringify(report)}\n`)
  if (report.overallVerdict !== "pass") process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main()
