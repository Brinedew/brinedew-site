import { createHash } from "node:crypto"

export const FULL_RELEASE_STEPS = Object.freeze([
  "Deploy the only allowed internal stateful worker (production)",
  "Deploy production static site to Cloudflare Pages",
  "Activate current Iconoplasm HTML shell cache version",
  "Verify Iconoplasm publication aliases (production)",
  "Smoke test production host ownership and browser bootstraps",
  "Smoke test Discord OAuth entry and anonymous session contract",
])

function successfulProductionJob(run, jobs) {
  if (run.status !== "completed" || run.conclusion !== "success") return null
  const production = jobs.filter((job) => job.name === "deploy-production")
  return production.length === 1 &&
    production[0].status === "completed" &&
    production[0].conclusion === "success"
    ? production[0]
    : null
}

function hasStep(job, name, conclusion) {
  return (
    job?.steps?.filter(
      (step) => step.name === name && step.status === "completed" && step.conclusion === conclusion,
    ).length === 1
  )
}

export function isFullRelease(run, jobs) {
  const job = successfulProductionJob(run, jobs)
  return Boolean(job && FULL_RELEASE_STEPS.every((name) => hasStep(job, name, "success")))
}

// A successful workflow can deliberately finish at a durable migration
// checkpoint. It is resumable only with these exact completed/skipped steps;
// it is never evidence of application activation.
export function isMigrationCheckpoint(run, jobs) {
  const job = successfulProductionJob(run, jobs)
  return Boolean(
    job &&
    hasStep(job, "Apply reviewed D1 migrations through prediction admission", "success") &&
    hasStep(job, "Record staged migration continuation checkpoint", "success") &&
    FULL_RELEASE_STEPS.every((name) => hasStep(job, name, "skipped")),
  )
}

const PROVIDER_ATTRIBUTION_THRESHOLD = 0.95
const EXPECTED_PROVIDER_METERS = Object.freeze([
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
])

const NON_ZERO_TASK5_METERS = Object.freeze([
  "workerRequests",
  "d1RowsRead",
  "d1RowsWritten",
  "durableObjectRequests",
  "durableObjectRowsRead",
  "durableObjectRowsWritten",
  "queueOperations",
  "externalRequests",
  "transferBytes",
])
const TASK5_EXTERNAL_GATES = Object.freeze([
  "hostedExecution",
  "authenticatedBrowser",
  "multiRegion",
  "bunnyDelivery",
])
const TASK5_FAILURE_PROFILES = Object.freeze([
  "stale_pointer",
  "bunny_outage",
  "expired_artifact",
  "laptop_off_accumulation",
  "d1_exhaustion",
  "queue_exhaustion",
  "delayed_projection",
])

function validCommandIdentity(hostedLoad) {
  const day = hostedLoad?.day
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "")) return false
  const prefix = `viral-load:tp53:${day}:`
  const digest = createHash("sha256")
  for (let index = 0; index < 60_000; index++)
    digest.update(`${prefix}${String(index).padStart(6, "0")}\n`)
  return (
    hostedLoad.commandIdentity?.prefix === prefix &&
    hostedLoad.commandIdentity?.first === `${prefix}000000` &&
    hostedLoad.commandIdentity?.last === `${prefix}059999` &&
    hostedLoad.commandIdentity?.count === 60_000 &&
    hostedLoad.commandIdentity?.digestAlgorithm === "sha256-newline-delimited" &&
    hostedLoad.commandIdentity?.digest === digest.digest("hex")
  )
}

function sha256Receipt(artifact) {
  const { digest, digestAlgorithm, ...receipt } = artifact || {}
  return {
    digest,
    digestAlgorithm,
    computed: createHash("sha256").update(JSON.stringify(receipt)).digest("hex"),
  }
}

export function validateTask5ViralLoadEvidence(evidence) {
  if (!evidence) return { verdict: "blocked_missing_task5_evidence", verified: false }
  const digest = sha256Receipt(evidence)
  const started = Date.parse(evidence.run?.startedAt || "")
  const ended = Date.parse(evidence.run?.endedAt || "")
  const valid =
    evidence.schemaVersion === 1 &&
    evidence.kind === "iconoplasm_viral_load_task5_evidence" &&
    digest.digestAlgorithm === "sha256" &&
    digest.digest === digest.computed &&
    /^[a-f0-9]{40}$/.test(evidence.run?.commitSha || "") &&
    /^[a-f0-9]{64}$/.test(evidence.run?.accountIdHash || "") &&
    evidence.run?.environment === "production" &&
    typeof evidence.run?.id === "string" &&
    evidence.run.id.length > 0 &&
    Number.isFinite(started) &&
    Number.isFinite(ended) &&
    started < ended &&
    evidence.hostedLoad?.physicalRequests >= 500_000 &&
    evidence.hostedLoad?.commandsAttempted === 60_000 &&
    evidence.hostedLoad?.concurrentStaticChecks > 0 &&
    validCommandIdentity(evidence.hostedLoad) &&
    evidence.commandReceipts?.acceptedCommands +
      evidence.commandReceipts?.capacityRefusedCommands ===
      60_000 &&
    evidence.commandReceipts?.lostAcceptedCommands === 0 &&
    evidence.commandReceipts?.digestAlgorithm === "sha256-tab-newline-delimited" &&
    /^[a-f0-9]{64}$/.test(evidence.commandReceipts?.digest || "") &&
    evidence.failureProfiles?.length === TASK5_FAILURE_PROFILES.length &&
    TASK5_FAILURE_PROFILES.every((name) => {
      const matches = evidence.failureProfiles.filter((profile) => profile?.name === name)
      return (
        matches.length === 1 &&
        matches[0].verdict === "verified" &&
        matches[0].anonymousStatefulOperations === 0 &&
        matches[0].lostAcceptedCommands === 0
      )
    }) &&
    evidence.provider?.identity?.accountIdHash === evidence.run.accountIdHash &&
    evidence.provider?.identity?.environment === evidence.run.environment &&
    evidence.provider?.identity?.runId === evidence.run.id &&
    Date.parse(evidence.provider?.observedAt?.before || "") <= started &&
    Date.parse(evidence.provider?.observedAt?.after || "") >= ended &&
    NON_ZERO_TASK5_METERS.every(
      (meter) => Number(evidence.provider?.meters?.[meter]?.expected) > 0,
    ) &&
    Object.keys(evidence.externalGates || {}).length === TASK5_EXTERNAL_GATES.length &&
    TASK5_EXTERNAL_GATES.every((gate) => evidence.externalGates?.[gate] === "verified")
  return valid
    ? { verdict: "pass", verified: true, evidence }
    : { verdict: "blocked_invalid_task5_evidence", verified: false }
}

export function reconcileProviderAttribution(evidence) {
  if (!evidence) {
    return {
      verdict: "blocked_missing_provider_evidence",
      threshold: PROVIDER_ATTRIBUTION_THRESHOLD,
      verified: false,
    }
  }
  if (
    evidence.schemaVersion !== 1 ||
    evidence.kind !== "cloudflare_provider_meter_delta" ||
    evidence.source !== "cloudflare_provider_api" ||
    !/^[a-f0-9]{64}$/.test(evidence.identity?.accountIdHash || "") ||
    evidence.identity?.environment !== "production" ||
    typeof evidence.identity?.runId !== "string" ||
    evidence.identity.runId.length === 0 ||
    !evidence.observedAt?.before ||
    !evidence.observedAt?.after ||
    !evidence.meters ||
    Object.keys(evidence.meters).length !== EXPECTED_PROVIDER_METERS.length ||
    !EXPECTED_PROVIDER_METERS.every((meter) => Object.hasOwn(evidence.meters, meter))
  ) {
    return {
      verdict: "blocked_invalid_provider_evidence",
      threshold: PROVIDER_ATTRIBUTION_THRESHOLD,
      verified: false,
    }
  }
  let observedNonStaticOperations = 0
  let explainedNonStaticOperations = 0
  const perMeter = {}
  const beforeAt = Date.parse(evidence.observedAt.before)
  const afterAt = Date.parse(evidence.observedAt.after)
  if (
    !Number.isFinite(beforeAt) ||
    !Number.isFinite(afterAt) ||
    beforeAt >= afterAt ||
    afterAt > Date.now() + 60_000 ||
    Date.now() - afterAt > 24 * 60 * 60 * 1_000
  ) {
    return {
      verdict: "blocked_invalid_provider_evidence",
      threshold: PROVIDER_ATTRIBUTION_THRESHOLD,
      verified: false,
    }
  }
  for (const [meter, observation] of Object.entries(evidence.meters)) {
    const before = Number(observation?.before)
    const after = Number(observation?.after)
    const explained = Number(observation?.explained)
    const expected = Number(observation?.expected)
    if (
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      !Number.isFinite(explained) ||
      before < 0 ||
      after < before ||
      explained < 0 ||
      explained > after - before ||
      !Number.isFinite(expected) ||
      expected < 0 ||
      (expected > 0 && after - before === 0)
    ) {
      return {
        verdict: "blocked_invalid_provider_evidence",
        threshold: PROVIDER_ATTRIBUTION_THRESHOLD,
        verified: false,
        invalidMeter: meter,
      }
    }
    observedNonStaticOperations += after - before
    explainedNonStaticOperations += explained
    const fraction = after - before === 0 ? 1 : explained / (after - before)
    perMeter[meter] = {
      observed: after - before,
      explained,
      expected,
      attributionFraction: fraction,
    }
  }
  const attributionFraction =
    observedNonStaticOperations === 0
      ? explainedNonStaticOperations === 0
        ? 1
        : 0
      : explainedNonStaticOperations / observedNonStaticOperations
  const everyMeterPasses = Object.values(perMeter).every(
    ({ attributionFraction }) => attributionFraction >= PROVIDER_ATTRIBUTION_THRESHOLD,
  )
  return {
    verdict:
      attributionFraction >= PROVIDER_ATTRIBUTION_THRESHOLD && everyMeterPasses
        ? "pass"
        : "blocked_below_attribution_threshold",
    threshold: PROVIDER_ATTRIBUTION_THRESHOLD,
    verified: attributionFraction >= PROVIDER_ATTRIBUTION_THRESHOLD && everyMeterPasses,
    observedNonStaticOperations,
    explainedNonStaticOperations,
    attributionFraction,
    perMeter,
    evidenceSource: evidence.source,
    observedAt: evidence.observedAt,
  }
}
