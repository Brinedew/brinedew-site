import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { ACCOUNT_CEILINGS } from "../workers/lib/operation-cost-ledger.js"
import { createOperationCostAccountUsageReader } from "../workers/iconoplasm/operation-cost-account-usage.js"
import { readReleaseOrigin, RELEASE_REQUEST_LIMIT } from "./operation-cost-release-plan.mjs"
import { createMigrationOperationCostAdapters } from "../workers/iconoplasm/operation-cost-migration-adapters.js"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
import { D1_OPERATOR_DAILY_LIMITS } from "../shared/iconoplasm-d1-budget-policy.js"

// This read-only check prevents a known refusal from pausing production. The
// server still reserves every operation atomically; telemetry is not a permit.
export async function preflightOperationCostRelease({ manifest, reader, now = Date.now }) {
  if (manifest?.schema !== "iconoplasm.migrationCostPlan.v1" || !manifest.migrations)
    throw new Error("COST_MIGRATION_PLAN_REQUIRED")
  const required = { rows_read: 0, rows_written: 0, requests: 1 }
  const predictions = [
    ...Array(3).fill(manifest.inventory_prediction),
    ...Object.values(manifest.migrations).map((item) => item.prediction),
  ]
  for (const prediction of predictions) {
    if (
      !prediction ||
      Object.keys(prediction).sort().join() !== "requests,rows_read,rows_written" ||
      prediction.requests < 1
    )
      throw new Error("COST_PREDICTION_REQUIRED")
    for (const meter of Object.keys(required)) {
      if (!Number.isSafeInteger(prediction[meter]) || prediction[meter] < 0)
        throw new Error("COST_PREDICTION_REQUIRED")
      // Entire reviewed release, including already-applied migrations, at its
      // maximum two-times forecast. Include registration control requests.
      required[meter] += 2 * prediction[meter] + (meter === "requests" ? 1 : 0)
      if (!Number.isSafeInteger(required[meter])) throw new Error("COST_PREDICTION_REQUIRED")
    }
  }
  required.requests = Math.max(required.requests, RELEASE_REQUEST_LIMIT)
  // Preparation is pure: these adapters have no database binding here. Use the
  // server's actual maximum calculation, not a second copy of its formulas.
  const adapters = createMigrationOperationCostAdapters({}, OPERATION_COST_IDENTITIES)
  const steps = [
    ...["geneguessr", "iconoplasm", "iconoplasm-authoring"].map((resource) => ({
      adapter_id: `${resource}-migration-inventory`,
      resource,
      prediction: manifest.inventory_prediction,
      arguments: { statements: [{ query_id: "applied-migrations", arguments: {} }] },
    })),
    ...Object.entries(manifest.migrations).map(([key, item]) => ({
      ...item,
      resource: key.split("/")[0],
    })),
  ]
  const maximum = { rows_read: 0, rows_written: 0, requests: RELEASE_REQUEST_LIMIT }
  for (const step of steps) {
    const adapter = adapters.get(step.adapter_id)
    if (!adapter || adapter.resource !== step.resource)
      throw new Error("COST_MIGRATION_NOT_REVIEWED")
    const { bound } = await adapter.prepare(step.arguments)
    for (const meter of Object.keys(required)) {
      if (bound[meter] > 2 * step.prediction[meter]) throw new Error("COST_TWICE_PREDICTION_LIMIT")
      if (meter !== "requests") maximum[meter] += bound[meter]
    }
  }
  if (
    maximum.rows_read > D1_OPERATOR_DAILY_LIMITS.reads ||
    maximum.rows_written > D1_OPERATOR_DAILY_LIMITS.writes
  )
    throw new Error("COST_RELEASE_EXCEEDS_DAILY_ALLOCATION")
  const sample = await reader.refresh()
  const checkedAt = now()
  if (
    sample?.day !== new Date(checkedAt).toISOString().slice(0, 10) ||
    !Number.isSafeInteger(sample.measured_at) ||
    sample.measured_at > checkedAt ||
    checkedAt - sample.measured_at > 60_000
  )
    throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
  for (const meter of Object.keys(required)) {
    if (!Number.isSafeInteger(sample[meter]) || sample[meter] < 0)
      throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
    if (sample[meter] + required[meter] > ACCOUNT_CEILINGS[meter])
      throw new Error(`COST_RELEASE_ACCOUNT_HEADROOM: ${meter}`)
  }
  return { day: sample.day, measured_at: sample.measured_at, observed: sample, required, maximum }
}

async function main() {
  if (process.env.GITHUB_ACTIONS === "true")
    await readReleaseOrigin({
      repository: process.env.GITHUB_REPOSITORY,
      runId: process.env.GITHUB_RUN_ID,
      token: process.env.GITHUB_TOKEN,
    })
  const manifest = JSON.parse(
    readFileSync(
      new URL("../cloudflare/operation-cost-migration-plan.json", import.meta.url),
      "utf8",
    ),
  )
  const reader = createOperationCostAccountUsageReader({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_BUDGET_ANALYTICS_TOKEN,
  })
  process.stdout.write(
    JSON.stringify(await preflightOperationCostRelease({ manifest, reader })) + "\n",
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
