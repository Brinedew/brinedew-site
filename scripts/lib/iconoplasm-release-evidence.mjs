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
    evidence.source !== "cloudflare_provider_meters" ||
    !evidence.observedAt?.before ||
    !evidence.observedAt?.after ||
    !evidence.meters ||
    Object.keys(evidence.meters).length === 0
  ) {
    return {
      verdict: "blocked_invalid_provider_evidence",
      threshold: PROVIDER_ATTRIBUTION_THRESHOLD,
      verified: false,
    }
  }
  let observedNonStaticOperations = 0
  let explainedNonStaticOperations = 0
  for (const [meter, observation] of Object.entries(evidence.meters)) {
    const before = Number(observation?.before)
    const after = Number(observation?.after)
    const explained = Number(observation?.explained)
    if (
      !Number.isFinite(before) ||
      !Number.isFinite(after) ||
      !Number.isFinite(explained) ||
      before < 0 ||
      after < before ||
      explained < 0 ||
      explained > after - before
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
  }
  const attributionFraction =
    observedNonStaticOperations === 0
      ? explainedNonStaticOperations === 0
        ? 1
        : 0
      : explainedNonStaticOperations / observedNonStaticOperations
  return {
    verdict:
      attributionFraction >= PROVIDER_ATTRIBUTION_THRESHOLD
        ? "pass"
        : "blocked_below_attribution_threshold",
    threshold: PROVIDER_ATTRIBUTION_THRESHOLD,
    verified: attributionFraction >= PROVIDER_ATTRIBUTION_THRESHOLD,
    observedNonStaticOperations,
    explainedNonStaticOperations,
    attributionFraction,
    evidenceSource: evidence.source,
    observedAt: evidence.observedAt,
  }
}
