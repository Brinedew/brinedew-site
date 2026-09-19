import { createHash } from "node:crypto"
import { assessHostedSchedule } from "./iconoplasm-viral-load-task5-driver.mjs"

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

export function createGitHubActionsRunVerifier({ token, repository, fetchImpl = fetch }) {
  if (!token || !/^[^/]+\/[^/]+$/.test(repository || "")) return null
  return async (provenance) => {
    const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" }
    const runResponse = await fetchImpl(
      `https://api.github.com/repos/${repository}/actions/runs/${provenance?.runId}`,
      { headers },
    )
    if (!runResponse.ok) return { verified: false }
    const run = await runResponse.json()
    const jobsResponse = await fetchImpl(run.jobs_url, { headers })
    if (!jobsResponse.ok) return { verified: false }
    const jobs = (await jobsResponse.json()).jobs || []
    const job = jobs.find((candidate) => String(candidate.id) === String(provenance?.jobId))
    return {
      verified: Boolean(job),
      workflowPath: run.path,
      runId: run.id,
      jobId: job?.id,
      conclusion: job?.conclusion,
      headSha: run.head_sha,
      environment: job?.name?.includes("collect-viral-load-staging-evidence") ? "staging" : null,
    }
  }
}

const RAW_ARTIFACT_KIND_COUNTS = Object.freeze({
  hosted_driver: 1,
  provider_query: 1,
  authenticated_browser: 1,
  region: 3,
  bunny_delivery: 1,
  fault_injection: 7,
  operation_shed_receipt: 8,
})

const REQUIRED_SHED_RECEIPTS = Object.freeze([
  "100000:discovery",
  "100000:vote",
  "100000:publication",
  "1000000:discovery",
  "1000000:vote",
  "1000000:publication",
  "1000000:worker",
  "1000000:durable_object",
])

function validShedReceipt(artifact, expectedCommit) {
  const identity = artifact?.identity
  const unsignedIdentity = identity && {
    prefix: identity.prefix,
    first: identity.first,
    last: identity.last,
    count: identity.count,
    digestAlgorithm: identity.digestAlgorithm,
  }
  const count = artifact?.refused + artifact?.pending
  const coverageValues = [
    ...Object.values(artifact?.coverage?.lanes || {}),
    ...Object.values(artifact?.coverage?.resources || {}),
  ]
  return (
    artifact?.schemaVersion === 1 &&
    artifact?.kind === "iconoplasm_operation_shed_receipt" &&
    artifact?.commitSha === expectedCommit &&
    artifact?.environment === "staging" &&
    REQUIRED_SHED_RECEIPTS.includes(`${artifact.tierReaders}:${artifact.operation}`) &&
    [artifact.attempted, artifact.accepted, artifact.refused, artifact.pending].every(
      (value) => Number.isSafeInteger(value) && value >= 0,
    ) &&
    artifact.attempted === artifact.accepted + artifact.refused + artifact.pending &&
    count > 0 &&
    identity?.count === count &&
    identity?.prefix === `viral-load:${artifact.tierReaders}:${artifact.operation}:` &&
    identity?.first === `${identity.prefix}000000000` &&
    identity?.last === `${identity.prefix}${String(count - 1).padStart(9, "0")}` &&
    identity?.digestAlgorithm === "sha256-canonical-contiguous-range" &&
    identity?.digest ===
      createHash("sha256").update(JSON.stringify(unsignedIdentity)).digest("hex") &&
    artifact.coverage &&
    typeof artifact.coverage.lanes === "object" &&
    typeof artifact.coverage.resources === "object" &&
    coverageValues.length > 0 &&
    coverageValues.every((value) => Number.isSafeInteger(value) && value >= 0 && value <= count)
  )
}

export async function validateTask5ViralLoadEvidence(
  evidence,
  { expectedCommit, trustedRunVerifier, rawArtifacts, now = Date.now() } = {},
) {
  if (!evidence) return { verdict: "blocked_missing_task5_evidence", verified: false }
  if (typeof trustedRunVerifier !== "function")
    return { verdict: "blocked_unverified_workflow_provenance", verified: false }
  const provenance = evidence.provenance
  const trusted = await trustedRunVerifier(provenance, { expectedCommit, now })
  if (
    !trusted?.verified ||
    provenance?.workflowPath !== ".github/workflows/deploy-quartz.yml" ||
    trusted.workflowPath !== provenance.workflowPath ||
    provenance?.runId !== trusted.runId ||
    provenance?.jobId !== trusted.jobId ||
    trusted.conclusion !== "success" ||
    trusted.headSha !== expectedCommit ||
    provenance?.commitSha !== expectedCommit ||
    trusted.environment !== "staging" ||
    provenance?.environment !== "staging"
  ) {
    return { verdict: "blocked_unverified_workflow_provenance", verified: false }
  }
  const manifest = evidence.rawArtifacts
  const kindCounts = Object.fromEntries(
    Object.keys(RAW_ARTIFACT_KIND_COUNTS).map((kind) => [kind, 0]),
  )
  const parsedRawArtifacts = {}
  if (!Array.isArray(manifest) || !rawArtifacts)
    return { verdict: "blocked_missing_raw_artifacts", verified: false }
  for (const entry of manifest) {
    if (!Object.hasOwn(kindCounts, entry?.kind) || typeof rawArtifacts[entry.name] !== "string")
      return { verdict: "blocked_invalid_raw_artifacts", verified: false }
    const digest = createHash("sha256").update(rawArtifacts[entry.name]).digest("hex")
    if (digest !== entry.sha256)
      return { verdict: "blocked_invalid_raw_artifacts", verified: false }
    try {
      parsedRawArtifacts[entry.name] = JSON.parse(rawArtifacts[entry.name])
    } catch {
      return { verdict: "blocked_invalid_raw_artifacts", verified: false }
    }
    kindCounts[entry.kind]++
  }
  if (
    Object.entries(RAW_ARTIFACT_KIND_COUNTS).some(([kind, count]) => kindCounts[kind] !== count)
  ) {
    return { verdict: "blocked_missing_raw_artifacts", verified: false }
  }
  const entryFor = (kind) => manifest.find((entry) => entry.kind === kind)
  const hostedDriver = parsedRawArtifacts[entryFor("hosted_driver").name]
  const providerQuery = parsedRawArtifacts[entryFor("provider_query").name]
  const supporting = manifest
    .filter((entry) => !["hosted_driver", "provider_query"].includes(entry.kind))
    .map((entry) => ({ ...entry, artifact: parsedRawArtifacts[entry.name] }))
  const commonValid = ({ artifact }) =>
    artifact?.commitSha === expectedCommit &&
    artifact?.environment === "staging" &&
    Number.isFinite(Date.parse(artifact.startedAt)) &&
    Date.parse(artifact.startedAt) < Date.parse(artifact.endedAt)
  const browsersValid = supporting
    .filter(({ kind }) => kind === "authenticated_browser")
    .every(
      ({ artifact }) =>
        artifact.kind === "authenticated_browser_receipt" && artifact.successfulRequests > 0,
    )
  const regions = supporting.filter(({ kind }) => kind === "region")
  const regionsValid =
    new Set(regions.map(({ artifact }) => artifact.region)).size === 3 &&
    regions.every(
      ({ artifact }) =>
        artifact.kind === "regional_read_receipt" && artifact.successfulRequests > 0,
    )
  const bunnyValid = supporting
    .filter(({ kind }) => kind === "bunny_delivery")
    .every(
      ({ artifact }) => artifact.kind === "bunny_delivery_receipt" && artifact.deliveredBytes > 0,
    )
  const faultsValid = supporting
    .filter(({ kind }) => kind === "fault_injection")
    .every(
      ({ artifact }) =>
        artifact.kind === "fault_injection_receipt" &&
        artifact.injectedRequests > 0 &&
        artifact.anonymousStatefulOperations === 0 &&
        artifact.lostAcceptedCommands === 0,
    )
  const shedReceipts = supporting.filter(({ kind }) => kind === "operation_shed_receipt")
  const shedReceiptsValid =
    new Set(shedReceipts.map(({ artifact }) => `${artifact.tierReaders}:${artifact.operation}`))
      .size === REQUIRED_SHED_RECEIPTS.length &&
    shedReceipts.every(({ artifact }) => validShedReceipt(artifact, expectedCommit))
  const recomputedSchedule = assessHostedSchedule(
    hostedDriver?.schedule?.windows || [],
    hostedDriver?.schedule?.elapsedMs,
  )
  const operationReceiptValid = [
    "workerRequests",
    "d1RowsRead",
    "d1RowsWritten",
    "durableObjectRequests",
    "durableObjectRowsRead",
    "durableObjectRowsWritten",
    "queueOperations",
    "externalRequests",
    "transferBytes",
  ].every(
    (name) =>
      Number.isSafeInteger(hostedDriver?.actualOperations?.[name]) &&
      hostedDriver.actualOperations[name] >= 0,
  )
  const providerMappingValid = EXPECTED_PROVIDER_METERS.every(
    (name) =>
      (Number.isSafeInteger(hostedDriver?.providerOperations?.[name]) &&
        hostedDriver.providerOperations[name] >= 0) ||
      hostedDriver?.providerOperations?.[name] === null,
  )
  if (
    hostedDriver?.kind !== "iconoplasm_viral_load_task5_driver_receipt" ||
    hostedDriver?.certificationReady !== true ||
    !recomputedSchedule.verified ||
    hostedDriver?.physicalStaticRequests < 500_000 ||
    hostedDriver?.commandsAttempted !== 60_000 ||
    !operationReceiptValid ||
    !providerMappingValid ||
    providerQuery?.kind !== "cloudflare_provider_meter_delta" ||
    JSON.stringify(providerQuery) !== JSON.stringify(evidence.provider) ||
    !supporting.every(commonValid) ||
    !browsersValid ||
    !regionsValid ||
    !bunnyValid ||
    !faultsValid ||
    !shedReceiptsValid
  ) {
    return { verdict: "blocked_invalid_raw_artifacts", verified: false }
  }
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
    evidence.run?.environment === "staging" &&
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
    NON_ZERO_TASK5_METERS.every((meter) => Object.hasOwn(evidence.provider?.meters || {}, meter)) &&
    Object.keys(evidence.externalGates || {}).length === TASK5_EXTERNAL_GATES.length &&
    TASK5_EXTERNAL_GATES.every((gate) => evidence.externalGates?.[gate] === "verified")
  return valid
    ? {
        verdict: "pass",
        verified: true,
        evidence,
        raw: {
          hostedDriver,
          providerQuery,
          shedReceipts: shedReceipts.map(({ artifact }) => artifact),
        },
      }
    : { verdict: "blocked_invalid_task5_evidence", verified: false }
}

export function reconcileProviderAttribution(
  evidence,
  { now = Date.now(), expectedOperations } = {},
) {
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
    !["production", "staging"].includes(evidence.identity?.environment) ||
    typeof evidence.identity?.runId !== "string" ||
    evidence.identity.runId.length === 0 ||
    !evidence.observedAt?.before ||
    !evidence.observedAt?.after ||
    !evidence.meters ||
    !expectedOperations ||
    Object.keys(evidence.meters).length !== EXPECTED_PROVIDER_METERS.length ||
    !EXPECTED_PROVIDER_METERS.every(
      (meter) =>
        Object.hasOwn(evidence.meters, meter) &&
        Object.hasOwn(expectedOperations, meter) &&
        Number.isFinite(expectedOperations[meter]) &&
        expectedOperations[meter] >= 0,
    )
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
    afterAt > now + 60_000 ||
    now - afterAt > 24 * 60 * 60 * 1_000
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
    const expected = Number(expectedOperations[meter])
    const observed = after - before
    const explained = Math.min(observed, expected)
    if (
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      Object.hasOwn(observation || {}, "explained") ||
      Object.hasOwn(observation || {}, "expected") ||
      before < 0 ||
      after < before ||
      !Number.isFinite(expected) ||
      expected < 0 ||
      (expected > 0 && after - before < expected * PROVIDER_ATTRIBUTION_THRESHOLD)
    ) {
      return {
        verdict: "blocked_invalid_provider_evidence",
        threshold: PROVIDER_ATTRIBUTION_THRESHOLD,
        verified: false,
        invalidMeter: meter,
      }
    }
    observedNonStaticOperations += observed
    explainedNonStaticOperations += explained
    const fraction = observed === 0 ? 1 : explained / observed
    perMeter[meter] = {
      observed,
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
