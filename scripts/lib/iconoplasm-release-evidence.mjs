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
