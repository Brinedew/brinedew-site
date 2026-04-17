import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

import toml from "toml"

const GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql"
const LOOKBACK_DAYS = 14
const D1_DAILY_QUERY = `query IconoplasmD1Daily($accountTag: string, $databaseId: string, $startDate: Date, $endDate: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1AnalyticsAdaptiveGroups(
        limit: 1000
        filter: { databaseId: $databaseId, date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
        }
        sum {
          readQueries
          writeQueries
          rowsRead
          rowsWritten
          queryBatchResponseBytes
        }
        avg {
          queryBatchTimeMs
        }
        quantiles {
          queryBatchTimeMsP90
        }
      }
    }
  }
}`

const D1_STORAGE_QUERY = `query IconoplasmD1Storage($accountTag: string, $databaseId: string, $startDate: Date, $endDate: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      d1StorageAdaptiveGroups(
        limit: 1
        filter: { databaseId: $databaseId, date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_DESC]
      ) {
        dimensions {
          date
        }
        max {
          databaseSizeBytes
        }
      }
    }
  }
}`

const DURABLE_OBJECT_CLASS_NAMES = [
  "IconoplasmVoteCoordinator",
  "IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate",
]

function parseArgs(argv) {
  let envName = "production"
  for (let index = 2; index < argv.length; index += 1) {
    const arg = String(argv[index] || "")
    if (arg === "--env") {
      envName = String(argv[index + 1] || "production").trim().toLowerCase()
      index += 1
      continue
    }
    if (arg.startsWith("--env=")) {
      envName = arg.slice("--env=".length).trim().toLowerCase()
    }
  }
  if (envName !== "production" && envName !== "staging") {
    throw new Error(`Unsupported environment \"${envName}\". Use production or staging.`)
  }
  return { envName }
}

function requireEnv(name) {
  const value = String(process.env[name] || "").trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

function asNumber(value) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function avg(values) {
  const list = values.filter((value) => Number.isFinite(value))
  if (!list.length) return null
  const total = list.reduce((sum, value) => sum + value, 0)
  return total / list.length
}

function roundMetric(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null
}

function isoDateDaysAgo(daysAgo) {
  const date = new Date()
  date.setUTCHours(0, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() - daysAgo)
  return date.toISOString().slice(0, 10)
}

function dashboardLink(accountId, toPath) {
  return `https://dash.cloudflare.com/?to=/${accountId}${toPath}`
}

async function loadWranglerConfig(rootDir, envName) {
  const configPath = path.join(rootDir, "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml")
  const parsed = toml.parse(await readFile(configPath, "utf8"))
  const envConfig = envName === "staging" ? parsed.env?.staging || {} : {}
  const d1Bindings = envName === "staging" ? envConfig.d1_databases || [] : parsed.d1_databases || []
  const iconoplasmDb = d1Bindings.find((entry) => entry.binding === "ICONOPLASM_DB")
  if (!iconoplasmDb?.database_id) {
    throw new Error(`Could not find ICONOPLASM_DB database_id for ${envName}`)
  }
  const vars = envName === "staging" ? envConfig.vars || {} : parsed.vars || {}
  return {
    scriptName: String(envName === "staging" ? envConfig.name : parsed.name),
    databaseId: String(iconoplasmDb.database_id),
    databaseName: String(iconoplasmDb.database_name || "iconoplasm"),
    billingCycleDayOfMonth: asNumber(vars.ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_DO_NOT_SET_CASUALLY),
    dailyBurstMultiplier: asNumber(vars.ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_DO_NOT_SET_CASUALLY),
    rowsReadHardMonthlyBudget: asNumber(vars.ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY),
    rowsWrittenHardMonthlyBudget: asNumber(vars.ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY),
  }
}

async function callGraphQL(apiToken, query, variables) {
  const response = await fetch(GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  })
  const payload = await response.json()
  if (!response.ok || Array.isArray(payload?.errors) && payload.errors.length) {
    throw new Error(`Cloudflare GraphQL query failed: ${JSON.stringify(payload, null, 2)}`)
  }
  return payload
}

function firstAccount(payload) {
  const account = payload?.data?.viewer?.accounts?.[0]
  if (!account) {
    throw new Error(`Cloudflare GraphQL response did not include an account payload: ${JSON.stringify(payload, null, 2)}`)
  }
  return account
}

async function fetchD1Snapshot({ apiToken, accountId, databaseId }) {
  const startDate = isoDateDaysAgo(LOOKBACK_DAYS - 1)
  const endDate = isoDateDaysAgo(0)
  const variables = {
    accountTag: accountId,
    databaseId,
    startDate,
    endDate,
  }
  const [analyticsPayload, storagePayload] = await Promise.all([
    callGraphQL(apiToken, D1_DAILY_QUERY, variables),
    callGraphQL(apiToken, D1_STORAGE_QUERY, variables),
  ])
  const analyticsAccount = firstAccount(analyticsPayload)
  const storageAccount = firstAccount(storagePayload)
  const daily = Array.isArray(analyticsAccount.d1AnalyticsAdaptiveGroups)
    ? analyticsAccount.d1AnalyticsAdaptiveGroups.map((row) => ({
        date: String(row?.dimensions?.date || ""),
        readQueries: asNumber(row?.sum?.readQueries),
        writeQueries: asNumber(row?.sum?.writeQueries),
        rowsRead: asNumber(row?.sum?.rowsRead),
        rowsWritten: asNumber(row?.sum?.rowsWritten),
        queryBatchResponseBytes: asNumber(row?.sum?.queryBatchResponseBytes),
        avgQueryBatchTimeMs: roundMetric(asNumber(row?.avg?.queryBatchTimeMs)),
        p90QueryBatchTimeMs: roundMetric(asNumber(row?.quantiles?.queryBatchTimeMsP90)),
      }))
    : []
  const storageRow = Array.isArray(storageAccount.d1StorageAdaptiveGroups)
    ? storageAccount.d1StorageAdaptiveGroups[0] || null
    : null
  const periodTotals = daily.reduce(
    (totals, row) => ({
      readQueries: totals.readQueries + row.readQueries,
      writeQueries: totals.writeQueries + row.writeQueries,
      rowsRead: totals.rowsRead + row.rowsRead,
      rowsWritten: totals.rowsWritten + row.rowsWritten,
      queryBatchResponseBytes: totals.queryBatchResponseBytes + row.queryBatchResponseBytes,
    }),
    {
      readQueries: 0,
      writeQueries: 0,
      rowsRead: 0,
      rowsWritten: 0,
      queryBatchResponseBytes: 0,
    },
  )
  return {
    rollingWindowDays: LOOKBACK_DAYS,
    lastDailyBucket: daily.length ? daily[daily.length - 1] : null,
    periodTotals,
    latency: {
      avgQueryBatchTimeMs: roundMetric(avg(daily.map((row) => row.avgQueryBatchTimeMs))),
      p90QueryBatchTimeMs: roundMetric(avg(daily.map((row) => row.p90QueryBatchTimeMs))),
    },
    storage: {
      databaseSizeBytes: storageRow ? asNumber(storageRow?.max?.databaseSizeBytes) : null,
      observedAt: storageRow?.dimensions?.date || null,
    },
    daily,
  }
}

function buildAutomationState({ config, d1 }) {
  return {
    refreshCadenceHours: 1,
    deployBake: true,
    scheduledBake: true,
    runtimeTelemetryRequests: false,
    currentDayCovered: Boolean(d1.lastDailyBucket?.date) && d1.lastDailyBucket.date === isoDateDaysAgo(0),
    filledWindowDays: Array.isArray(d1.daily) ? d1.daily.length : 0,
    rollingWindowDays: d1.rollingWindowDays,
    storageBucketPresent: Boolean(d1.storage?.observedAt),
    liveDetailLivesInCloudflare: true,
    graphQLUsesAdaptiveSampling: true,
    graphQLRateLimit: "300 queries per 5 minutes per user",
    note: `Cloudflare dashboard links stay live. The app runtime does not answer observability requests. ${config.databaseName} is refreshed out of band.`,
  }
}

async function writeSnapshotFiles(rootDir, snapshot) {
  const generatedDir = path.join(rootDir, "workers", "generated")
  await mkdir(generatedDir, { recursive: true })
  const targetPath = path.join(generatedDir, "iconoplasm-observability-snapshot.js")
  const fileContents = [
    "// Generated by scripts/generate-iconoplasm-observability-snapshot.mjs. Do not hand edit.",
    `export const ICONOPLASM_OBSERVABILITY_SNAPSHOT = ${JSON.stringify(snapshot, null, 2)}`,
    "",
  ].join("\n")
  await writeFile(targetPath, fileContents, "utf8")
  console.log(`Wrote ${targetPath}`)
}

async function main() {
  const { envName } = parseArgs(process.argv)
  const apiToken = requireEnv("CLOUDFLARE_API_TOKEN")
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID")
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const config = await loadWranglerConfig(rootDir, envName)
  const d1 = await fetchD1Snapshot({
    apiToken,
    accountId,
    databaseId: config.databaseId,
  })
  const automation = buildAutomationState({ config, d1 })
  const snapshot = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    environment: envName,
    source: {
      mode: "out_of_band_snapshot",
      analyticsTruth: "Cloudflare GraphQL analytics",
      billingTruth: "Cloudflare Billing dashboard",
      note: "The admin UI reads this baked snapshot instead of calling a runtime cost endpoint.",
    },
    status: {
      level: d1.lastDailyBucket ? "ok" : "warning",
      headline: d1.lastDailyBucket ? "Snapshot ready" : "No D1 analytics buckets returned",
      detail: d1.lastDailyBucket
        ? "This view is baked from Cloudflare analytics outside the request path."
        : "Cloudflare returned no D1 analytics rows for the requested window.",
    },
    d1: {
      databaseId: config.databaseId,
      lastDailyBucket: d1.lastDailyBucket,
      rollingWindowDays: d1.rollingWindowDays,
      periodTotals: d1.periodTotals,
      latency: d1.latency,
      storage: d1.storage,
      daily: d1.daily,
    },
    guardrails: {
      billingCycleDayOfMonth: config.billingCycleDayOfMonth,
      dailyBurstMultiplier: config.dailyBurstMultiplier,
      rowsReadHardMonthlyBudget: config.rowsReadHardMonthlyBudget,
      rowsWrittenHardMonthlyBudget: config.rowsWrittenHardMonthlyBudget,
    },
    coverage: {
      bakedD1DailyTrend: true,
      bakedLatency: d1.latency.avgQueryBatchTimeMs != null || d1.latency.p90QueryBatchTimeMs != null,
      bakedStorage: Boolean(d1.storage.observedAt),
      liveDurableObjectDrilldownOnly: true,
      billingTruthLivesInCloudflare: true,
    },
    automation,
    launchpad: [
      {
        label: "D1 metrics",
        href: dashboardLink(accountId, "/workers/d1"),
        note: "Rows read, rows written, latency, and storage for the iconoplasm database.",
      },
      {
        label: "Durable Objects metrics",
        href: dashboardLink(accountId, "/workers/durable-objects"),
        note: "Live DO invocations, storage, and logs. Use class names below to drill into Iconoplasm.",
      },
      {
        label: "Billing usage",
        href: dashboardLink(accountId, "/billing"),
        note: "Final bill, usage alerts, and the place reality cashes the check.",
      },
    ],
    durableObjects: {
      scriptName: config.scriptName,
      classNames: DURABLE_OBJECT_CLASS_NAMES,
    },
  }
  await writeSnapshotFiles(rootDir, snapshot)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
