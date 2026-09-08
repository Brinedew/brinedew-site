import { appendFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { createOperationCostAccountUsageReader } from "../workers/iconoplasm/operation-cost-account-usage.js"
import { ACCOUNT_CEILINGS } from "../workers/lib/operation-cost-ledger.js"
import { KV_ACCOUNT_CEILINGS } from "../workers/lib/operation-cost-meters.js"
import { readReleaseOrigin } from "./operation-cost-release-plan.mjs"

// The installed setting is the release state. A working published reader is
// not evidence that application writes are active, and a failed reader is not
// permission to put a working application into maintenance.
export async function readIconoplasmReleaseState({
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  token = process.env.CLOUDFLARE_API_TOKEN,
  fetcher = fetch,
} = {}) {
  if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token)
    throw new Error("COST_RELEASE_STATE_CREDENTIALS_REQUIRED")
  const response = await fetcher(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/geneguessr-api/settings`,
    {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    },
  )
  if (!response.ok) throw new Error("COST_RELEASE_STATE_UNAVAILABLE")
  const value = await response.json()
  if (value?.success !== true || !Array.isArray(value.result?.bindings))
    throw new Error("COST_RELEASE_STATE_UNAVAILABLE")
  function setting(name, fallback) {
    const matches = value.result.bindings.filter((item) => item.name === name)
    if (!matches.length) return fallback
    if (matches.length !== 1 || matches[0].type !== "plain_text")
      throw new Error("COST_RELEASE_STATE_INVALID")
    return matches[0].text
  }
  const transition = setting("ICONOPLASM_SCHEMA_TRANSITION", "0")
  if (!["0", "1"].includes(transition)) throw new Error("COST_RELEASE_STATE_INVALID")
  return {
    schema_transition: transition === "1",
    reader_recovery: setting("ICONOPLASM_SCHEMA_TRANSITION_MODE", "") === "reader-recovery",
    origin_run_id: setting("ICONOPLASM_MIGRATION_ORIGIN_RUN_ID", ""),
  }
}

export function selectReleaseOriginRunId(state, runId, requestedRunId = "") {
  if (!/^\d+$/.test(runId) || (requestedRunId && !/^\d+$/.test(requestedRunId)))
    throw new Error("COST_RELEASE_ORIGIN_REQUIRED")
  if (!state.schema_transition) {
    if (requestedRunId) throw new Error("COST_RELEASE_CONTINUATION_REQUIRES_MAINTENANCE")
    return runId
  }
  const retained = state.origin_run_id
  if (retained && !/^\d+$/.test(retained)) throw new Error("COST_RELEASE_STATE_INVALID")
  if (retained && requestedRunId && retained !== requestedRunId)
    throw new Error("COST_RELEASE_CONTINUATION_MUST_PRESERVE_ORIGIN")
  if (!retained && !requestedRunId) throw new Error("COST_RELEASE_RESUME_RUN_REQUIRED")
  return retained || requestedRunId
}

export function requireReaderRecoveryHeadroom(sample, now = Date.now()) {
  // The reviewed wrapper cannot reach D1 on its reader routes. These are the
  // complete verification probes' conservative Worker/KV bounds, not a permit
  // for migrations, catalog reconstruction, or normal application activation.
  const maximum = { requests: 20, kv_reads: 100 }
  if (
    sample?.day !== new Date(now).toISOString().slice(0, 10) ||
    !Number.isSafeInteger(sample.measured_at) ||
    !Number.isSafeInteger(sample.kv_measured_at) ||
    [sample.measured_at, sample.kv_measured_at].some((time) => time > now || now - time > 60000)
  )
    throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
  for (const [meter, bound] of Object.entries(maximum)) {
    if (!Number.isSafeInteger(sample[meter]) || sample[meter] < 0)
      throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
    if (sample[meter] + bound > (ACCOUNT_CEILINGS[meter] ?? KV_ACCOUNT_CEILINGS[meter]))
      throw new Error(`COST_READER_RECOVERY_HEADROOM: ${meter}`)
  }
  return { rows_read: 0, rows_written: 0, kv_writes: 0, ...maximum }
}

async function main() {
  const state = await readIconoplasmReleaseState()
  const originRunId = selectReleaseOriginRunId(
    state,
    process.env.GITHUB_RUN_ID,
    process.env.ICONOPLASM_RELEASE_ORIGIN_RUN_ID,
  )
  await readReleaseOrigin({
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    resumeRunId: originRunId,
    token: process.env.GITHUB_TOKEN,
  })
  let maximum
  if (state.schema_transition) {
    const reader = createOperationCostAccountUsageReader({
      accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
      token: process.env.CLOUDFLARE_BUDGET_ANALYTICS_TOKEN,
    })
    maximum = requireReaderRecoveryHeadroom(await reader.refresh({ includeKv: true }))
  }
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(process.env.GITHUB_OUTPUT, `schema_transition=${state.schema_transition}\n`)
  if (process.env.GITHUB_ENV)
    appendFileSync(process.env.GITHUB_ENV, `ICONOPLASM_RELEASE_ORIGIN_RUN_ID=${originRunId}\n`)
  console.log(JSON.stringify({ ...state, origin_run_id: originRunId, maximum }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
