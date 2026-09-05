import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
export const RELEASE_REQUEST_LIMIT = 40

export async function readReleaseOrigin({
  repository,
  runId,
  token,
  fetcher = fetch,
  now = Date.now(),
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || "") || !/^\d+$/.test(runId || "") || !token)
    throw new Error("COST_RELEASE_ORIGIN_REQUIRED")
  const response = await fetcher(
    `https://api.github.com/repos/${repository}/actions/runs/${runId}`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    },
  )
  if (!response.ok) throw new Error("COST_RELEASE_ORIGIN_UNAVAILABLE")
  const run = await response.json()
  const started = Date.parse(run.created_at)
  if (
    String(run.id) !== runId ||
    !Number.isSafeInteger(started) ||
    started > now ||
    now - started > 6 * 86_400_000
  )
    throw new Error("COST_RELEASE_RECEIPT_RETENTION_EXCEEDED")
  return { releaseId: `deploy-${runId}`, started }
}

// IDs depend on the release and adapter, never the retry number or which
// migrations happen to remain pending. Server receipts own the continuation.
export async function acquireReleasePlan({ releaseId, adapter, prediction, send, features, now }) {
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
      const changed = Object.entries(OPERATION_COST_IDENTITIES).some(
        ([key, value]) => prior[key] !== value,
      )
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
      ...OPERATION_COST_IDENTITIES,
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
