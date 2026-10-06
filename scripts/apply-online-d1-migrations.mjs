// B-847: reviewed online D1 migrations apply on the ordinary release.
//
// A migration that both the running code and the new code tolerate (dropping
// objects nothing reads, adding defaulted columns, backfilling a
// version-checked accelerator, CREATE INDEX IF NOT EXISTS) no longer needs the
// paused maintenance protocol: D1 serializes queries per database, so readers
// never see a half state. The review marks such a migration `"online": true`
// in cloudflare/operation-cost-migration-plan.json together with its cost
// prediction and optional size guards. This step runs before the Worker
// deploy; a refusal stops the release before anything changes, and the
// installed code keeps serving. Migrations without `online` keep the
// maintenance protocol (`data_maintenance=true`).
import { execFileSync } from "node:child_process"
import { readFileSync, readdirSync } from "node:fs"
import { pathToFileURL } from "node:url"

import { createOperationCostAccountUsageReader } from "../workers/iconoplasm/operation-cost-account-usage.js"
import { D1_OPERATOR_DAILY_LIMITS } from "../shared/iconoplasm-d1-budget-policy.js"

const ROOT = new URL("../", import.meta.url)
const CONFIG = "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml"
// Databases whose wrangler migrations_dir is exactly one reviewed directory.
export const ONLINE_MIGRATION_DATABASES = Object.freeze({
  iconoplasm: "migrations-iconoplasm",
  "iconoplasm-authoring": "migrations-iconoplasm-authoring",
})
// One daily allowance for all operator work (B-1035): migrations are admitted against
// the same numbers as the operator ledger and its B-1026 tiers, so no path has a
// budget of its own. It used to have one (4.5M reads, 70k writes against 1M and 20k),
// which made a one-off bundle look cheaper than the designed outbox route.
export const MIGRATION_READ_CEILING = D1_OPERATOR_DAILY_LIMITS.reads
export const MIGRATION_WRITE_CEILING = D1_OPERATOR_DAILY_LIMITS.writes

function requirePrediction(prediction, key) {
  if (
    !prediction ||
    !Number.isSafeInteger(prediction.rows_read) ||
    !Number.isSafeInteger(prediction.rows_written) ||
    prediction.rows_read < 0 ||
    prediction.rows_written < 0
  )
    throw new Error(`COST_PREDICTION_REQUIRED: ${key}`)
}

// Same reviewed exception as run-admitted-d1-migrations.mjs: production first
// journaled the minimal comments table under this name; 0045/0046 document it.
function isReviewedHistoricalMigration(resource, name, applied) {
  return (
    resource === "iconoplasm" &&
    name === "0045_add_gene_comments.sql" &&
    applied.has("0045_gene_comments_and_clans_backend.sql") &&
    applied.has("0046_gene_comment_columns.sql")
  )
}

export function planOnlineMigrations({ manifest, files, applied }) {
  if (manifest?.schema !== "iconoplasm.migrationCostPlan.v1" || !manifest.migrations)
    throw new Error("COST_MIGRATION_PLAN_REQUIRED")
  const pending = []
  const total = { rows_read: 0, rows_written: 0 }
  // Every database's pending set is judged before the first one applies.
  for (const [resource, names] of Object.entries(files)) {
    const done = applied[resource] || new Set()
    for (const name of done)
      if (!names.includes(name) && !isReviewedHistoricalMigration(resource, name, done))
        throw new Error(`COST_MIGRATION_HISTORY_DIVERGED: ${resource}`)
    const lastApplied = names.reduce((last, name, index) => (done.has(name) ? index : last), -1)
    names.forEach((name, index) => {
      if (done.has(name)) return
      if (index < lastApplied) throw new Error(`MIGRATION_OUT_OF_ORDER: ${resource}/${name}`)
      const key = `${resource}/${name}`
      const reviewed = manifest.migrations[key]
      if (!reviewed) throw new Error(`COST_MIGRATION_NOT_REVIEWED: ${key}`)
      if (reviewed.online !== true) throw new Error(`CODE_RELEASE_REQUIRES_MAINTENANCE: ${key}`)
      requirePrediction(reviewed.prediction, key)
      total.rows_read += reviewed.prediction.rows_read
      total.rows_written += reviewed.prediction.rows_written
      pending.push({ resource, name, key, guards: reviewed.guards || [] })
    })
  }
  return {
    pending,
    total,
    resources: [...new Set(pending.map((item) => item.resource))],
  }
}

export function admitOnlineMigrations({ total, usage }) {
  const read = usage?.rows_read
  const written = usage?.rows_written
  if (![read, written].every((value) => Number.isSafeInteger(value) && value >= 0))
    throw new Error("MIGRATION_USAGE_UNAVAILABLE")
  // Twice the prediction: the review is an estimate, the ceiling is not.
  if (read + 2 * total.rows_read > MIGRATION_READ_CEILING)
    throw new Error(`MIGRATION_HEADROOM: rows_read ${read} + 2x${total.rows_read}`)
  if (written + 2 * total.rows_written > MIGRATION_WRITE_CEILING)
    throw new Error(`MIGRATION_HEADROOM: rows_written ${written} + 2x${total.rows_written}`)
  return { read, written }
}

export async function checkMigrationGuards({ guards, query }) {
  for (const guard of guards) {
    if (typeof guard?.sql !== "string" || !Number.isSafeInteger(guard?.max))
      throw new Error(`MIGRATION_GUARD_INVALID: ${guard?.key}`)
    const value = await query(guard)
    if (!Number.isSafeInteger(value)) throw new Error(`MIGRATION_GUARD_UNAVAILABLE: ${guard.key}`)
    if (value > guard.max)
      throw new Error(`MIGRATION_GUARD_EXCEEDED: ${guard.key} (${value} > ${guard.max})`)
  }
}

function databaseIds() {
  const text = readFileSync(new URL(CONFIG, ROOT), "utf8")
  // The top-level (production) blocks come before any [env.*] section.
  const production = text.split(/\n\[env\./)[0]
  const ids = new Map()
  for (const block of production.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|$)/g) || []) {
    const name = block.match(/^database_name\s*=\s*"([^"]+)"/m)?.[1]
    const id = block.match(/^database_id\s*=\s*"([a-f0-9-]+)"/m)?.[1]
    if (name && id) ids.set(name, id)
  }
  return ids
}

async function d1Query({ accountId, token, databaseId, sql }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
      signal: AbortSignal.timeout(15_000),
    },
  )
  const payload = await response.json().catch(() => null)
  const result = payload?.result?.[0]
  if (
    !response.ok ||
    !payload?.success ||
    result?.success === false ||
    !Array.isArray(result?.results)
  )
    throw new Error("MIGRATION_D1_QUERY_FAILED")
  return result.results
}

async function readApplied({ accountId, token, ids }) {
  const applied = {}
  for (const resource of Object.keys(ONLINE_MIGRATION_DATABASES)) {
    const rows = await d1Query({
      accountId,
      token,
      databaseId: ids.get(resource),
      sql: "SELECT name FROM d1_migrations ORDER BY id LIMIT 1024",
    })
    applied[resource] = new Set(rows.map((row) => String(row.name)))
  }
  return applied
}

function sourceFiles() {
  return Object.fromEntries(
    Object.entries(ONLINE_MIGRATION_DATABASES).map(([resource, directory]) => [
      resource,
      readdirSync(new URL(directory + "/", ROOT))
        .filter((name) => name.endsWith(".sql"))
        .sort(),
    ]),
  )
}

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID
  const token = process.env.CLOUDFLARE_API_TOKEN
  if (!/^[a-f0-9]{32}$/.test(accountId || "") || !token)
    throw new Error("MIGRATION_CREDENTIALS_REQUIRED")
  const manifest = JSON.parse(
    readFileSync(new URL("cloudflare/operation-cost-migration-plan.json", ROOT), "utf8"),
  )
  const ids = databaseIds()
  const plan = planOnlineMigrations({
    manifest,
    files: sourceFiles(),
    applied: await readApplied({ accountId, token, ids }),
  })
  if (!plan.pending.length || process.argv.includes("--plan-only")) {
    console.log(
      JSON.stringify({ pending: plan.pending.map((item) => item.key), total: plan.total }),
    )
    return
  }
  const usage = await createOperationCostAccountUsageReader({
    accountId,
    token: process.env.CLOUDFLARE_BUDGET_ANALYTICS_TOKEN,
  }).refresh()
  const admitted = admitOnlineMigrations({ total: plan.total, usage })
  await checkMigrationGuards({
    guards: plan.pending.flatMap((item) =>
      item.guards.map((guard) => ({ ...guard, key: item.key, resource: item.resource })),
    ),
    query: async (guard) => {
      const rows = await d1Query({
        accountId,
        token,
        databaseId: ids.get(guard.resource),
        sql: guard.sql,
      })
      return Number(Object.values(rows[0] || {})[0])
    },
  })
  for (const resource of plan.resources) {
    execFileSync(
      "pnpm",
      ["exec", "wrangler", "d1", "migrations", "apply", resource, "--remote", "--config", CONFIG],
      { stdio: "inherit", env: { ...process.env, CI: "1" } },
    )
  }
  const after = await readApplied({ accountId, token, ids })
  const missing = plan.pending.filter((item) => !after[item.resource].has(item.name))
  if (missing.length)
    throw new Error(`MIGRATION_NOT_JOURNALED: ${missing.map((item) => item.key).join(", ")}`)
  console.log(
    JSON.stringify({
      applied: plan.pending.map((item) => item.key),
      predicted: plan.total,
      usage_before: admitted,
    }),
  )
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
