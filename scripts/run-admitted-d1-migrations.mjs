import { readFileSync, readdirSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
import {
  acquireReleasePlan,
  readReleaseOrigin,
  RELEASE_REQUEST_LIMIT,
  MIGRATION_RELEASE_REQUEST_LIMIT,
} from "./operation-cost-release-plan.mjs"
import { createMigrationOperationCostAdapters } from "../workers/iconoplasm/operation-cost-migration-adapters.js"

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
  inventoryReleaseId = releaseId,
  send,
  files,
  now = Date.now(),
  inventoryOnly = false,
}) {
  if (manifest?.schema !== "iconoplasm.migrationCostPlan.v1" || !manifest.migrations)
    throw new Error("COST_MIGRATION_PLAN_REQUIRED")
  requirePrediction(manifest.inventory_prediction)
  for (const migration of Object.values(manifest.migrations))
    requirePrediction(migration.prediction)
  if ([releaseId, inventoryReleaseId].some((id) => !/^[A-Za-z0-9_-]{1,100}$/.test(id)))
    throw new Error("COST_RELEASE_ID_REQUIRED")
  const capabilities = await send("", "GET")
  const adapters = new Map(capabilities.adapters?.map((item) => [item.id, item]) || [])
  const evidence = []
  const acquired = new Map()
  async function execute(adapterId, prediction, args) {
    const adapter = adapters.get(adapterId)
    // Before deploying a new implementation, only the installed, read-only
    // inventory adapter can run. Pin its own identities in the immutable plan;
    // DDL below still requires the exact new release identities.
    const identities = inventoryOnly
      ? Object.fromEntries(
          Object.keys(OPERATION_COST_IDENTITIES).map((key) => [key, adapter?.[key]]),
        )
      : OPERATION_COST_IDENTITIES
    if (
      !adapter ||
      Object.entries(identities).some(
        ([key, value]) => !/^[a-f0-9]{64}$/.test(value || "") || adapter[key] !== value,
      ) ||
      (inventoryOnly &&
        (!adapterId.endsWith("-migration-inventory") ||
          adapter.id !== `${adapter.resource}-migration-inventory`))
    )
      throw new Error("COST_DEPLOYED_IMPLEMENTATION_MISMATCH")
    let acquisition = acquired.get(adapterId)
    if (!acquisition)
      acquisition = await acquireReleasePlan({
        releaseId: adapterId.endsWith("-migration-inventory") ? inventoryReleaseId : releaseId,
        adapter,
        prediction,
        send,
        features: capabilities.features,
        now,
        identities,
      })
    const { plan, stepId } = acquisition
    const receipt = await send("/execute", "POST", {
      operation_id: plan.id,
      step_id: stepId,
      adapter_id: adapterId,
      arguments: args,
    })
    evidence.push({ plan, usage: receipt.usage, ceiling: receipt.ceiling })
    acquired.set(adapterId, { plan, stepId: `execute-${Number(stepId.slice(8)) + 1}` })
    return receipt.result
  }
  const pending = []
  const pendingKeys = []
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
      if (!inventoryOnly && adapters.get(reviewed.adapter_id)?.resource !== resource)
        throw new Error("COST_MIGRATION_RESOURCE_MISMATCH")
      pending.push(reviewed)
      pendingKeys.push(`${resource}/${name}`)
    }
  }
  // Check every database's pending set before performing the first DDL.
  if (inventoryOnly) return { pending_migrations: pendingKeys, evidence }
  const localAdapters = createMigrationOperationCostAdapters(
    { ICONOPLASM_SCHEMA_TRANSITION: "1" },
    OPERATION_COST_IDENTITIES,
  )
  for (const item of pending) {
    if (!item.migration_protocol) {
      await execute(item.adapter_id, item.prediction, item.arguments)
      continue
    }
    if (
      item.migration_protocol !== "admin-count-seed-v1" ||
      adapters.get(item.adapter_id)?.migration_protocol !== item.migration_protocol ||
      !Number.isSafeInteger(item.max_steps) ||
      item.max_steps < 1 ||
      item.max_steps > 100
    )
      throw new Error("COST_MIGRATION_PROTOCOL_INVALID")
    let args = item.arguments,
      complete = false
    for (let step = 0; step < item.max_steps; step++) {
      const { bound } = await localAdapters.get(item.adapter_id).prepare(args)
      const capacity = await send("/capacity", "GET")
      const checkedAt = Date.now()
      if (
        capacity?.day !== new Date(checkedAt).toISOString().slice(0, 10) ||
        !Number.isSafeInteger(capacity.measured_at) ||
        capacity.measured_at > checkedAt ||
        checkedAt - capacity.measured_at > 60000
      )
        throw new Error("COST_SHARED_USAGE_UNAVAILABLE")
      for (const meter of Object.keys(bound)) {
        if (!Number.isSafeInteger(capacity.remaining?.[meter]) || capacity.remaining[meter] < 0)
          throw new Error("COST_SHARED_USAGE_UNAVAILABLE")
        if (capacity.remaining[meter] < bound[meter] + (meter === "requests" ? 2 : 0))
          throw new Error("COST_MIGRATION_RESUME_AFTER_HEADROOM")
      }
      const result = await execute(item.adapter_id, item.prediction, args)
      if (result?.applied === true) {
        complete = true
        break
      }
      if (!["catalog", "rollup", "assets", "finish"].includes(result?.next_phase))
        throw new Error("COST_MIGRATION_PROGRESS_INVALID")
      args = { phase: result.next_phase }
    }
    if (!complete) throw new Error("COST_MIGRATION_RESUME_REQUIRED")
  }
  return { migrations_applied: pending.length, evidence }
}

export function createReleaseSender(
  token,
  fetcher = fetch,
  report = () => {},
  requestLimit = RELEASE_REQUEST_LIMIT,
) {
  if (!token) throw new Error("COST_OPERATOR_TOKEN_REQUIRED")
  if (![RELEASE_REQUEST_LIMIT, MIGRATION_RELEASE_REQUEST_LIMIT].includes(requestLimit))
    throw new Error("COST_DEPLOYMENT_REQUEST_LIMIT")
  // Fixed origin, bounded traffic, timeouts and no implicit retries. D1 and
  // account-wide admission are owned by the existing server ledger.
  let requests = 0
  return async (suffix, method, body) => {
    if (++requests > requestLimit) throw new Error("COST_DEPLOYMENT_REQUEST_LIMIT")
    // B-742: persist the exact last attempted step before a deployment exits.
    // Never log the token, headers, arbitrary arguments or response bodies.
    const step = {
      request: requests,
      method,
      route: suffix || "/",
      adapter_id: body?.adapter_id || null,
      operation_id: body?.operation_id || body?.id || null,
      step_id: body?.step_id || null,
    }
    report({ ...step, phase: "start" })
    const response = await fetcher(ENDPOINT + suffix, {
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
    const code = /^COST_[A-Z_]+$/.test(value.code) ? value.code : "COST_OPERATION_REFUSED"
    report({
      ...step,
      phase: response.ok ? "complete" : "refused",
      status: response.status,
      ...(!response.ok ? { code } : {}),
    })
    if (!response.ok) throw new Error(code)
    return value
  }
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
  const send = createReleaseSender(
    process.env.ICONOPLASM_ADMIN_TOKEN,
    fetch,
    (step) => {
      console.error("[admitted-migration] " + JSON.stringify(step))
    },
    MIGRATION_RELEASE_REQUEST_LIMIT,
  )
  const result = await runAdmittedMigrations({
    manifest,
    releaseId: origin.releaseId,
    inventoryReleaseId: origin.inspectionId,
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
