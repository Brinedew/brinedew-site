import { readFileSync, readdirSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
import {
  acquireReleasePlan,
  readReleaseOrigin,
  RELEASE_REQUEST_LIMIT,
} from "./operation-cost-release-plan.mjs"

const ROOT = new URL("../", import.meta.url)
const ENDPOINT = "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/cost/operations"
const DATABASES = {
  // Benchmark owns two tables in the same database and migration journal.
  geneguessr: ["migrations", "workers/benchmark/migrations"],
  iconoplasm: ["migrations-iconoplasm"],
  "iconoplasm-authoring": ["migrations-iconoplasm-authoring"],
}

function isReviewedHistoricalMigration(resource, name, applied) {
  // Production first received the minimal comments table under this name.
  // The committed 0045 and 0046 explicitly document that earlier variant.
  // Recognize its journal row only alongside both completed canonical repairs;
  // never remove it, replay it, or treat it as a substitute for either repair.
  return (
    resource === "iconoplasm" &&
    name === "0045_add_gene_comments.sql" &&
    applied.has("0045_gene_comments_and_clans_backend.sql") &&
    applied.has("0046_gene_comment_columns.sql")
  )
}

function requirePrediction(prediction) {
  if (
    !prediction ||
    Object.keys(prediction).sort().join() !== "requests,rows_read,rows_written" ||
    Object.values(prediction).some((value) => !Number.isSafeInteger(value) || value < 0) ||
    prediction.requests < 1
  )
    throw new Error("COST_PREDICTION_REQUIRED")
}

export async function runAdmittedMigrations({
  manifest,
  releaseId,
  send,
  files,
  now = Date.now(),
}) {
  if (manifest?.schema !== "iconoplasm.migrationCostPlan.v1" || !manifest.migrations)
    throw new Error("COST_MIGRATION_PLAN_REQUIRED")
  requirePrediction(manifest.inventory_prediction)
  for (const migration of Object.values(manifest.migrations))
    requirePrediction(migration.prediction)
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(releaseId)) throw new Error("COST_RELEASE_ID_REQUIRED")
  const capabilities = await send("", "GET")
  const adapters = new Map(capabilities.adapters?.map((item) => [item.id, item]) || [])
  const evidence = []
  async function execute(adapterId, prediction, args) {
    const adapter = adapters.get(adapterId)
    if (
      !adapter ||
      Object.entries(OPERATION_COST_IDENTITIES).some(([key, value]) => adapter[key] !== value)
    )
      throw new Error("COST_DEPLOYED_IMPLEMENTATION_MISMATCH")
    const { plan, stepId } = await acquireReleasePlan({
      releaseId,
      adapter,
      prediction,
      send,
      features: capabilities.features,
      now,
    })
    const receipt = await send("/execute", "POST", {
      operation_id: plan.id,
      step_id: stepId,
      adapter_id: adapterId,
      arguments: args,
    })
    evidence.push({ plan, usage: receipt.usage, ceiling: receipt.ceiling })
    return receipt.result
  }
  const pending = []
  for (const [resource, directories] of Object.entries(DATABASES)) {
    const results = await execute(
      `${resource}-migration-inventory`,
      manifest.inventory_prediction,
      { statements: [{ query_id: "applied-migrations", arguments: {} }] },
    )
    const rows = results?.[0]?.results
    if (!Array.isArray(rows) || rows.length >= 513)
      throw new Error("COST_MIGRATION_INVENTORY_TRUNCATED")
    const expected = directories.flatMap((directory) => files(directory))
    if (new Set(expected).size !== expected.length)
      throw new Error(`COST_MIGRATION_SOURCE_NAME_COLLISION: ${resource}`)
    const applied = new Set(rows.map((row) => row.name))
    if (
      applied.size !== rows.length ||
      [...applied].some(
        (name) =>
          !expected.includes(name) && !isReviewedHistoricalMigration(resource, name, applied),
      )
    )
      throw new Error(`COST_MIGRATION_HISTORY_DIVERGED: ${resource}`)
    for (const name of expected) {
      if (applied.has(name)) continue
      const reviewed = manifest.migrations[`${resource}/${name}`]
      if (!reviewed) throw new Error(`COST_MIGRATION_NOT_REVIEWED: ${resource}/${name}`)
      if (adapters.get(reviewed.adapter_id)?.resource !== resource)
        throw new Error("COST_MIGRATION_RESOURCE_MISMATCH")
      pending.push(reviewed)
    }
  }
  // Check every database's pending set before performing the first DDL.
  for (const item of pending) await execute(item.adapter_id, item.prediction, item.arguments)
  return { migrations_applied: pending.length, evidence }
}

async function main() {
  const origin = await readReleaseOrigin({
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
    token: process.env.GITHUB_TOKEN,
  })
  const manifest = JSON.parse(
    readFileSync(new URL("cloudflare/operation-cost-migration-plan.json", ROOT), "utf8"),
  )
  const token = process.env.ICONOPLASM_ADMIN_TOKEN
  if (!token) throw new Error("COST_OPERATOR_TOKEN_REQUIRED")
  // Fixed origin, bounded traffic, timeouts and no implicit retries. D1 and
  // account-wide admission are owned by the existing server ledger.
  let requests = 0
  const send = async (suffix, method, body) => {
    if (++requests > RELEASE_REQUEST_LIMIT) throw new Error("COST_DEPLOYMENT_REQUEST_LIMIT")
    const response = await fetch(ENDPOINT + suffix, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { "x-iconoplasm-admin-token": token, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await response.text()
    if (text.length > 256_000) throw new Error("COST_RESPONSE_LIMIT")
    let value
    try {
      value = JSON.parse(text)
    } catch {
      throw new Error("COST_RESPONSE_INVALID")
    }
    if (!response.ok)
      throw new Error(/^COST_[A-Z_]+$/.test(value.code) ? value.code : "COST_OPERATION_REFUSED")
    return value
  }
  const result = await runAdmittedMigrations({
    manifest,
    releaseId: origin.releaseId,
    send,
    files: (directory) =>
      readdirSync(new URL(directory + "/", ROOT))
        .filter((name) => name.endsWith(".sql"))
        .sort(),
  })
  process.stdout.write(JSON.stringify(result) + "\n")
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
