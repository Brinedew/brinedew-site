import { readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
import { acquireReleasePlan, readReleaseOrigin } from "./operation-cost-release-plan.mjs"
import { createReleaseSender } from "./run-admitted-d1-migrations.mjs"

export async function runAdmittedCatalogInitialization({
  prediction,
  releaseId,
  send,
  now = Date.now(),
  inspectOnly = false,
}) {
  if (
    !prediction ||
    Object.keys(prediction).sort().join() !==
      "kv_deletes,kv_lists,kv_reads,kv_writes,requests,rows_read,rows_written" ||
    Object.values(prediction).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    prediction.requests < 1 ||
    !/^[A-Za-z0-9_-]{1,100}$/.test(releaseId)
  )
    throw new Error("COST_PREDICTION_REQUIRED")
  const capabilities = await send("", "GET")
  const adapter = capabilities.adapters?.find(
    (item) => item.id === "catalog-snapshot-initialization",
  )
  if (
    !adapter ||
    adapter.resource !== "iconoplasm-kv" ||
    Object.entries(OPERATION_COST_IDENTITIES).some(([key, value]) => adapter[key] !== value)
  ) {
    throw new Error("COST_DEPLOYED_IMPLEMENTATION_MISMATCH")
  }
  const { plan, stepId } = await acquireReleasePlan({
    releaseId,
    adapter,
    prediction,
    send,
    features: capabilities.features,
    now,
  })
  const response = await send("/execute", "POST", {
    operation_id: plan.id,
    step_id: stepId,
    adapter_id: adapter.id,
    arguments: inspectOnly ? { inspect_only: true } : {},
  })
  const result = response?.result
  if (
    !result ||
    typeof result.build_version !== "string" ||
    !result.build_version.length ||
    !Number.isSafeInteger(result.gene_count) ||
    result.gene_count < 0 ||
    result.gene_count > 20000 ||
    typeof result.changed !== "boolean"
  ) {
    throw new Error("COST_CATALOG_INITIALIZATION_RECEIPT_INVALID")
  }
  return response
}

async function main() {
  const origin = await readReleaseOrigin({
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
  // Observe retained inputs without reserving a publication write. Keep this
  // attempt's read-only identity separate from the original mutation lineage.
  const send = createReleaseSender(process.env.ICONOPLASM_ADMIN_TOKEN)
  await runAdmittedCatalogInitialization({
    prediction: { ...manifest.catalog_initialization_prediction, kv_writes: 0 },
    releaseId: `${origin.inspectionId}-catalog-check`,
    send,
    inspectOnly: true,
  })
  const result = await runAdmittedCatalogInitialization({
    prediction: manifest.catalog_initialization_prediction,
    releaseId: origin.releaseId,
    send,
  })
  console.log(JSON.stringify(result))
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
