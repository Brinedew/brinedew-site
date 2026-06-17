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

const DURABLE_OBJECT_INVOCATIONS_QUERY = `query IconoplasmDOInvocations($accountTag: string, $startDate: Date, $endDate: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      durableObjectsInvocationsAdaptiveGroups(
        limit: 1000
        filter: { date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
          scriptName
        }
        sum {
          requests
          errors
        }
      }
    }
  }
}`

// Chesterton's fence:
// The DO write ceiling that broke live traffic is not a design flourish.
// Cloudflare's free-tier SQLite-backed Durable Objects really do clamp at
// 100,000 rows_written per day. Keep this number loud in the baked snapshot so
// the admin can show the real wall instead of drifting back into vague totals.
const DURABLE_OBJECT_ROWS_WRITTEN_DAILY_LIMIT = 100000

const DURABLE_OBJECT_PERIODIC_QUERY = `query IconoplasmDOPeriodic($accountTag: string, $startDate: Date, $endDate: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      durableObjectsPeriodicGroups(
        limit: 1000
        filter: { date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
        }
        sum {
          rowsRead
          rowsWritten
          storageReadUnits
          storageWriteUnits
          activeTime
          cpuTime
          subrequests
        }
      }
    }
  }
}`

const PLATFORM_USAGE_QUERY = `query IconoplasmPlatformUsage($accountTag: string, $startDate: Date, $endDate: Date) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(
        limit: 10000
        filter: { date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
          scriptName
          status
        }
        sum {
          requests
          errors
          subrequests
          cpuTimeUs
          responseBodySize
        }
      }
      kvOperationsAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
          actionType
          namespaceId
          result
        }
        sum {
          requests
          objectBytes
        }
        count
      }
      kvStorageAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
          namespaceId
        }
        max {
          byteCount
          keyCount
        }
      }
      queueMessageOperationsAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
          actionType
          outcome
          queueId
        }
        sum {
          billableOperations
          bytes
        }
        avg {
          lagTime
          retryCount
        }
        count
      }
      queueBacklogAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
          queueId
        }
        avg {
          messages
          bytes
        }
      }
      pagesFunctionsInvocationsAdaptiveGroups(
        limit: 10000
        filter: { date_geq: $startDate, date_leq: $endDate }
        orderBy: [date_ASC]
      ) {
        dimensions {
          date
          scriptName
          status
        }
        sum {
          requests
          errors
          subrequests
          responseBodySize
        }
      }
    }
  }
}`

const DURABLE_OBJECT_CLASS_NAMES = [
  "IconoplasmVoteCoordinator",
  "IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate",
]
const WORKERS_OBSERVABILITY_DAILY_LIMIT_EVENTS = 200000

function parseArgs(argv) {
  let envName = "production"
  for (let index = 2; index < argv.length; index += 1) {
    const arg = String(argv[index] || "")
    if (arg === "--env") {
      envName = String(argv[index + 1] || "production")
        .trim()
        .toLowerCase()
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

function optionalEnv(name) {
  return String(process.env[name] || "").trim()
}

function requireEnv(name) {
  const value = optionalEnv(name)
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

function isoDatePlusDays(baseDate, days) {
  const date = new Date(`${String(baseDate || "")}T00:00:00.000Z`)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`Invalid ISO date for offset: ${baseDate}`)
  }
  date.setUTCDate(date.getUTCDate() + Number(days || 0))
  return date.toISOString().slice(0, 10)
}

function dashboardLink(accountId, toPath) {
  return `https://dash.cloudflare.com/?to=/${accountId}${toPath}`
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10)
}

function utcMonthDays(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate()
}

function clampedBillingDay(year, monthIndex, billingDayOfMonth) {
  const requested = Math.max(1, Number(billingDayOfMonth || 1) || 1)
  return Math.min(requested, utcMonthDays(year, monthIndex))
}

function cycleBoundaryForMonth(year, monthIndex, billingDayOfMonth) {
  return new Date(
    Date.UTC(year, monthIndex, clampedBillingDay(year, monthIndex, billingDayOfMonth), 0, 0, 0, 0),
  )
}

function currentBillingCycle(nowInput, billingDayOfMonth) {
  const now = new Date(nowInput)
  now.setUTCHours(0, 0, 0, 0)
  let cycleStart = cycleBoundaryForMonth(now.getUTCFullYear(), now.getUTCMonth(), billingDayOfMonth)
  if (now.getTime() < cycleStart.getTime()) {
    cycleStart = cycleBoundaryForMonth(
      now.getUTCFullYear(),
      now.getUTCMonth() - 1,
      billingDayOfMonth,
    )
  }
  const nextCycleStart = cycleBoundaryForMonth(
    cycleStart.getUTCFullYear(),
    cycleStart.getUTCMonth() + 1,
    billingDayOfMonth,
  )
  return {
    cycleKey: isoDate(cycleStart),
    cycleStartDate: isoDate(cycleStart),
    cycleEndDate: isoDate(now),
    nextCycleStartDate: isoDate(nextCycleStart),
    daysRemainingInCycle: Math.max(
      1,
      Math.ceil((nextCycleStart.getTime() - now.getTime()) / 86400000),
    ),
  }
}

function smartDailyLimit(monthlyRemainingAtStartOfDay, daysRemainingInCycle, burstMultiplier) {
  const remaining = Math.max(0, Number(monthlyRemainingAtStartOfDay || 0) || 0)
  const daysRemaining = Math.max(1, Number(daysRemainingInCycle || 1) || 1)
  const burst = Math.max(1, Number(burstMultiplier || 1) || 1)
  if (remaining <= 0) return 0
  const baseAllowance = Math.ceil(remaining / daysRemaining)
  return Math.min(remaining, Math.max(baseAllowance, Math.ceil(baseAllowance * burst)))
}

async function loadWranglerConfig(rootDir, envName) {
  const configPath = path.join(
    rootDir,
    "wrangler.the-only-allowed-internal-stateful-worker-do-not-duplicate.toml",
  )
  const parsed = toml.parse(await readFile(configPath, "utf8"))
  const envConfig = envName === "staging" ? parsed.env?.staging || {} : {}
  const d1Bindings =
    envName === "staging" ? envConfig.d1_databases || [] : parsed.d1_databases || []
  const iconoplasmDb = d1Bindings.find((entry) => entry.binding === "ICONOPLASM_DB")
  if (!iconoplasmDb?.database_id) {
    throw new Error(`Could not find ICONOPLASM_DB database_id for ${envName}`)
  }
  const vars = envName === "staging" ? envConfig.vars || {} : parsed.vars || {}
  return {
    scriptName: String(envName === "staging" ? envConfig.name : parsed.name),
    databaseId: String(iconoplasmDb.database_id),
    databaseName: String(iconoplasmDb.database_name || "iconoplasm"),
    billingCycleDayOfMonth: asNumber(
      vars.ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_DO_NOT_SET_CASUALLY,
    ),
    dailyBurstMultiplier: asNumber(vars.ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_DO_NOT_SET_CASUALLY),
    rowsReadHardMonthlyBudget: asNumber(
      vars.ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY,
    ),
    rowsWrittenHardMonthlyBudget: asNumber(
      vars.ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY,
    ),
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
  if (!response.ok || (Array.isArray(payload?.errors) && payload.errors.length)) {
    throw new Error(`Cloudflare GraphQL query failed: ${JSON.stringify(payload, null, 2)}`)
  }
  return payload
}

function unixMsAtUtcDateStart(dateInput) {
  const value = new Date(`${String(dateInput || "")}T00:00:00.000Z`)
  if (!Number.isFinite(value.getTime())) throw new Error(`Invalid UTC date input: ${dateInput}`)
  return value.getTime()
}

async function callWorkersObservabilityTelemetryQuery({ apiToken, accountId, body }) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/observability/telemetry/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  )
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(
      `Workers Observability query failed (${response.status}): ${JSON.stringify(payload, null, 2)}`,
    )
  }
  if (payload?.success === false) {
    throw new Error(
      `Workers Observability API reported failure: ${JSON.stringify(payload, null, 2)}`,
    )
  }
  return payload?.result || {}
}

function outcomeClassFromHttpStatus(statusInput) {
  const status = Math.trunc(asNumber(statusInput))
  if (status >= 500) return "server_error"
  if (status >= 400) return "client_error"
  if (status >= 200 && status < 400) return "ok"
  return "unknown"
}

function observabilityCalculation(result, alias) {
  const calculations = Array.isArray(result?.calculations) ? result.calculations : []
  return calculations.find((entry) => String(entry?.alias || entry?.calculation || "") === alias)
}

function observabilityCalculationTotal(result, alias) {
  const calculation = observabilityCalculation(result, alias)
  const firstAggregate = Array.isArray(calculation?.aggregates) ? calculation.aggregates[0] : null
  return asNumber(firstAggregate?.value ?? firstAggregate?.count)
}

function observabilityGroupedCalculationRows(result, alias) {
  const calculation = observabilityCalculation(result, alias)
  return (Array.isArray(calculation?.aggregates) ? calculation.aggregates : []).map((aggregate) => {
    const groups = Object.create(null)
    for (const group of Array.isArray(aggregate?.groups) ? aggregate.groups : []) {
      const key = String(group?.key || "")
      groups[key] = group?.value
      const shortKey = key.split(".").pop()
      if (shortKey) groups[shortKey] = group?.value
    }
    return {
      groups,
      groupKey: String(aggregate?.groupKey || ""),
      value: asNumber(aggregate?.value ?? aggregate?.count),
    }
  })
}

function observabilityDailySeries(result, alias) {
  const calculation = observabilityCalculation(result, alias)
  const series = Array.isArray(calculation?.series) ? calculation.series : []
  return series
    .map((bucket) => {
      const data = Array.isArray(bucket?.data) ? bucket.data : []
      const value = data.reduce((sum, item) => sum + asNumber(item?.value ?? item?.count), 0)
      return { date: String(bucket?.time || "").slice(0, 10), value }
    })
    .filter((row) => row.date)
}

async function fetchBudgetAttributionSnapshot({ apiToken, accountId, config, d1 }) {
  const cycleStart = unixMsAtUtcDateStart(d1.cycleStartDate)
  const cycleEnd = unixMsAtUtcDateStart(d1.cycleEndDate)
  const nextCycleStart = unixMsAtUtcDateStart(d1.nextCycleStartDate)
  const currentDayEnd = unixMsAtUtcDateStart(isoDatePlusDays(d1.cycleEndDate, 1))
  const serviceFilter = {
    key: "$metadata.service",
    operation: "eq",
    type: "string",
    value: config.scriptName,
  }
  const routeFilter = { key: "route", operation: "exists", type: "string" }
  const baseParameters = {
    datasets: ["cloudflare-workers"],
    filterCombination: "and",
    filters: [serviceFilter, routeFilter],
    calculations: [{ operator: "count", alias: "request_count" }],
  }
  const queryBody = ({ from, to, groupBys = [], limit = 100, orderBy = null }) => ({
    queryId: "iconoplasm-route-attribution",
    timeframe: { from, to },
    view: "calculations",
    dry: true,
    limit,
    parameters: {
      ...baseParameters,
      ...(groupBys.length ? { groupBys } : {}),
      ...(orderBy ? { orderBy } : {}),
    },
  })

  let cycleTotalsResult = null
  let currentDayResult = null
  let topRequestRouteResult = null
  let sqlError = null
  try {
    ;[cycleTotalsResult, currentDayResult, topRequestRouteResult] = await Promise.all([
      callWorkersObservabilityTelemetryQuery({
        apiToken,
        accountId,
        body: queryBody({ from: cycleStart, to: nextCycleStart, limit: 1 }),
      }),
      callWorkersObservabilityTelemetryQuery({
        apiToken,
        accountId,
        body: queryBody({ from: cycleEnd, to: currentDayEnd, limit: 1 }),
      }),
      callWorkersObservabilityTelemetryQuery({
        apiToken,
        accountId,
        body: queryBody({
          from: cycleStart,
          to: nextCycleStart,
          limit: 24,
          groupBys: [
            { type: "string", value: "route" },
            { type: "number", value: "status" },
          ],
          orderBy: { value: "request_count", order: "desc" },
        }),
      }),
    ])
  } catch (error) {
    sqlError = error instanceof Error ? error.message : String(error)
  }

  if (sqlError) {
    return {
      available: false,
      backend: "cloudflare_workers_observability",
      dataset: "cloudflare-workers",
      note: `Cloudflare Workers Observability route attribution is unavailable in this bake because the telemetry query failed: ${sqlError}`,
      currentDay: null,
      cycleTotals: null,
      cycleTopRoutes: [],
      cycleTopRequestRoutes: [],
    }
  }

  const cycleRequestCount = observabilityCalculationTotal(cycleTotalsResult, "request_count")
  const currentDayRequestCount = observabilityCalculationTotal(currentDayResult, "request_count")
  const topRequestRoutes = observabilityGroupedCalculationRows(
    topRequestRouteResult,
    "request_count",
  ).map((row) => {
    const status = asNumber(row.groups.status)
    return {
      routeFamily: String(row.groups.route || row.groupKey || ""),
      budgetClass: "",
      actorClass: "",
      sourceClass: "workers_observability",
      outcomeClass: outcomeClassFromHttpStatus(status),
      requestCount: asNumber(row.value),
      rowsRead: 0,
      rowsWritten: 0,
      queryCount: 0,
      responseStatus: status,
      latestAt: null,
    }
  })
  return {
    available: true,
    backend: "cloudflare_workers_observability",
    dataset: "cloudflare-workers",
    note: "Route attribution is baked from Cloudflare Workers Observability logs. The Worker writes structured route fields; the admin page reads the query result out of band so the live admin page does not create telemetry load.",
    dailyLimitDataPointsWritten: WORKERS_OBSERVABILITY_DAILY_LIMIT_EVENTS,
    currentDay: {
      date: d1.cycleEndDate,
      rowsRead: 0,
      rowsWritten: 0,
      queryCount: 0,
      requestCount: currentDayRequestCount,
      targetCapReachedEvents: 0,
      telemetryLockedEvents: 0,
    },
    cycleTotals: {
      rowsRead: 0,
      rowsWritten: 0,
      queryCount: 0,
      requestCount: cycleRequestCount,
      targetCapReachedEvents: 0,
      telemetryLockedEvents: 0,
    },
    cycleTopRoutes: topRequestRoutes,
    cycleTopRequestRoutes: topRequestRoutes,
  }
}

async function fetchWorkersObservabilitySnapshot({ apiToken, accountId, config, d1 }) {
  const startDate = isoDateDaysAgo(LOOKBACK_DAYS - 1)
  const from = unixMsAtUtcDateStart(startDate)
  const todayStart = unixMsAtUtcDateStart(d1.cycleEndDate)
  const tomorrowStart = unixMsAtUtcDateStart(isoDatePlusDays(d1.cycleEndDate, 1))
  const serviceFilter = {
    key: "$metadata.service",
    operation: "eq",
    type: "string",
    value: config.scriptName,
  }
  const body = ({ fromMs, toMs, chart = false }) => ({
    queryId: "iconoplasm-workers-observability-events",
    timeframe: { from: fromMs, to: toMs },
    view: "calculations",
    dry: true,
    chart,
    granularity: 86400000,
    limit: 1,
    parameters: {
      datasets: ["cloudflare-workers"],
      filterCombination: "and",
      filters: [serviceFilter],
      calculations: [{ operator: "count", alias: "event_count" }],
    },
  })
  try {
    const [currentDayResult, dailyResult] = await Promise.all([
      callWorkersObservabilityTelemetryQuery({
        apiToken,
        accountId,
        body: body({ fromMs: todayStart, toMs: tomorrowStart }),
      }),
      callWorkersObservabilityTelemetryQuery({
        apiToken,
        accountId,
        body: body({ fromMs: from, toMs: tomorrowStart, chart: true }),
      }),
    ])
    return {
      available: true,
      backend: "cloudflare_workers_observability",
      dataset: "cloudflare-workers",
      note: "Workers Observability event counts are queried out of band from Cloudflare's telemetry API.",
      dailyLimitEvents: WORKERS_OBSERVABILITY_DAILY_LIMIT_EVENTS,
      currentDay: {
        date: d1.cycleEndDate,
        eventCount: observabilityCalculationTotal(currentDayResult, "event_count"),
      },
      daily: observabilityDailySeries(dailyResult, "event_count").map((row) => ({
        date: row.date,
        eventCount: row.value,
        eventLimit: WORKERS_OBSERVABILITY_DAILY_LIMIT_EVENTS,
      })),
    }
  } catch (error) {
    return {
      available: false,
      backend: "cloudflare_workers_observability",
      dataset: "cloudflare-workers",
      note: `Workers Observability event usage is unavailable in this bake: ${
        error instanceof Error ? error.message : String(error)
      }`,
      dailyLimitEvents: WORKERS_OBSERVABILITY_DAILY_LIMIT_EVENTS,
      currentDay: null,
      daily: [],
    }
  }
}

function firstAccount(payload) {
  const account = payload?.data?.viewer?.accounts?.[0]
  if (!account) {
    throw new Error(
      `Cloudflare GraphQL response did not include an account payload: ${JSON.stringify(payload, null, 2)}`,
    )
  }
  return account
}

function sortedDailyRows(map) {
  return Object.values(map).sort((left, right) =>
    String(left.date).localeCompare(String(right.date)),
  )
}

function sumDaily(rows, fields) {
  return (Array.isArray(rows) ? rows : []).reduce((totals, row) => {
    for (const field of fields) totals[field] = asNumber(totals[field]) + asNumber(row?.[field])
    return totals
  }, {})
}

async function fetchPlatformUsageSnapshot({ apiToken, accountId, startDate, endDate }) {
  const payload = await callGraphQL(apiToken, PLATFORM_USAGE_QUERY, {
    accountTag: accountId,
    startDate,
    endDate,
  })
  const account = firstAccount(payload)
  const workerDays = Object.create(null)
  for (const row of Array.isArray(account.workersInvocationsAdaptive)
    ? account.workersInvocationsAdaptive
    : []) {
    const date = String(row?.dimensions?.date || "")
    if (!date) continue
    const target = (workerDays[date] ||= {
      date,
      requests: 0,
      errors: 0,
      subrequests: 0,
      cpuTimeUs: 0,
      responseBodySize: 0,
      scripts: Object.create(null),
      statuses: Object.create(null),
    })
    target.requests += asNumber(row?.sum?.requests)
    target.errors += asNumber(row?.sum?.errors)
    target.subrequests += asNumber(row?.sum?.subrequests)
    target.cpuTimeUs += asNumber(row?.sum?.cpuTimeUs)
    target.responseBodySize += asNumber(row?.sum?.responseBodySize)
    const script = String(row?.dimensions?.scriptName || "unknown")
    const status = String(row?.dimensions?.status || "unknown")
    target.scripts[script] = asNumber(target.scripts[script]) + asNumber(row?.sum?.requests)
    target.statuses[status] = asNumber(target.statuses[status]) + asNumber(row?.sum?.requests)
  }

  const kvDays = Object.create(null)
  for (const row of Array.isArray(account.kvOperationsAdaptiveGroups)
    ? account.kvOperationsAdaptiveGroups
    : []) {
    const date = String(row?.dimensions?.date || "")
    if (!date) continue
    const action = String(row?.dimensions?.actionType || "unknown").toLowerCase()
    const target = (kvDays[date] ||= {
      date,
      requests: 0,
      readRequests: 0,
      writeRequests: 0,
      listRequests: 0,
      deleteRequests: 0,
      objectBytes: 0,
      operations: Object.create(null),
    })
    const requests = asNumber(row?.sum?.requests || row?.count)
    target.requests += requests
    target.objectBytes += asNumber(row?.sum?.objectBytes)
    target.operations[action] = asNumber(target.operations[action]) + requests
    if (action.includes("read")) target.readRequests += requests
    else if (action.includes("write")) target.writeRequests += requests
    else if (action.includes("list")) target.listRequests += requests
    else if (action.includes("delete")) target.deleteRequests += requests
  }
  const kvStorageRows = Array.isArray(account.kvStorageAdaptiveGroups)
    ? account.kvStorageAdaptiveGroups
    : []
  const kvLatestStorage = kvStorageRows.reduce((latest, row) => {
    const date = String(row?.dimensions?.date || "")
    if (!date || date < String(latest?.date || "")) return latest
    return {
      date,
      byteCount: asNumber(row?.max?.byteCount),
      keyCount: asNumber(row?.max?.keyCount),
      namespaceId: String(row?.dimensions?.namespaceId || ""),
    }
  }, null)

  const queueDays = Object.create(null)
  for (const row of Array.isArray(account.queueMessageOperationsAdaptiveGroups)
    ? account.queueMessageOperationsAdaptiveGroups
    : []) {
    const date = String(row?.dimensions?.date || "")
    if (!date) continue
    const action = String(row?.dimensions?.actionType || "unknown")
    const outcome = String(row?.dimensions?.outcome || "unknown")
    const target = (queueDays[date] ||= {
      date,
      billableOperations: 0,
      bytes: 0,
      messages: 0,
      failedOperations: 0,
      dlqOperations: 0,
      avgLagTime: 0,
      avgRetryCount: 0,
      samples: 0,
      actions: Object.create(null),
      outcomes: Object.create(null),
    })
    const operations = asNumber(row?.sum?.billableOperations || row?.count)
    target.billableOperations += operations
    target.bytes += asNumber(row?.sum?.bytes)
    target.messages += asNumber(row?.count)
    target.actions[action] = asNumber(target.actions[action]) + operations
    target.outcomes[outcome] = asNumber(target.outcomes[outcome]) + operations
    if (outcome === "fail") target.failedOperations += operations
    if (outcome === "dlq") target.dlqOperations += operations
    target.avgLagTime += asNumber(row?.avg?.lagTime)
    target.avgRetryCount += asNumber(row?.avg?.retryCount)
    target.samples += 1
  }
  for (const row of Array.isArray(account.queueBacklogAdaptiveGroups)
    ? account.queueBacklogAdaptiveGroups
    : []) {
    const date = String(row?.dimensions?.date || "")
    if (!date) continue
    const target = (queueDays[date] ||= {
      date,
      billableOperations: 0,
      bytes: 0,
      messages: 0,
      failedOperations: 0,
      dlqOperations: 0,
      avgLagTime: 0,
      avgRetryCount: 0,
      samples: 0,
      actions: {},
      outcomes: {},
    })
    target.backlogMessages = Math.max(
      asNumber(target.backlogMessages),
      asNumber(row?.avg?.messages),
    )
    target.backlogBytes = Math.max(asNumber(target.backlogBytes), asNumber(row?.avg?.bytes))
  }
  for (const row of Object.values(queueDays)) {
    row.avgLagTime = row.samples > 0 ? roundMetric(row.avgLagTime / row.samples) : 0
    row.avgRetryCount = row.samples > 0 ? roundMetric(row.avgRetryCount / row.samples) : 0
  }

  const pagesDays = Object.create(null)
  for (const row of Array.isArray(account.pagesFunctionsInvocationsAdaptiveGroups)
    ? account.pagesFunctionsInvocationsAdaptiveGroups
    : []) {
    const date = String(row?.dimensions?.date || "")
    if (!date) continue
    const target = (pagesDays[date] ||= {
      date,
      requests: 0,
      errors: 0,
      subrequests: 0,
      responseBodySize: 0,
    })
    target.requests += asNumber(row?.sum?.requests)
    target.errors += asNumber(row?.sum?.errors)
    target.subrequests += asNumber(row?.sum?.subrequests)
    target.responseBodySize += asNumber(row?.sum?.responseBodySize)
  }

  const workersDaily = sortedDailyRows(workerDays)
  const kvDaily = sortedDailyRows(kvDays)
  const queuesDaily = sortedDailyRows(queueDays)
  const pagesFunctionsDaily = sortedDailyRows(pagesDays)
  return {
    workers: {
      dailyLimitRequests: 100000,
      currentDay: workersDaily[workersDaily.length - 1] || null,
      totals: sumDaily(workersDaily, [
        "requests",
        "errors",
        "subrequests",
        "cpuTimeUs",
        "responseBodySize",
      ]),
      daily: workersDaily,
    },
    kv: {
      dailyLimitReads: 100000,
      dailyLimitWritesListsDeletes: 1000,
      currentDay: kvDaily[kvDaily.length - 1] || null,
      totals: sumDaily(kvDaily, [
        "requests",
        "readRequests",
        "writeRequests",
        "listRequests",
        "deleteRequests",
        "objectBytes",
      ]),
      storage: kvLatestStorage,
      daily: kvDaily,
    },
    queues: {
      dailyLimitBillableOperations: 10000,
      currentDay: queuesDaily[queuesDaily.length - 1] || null,
      totals: sumDaily(queuesDaily, [
        "billableOperations",
        "bytes",
        "messages",
        "failedOperations",
        "dlqOperations",
      ]),
      daily: queuesDaily,
    },
    pagesFunctions: {
      currentDay: pagesFunctionsDaily[pagesFunctionsDaily.length - 1] || null,
      totals: sumDaily(pagesFunctionsDaily, [
        "requests",
        "errors",
        "subrequests",
        "responseBodySize",
      ]),
      daily: pagesFunctionsDaily,
    },
  }
}

async function fetchD1Snapshot({ apiToken, accountId, config }) {
  const cycle = currentBillingCycle(new Date(), config.billingCycleDayOfMonth)
  const variables = {
    accountTag: accountId,
    databaseId: config.databaseId,
    startDate: cycle.cycleStartDate,
    endDate: cycle.cycleEndDate,
  }
  const [analyticsPayload, storagePayload] = await Promise.all([
    callGraphQL(apiToken, D1_DAILY_QUERY, variables),
    callGraphQL(apiToken, D1_STORAGE_QUERY, variables),
  ])
  const analyticsAccount = firstAccount(analyticsPayload)
  const storageAccount = firstAccount(storagePayload)
  const rawDaily = Array.isArray(analyticsAccount.d1AnalyticsAdaptiveGroups)
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
  let cycleRowsReadBeforeDay = 0
  let cycleRowsWrittenBeforeDay = 0
  const cycleDaily = rawDaily.map((row) => {
    const dayStartMs = Date.parse(`${row.date}T00:00:00.000Z`)
    const nextCycleStartMs = Date.parse(`${cycle.nextCycleStartDate}T00:00:00.000Z`)
    const daysRemainingInCycle =
      Number.isFinite(dayStartMs) && Number.isFinite(nextCycleStartMs)
        ? Math.max(1, Math.ceil((nextCycleStartMs - dayStartMs) / 86400000))
        : 1
    const rowsReadDailySmartLimit =
      config.rowsReadHardMonthlyBudget > 0
        ? smartDailyLimit(
            config.rowsReadHardMonthlyBudget - cycleRowsReadBeforeDay,
            daysRemainingInCycle,
            config.dailyBurstMultiplier,
          )
        : null
    const rowsWrittenDailySmartLimit =
      config.rowsWrittenHardMonthlyBudget > 0
        ? smartDailyLimit(
            config.rowsWrittenHardMonthlyBudget - cycleRowsWrittenBeforeDay,
            daysRemainingInCycle,
            config.dailyBurstMultiplier,
          )
        : null
    cycleRowsReadBeforeDay += row.rowsRead
    cycleRowsWrittenBeforeDay += row.rowsWritten
    return {
      ...row,
      daysRemainingInCycle,
      rowsReadDailySmartLimit,
      rowsWrittenDailySmartLimit,
      rowsReadDailyRemaining:
        rowsReadDailySmartLimit == null
          ? null
          : Math.max(0, rowsReadDailySmartLimit - row.rowsRead),
      rowsWrittenDailyRemaining:
        rowsWrittenDailySmartLimit == null
          ? null
          : Math.max(0, rowsWrittenDailySmartLimit - row.rowsWritten),
    }
  })
  const cycleTotalsBase = cycleDaily.reduce(
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
  const elapsedCycleDays = Math.max(
    1,
    Math.floor(
      (Date.parse(`${cycle.cycleEndDate}T00:00:00.000Z`) -
        Date.parse(`${cycle.cycleStartDate}T00:00:00.000Z`)) /
        86400000,
    ) + 1,
  )
  const expectedWindowDays = Math.min(LOOKBACK_DAYS, elapsedCycleDays)
  const daily = cycleDaily.slice(-expectedWindowDays)
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
  const currentDayRow = cycleDaily.find((row) => row.date === cycle.cycleEndDate) || null
  const currentDayRowsRead = asNumber(currentDayRow?.rowsRead)
  const currentDayRowsWritten = asNumber(currentDayRow?.rowsWritten)
  const cycleRowsReadBeforeToday = Math.max(0, cycleTotalsBase.rowsRead - currentDayRowsRead)
  const cycleRowsWrittenBeforeToday = Math.max(
    0,
    cycleTotalsBase.rowsWritten - currentDayRowsWritten,
  )
  const currentDayRowsReadDailySmartLimit =
    config.rowsReadHardMonthlyBudget > 0
      ? smartDailyLimit(
          config.rowsReadHardMonthlyBudget - cycleRowsReadBeforeToday,
          cycle.daysRemainingInCycle,
          config.dailyBurstMultiplier,
        )
      : null
  const currentDayRowsWrittenDailySmartLimit =
    config.rowsWrittenHardMonthlyBudget > 0
      ? smartDailyLimit(
          config.rowsWrittenHardMonthlyBudget - cycleRowsWrittenBeforeToday,
          cycle.daysRemainingInCycle,
          config.dailyBurstMultiplier,
        )
      : null
  const storageRow = Array.isArray(storageAccount.d1StorageAdaptiveGroups)
    ? storageAccount.d1StorageAdaptiveGroups[0] || null
    : null
  return {
    cycleKey: cycle.cycleKey,
    cycleStartDate: cycle.cycleStartDate,
    cycleEndDate: cycle.cycleEndDate,
    nextCycleStartDate: cycle.nextCycleStartDate,
    daysRemainingInCycle: cycle.daysRemainingInCycle,
    rollingWindowDays: LOOKBACK_DAYS,
    expectedWindowDays,
    lastDailyBucket: daily.length ? daily[daily.length - 1] : null,
    currentDay: {
      date: cycle.cycleEndDate,
      readQueries: asNumber(currentDayRow?.readQueries),
      writeQueries: asNumber(currentDayRow?.writeQueries),
      rowsRead: currentDayRowsRead,
      rowsWritten: currentDayRowsWritten,
      queryBatchResponseBytes: asNumber(currentDayRow?.queryBatchResponseBytes),
      rowsReadDailySmartLimit: currentDayRowsReadDailySmartLimit,
      rowsWrittenDailySmartLimit: currentDayRowsWrittenDailySmartLimit,
      rowsReadDailyRemaining:
        currentDayRowsReadDailySmartLimit == null
          ? null
          : Math.max(0, currentDayRowsReadDailySmartLimit - currentDayRowsRead),
      rowsWrittenDailyRemaining:
        currentDayRowsWrittenDailySmartLimit == null
          ? null
          : Math.max(0, currentDayRowsWrittenDailySmartLimit - currentDayRowsWritten),
      covered: Boolean(currentDayRow),
    },
    periodTotals,
    cycleTotals: {
      ...cycleTotalsBase,
      rowsReadMonthlyLimit: config.rowsReadHardMonthlyBudget || null,
      rowsWrittenMonthlyLimit: config.rowsWrittenHardMonthlyBudget || null,
      rowsReadMonthlyRemaining:
        config.rowsReadHardMonthlyBudget > 0
          ? Math.max(0, config.rowsReadHardMonthlyBudget - cycleTotalsBase.rowsRead)
          : null,
      rowsWrittenMonthlyRemaining:
        config.rowsWrittenHardMonthlyBudget > 0
          ? Math.max(0, config.rowsWrittenHardMonthlyBudget - cycleTotalsBase.rowsWritten)
          : null,
    },
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

async function fetchDurableObjectSnapshot({
  apiToken,
  accountId,
  scriptName,
  classNames,
  startDate,
  endDate,
}) {
  const [invocationsPayload, periodicPayload] = await Promise.all([
    callGraphQL(apiToken, DURABLE_OBJECT_INVOCATIONS_QUERY, {
      accountTag: accountId,
      startDate,
      endDate,
    }),
    callGraphQL(apiToken, DURABLE_OBJECT_PERIODIC_QUERY, {
      accountTag: accountId,
      startDate,
      endDate,
    }),
  ])
  const invocationsAccount = firstAccount(invocationsPayload)
  const periodicAccount = firstAccount(periodicPayload)
  const invocationRows = (
    Array.isArray(invocationsAccount.durableObjectsInvocationsAdaptiveGroups)
      ? invocationsAccount.durableObjectsInvocationsAdaptiveGroups
      : []
  )
    .map((row) => ({
      date: String(row?.dimensions?.date || ""),
      scriptName: String(row?.dimensions?.scriptName || ""),
      requests: asNumber(row?.sum?.requests),
      errors: asNumber(row?.sum?.errors),
    }))
    .filter((row) => row.scriptName === scriptName)
  const invocationDaySet = new Set()
  let totalRequests = 0
  let totalErrors = 0
  let lastInvocationDate = null
  invocationRows.forEach((row) => {
    if (row.requests > 0 || row.errors > 0) {
      invocationDaySet.add(row.date)
      lastInvocationDate =
        lastInvocationDate && lastInvocationDate > row.date ? lastInvocationDate : row.date
    }
    totalRequests += row.requests
    totalErrors += row.errors
  })

  const periodicByDate = new Map()
  ;(Array.isArray(periodicAccount.durableObjectsPeriodicGroups)
    ? periodicAccount.durableObjectsPeriodicGroups
    : []
  ).forEach((row) => {
    const date = String(row?.dimensions?.date || "")
    if (!date) return
    const existing = periodicByDate.get(date) || {
      date,
      rowsRead: 0,
      rowsWritten: 0,
      storageReadUnits: 0,
      storageWriteUnits: 0,
      activeTime: 0,
      cpuTime: 0,
      subrequests: 0,
    }
    existing.rowsRead += asNumber(row?.sum?.rowsRead)
    existing.rowsWritten += asNumber(row?.sum?.rowsWritten)
    existing.storageReadUnits += asNumber(row?.sum?.storageReadUnits)
    existing.storageWriteUnits += asNumber(row?.sum?.storageWriteUnits)
    existing.activeTime += asNumber(row?.sum?.activeTime)
    existing.cpuTime += asNumber(row?.sum?.cpuTime)
    existing.subrequests += asNumber(row?.sum?.subrequests)
    periodicByDate.set(date, existing)
  })

  const daily = []
  const cursor = new Date(`${startDate}T00:00:00.000Z`)
  const endCursor = new Date(`${endDate}T00:00:00.000Z`)
  while (cursor.getTime() <= endCursor.getTime()) {
    const date = cursor.toISOString().slice(0, 10)
    const base = periodicByDate.get(date) || {
      date,
      rowsRead: 0,
      rowsWritten: 0,
      storageReadUnits: 0,
      storageWriteUnits: 0,
      activeTime: 0,
      cpuTime: 0,
      subrequests: 0,
    }
    daily.push({
      ...base,
      rowsWrittenDailyLimit: DURABLE_OBJECT_ROWS_WRITTEN_DAILY_LIMIT,
      rowsWrittenDailyRemaining: Math.max(
        0,
        DURABLE_OBJECT_ROWS_WRITTEN_DAILY_LIMIT - base.rowsWritten,
      ),
      exhausted: base.rowsWritten >= DURABLE_OBJECT_ROWS_WRITTEN_DAILY_LIMIT,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }

  const periodTotals = daily.reduce(
    (totals, row) => ({
      rowsRead: totals.rowsRead + row.rowsRead,
      rowsWritten: totals.rowsWritten + row.rowsWritten,
      storageReadUnits: totals.storageReadUnits + row.storageReadUnits,
      storageWriteUnits: totals.storageWriteUnits + row.storageWriteUnits,
      activeTime: totals.activeTime + row.activeTime,
      cpuTime: totals.cpuTime + row.cpuTime,
      subrequests: totals.subrequests + row.subrequests,
    }),
    {
      rowsRead: 0,
      rowsWritten: 0,
      storageReadUnits: 0,
      storageWriteUnits: 0,
      activeTime: 0,
      cpuTime: 0,
      subrequests: 0,
    },
  )
  const currentDay = daily.find((row) => row.date === endDate) || null
  const peakDay = daily.reduce((best, row) => {
    if (!best) return row
    if (row.rowsWritten > best.rowsWritten) return row
    return best
  }, null)
  const daysAtDailyLimit = daily.reduce((count, row) => count + (row.exhausted ? 1 : 0), 0)
  const lastRowsWrittenDate = daily.reduce((latest, row) => {
    if (row.rowsWritten <= 0) return latest
    return latest && latest > row.date ? latest : row.date
  }, null)

  return {
    scriptName,
    classNames: Array.isArray(classNames) ? classNames : [],
    dailyLimitRowsWritten: DURABLE_OBJECT_ROWS_WRITTEN_DAILY_LIMIT,
    currentDay: currentDay
      ? {
          ...currentDay,
          covered: true,
        }
      : {
          date: endDate,
          rowsRead: 0,
          rowsWritten: 0,
          storageReadUnits: 0,
          storageWriteUnits: 0,
          activeTime: 0,
          cpuTime: 0,
          subrequests: 0,
          rowsWrittenDailyLimit: DURABLE_OBJECT_ROWS_WRITTEN_DAILY_LIMIT,
          rowsWrittenDailyRemaining: DURABLE_OBJECT_ROWS_WRITTEN_DAILY_LIMIT,
          exhausted: false,
          covered: false,
        },
    peakDay: peakDay
      ? {
          ...peakDay,
        }
      : null,
    totals: {
      requests: totalRequests,
      errors: totalErrors,
      activeDays: invocationDaySet.size,
      trackedClasses: Array.isArray(classNames) ? classNames.length : 0,
      lastActiveDate: lastInvocationDate,
      rowsRead: periodTotals.rowsRead,
      rowsWritten: periodTotals.rowsWritten,
      storageReadUnits: periodTotals.storageReadUnits,
      storageWriteUnits: periodTotals.storageWriteUnits,
      activeTime: periodTotals.activeTime,
      cpuTime: periodTotals.cpuTime,
      subrequests: periodTotals.subrequests,
      daysAtDailyLimit,
      lastRowsWrittenDate,
    },
    daily,
    classes: [],
  }
}

function buildAutomationState({ config, d1 }) {
  return {
    refreshCadenceHours: 1,
    deployBake: true,
    scheduledBake: true,
    runtimeTelemetryRequests: false,
    currentDayCovered: Boolean(d1.currentDay?.covered),
    filledWindowDays: Array.isArray(d1.daily) ? d1.daily.length : 0,
    rollingWindowDays: d1.expectedWindowDays || d1.rollingWindowDays,
    storageBucketPresent: Boolean(d1.storage?.observedAt),
    liveDetailLivesInCloudflare: true,
    graphQLUsesAdaptiveSampling: true,
    graphQLRateLimit: "300 queries per 5 minutes per user",
    note: `Cloudflare dashboard links stay live. The app runtime does not answer observability requests. ${config.databaseName} is refreshed out of band.`,
  }
}

function buildWorkerLimiterSnapshot({ config, d1 }) {
  const dailyRows = Array.isArray(d1?.daily)
    ? d1.daily.map((row) => ({
        date: String(row?.date || ""),
        rowsWritten: asNumber(row?.rowsWritten),
        rowsWrittenDailySmartLimit: asNumber(row?.rowsWrittenDailySmartLimit),
        rowsWrittenDailyRemaining: asNumber(row?.rowsWrittenDailyRemaining),
        exhausted:
          asNumber(row?.rowsWrittenDailySmartLimit) > 0
            ? asNumber(row?.rowsWritten) >= asNumber(row?.rowsWrittenDailySmartLimit)
            : false,
      }))
    : []
  const currentDay = d1?.currentDay || {}
  const cycleTotals = d1?.cycleTotals || {}
  const currentDayRowsWritten = asNumber(currentDay?.rowsWritten)
  const currentDayDailyLimit = asNumber(currentDay?.rowsWrittenDailySmartLimit)
  const currentDayDailyRemaining = asNumber(currentDay?.rowsWrittenDailyRemaining)
  const cycleRowsWritten = asNumber(cycleTotals?.rowsWritten)
  const cycleRowsWrittenLimit = asNumber(cycleTotals?.rowsWrittenMonthlyLimit)
  const cycleRowsWrittenRemaining = asNumber(cycleTotals?.rowsWrittenMonthlyRemaining)
  const peakDay = dailyRows.reduce((best, row) => {
    if (!best) return row
    return asNumber(row?.rowsWritten) > asNumber(best?.rowsWritten) ? row : best
  }, null)
  return {
    active: currentDayDailyLimit > 0 || cycleRowsWrittenLimit > 0,
    refreshCadenceHours: 1,
    budgetBasis: "d1_rows_written_daily_smart_limit",
    budgetBasisLabel: "Worker D1 mutation limiter",
    explanation:
      "This is the worker-side write limiter for admin mutation families. It is baked from Cloudflare D1 analytics plus the wrangler guardrail config, so operators can make launch decisions without hitting a request-path telemetry endpoint.",
    decision:
      currentDayDailyRemaining <= 0
        ? "Worker mutation writes are out of headroom today."
        : cycleRowsWrittenRemaining <= 0
          ? "Worker mutation writes are out of billing-cycle headroom."
          : `Worker mutation writes still have headroom today and in the current cycle.`,
    currentDay: {
      date: String(currentDay?.date || d1?.cycleEndDate || ""),
      rowsWritten: currentDayRowsWritten,
      rowsWrittenDailySmartLimit: currentDayDailyLimit,
      rowsWrittenDailyRemaining: currentDayDailyRemaining,
      exhausted: currentDayDailyLimit > 0 ? currentDayRowsWritten >= currentDayDailyLimit : false,
      covered: Boolean(currentDay?.covered),
    },
    cycleTotals: {
      rowsWritten: cycleRowsWritten,
      rowsWrittenMonthlyLimit: cycleRowsWrittenLimit,
      rowsWrittenMonthlyRemaining: cycleRowsWrittenRemaining,
      daysRemainingInCycle: asNumber(d1?.daysRemainingInCycle),
    },
    peakDay,
    totals: {
      activeDays: dailyRows.length,
      daysAtDailySmartLimit: dailyRows.filter((row) => Boolean(row?.exhausted)).length,
      rowsWritten: dailyRows.reduce((sum, row) => sum + asNumber(row?.rowsWritten), 0),
      lastRowsWrittenDate: dailyRows.length
        ? String(dailyRows[dailyRows.length - 1]?.date || "")
        : "",
    },
    guardrails: {
      billingCycleDayOfMonth: asNumber(config?.billingCycleDayOfMonth),
      dailyBurstMultiplier: asNumber(config?.dailyBurstMultiplier),
      rowsWrittenHardMonthlyBudget: asNumber(config?.rowsWrittenHardMonthlyBudget),
    },
    daily: dailyRows,
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
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const apiToken = optionalEnv("CLOUDFLARE_API_TOKEN")
  if (!apiToken) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN is required. It must be the account-owned iconoplasm-admin token; the observability snapshot generator does not fall back to Wrangler OAuth.",
    )
  }
  const accountId = optionalEnv("CLOUDFLARE_ACCOUNT_ID")
  if (!accountId) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID is required. The observability snapshot generator does not recover an account from Wrangler login.",
    )
  }
  const config = await loadWranglerConfig(rootDir, envName)
  const d1 = await fetchD1Snapshot({
    apiToken,
    accountId,
    config,
  })
  const durableObjects = await fetchDurableObjectSnapshot({
    apiToken,
    accountId,
    scriptName: config.scriptName,
    classNames: DURABLE_OBJECT_CLASS_NAMES,
    startDate: d1.cycleStartDate,
    endDate: d1.cycleEndDate,
  })
  const platform = await fetchPlatformUsageSnapshot({
    apiToken,
    accountId,
    startDate: d1.cycleStartDate,
    endDate: d1.cycleEndDate,
  })
  const workersObservability = await fetchWorkersObservabilitySnapshot({
    apiToken,
    accountId,
    config,
    d1,
  })
  const budgetAttribution = await fetchBudgetAttributionSnapshot({
    apiToken,
    accountId,
    config,
    d1,
  })
  const automation = buildAutomationState({ config, d1 })
  const workerLimiter = buildWorkerLimiterSnapshot({ config, d1 })
  // Chesterton's fence:
  // We retired the in-app /api/iconoplasm/admin/cost/usage path on purpose.
  // The admin must not hit telemetry routes, Durable Objects, or GraphQL at
  // page load just to explain observability to itself.
  //
  // This bake is the compromise: collect Cloudflare analytics out of band, then
  // ship enough concrete facts into the UI that operators can see accountability
  // at a glance without leaving the page. If this payload collapses back into
  // little more than dashboard links, the UI becomes vague and we recreate the
  // regression that motivated the refactor.
  //
  // GraphQL here is operational trend data, not billing truth. Keep billing
  // truth in Cloudflare Billing, but keep budget/attribution facts in this
  // snapshot so the UI does not devolve into link soup.
  const snapshot = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    environment: envName,
    source: {
      mode: "out_of_band_snapshot",
      analyticsTruth: "Cloudflare GraphQL analytics",
      billingTruth: "Cloudflare Billing dashboard",
      note: "The admin UI reads this baked snapshot instead of calling runtime telemetry endpoints.",
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
      cycleKey: d1.cycleKey,
      cycleStartDate: d1.cycleStartDate,
      cycleEndDate: d1.cycleEndDate,
      nextCycleStartDate: d1.nextCycleStartDate,
      daysRemainingInCycle: d1.daysRemainingInCycle,
      currentDay: d1.currentDay,
      cycleTotals: d1.cycleTotals,
      lastDailyBucket: d1.lastDailyBucket,
      rollingWindowDays: d1.rollingWindowDays,
      expectedWindowDays: d1.expectedWindowDays,
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
      bakedDurableObjectDailyTrend: true,
      bakedWorkersDailyTrend: platform.workers.daily.length > 0,
      bakedWorkersObservabilityDailyTrend: workersObservability.daily.length > 0,
      bakedKvDailyTrend: platform.kv.daily.length > 0,
      bakedQueuesDailyTrend: platform.queues.daily.length > 0,
      bakedPagesDailyTrend: platform.pagesFunctions.daily.length > 0,
      bakedLatency:
        d1.latency.avgQueryBatchTimeMs != null || d1.latency.p90QueryBatchTimeMs != null,
      bakedStorage: Boolean(d1.storage.observedAt),
      liveDurableObjectDrilldownOnly: false,
      freePlanQuotaTruthLivesInCloudflareProductDashboards: true,
    },
    automation,
    launchpad: [
      {
        label: "D1 metrics",
        href: dashboardLink(accountId, "/workers/d1"),
        note: "Final drilldown for D1 reads, writes, latency, and storage after the baked cycle summary raises a flag.",
      },
      {
        label: "Durable Objects metrics",
        href: dashboardLink(accountId, "/workers/durable-objects"),
        note: "Live Durable Object invocations, storage, and logs after the baked class summary tells you where to look.",
      },
      {
        label: "Workers & Pages usage",
        href: dashboardLink(accountId, "/workers-and-pages"),
        note: "Account-wide Worker requests, CPU time, observability events, and build minutes. This is a free-plan quota surface, not a spend page.",
      },
      {
        label: "Workers KV usage",
        href: dashboardLink(accountId, "/workers/kv/namespaces"),
        note: "KV reads, writes, deletes, lists, and storage. Missing this surface can hide extension-scale manifest or settings traffic.",
      },
      {
        label: "Queues usage",
        href: dashboardLink(accountId, "/workers/queues"),
        note: "Queue billable operations, queued messages, backlog, lag, and retry pressure.",
      },
      {
        label: "R2 status",
        href: dashboardLink(accountId, "/r2/overview"),
        note: "Currently a status check for this account because Iconoplasm portraits are on Bunny and R2 is not active in production bindings.",
      },
    ],
    budgetAttribution,
    workersObservability,
    workerLimiter,
    durableObjects,
    workers: platform.workers,
    kv: platform.kv,
    queues: platform.queues,
    pagesFunctions: platform.pagesFunctions,
  }
  await writeSnapshotFiles(rootDir, snapshot)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error))
  process.exit(1)
})
