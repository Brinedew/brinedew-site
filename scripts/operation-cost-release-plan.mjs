import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
export const RELEASE_REQUEST_LIMIT = 40
// Resumable migrations have at most 100 admitted steps plus per-step capacity
// reads and inventory/registration overhead. The shared daily ceiling remains.
export const MIGRATION_RELEASE_REQUEST_LIMIT = 256

// A verified reader-only containment deployment is the one successful origin
// that can safely carry a retained migration lineage into canonical release
// work. All callers after release-state selection use this shared validator.
export function readCanonicalReleaseOrigin(options) {
  return readReleaseOrigin({ ...options, allowReaderRecoveryOrigin: true })
}

export async function readReleaseOrigin({
  repository,
  runId,
  token,
  resumeRunId = process.env.ICONOPLASM_RELEASE_ORIGIN_RUN_ID,
  allowReaderRecoveryOrigin = false,
  fetcher = fetch,
  now = Date.now(),
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !/^\d+$/.test(runId || "") || !token)
    throw new Error("COST_RELEASE_ORIGIN_REQUIRED")
  if (resumeRunId && !/^\d+$/.test(resumeRunId)) throw new Error("COST_RELEASE_ORIGIN_REQUIRED")
  async function get(path) {
    const response = await fetcher(`https://api.github.com/repos/${repository}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error("COST_RELEASE_ORIGIN_UNAVAILABLE")
    return response.json()
  }
  const current = await get(`actions/runs/${runId}`)
  if (String(current.id) !== runId) throw new Error("COST_RELEASE_RECEIPT_RETENTION_EXCEEDED")
  const originId = resumeRunId || runId
  const run = originId === runId ? current : await get(`actions/runs/${originId}`)
  const started = Date.parse(run.created_at)
  if (
    String(run.id) !== originId ||
    !Number.isSafeInteger(started) ||
    started > now ||
    now - started > 6 * 86_400_000
  )
    throw new Error("COST_RELEASE_RECEIPT_RETENTION_EXCEEDED")
  if (originId !== runId) {
    // A code correction may continue the same migration, but a different
    // repository, workflow, branch or divergent checkout may not inherit it.
    const isFailedCanonicalOrigin = run.status === "completed" && run.conclusion === "failure"
    // A reader-only containment deployment can establish a transition before
    // any migration plan exists. It is therefore the one successful origin a
    // later canonical release may inherit. Inspect its recorded job steps,
    // rather than trusting a successful workflow conclusion or a caller flag.
    let isVerifiedReaderRecoveryOrigin = false
    if (
      !isFailedCanonicalOrigin &&
      allowReaderRecoveryOrigin &&
      run.status === "completed" &&
      run.conclusion === "success"
    ) {
      const jobs = await get(`actions/runs/${originId}/jobs?per_page=100`)
      const readerJobs = Array.isArray(jobs?.jobs)
        ? jobs.jobs.filter((job) => job.name === "reader-recovery-only")
        : []
      const reader = readerJobs[0]
      const completedStep = (name) =>
        reader?.steps?.some((step) => step.name === name && step.conclusion === "success")
      isVerifiedReaderRecoveryOrigin =
        readerJobs.length === 1 &&
        reader?.conclusion === "success" &&
        completedStep("Deploy the D1-free reader containment artifact") &&
        completedStep("Verify published readers and retained application protection") &&
        !jobs.jobs.some((job) => job.name === "deploy-production" && job.conclusion !== "skipped")
    }
    if (
      [run, current].some(
        (item) =>
          item.path !== ".github/workflows/deploy-quartz.yml" ||
          item.head_branch !== "main" ||
          item.head_repository?.full_name !== repository ||
          !/^[a-f0-9]{40}$/.test(item.head_sha || ""),
      ) ||
      run.workflow_id !== current.workflow_id ||
      !(isFailedCanonicalOrigin || isVerifiedReaderRecoveryOrigin) ||
      started > Date.parse(current.created_at)
    )
      throw new Error("COST_RELEASE_CONTINUATION_ORIGIN_INVALID")
    const comparison = await get(`compare/${run.head_sha}...${current.head_sha}`)
    if (!["ahead", "identical"].includes(comparison.status))
      throw new Error("COST_RELEASE_CONTINUATION_ORIGIN_INVALID")
  }
  const attempt = current.run_attempt ?? 1
  if (!Number.isSafeInteger(attempt) || attempt < 1) throw new Error("COST_RELEASE_ORIGIN_REQUIRED")
  return {
    releaseId: `deploy-${originId}`,
    // Each attempt needs fresh read-only observations. They are separate from
    // the retained migration operation, never a renewed DDL allowance.
    inspectionId: `inspect-${runId}-${attempt}`,
    started,
  }
}

// IDs depend on the release and adapter, never the retry number or which
// migrations happen to remain pending. Server receipts own the continuation.
export async function acquireReleasePlan({
  releaseId,
  adapter,
  prediction,
  send,
  features,
  now,
  identities = OPERATION_COST_IDENTITIES,
}) {
  let id = `${releaseId}-${adapter.id}`
  let predecessor
  for (let depth = 0; depth < 8; depth++) {
    let stored
    try {
      stored = (await send("/receipt", "POST", { id })).plan
      if (stored?.id !== id || !stored.immutable || !stored.steps)
        throw new Error("COST_REGISTRATION_RECEIPT_INVALID")
    } catch (error) {
      if (error.message !== "COST_PREDICTION_NOT_REGISTERED") throw error
    }
    if (stored) {
      const prior = stored.immutable
      if (
        prior.adapter_id !== adapter.id ||
        prior.resource !== adapter.resource ||
        Object.keys(prediction).some((meter) => prior.prediction?.[meter] !== prediction[meter])
      )
        throw new Error("COST_CONTINUATION_MUST_PRESERVE_PREDICTION")
      if (stored.status === "continued") {
        if (stored.successor_id !== `${id}-next`)
          throw new Error("COST_CONTINUATION_IDENTITY_INVALID")
        id = stored.successor_id
        predecessor = prior.id
        continue
      }
      const changed = Object.entries(identities).some(([key, value]) => prior[key] !== value)
      if (prior.expires_at > now && !changed) {
        if (stored.status !== "active") throw new Error("COST_PLAN_TRIPPED")
        return { plan: prior, stepId: `execute-${Object.keys(stored.steps).length}` }
      }
      if (!features?.includes("preserved-budget-continuation"))
        throw new Error("COST_CONTINUATION_NOT_SUPPORTED")
      predecessor = id
      id += "-next"
      continue
    }
    const plan = {
      id,
      adapter_id: adapter.id,
      resource: adapter.resource,
      ...identities,
      prediction,
      expires_at: Math.min(now + 3_500_000, (Math.floor(now / 86_400_000) + 1) * 86_400_000 - 1),
      ...(predecessor ? { predecessor_id: predecessor } : {}),
    }
    const registered = await send("/register", "POST", plan)
    if (registered.plan?.id !== id) throw new Error("COST_REGISTRATION_RECEIPT_INVALID")
    return { plan, stepId: "execute-0" }
  }
  throw new Error("COST_CONTINUATION_DEPTH_LIMIT")
}
