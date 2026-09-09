import { readFileSync, readdirSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { ACCOUNT_CEILINGS } from "../workers/lib/operation-cost-ledger.js"
import { createOperationCostAccountUsageReader } from "../workers/iconoplasm/operation-cost-account-usage.js"
import {
  readReleaseOrigin,
  RELEASE_REQUEST_LIMIT,
  MIGRATION_RELEASE_REQUEST_LIMIT,
} from "./operation-cost-release-plan.mjs"
import { createMigrationOperationCostAdapters } from "../workers/iconoplasm/operation-cost-migration-adapters.js"
import { OPERATION_COST_IDENTITIES } from "../workers/generated/operation-cost-identities.js"
import { D1_OPERATOR_DAILY_LIMITS } from "../shared/iconoplasm-d1-budget-policy.js"
import { runAdmittedMigrations, createReleaseSender } from "./run-admitted-d1-migrations.mjs"
import {
  KV_COST_METERS,
  KV_OPERATOR_LIMITS,
  KV_ACCOUNT_CEILINGS,
} from "../workers/lib/operation-cost-meters.js"
import { createCatalogInitializationCostAdapter } from "../workers/iconoplasm/operation-cost-catalog-initialization-adapter.js"
import { readIconoplasmReleaseState } from "./read-iconoplasm-release-state.mjs"
import { migrationSizePrerequisites } from "./operation-cost-release-prerequisites.mjs"

// Two inventory preflights, schema inspection, migrations, and catalog
// initialization each own a bounded sender. Budget their cumulative requests.
const RELEASE_CONTROL_REQUESTS = 4 * RELEASE_REQUEST_LIMIT + MIGRATION_RELEASE_REQUEST_LIMIT

export async function verifyReleaseAuthentication({ token, fetcher = fetch }) {
  if (!token) throw new Error("COST_OPERATOR_TOKEN_REQUIRED")
  const response = await fetcher(
    "https://iconoplasm.brinedew.bio/api/iconoplasm/admin/cost/operations",
    {
      method: "HEAD",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers: { "x-iconoplasm-admin-token": token },
    },
  )
  if (response.status === 401 || response.status === 403)
    throw new Error("COST_RELEASE_AUTHENTICATION_FAILED")
  if (!response.ok) throw new Error(`COST_RELEASE_ADMISSION_UNAVAILABLE_HTTP_${response.status}`)
}

// This read-only check prevents a known refusal from pausing production. The
// server still reserves every operation atomically; telemetry is not a permit.
export async function preflightOperationCostRelease({
  manifest,
  reader,
  now = Date.now,
  pendingMigrations = Object.keys(manifest?.migrations || {}),
}) {
  if (manifest?.schema !== "iconoplasm.migrationCostPlan.v1" || !manifest.migrations)
    throw new Error("COST_MIGRATION_PLAN_REQUIRED")
  if (
    !Array.isArray(pendingMigrations) ||
    new Set(pendingMigrations).size !== pendingMigrations.length ||
    pendingMigrations.some((key) => !Object.hasOwn(manifest.migrations, key))
  )
    throw new Error("COST_MIGRATION_NOT_REVIEWED")
  const pending = Object.fromEntries(
    pendingMigrations.map((key) => [key, manifest.migrations[key]]),
  )
  const required = { rows_read: 0, rows_written: 0, requests: 1 }
  const prerequisites = migrationSizePrerequisites(Object.values(pending))
  const predictions = [
    ...prerequisites.map((item) => item.prediction),
    ...Array(3).fill(manifest.inventory_prediction),
    ...Array(3).fill({ rows_read: 2050, rows_written: 0, requests: 1 }),
    ...Object.values(pending).map((item) => item.prediction),
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
      // Only inventory-confirmed pending work, at its maximum two-times
      // forecast. Applied migrations retain their journal and old receipts.
      required[meter] += 2 * prediction[meter] + (meter === "requests" ? 1 : 0)
      if (!Number.isSafeInteger(required[meter])) throw new Error("COST_PREDICTION_REQUIRED")
    }
  }
  required.requests = Math.max(required.requests, RELEASE_CONTROL_REQUESTS)
  // Preparation is pure: these adapters have no database binding here. Use the
  // server's actual maximum calculation, not a second copy of its formulas.
  const adapters = createMigrationOperationCostAdapters(
    { ICONOPLASM_SCHEMA_TRANSITION: "1" },
    OPERATION_COST_IDENTITIES,
  )
  const steps = [
    ...prerequisites,
    ...["geneguessr", "iconoplasm", "iconoplasm-authoring"].map((resource) => ({
      adapter_id: `${resource}-migration-inventory`,
      resource,
      prediction: { rows_read: 2050, rows_written: 0, requests: 1 },
      arguments: { statements: [{ query_id: "schema-objects", arguments: {} }] },
    })),
    ...["geneguessr", "iconoplasm", "iconoplasm-authoring"].map((resource) => ({
      adapter_id: `${resource}-migration-inventory`,
      resource,
      prediction: manifest.inventory_prediction,
      arguments: { statements: [{ query_id: "applied-migrations", arguments: {} }] },
    })),
    ...Object.entries(pending).map(([key, item]) => ({
      ...item,
      resource: key.split("/")[0],
    })),
  ]
  const maximum = { rows_read: 0, rows_written: 0, requests: RELEASE_CONTROL_REQUESTS }
  for (const step of steps) {
    const adapter = adapters.get(step.adapter_id)
    if (!adapter || adapter.resource !== step.resource)
      throw new Error("COST_MIGRATION_NOT_REVIEWED")
    const { bound } = await adapter.prepare(step.arguments)
    if (step.migration_protocol) {
      if (step.migration_protocol !== "admin-count-seed-v1" || step.max_steps !== 100)
        throw new Error("COST_MIGRATION_PROTOCOL_INVALID")
      const page = await adapter.prepare({ phase: "assets" })
      const finish = await adapter.prepare({ phase: "finish" })
      for (const meter of Object.keys(bound))
        bound[meter] += (step.max_steps - 2) * page.bound[meter] + finish.bound[meter]
    }
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
  const initialization = manifest.catalog_initialization_prediction
  if (initialization) {
    if (
      Object.keys(initialization).sort().join() !==
        "kv_deletes,kv_lists,kv_reads,kv_writes,requests,rows_read,rows_written" ||
      Object.values(initialization).some((value) => !Number.isSafeInteger(value) || value < 0) ||
      initialization.requests < 1
    )
      throw new Error("COST_PREDICTION_REQUIRED")
    const { bound } = await createCatalogInitializationCostAdapter(
      OPERATION_COST_IDENTITIES,
    ).prepare({})
    for (const meter of Object.keys(bound)) {
      if (bound[meter] > 2 * initialization[meter]) throw new Error("COST_TWICE_PREDICTION_LIMIT")
      required[meter] = (required[meter] ?? 0) + 2 * initialization[meter]
      maximum[meter] = (maximum[meter] ?? 0) + bound[meter]
    }
    // A zero-write preflight validates the same inputs before the mutation
    // plan is acquired, preserving its remaining write allowance on bad input.
    required.kv_reads += 2 * initialization.kv_reads
    maximum.kv_reads += bound.kv_reads
    required.requests += 4
    maximum.requests += 4
    for (const meter of KV_COST_METERS)
      if (maximum[meter] > KV_OPERATOR_LIMITS[meter])
        throw new Error("COST_RELEASE_EXCEEDS_DAILY_ALLOCATION")
  }
  const sample = await reader.refresh({ includeKv: Boolean(initialization) })
  const checkedAt = now()
  if (
    sample?.day !== new Date(checkedAt).toISOString().slice(0, 10) ||
    !Number.isSafeInteger(sample.measured_at) ||
    sample.measured_at > checkedAt ||
    checkedAt - sample.measured_at > 60_000
  )
    throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
  if (
    initialization &&
    (!Number.isSafeInteger(sample.kv_measured_at) ||
      sample.kv_measured_at > checkedAt ||
      checkedAt - sample.kv_measured_at > 60_000)
  )
    throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
  for (const meter of Object.keys(required)) {
    if (!Number.isSafeInteger(sample[meter]) || sample[meter] < 0)
      throw new Error("COST_ACCOUNT_USAGE_UNAVAILABLE")
    if (KV_COST_METERS.includes(meter) && required[meter] === 0) continue
    if (sample[meter] + required[meter] > (ACCOUNT_CEILINGS[meter] ?? KV_ACCOUNT_CEILINGS[meter]))
      throw new Error(`COST_RELEASE_ACCOUNT_HEADROOM: ${meter}`)
  }
  return { day: sample.day, measured_at: sample.measured_at, observed: sample, required, maximum }
}

export function requireReleaseSharedCapacity(maximum, capacity, now = Date.now(), observed) {
  if (
    capacity?.day !== new Date(now).toISOString().slice(0, 10) ||
    !Number.isSafeInteger(capacity?.measured_at) ||
    capacity.measured_at > now ||
    now - capacity.measured_at > 60000
  )
    throw new Error("COST_SHARED_USAGE_UNAVAILABLE")
  for (const meter of ["rows_read", "rows_written", "requests"]) {
    if (
      !Number.isSafeInteger(capacity.remaining?.[meter]) ||
      capacity.remaining[meter] < 0 ||
      !Number.isSafeInteger(maximum?.[meter]) ||
      maximum[meter] < 0
    )
      throw new Error("COST_SHARED_USAGE_UNAVAILABLE")
    if (maximum[meter] > capacity.remaining[meter])
      throw new Error(`COST_RELEASE_SHARED_HEADROOM: ${meter}`)
    if (observed) {
      if (
        !Number.isSafeInteger(capacity.used?.[meter]) ||
        capacity.used[meter] < 0 ||
        !Number.isSafeInteger(observed[meter]) ||
        observed[meter] < 0
      )
        throw new Error("COST_SHARED_USAGE_UNAVAILABLE")
      if (observed[meter] + capacity.used[meter] + maximum[meter] > ACCOUNT_CEILINGS[meter])
        throw new Error(`COST_RELEASE_ACCOUNT_HEADROOM: ${meter}`)
    }
  }
}

export async function chooseReleaseAdmission({
  manifest,
  pendingMigrations,
  result,
  capacity,
  readMaintenance,
  now = Date.now(),
}) {
  try {
    requireReleaseSharedCapacity(result.maximum, capacity, now, result.observed)
    return { mode: "complete-release", maximum: result.maximum }
  } catch (error) {
    if (!/^COST_RELEASE_(SHARED|ACCOUNT)_HEADROOM:/.test(error.message)) throw error
    const first = manifest.migrations[pendingMigrations[0]]
    // Never pause a working site on insufficient capacity. An already-paused
    // site may stage and resume its first bounded migration; the runner admits
    // every page separately and retains all uncertain shared usage.
    if (first?.migration_protocol !== "admin-count-seed-v1" || !(await readMaintenance()))
      throw error
    const adapters = createMigrationOperationCostAdapters(
      { ICONOPLASM_SCHEMA_TRANSITION: "1" },
      OPERATION_COST_IDENTITIES,
    )
    const { bound } = await adapters.get(first.adapter_id).prepare(first.arguments)
    const maximum = { ...bound, requests: RELEASE_CONTROL_REQUESTS }
    for (const probe of migrationSizePrerequisites(
      pendingMigrations.map((key) => manifest.migrations[key]),
    )) {
      const prepared = await adapters.get(probe.adapter_id).prepare(probe.arguments)
      maximum.rows_read += prepared.bound.rows_read
    }
    for (const resource of ["geneguessr", "iconoplasm", "iconoplasm-authoring"]) {
      const inventory = adapters.get(`${resource}-migration-inventory`)
      const prepared = await inventory.prepare({
        statements: [
          { query_id: "applied-migrations", arguments: {} },
          { query_id: "schema-objects", arguments: {} },
        ],
      })
      maximum.rows_read += prepared.bound.rows_read
    }
    requireReleaseSharedCapacity(maximum, capacity, now, result.observed)
    return { mode: "resume-existing-maintenance", maximum }
  }
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
  const reader = createOperationCostAccountUsageReader({
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
    token: process.env.CLOUDFLARE_BUDGET_ANALYTICS_TOKEN,
  })
  // Verify the credential against the current authority before a deployment
  // can pause application traffic. This HEAD performs no application D1 work.
  await verifyReleaseAuthentication({ token: process.env.ICONOPLASM_ADMIN_TOKEN })
  // The first admitted migration inventory reads application D1. Check both
  // provider telemetry and the authority's retained shared reservations before
  // that read. /capacity is control-plane state and does not touch application D1.
  const preflightSend = createReleaseSender(process.env.ICONOPLASM_ADMIN_TOKEN)
  const sentinel = await preflightOperationCostRelease({
    manifest,
    reader,
    pendingMigrations: [],
  })
  const sentinelCapacity = await preflightSend("/capacity", "GET")
  requireReleaseSharedCapacity(
    sentinel.maximum,
    sentinelCapacity,
    Date.now(),
    sentinel.observed,
  )
  // Inventory remains separately admitted and resumable through the same bounded
  // sender after the zero-D1 sentinel proves enough capacity for its baseline work.
  const inventory = await runAdmittedMigrations({
    manifest,
    releaseId: `${origin.inspectionId}-preflight`,
    inventoryOnly: true,
    send: preflightSend,
    files: (directory) =>
      readdirSync(new URL(`../${directory}/`, import.meta.url))
        .filter((name) => name.endsWith(".sql"))
        .sort(),
  })
  const result = await preflightOperationCostRelease({
    manifest,
    reader,
    pendingMigrations: inventory.pending_migrations,
  })
  // Provider telemetry does not include the authority's uncertain reservations.
  // Read the one existing ledger, never infer a refund or create another budget.
  const capacity = await createReleaseSender(process.env.ICONOPLASM_ADMIN_TOKEN)("/capacity", "GET")
  const admission = await chooseReleaseAdmission({
    manifest,
    pendingMigrations: inventory.pending_migrations,
    result,
    capacity,
    readMaintenance: async () => (await readIconoplasmReleaseState()).schema_transition,
  })
  process.stdout.write(
    JSON.stringify({
      ...result,
      capacity,
      admission,
      pending_migrations: inventory.pending_migrations,
    }) + "\n",
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}