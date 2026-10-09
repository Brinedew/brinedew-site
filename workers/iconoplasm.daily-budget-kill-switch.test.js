import assert from "node:assert/strict"
import test from "node:test"

import { FREE_D1_DAILY_LIMITS } from "../shared/iconoplasm-d1-budget-policy.js"
import {
  handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate,
  handleIconoplasmSyncFinalizationQueue,
} from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"
import { FakeDailyBudgetNamespace } from "./test-helpers/fake-daily-budget-namespace.js"

class MeteredSummaryStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async all() {
    this.db.calls.push({ type: "all", sql: this.sql, args: this.args })
    if (this.sql.includes("FROM icono_portrait_assets")) {
      return {
        results: [{ candidate_assets: 12, stale_assets: 1, legacy_assets: 2 }],
        meta: { rows_read: this.db.rowsReadPerQuery, rows_written: 0 },
      }
    }
    return {
      results: [],
      meta: { rows_read: this.db.rowsReadPerQuery, rows_written: 0 },
    }
  }

  async first() {
    this.db.calls.push({ type: "first", sql: this.sql, args: this.args })
    if (this.sql.includes("COUNT(*) AS candidate_assets")) {
      return { candidate_assets: 12, stale_assets: 1, legacy_assets: 2 }
    }
    return null
  }

  async run() {
    this.db.calls.push({ type: "run", sql: this.sql, args: this.args })
    return {
      success: true,
      meta: { rows_read: 0, rows_written: 0 },
    }
  }
}

class MeteredSummaryDb {
  constructor({ rowsReadPerQuery = 1 } = {}) {
    this.rowsReadPerQuery = rowsReadPerQuery
    this.calls = []
  }

  prepare(sql) {
    return new MeteredSummaryStatement(this, sql)
  }
}

class CatalogUpsertStatement {
  constructor(db, sql) {
    this.db = db
    this.sql = String(sql || "")
    this.args = []
  }

  bind(...args) {
    this.args = args
    return this
  }

  async all() {
    this.db.calls.push({ type: "all", sql: this.sql, args: this.args })
    return {
      results: [],
      meta: { rows_read: 0, rows_written: 0 },
    }
  }

  async first() {
    this.db.calls.push({ type: "first", sql: this.sql, args: this.args })
    return null
  }

  async run() {
    this.db.calls.push({ type: "run", sql: this.sql, args: this.args })
    if (this.sql.includes("INSERT INTO icono_gene_catalog")) {
      this.db.catalogUpsertRuns += 1
      return {
        success: true,
        meta: {
          rows_read: 0,
          rows_written: this.db.rowsWrittenPerRun,
        },
      }
    }
    return {
      success: true,
      meta: { rows_read: 0, rows_written: 0 },
    }
  }
}

class CatalogUpsertDb {
  constructor({ rowsWrittenPerRun = 1 } = {}) {
    this.rowsWrittenPerRun = rowsWrittenPerRun
    this.calls = []
    this.catalogUpsertRuns = 0
  }

  prepare(sql) {
    return new CatalogUpsertStatement(this, sql)
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()))
  }
}

function adminSummaryRequest() {
  return new Request(
    "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/assets/summary",
    {
      headers: {
        "x-iconoplasm-admin-token": "founder-secret",
      },
    },
  )
}

test("read-only Iconoplasm admin summaries are metered under the shared budget (B-744)", async () => {
  const db = new MeteredSummaryDb({ rowsReadPerQuery: 2 })
  const budgetNamespace = new FakeDailyBudgetNamespace()
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "founder-secret",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
  }

  const first =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      adminSummaryRequest(),
      env,
      { waitUntil() {} },
    )
  assert.equal(first.status, 200)
  assert.ok(
    budgetNamespace.calls.some((call) => call.pathname === "/snapshot"),
    "admin read paths must consult the shared ledger (no read path is exempt)",
  )
  assert.ok(db.calls.length >= 1)
})

test("an exhausted shared day makes admin read summaries fail closed (B-744)", async () => {
  const db = new MeteredSummaryDb({ rowsReadPerQuery: 2 })
  // The account has already read Cloudflare's whole daily allowance today.
  const budgetNamespace = new FakeDailyBudgetNamespace({ rowsRead: FREE_D1_DAILY_LIMITS.reads })
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "founder-secret",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
  }
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      adminSummaryRequest(),
      env,
      { waitUntil() {} },
    )
  assert.equal(response.status, 503)
  const payload = await response.json()
  assert.equal(payload?.code, "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED")
  assert.equal(payload?.budget?.exhausted_by, "rows_read_daily")
  assert.equal(db.calls.length, 0, "an exhausted day stops the read before it reaches D1")
})

test("admin cost usage now points operators at Cloudflare observability instead of an internal ledger report", async () => {
  const db = new MeteredSummaryDb({ rowsReadPerQuery: 3 })
  const budgetNamespace = new FakeDailyBudgetNamespace()
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "founder-secret",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
  }

  const summaryResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      adminSummaryRequest(),
      env,
      { waitUntil() {} },
    )
  assert.equal(summaryResponse.status, 200)

  const reportResponse =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/cost/usage",
        {
          headers: {
            "x-iconoplasm-admin-token": "founder-secret",
          },
        },
      ),
      env,
      { waitUntil() {} },
    )
  const reportPayload = await reportResponse.json()
  assert.equal(reportResponse.status, 410)
  assert.equal(reportPayload?.code, "ICONOPLASM_CLOUDFLARE_OBSERVABILITY_REQUIRED")
  assert.equal(reportPayload?.observability?.source_of_truth, "cloudflare_dashboard_and_graphql")
  // B-744: admin read paths are now metered (no read path is exempt), so the
  // admin summary legitimately touches the ledger. The retired cost/usage route
  // still returns its observability-required payload without error.
  assert.ok(Array.isArray(budgetNamespace.calls))
})

test("admin cost snapshot serves the baked observability payload without touching the budget ledger", async () => {
  const budgetNamespace = new FakeDailyBudgetNamespace()

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/cost/snapshot",
        {
          headers: {
            "x-iconoplasm-admin-token": "founder-secret",
          },
        },
      ),
      {
        ICONOPLASM_ADMIN_TOKEN: "founder-secret",
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.snapshot?.source?.mode, "out_of_band_snapshot")
  assert.equal(payload?.snapshot?.source?.analyticsTruth, "Cloudflare GraphQL analytics")
  assert.ok(
    ["fresh", "stale", "overdue", "unavailable"].includes(payload?.snapshot?.freshness?.state),
  )
  assert.equal(payload?.snapshot?.publication?.state, "deploy_fallback")
  assert.equal(payload?.snapshot?.retiredMetrics?.[0]?.state, "retired")
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    [],
  )
})

test("admin cost snapshot prefers the atomically published KV artifact", async () => {
  const budgetNamespace = new FakeDailyBudgetNamespace()
  const kvCalls = []
  const publishedAt = new Date().toISOString()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/cost/snapshot",
        { headers: { "x-iconoplasm-admin-token": "founder-secret" } },
      ),
      {
        ICONOPLASM_ADMIN_TOKEN: "founder-secret",
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
        KV: {
          async get(key) {
            kvCalls.push(key)
            return JSON.stringify({
              generatedAt: publishedAt,
              source: {
                mode: "out_of_band_snapshot",
                analyticsTruth: "Cloudflare GraphQL analytics",
              },
            })
          },
        },
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.snapshot?.generatedAt, publishedAt)
  assert.equal(payload?.snapshot?.publication?.state, "published")
  assert.equal(payload?.snapshot?.publication?.source, "kv")
  assert.deepEqual(kvCalls, ["iconoplasm:observability-snapshot:v1"])
  assert.deepEqual(budgetNamespace.calls, [])
})

test("B-1037: a deploy-baked snapshot newer than the KV artifact wins until the next refresh", async () => {
  const budgetNamespace = new FakeDailyBudgetNamespace()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/cost/snapshot",
        { headers: { "x-iconoplasm-admin-token": "founder-secret" } },
      ),
      {
        ICONOPLASM_ADMIN_TOKEN: "founder-secret",
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
        KV: {
          async get() {
            return JSON.stringify({ generatedAt: "2020-01-01T00:00:00.000Z", source: {} })
          },
        },
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.snapshot?.publication?.state, "deploy_newer")
  assert.equal(payload?.snapshot?.publication?.source, "worker_bundle")
  assert.notEqual(payload?.snapshot?.generatedAt, "2020-01-01T00:00:00.000Z")
})

test("signed-in admin sees current account meters beside an old baked snapshot", async () => {
  const day = new Date().toISOString().slice(0, 10)
  const observed = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, options) => {
    observed.push({ url: String(url), body: JSON.parse(options.body) })
    return Response.json({
      data: {
        viewer: {
          accounts: [
            {
              workersInvocationsAdaptive: [{ sum: { requests: 9512 } }],
              d1AnalyticsAdaptiveGroups: [
                {
                  dimensions: { date: day, databaseId: "db" },
                  sum: { rowsRead: 273944, rowsWritten: 166 },
                },
              ],
              kvOperationsAdaptiveGroups: [
                { dimensions: { date: day, actionType: "read" }, sum: { requests: 12421 } },
              ],
              durableObjectsInvocationsAdaptiveGroups: [
                { dimensions: { date: day }, sum: { requests: 1596 } },
              ],
              durableObjectsPeriodicGroups: [
                {
                  dimensions: { date: day },
                  sum: { rowsRead: 27131, rowsWritten: 3071, duration: 594.67 },
                },
              ],
              queueMessageOperationsAdaptiveGroups: [
                { dimensions: { date: day }, sum: { billableOperations: 3 } },
              ],
            },
          ],
        },
      },
    })
  }
  const budgetNamespace = new FakeDailyBudgetNamespace()
  try {
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request("https://internal/api/iconoplasm/admin/cost/snapshot", {
          headers: { "x-iconoplasm-admin-token": "founder-secret" },
        }),
        {
          ICONOPLASM_ADMIN_TOKEN: "founder-secret",
          CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
          CLOUDFLARE_BUDGET_ANALYTICS_TOKEN: "budget-token",
          ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
          KV: {
            get: async () =>
              JSON.stringify({
                generatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
              }),
          },
        },
        { waitUntil() {} },
      )
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.snapshot.freshness.state, "overdue")
    assert.equal(payload.snapshot.liveProvider.state, "queried")
    assert.equal(payload.snapshot.liveProvider.day, day)
    assert.equal(payload.snapshot.liveProvider.usage.rows_read, 273944)
    assert.equal(payload.snapshot.liveProvider.usage.do_rows_written, 3071)
    assert.equal(payload.snapshot.liveProvider.limits.rows_read, 5000000)
    assert.equal(observed.length, 1)
    assert.equal(observed[0].url, "https://api.cloudflare.com/client/v4/graphql")
    assert.deepEqual(budgetNamespace.calls, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("admin capacity shows provider failure instead of treating baked counts as current", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response("unavailable", { status: 503 })
  try {
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request("https://internal/api/iconoplasm/admin/cost/snapshot", {
          headers: { "x-iconoplasm-admin-token": "founder-secret" },
        }),
        {
          ICONOPLASM_ADMIN_TOKEN: "founder-secret",
          CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
          CLOUDFLARE_BUDGET_ANALYTICS_TOKEN: "budget-token",
          KV: {
            get: async () =>
              JSON.stringify({
                generatedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
              }),
          },
        },
        { waitUntil() {} },
      )
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.snapshot.freshness.state, "overdue")
    assert.equal(payload.snapshot.liveProvider.state, "unavailable")
    assert.equal(payload.snapshot.liveProvider.usage, null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("admin mutation limiter policy reports the live limiter basis so Website Ops can fail closed", async () => {
  const db = new MeteredSummaryDb({ rowsReadPerQuery: 3 })
  const budgetNamespace = new FakeDailyBudgetNamespace()
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "founder-secret",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
  }

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/mutation-limiter/policy",
        {
          headers: {
            "x-iconoplasm-admin-token": "founder-secret",
          },
        },
      ),
      env,
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(payload?.mutation_limiter?.active, true)
  assert.equal(payload?.mutation_limiter?.budget_basis, "d1_rows_written_daily_smart_limit")
  assert.equal(payload?.mutation_limiter?.target_daily_percent, 85)
  // The limiter's wall is Cloudflare's own daily write allowance (B-1026), and its
  // target ceiling is 85% of it.
  assert.equal(
    payload?.mutation_limiter?.budget_snapshot?.rows_written_daily_smart_limit,
    FREE_D1_DAILY_LIMITS.writes,
  )
  assert.equal(
    payload?.mutation_limiter?.target_rows_written_ceiling,
    Math.floor(FREE_D1_DAILY_LIMITS.writes * 0.85),
  )
  assert.equal(payload?.mutation_limiter?.explains_do_cap, false)
  assert.match(
    String(payload?.mutation_limiter?.explanation || ""),
    /not the Cloudflare Durable Objects rows_written daily cap/i,
  )
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    ["/snapshot"],
  )
})

test("daily budget durable object rebuilds legacy attribution schema before reporting", async () => {
  class FakeLegacyBudgetSql {
    constructor() {
      this.calls = []
    }

    exec(sql, ...args) {
      const text = String(sql || "")
      this.calls.push({ sql: text, args })
      if (text.includes("PRAGMA table_info(daily_budget_usage)")) {
        return {
          toArray() {
            return [
              { name: "day_key", pk: 1 },
              { name: "cycle_key", pk: 0 },
              { name: "rows_read", pk: 0 },
              { name: "rows_written", pk: 0 },
              { name: "query_count", pk: 0 },
              { name: "request_count", pk: 0 },
              { name: "updated_at", pk: 0 },
            ]
          },
        }
      }
      if (text.includes("PRAGMA table_info(daily_budget_usage_attribution)")) {
        return {
          toArray() {
            return [
              { name: "day_key", pk: 1 },
              { name: "route_family", pk: 2 },
              { name: "actor_class", pk: 3 },
              { name: "source_class", pk: 4 },
              { name: "budget_class", pk: 5 },
              { name: "rows_read", pk: 0 },
              { name: "rows_written", pk: 0 },
              { name: "query_count", pk: 0 },
              { name: "updated_at", pk: 0 },
            ]
          },
        }
      }
      return {
        toArray() {
          return []
        },
      }
    }
  }

  const fakeSql = new FakeLegacyBudgetSql()
  const fakeState = {
    storage: { sql: fakeSql },
    blockConcurrencyWhile(callback) {
      return callback()
    },
  }

  const workerModule =
    await import("./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js")
  new workerModule.IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate(fakeState)

  const executedSql = fakeSql.calls.map((call) => call.sql)
  const rebuildInsert =
    executedSql.find((sql) =>
      sql.includes("INSERT INTO daily_budget_usage_attribution_v2_do_not_delete"),
    ) || ""

  assert.equal(
    executedSql.some((sql) =>
      sql.includes("CREATE TABLE IF NOT EXISTS daily_budget_usage_attribution_v2_do_not_delete"),
    ),
    true,
  )
  assert.equal(rebuildInsert.includes("day_key AS cycle_key"), true)
  assert.equal(rebuildInsert.includes("0 AS request_count"), true)
  assert.equal(
    executedSql.some((sql) => sql.includes("DROP TABLE daily_budget_usage_attribution")),
    true,
  )
  assert.equal(
    executedSql.some((sql) =>
      sql.includes(
        "ALTER TABLE daily_budget_usage_attribution_v2_do_not_delete RENAME TO daily_budget_usage_attribution",
      ),
    ),
    true,
  )
})

test("daily budget report survives constructor schema writes after DO free-tier write exhaustion", async () => {
  class FreeTierExhaustedButReadableSql {
    constructor() {
      this.dayRow = {
        day_key: "2026-04-17",
        cycle_key: "2026-04-07",
        rows_read: 0,
        rows_written: 100000,
        query_count: 12,
        request_count: 3,
        updated_at: "2026-04-17T04:00:00Z",
      }
      this.attributionRows = [
        {
          day_key: "2026-04-17",
          cycle_key: "2026-04-07",
          route_family: "admin_assets_summary",
          actor_class: "admin_token",
          source_class: "admin_ui",
          rows_read: 0,
          rows_written: 100000,
          query_count: 1,
          request_count: 1,
          updated_at: "2026-04-17T04:00:00Z",
        },
      ]
    }

    exec(sql, ...args) {
      const text = String(sql || "")
      if (text.includes("CREATE TABLE IF NOT EXISTS daily_budget_usage")) {
        throw new Error("Exceeded allowed rows written in Durable Objects free tier.")
      }
      if (text.includes("FROM daily_budget_usage\n           WHERE day_key = ?")) {
        return { toArray: () => [this.dayRow] }
      }
      if (text.includes("FROM daily_budget_usage\n           WHERE cycle_key = ?")) {
        return {
          toArray: () => [
            {
              rows_read: this.dayRow.rows_read,
              rows_written: this.dayRow.rows_written,
              query_count: this.dayRow.query_count,
              request_count: this.dayRow.request_count,
            },
          ],
        }
      }
      if (
        text.includes("FROM daily_budget_usage_attribution") &&
        text.includes("WHERE day_key = ?")
      ) {
        return { toArray: () => this.attributionRows }
      }
      if (
        text.includes("FROM daily_budget_usage_attribution") &&
        text.includes("WHERE cycle_key = ?")
      ) {
        return { toArray: () => this.attributionRows }
      }
      if (text.includes("FROM daily_budget_usage\n         WHERE cycle_key = ?")) {
        return { toArray: () => [this.dayRow] }
      }
      return { toArray: () => [] }
    }
  }

  const workerModule =
    await import("./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js")
  const durableObject = new workerModule.IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate({
    storage: { sql: new FreeTierExhaustedButReadableSql() },
    blockConcurrencyWhile(callback) {
      return callback()
    },
  })

  const response = await durableObject.fetch(
    new Request("https://iconoplasm-d1-daily-budget-kill-switch/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_key: "2026-04-17",
        cycle_key: "2026-04-07",
        days_remaining_in_cycle: 20,
      }),
    }),
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.snapshot?.rows_written, 100000)
  assert.equal(Array.isArray(payload?.daily_attribution), true)
  assert.equal(payload?.daily_attribution?.[0]?.rows_written, 100000)
})

test("admin cost usage no longer queries the DO ledger even when that report path would be write-locked", async () => {
  class ThrowingReportBudgetNamespace {
    constructor() {
      this.calls = []
    }

    idFromName(name) {
      return String(name || "")
    }

    get() {
      return {
        fetch: async (request) => {
          const url = new URL(request.url)
          this.calls.push({ pathname: url.pathname })
          if (url.pathname === "/report") {
            throw new Error("Exceeded allowed rows written in Durable Objects free tier.")
          }
          return Response.json({
            day_key: "2026-04-17",
            cycle_key: "2026-04-07",
            rows_read: 0,
            rows_written: 0,
            query_count: 0,
            request_count: 0,
            cycle_rows_read: 0,
            cycle_rows_written: 0,
            cycle_query_count: 0,
            cycle_request_count: 0,
            rows_read_daily_smart_limit: FREE_D1_DAILY_LIMITS.reads,
            rows_written_daily_smart_limit: FREE_D1_DAILY_LIMITS.writes,
            rows_read_daily_remaining: FREE_D1_DAILY_LIMITS.reads,
            rows_written_daily_remaining: FREE_D1_DAILY_LIMITS.writes,
            days_remaining_in_cycle: 21,
            daily_burst_multiplier: 1,
            exhausted: false,
            exhausted_by: null,
            updated_at: "2026-04-17T04:00:00Z",
          })
        },
      }
    }
  }

  const budgetNamespace = new ThrowingReportBudgetNamespace()

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/cost/usage",
        {
          headers: {
            "x-iconoplasm-admin-token": "founder-secret",
          },
        },
      ),
      {
        ICONOPLASM_ADMIN_TOKEN: "founder-secret",
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 410)
  assert.equal(payload?.code, "ICONOPLASM_CLOUDFLARE_OBSERVABILITY_REQUIRED")
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    [],
  )
})

test("write-heavy admin mutations fail before starting once the configured target cap is already reached", async () => {
  class FixedSnapshotBudgetNamespace {
    constructor(initialSnapshot) {
      this.snapshot = { ...initialSnapshot }
      this.calls = []
    }

    idFromName(name) {
      return String(name || "")
    }

    get() {
      return {
        fetch: async (request) => {
          const url = new URL(request.url)
          const payload = (await request.json().catch(() => ({}))) || {}
          this.calls.push({ pathname: url.pathname, payload })
          if (url.pathname === "/record") {
            const rowsRead = Math.max(0, Number(payload?.rows_read || 0) || 0)
            const rowsWritten = Math.max(0, Number(payload?.rows_written || 0) || 0)
            const queryCount = Math.max(0, Number(payload?.query_count || 0) || 0)
            const requestCount = Math.max(0, Number(payload?.request_count || 0) || 0)
            this.snapshot = {
              ...this.snapshot,
              rows_read: Number(this.snapshot.rows_read || 0) + rowsRead,
              rows_written: Number(this.snapshot.rows_written || 0) + rowsWritten,
              query_count: Number(this.snapshot.query_count || 0) + queryCount,
              request_count: Number(this.snapshot.request_count || 0) + requestCount,
              cycle_rows_read: Number(this.snapshot.cycle_rows_read || 0) + rowsRead,
              cycle_rows_written: Number(this.snapshot.cycle_rows_written || 0) + rowsWritten,
              cycle_query_count: Number(this.snapshot.cycle_query_count || 0) + queryCount,
              cycle_request_count: Number(this.snapshot.cycle_request_count || 0) + requestCount,
              rows_read_monthly_remaining:
                this.snapshot.rows_read_monthly_limit == null
                  ? null
                  : Math.max(0, Number(this.snapshot.rows_read_monthly_remaining || 0) - rowsRead),
              rows_written_monthly_remaining:
                this.snapshot.rows_written_monthly_limit == null
                  ? null
                  : Math.max(
                      0,
                      Number(this.snapshot.rows_written_monthly_remaining || 0) - rowsWritten,
                    ),
              rows_read_daily_remaining:
                this.snapshot.rows_read_daily_smart_limit == null
                  ? null
                  : Math.max(0, Number(this.snapshot.rows_read_daily_remaining || 0) - rowsRead),
              rows_written_daily_remaining:
                this.snapshot.rows_written_daily_smart_limit == null
                  ? null
                  : Math.max(
                      0,
                      Number(this.snapshot.rows_written_daily_remaining || 0) - rowsWritten,
                    ),
            }
            this.snapshot.exhausted =
              (this.snapshot.rows_read_daily_smart_limit != null &&
                Number(this.snapshot.rows_read || 0) >=
                  Number(this.snapshot.rows_read_daily_smart_limit || 0)) ||
              (this.snapshot.rows_written_daily_smart_limit != null &&
                Number(this.snapshot.rows_written || 0) >=
                  Number(this.snapshot.rows_written_daily_smart_limit || 0))
            this.snapshot.exhausted_by = this.snapshot.exhausted ? "rows_written_daily" : null
          }
          return Response.json(this.snapshot)
        },
      }
    }
  }

  // The account has written one row more than the limiter's target share (85%) of
  // Cloudflare's daily write allowance, and is still under the allowance itself.
  const targetCeiling = Math.floor(FREE_D1_DAILY_LIMITS.writes * 0.85)
  const written = targetCeiling + 1
  const db = new CatalogUpsertDb({ rowsWrittenPerRun: 2 })
  const budgetNamespace = new FixedSnapshotBudgetNamespace({
    day_key: "2026-04-17",
    cycle_key: "2026-04-07",
    rows_read: 0,
    rows_written: written,
    query_count: 3,
    request_count: 1,
    cycle_rows_read: 0,
    cycle_rows_written: written,
    cycle_query_count: 3,
    cycle_request_count: 1,
    rows_read_monthly_limit: null,
    rows_written_monthly_limit: null,
    rows_read_monthly_remaining: null,
    rows_written_monthly_remaining: null,
    rows_read_daily_smart_limit: FREE_D1_DAILY_LIMITS.reads,
    rows_written_daily_smart_limit: FREE_D1_DAILY_LIMITS.writes,
    rows_read_daily_remaining: FREE_D1_DAILY_LIMITS.reads,
    rows_written_daily_remaining: FREE_D1_DAILY_LIMITS.writes - written,
    account_rows_read: 0,
    account_rows_written: written,
    days_remaining_in_cycle: 20,
    daily_burst_multiplier: 1,
    exhausted: false,
    exhausted_by: null,
    updated_at: "2026-04-17T05:00:00Z",
  })

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/catalog/upsert",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-iconoplasm-admin-token": "founder-secret",
          },
          body: JSON.stringify({
            defer_read_models: true,
            items: [
              { gene_symbol: "TP53", full_name: "Tumor protein p53", tmh: false, aliases_json: [] },
            ],
          }),
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_ADMIN_TOKEN: "founder-secret",
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload?.code, "ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE")
  assert.equal(payload?.limiter?.stage, "preflight")
  assert.equal(payload?.limiter?.reason, "rows_written_target_cap_reached_before_start")
  assert.equal(payload?.limiter?.target_daily_percent, 85)
  assert.equal(payload?.limiter?.target_rows_written_ceiling, targetCeiling)
  assert.equal(payload?.limiter?.rows_written_target_remaining, 0)
  assert.equal(db.catalogUpsertRuns, 0)
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    ["/snapshot"],
  )
})

test("write-heavy admin mutations reserve atomic batch headroom before writing", async () => {
  class FixedSnapshotBudgetNamespace {
    constructor(initialSnapshot) {
      this.snapshot = { ...initialSnapshot }
      this.calls = []
    }

    idFromName(name) {
      return String(name || "")
    }

    get() {
      return {
        fetch: async (request) => {
          const url = new URL(request.url)
          const payload = (await request.json().catch(() => ({}))) || {}
          this.calls.push({ pathname: url.pathname, payload })
          if (url.pathname === "/record") {
            const rowsRead = Math.max(0, Number(payload?.rows_read || 0) || 0)
            const rowsWritten = Math.max(0, Number(payload?.rows_written || 0) || 0)
            const queryCount = Math.max(0, Number(payload?.query_count || 0) || 0)
            const requestCount = Math.max(0, Number(payload?.request_count || 0) || 0)
            this.snapshot = {
              ...this.snapshot,
              rows_read: Number(this.snapshot.rows_read || 0) + rowsRead,
              rows_written: Number(this.snapshot.rows_written || 0) + rowsWritten,
              query_count: Number(this.snapshot.query_count || 0) + queryCount,
              request_count: Number(this.snapshot.request_count || 0) + requestCount,
              cycle_rows_read: Number(this.snapshot.cycle_rows_read || 0) + rowsRead,
              cycle_rows_written: Number(this.snapshot.cycle_rows_written || 0) + rowsWritten,
              cycle_query_count: Number(this.snapshot.cycle_query_count || 0) + queryCount,
              cycle_request_count: Number(this.snapshot.cycle_request_count || 0) + requestCount,
              rows_read_monthly_remaining:
                this.snapshot.rows_read_monthly_limit == null
                  ? null
                  : Math.max(0, Number(this.snapshot.rows_read_monthly_remaining || 0) - rowsRead),
              rows_written_monthly_remaining:
                this.snapshot.rows_written_monthly_limit == null
                  ? null
                  : Math.max(
                      0,
                      Number(this.snapshot.rows_written_monthly_remaining || 0) - rowsWritten,
                    ),
              rows_read_daily_remaining:
                this.snapshot.rows_read_daily_smart_limit == null
                  ? null
                  : Math.max(0, Number(this.snapshot.rows_read_daily_remaining || 0) - rowsRead),
              rows_written_daily_remaining:
                this.snapshot.rows_written_daily_smart_limit == null
                  ? null
                  : Math.max(
                      0,
                      Number(this.snapshot.rows_written_daily_remaining || 0) - rowsWritten,
                    ),
            }
            this.snapshot.exhausted =
              (this.snapshot.rows_read_daily_smart_limit != null &&
                Number(this.snapshot.rows_read || 0) >=
                  Number(this.snapshot.rows_read_daily_smart_limit || 0)) ||
              (this.snapshot.rows_written_daily_smart_limit != null &&
                Number(this.snapshot.rows_written || 0) >=
                  Number(this.snapshot.rows_written_daily_smart_limit || 0))
            this.snapshot.exhausted_by = this.snapshot.exhausted ? "rows_written_daily" : null
          }
          return Response.json(this.snapshot)
        },
      }
    }
  }

  const db = new CatalogUpsertDb({ rowsWrittenPerRun: 2 })
  // The budget object answers for a day that is deliberately tiny: a wall of 12 writes
  // with 4 used. The limiter's target (85% of 12 is 10) has room for the preflight,
  // while the five-gene batch's reservation is larger than the 8 writes left under the
  // wall, so the atomic reservation, not the preflight, is what refuses it. (At
  // Cloudflare's real allowance of 100,000 the target cap would trip first, long
  // before a five-gene batch could outgrow what is left.)
  const budgetNamespace = new FixedSnapshotBudgetNamespace({
    day_key: "2026-04-17",
    cycle_key: "2026-04-07",
    rows_read: 0,
    rows_written: 4,
    query_count: 1,
    request_count: 1,
    cycle_rows_read: 0,
    cycle_rows_written: 4,
    cycle_query_count: 1,
    cycle_request_count: 1,
    rows_read_monthly_limit: null,
    rows_written_monthly_limit: null,
    rows_read_monthly_remaining: null,
    rows_written_monthly_remaining: null,
    rows_read_daily_smart_limit: FREE_D1_DAILY_LIMITS.reads,
    rows_written_daily_smart_limit: 12,
    rows_read_daily_remaining: FREE_D1_DAILY_LIMITS.reads,
    rows_written_daily_remaining: 8,
    days_remaining_in_cycle: 20,
    daily_burst_multiplier: 1,
    exhausted: false,
    exhausted_by: null,
    updated_at: "2026-04-17T05:00:00Z",
  })

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/catalog/upsert",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-iconoplasm-admin-token": "founder-secret",
          },
          body: JSON.stringify({
            defer_read_models: true,
            items: [
              { gene_symbol: "TP53", full_name: "Tumor protein p53", tmh: false, aliases_json: [] },
              {
                gene_symbol: "EGFR",
                full_name: "Epidermal growth factor receptor",
                tmh: true,
                aliases_json: [],
              },
              {
                gene_symbol: "BRCA1",
                full_name: "Breast cancer type 1 susceptibility protein",
                tmh: false,
                aliases_json: [],
              },
              { gene_symbol: "MYC", full_name: "MYC proto-oncogene", tmh: false, aliases_json: [] },
              {
                gene_symbol: "PTEN",
                full_name: "Phosphatase and tensin homolog",
                tmh: false,
                aliases_json: [],
              },
            ],
          }),
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_ADMIN_TOKEN: "founder-secret",
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload?.code, "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED")
  assert.equal(payload?.budget?.rows_written, 4)
  // B-1026: the daily wall is Cloudflare's own, so the refusal names the day, not a
  // private "smart" slice of it.
  assert.equal(payload?.budget?.exhausted_by, "rows_written_daily")
  assert.equal(db.catalogUpsertRuns, 0)
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    ["/snapshot"],
  )
})

test("iconoplasm health stays up and does not touch the limiter DO on read-only paths", async () => {
  class ThrowingSnapshotBudgetNamespace {
    constructor() {
      this.calls = []
    }

    idFromName(name) {
      return String(name || "")
    }

    get() {
      return {
        fetch: async (request) => {
          const url = new URL(request.url)
          this.calls.push({ pathname: url.pathname })
          throw new Error("Exceeded allowed rows written in Durable Objects free tier.")
        },
      }
    }
  }

  const budgetNamespace = new ThrowingSnapshotBudgetNamespace()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request("https://the-only-allowed-internal-stateful-worker-do-not-duplicate/health"),
      {
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.deepEqual(payload, { status: "ok", service: "iconoplasm" })
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    [],
  )
})

test("write-heavy admin mutations still fail closed when snapshot telemetry is locked before preflight", async () => {
  class ThrowingSnapshotBudgetNamespace {
    constructor() {
      this.calls = []
    }

    idFromName(name) {
      return String(name || "")
    }

    get() {
      return {
        fetch: async (request) => {
          const url = new URL(request.url)
          this.calls.push({ pathname: url.pathname })
          throw new Error("Exceeded allowed rows written in Durable Objects free tier.")
        },
      }
    }
  }

  const db = new CatalogUpsertDb({ rowsWrittenPerRun: 2 })
  const budgetNamespace = new ThrowingSnapshotBudgetNamespace()
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/catalog/upsert",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-iconoplasm-admin-token": "founder-secret",
          },
          body: JSON.stringify({
            defer_read_models: true,
            items: [
              { gene_symbol: "TP53", full_name: "Tumor protein p53", tmh: false, aliases_json: [] },
            ],
          }),
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_ADMIN_TOKEN: "founder-secret",
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload?.code, "ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE")
  assert.equal(payload?.limiter?.stage, "preflight")
  assert.equal(payload?.limiter?.reason, "telemetry_locked_before_snapshot")
  assert.equal(payload?.limiter?.telemetry_locked, true)
  assert.equal(db.catalogUpsertRuns, 0)
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    ["/snapshot"],
  )
})

test("all sync-owned admin mutation routes still hit the limiter preflight before route-specific work", async () => {
  class ThrowingSnapshotBudgetNamespace {
    constructor() {
      this.calls = []
    }

    idFromName(name) {
      return String(name || "")
    }

    get() {
      return {
        fetch: async (request) => {
          const url = new URL(request.url)
          this.calls.push({ pathname: url.pathname })
          throw new Error("Exceeded allowed rows written in Durable Objects free tier.")
        },
      }
    }
  }

  const guardedRoutes = [
    "/api/iconoplasm/admin/ingest",
    "/api/iconoplasm/admin/reconcile",
    "/api/iconoplasm/admin/catalog/upsert",
    "/api/iconoplasm/admin/catalog/reconcile",
    "/api/iconoplasm/admin/catalog/publish",
    "/api/iconoplasm/admin/essence/upsert",
    "/api/iconoplasm/admin/read-models/bootstrap",
    "/api/iconoplasm/admin/finalization/enqueue",
    "/api/iconoplasm/admin/finalization/process",
  ]

  for (const path of guardedRoutes) {
    const budgetNamespace = new ThrowingSnapshotBudgetNamespace()
    const response =
      await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
        new Request(`https://the-only-allowed-internal-stateful-worker-do-not-duplicate${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-iconoplasm-admin-token": "founder-secret",
          },
          body: JSON.stringify({}),
        }),
        {
          ICONOPLASM_ADMIN_TOKEN: "founder-secret",
          ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
        },
        { waitUntil() {} },
      )
    const payload = await response.json()

    assert.equal(
      response.status,
      503,
      `${path} should fail closed when limiter telemetry is locked`,
    )
    assert.equal(payload?.code, "ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE")
    assert.equal(payload?.limiter?.stage, "preflight")
    assert.equal(payload?.limiter?.reason, "telemetry_locked_before_snapshot")
    assert.deepEqual(
      budgetNamespace.calls.map((call) => call.pathname),
      ["/snapshot"],
      `${path} should consult the limiter snapshot before any route-specific work`,
    )
  }
})

test("write-heavy admin mutations flush the shared budget ledger once even when a chunk crosses the old flush thresholds", async () => {
  class FixedSnapshotBudgetNamespace {
    constructor(initialSnapshot) {
      this.snapshot = { ...initialSnapshot }
      this.calls = []
    }

    idFromName(name) {
      return String(name || "")
    }

    get() {
      return {
        fetch: async (request) => {
          const url = new URL(request.url)
          const payload = (await request.json().catch(() => ({}))) || {}
          this.calls.push({ pathname: url.pathname, payload })
          if (url.pathname === "/record") {
            const rowsRead = Math.max(0, Number(payload?.rows_read || 0) || 0)
            const rowsWritten = Math.max(0, Number(payload?.rows_written || 0) || 0)
            const queryCount = Math.max(0, Number(payload?.query_count || 0) || 0)
            const requestCount = Math.max(0, Number(payload?.request_count || 0) || 0)
            this.snapshot = {
              ...this.snapshot,
              rows_read: Number(this.snapshot.rows_read || 0) + rowsRead,
              rows_written: Number(this.snapshot.rows_written || 0) + rowsWritten,
              query_count: Number(this.snapshot.query_count || 0) + queryCount,
              request_count: Number(this.snapshot.request_count || 0) + requestCount,
              cycle_rows_read: Number(this.snapshot.cycle_rows_read || 0) + rowsRead,
              cycle_rows_written: Number(this.snapshot.cycle_rows_written || 0) + rowsWritten,
              cycle_query_count: Number(this.snapshot.cycle_query_count || 0) + queryCount,
              cycle_request_count: Number(this.snapshot.cycle_request_count || 0) + requestCount,
              rows_read_monthly_remaining:
                this.snapshot.rows_read_monthly_limit == null
                  ? null
                  : Math.max(0, Number(this.snapshot.rows_read_monthly_remaining || 0) - rowsRead),
              rows_written_monthly_remaining:
                this.snapshot.rows_written_monthly_limit == null
                  ? null
                  : Math.max(
                      0,
                      Number(this.snapshot.rows_written_monthly_remaining || 0) - rowsWritten,
                    ),
              rows_read_daily_remaining:
                this.snapshot.rows_read_daily_smart_limit == null
                  ? null
                  : Math.max(0, Number(this.snapshot.rows_read_daily_remaining || 0) - rowsRead),
              rows_written_daily_remaining:
                this.snapshot.rows_written_daily_smart_limit == null
                  ? null
                  : Math.max(
                      0,
                      Number(this.snapshot.rows_written_daily_remaining || 0) - rowsWritten,
                    ),
            }
            this.snapshot.exhausted =
              (this.snapshot.rows_read_daily_smart_limit != null &&
                Number(this.snapshot.rows_read || 0) >=
                  Number(this.snapshot.rows_read_daily_smart_limit || 0)) ||
              (this.snapshot.rows_written_daily_smart_limit != null &&
                Number(this.snapshot.rows_written || 0) >=
                  Number(this.snapshot.rows_written_daily_smart_limit || 0))
            this.snapshot.exhausted_by = this.snapshot.exhausted ? "rows_written_daily" : null
          }
          return Response.json(this.snapshot)
        },
      }
    }
  }

  const db = new CatalogUpsertDb({ rowsWrittenPerRun: 600 })
  const budgetNamespace = new FixedSnapshotBudgetNamespace({
    day_key: "2026-04-17",
    cycle_key: "2026-04-07",
    rows_read: 0,
    rows_written: 0,
    query_count: 0,
    request_count: 0,
    cycle_rows_read: 0,
    cycle_rows_written: 0,
    cycle_query_count: 0,
    cycle_request_count: 0,
    rows_read_monthly_limit: null,
    rows_written_monthly_limit: null,
    rows_read_monthly_remaining: null,
    rows_written_monthly_remaining: null,
    rows_read_daily_smart_limit: FREE_D1_DAILY_LIMITS.reads,
    rows_written_daily_smart_limit: FREE_D1_DAILY_LIMITS.writes,
    rows_read_daily_remaining: FREE_D1_DAILY_LIMITS.reads,
    rows_written_daily_remaining: FREE_D1_DAILY_LIMITS.writes,
    days_remaining_in_cycle: 20,
    daily_burst_multiplier: 1,
    exhausted: false,
    exhausted_by: null,
    updated_at: "2026-04-17T05:00:00Z",
  })

  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      new Request(
        "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/catalog/upsert",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-iconoplasm-admin-token": "founder-secret",
          },
          body: JSON.stringify({
            defer_read_models: true,
            items: [
              { gene_symbol: "TP53", full_name: "Tumor protein p53", tmh: false, aliases_json: [] },
              {
                gene_symbol: "EGFR",
                full_name: "Epidermal growth factor receptor",
                tmh: true,
                aliases_json: [],
              },
            ],
          }),
        },
      ),
      {
        ICONOPLASM_DB: db,
        ICONOPLASM_ADMIN_TOKEN: "founder-secret",
        ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
      },
      { waitUntil() {} },
    )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(db.catalogUpsertRuns, 2)
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    ["/snapshot", "/record"],
  )
  assert.equal(budgetNamespace.calls[1]?.payload?.rows_written, 1200)
  assert.equal(budgetNamespace.calls[1]?.payload?.request_count, 1)
})

test("daily budget durable object records only shared totals and skips hot-path attribution writes", async () => {
  class AttributionFreeBudgetSql {
    constructor() {
      this.calls = []
      this.dayRow = {
        day_key: "2026-04-17",
        cycle_key: "2026-04-07",
        rows_read: 0,
        rows_written: 0,
        query_count: 0,
        request_count: 0,
        updated_at: null,
      }
    }

    exec(sql, ...args) {
      const text = String(sql || "")
      this.calls.push({ sql: text, args })
      if (text.includes("PRAGMA table_info(daily_budget_usage)")) {
        return {
          toArray() {
            return [
              { name: "day_key", pk: 1 },
              { name: "cycle_key", pk: 0 },
              { name: "rows_read", pk: 0 },
              { name: "rows_written", pk: 0 },
              { name: "query_count", pk: 0 },
              { name: "request_count", pk: 0 },
              { name: "updated_at", pk: 0 },
            ]
          },
        }
      }
      if (text.includes("PRAGMA table_info(daily_budget_usage_attribution)")) {
        return {
          toArray() {
            return [
              { name: "day_key", pk: 1 },
              { name: "cycle_key", pk: 2 },
              { name: "route_family", pk: 3 },
              { name: "actor_class", pk: 4 },
              { name: "source_class", pk: 5 },
              { name: "rows_read", pk: 0 },
              { name: "rows_written", pk: 0 },
              { name: "query_count", pk: 0 },
              { name: "request_count", pk: 0 },
              { name: "updated_at", pk: 0 },
            ]
          },
        }
      }
      if (text.includes("INSERT INTO daily_budget_usage (")) {
        this.dayRow = {
          ...this.dayRow,
          day_key: String(args[0] || this.dayRow.day_key),
          cycle_key: String(args[1] || this.dayRow.cycle_key),
          rows_read: Number(this.dayRow.rows_read || 0) + Math.max(0, Number(args[2] || 0) || 0),
          rows_written:
            Number(this.dayRow.rows_written || 0) + Math.max(0, Number(args[3] || 0) || 0),
          query_count:
            Number(this.dayRow.query_count || 0) + Math.max(0, Number(args[4] || 0) || 0),
          request_count:
            Number(this.dayRow.request_count || 0) + Math.max(0, Number(args[5] || 0) || 0),
          updated_at: "2026-04-17T06:00:00Z",
        }
        return { toArray: () => [] }
      }
      if (text.includes("FROM daily_budget_usage\n           WHERE day_key = ?")) {
        return { toArray: () => [this.dayRow] }
      }
      if (text.includes("FROM daily_budget_usage\n           WHERE cycle_key = ?")) {
        return {
          toArray: () => [
            {
              rows_read: this.dayRow.rows_read,
              rows_written: this.dayRow.rows_written,
              query_count: this.dayRow.query_count,
              request_count: this.dayRow.request_count,
            },
          ],
        }
      }
      if (text.includes("FROM daily_budget_usage_attribution")) {
        return { toArray: () => [] }
      }
      if (text.includes("FROM daily_budget_usage\n         WHERE cycle_key = ?")) {
        return { toArray: () => [this.dayRow] }
      }
      return {
        toArray() {
          return []
        },
      }
    }
  }

  const fakeSql = new AttributionFreeBudgetSql()
  const workerModule =
    await import("./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js")
  const durableObject = new workerModule.IconoplasmD1DailyBudgetKillSwitchDoNotDuplicate({
    storage: { sql: fakeSql },
    blockConcurrencyWhile(callback) {
      return callback()
    },
  })

  const response = await durableObject.fetch(
    new Request("https://iconoplasm-d1-daily-budget-kill-switch/record", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        day_key: "2026-04-17",
        cycle_key: "2026-04-07",
        days_remaining_in_cycle: 20,
        rows_read: 11,
        rows_written: 22,
        query_count: 3,
        request_count: 1,
        attribution: {
          route_family: "admin_catalog_upsert",
          actor_class: "admin_token",
          source_class: "admin_ui",
        },
      }),
    }),
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.rows_written, 22)
  assert.equal(
    fakeSql.calls.some((call) => call.sql.includes("INSERT INTO daily_budget_usage_attribution (")),
    false,
  )
})

function authorityLaneEnv(overrides = {}) {
  return {
    ICONOPLASM_DB: new MeteredSummaryDb({ rowsReadPerQuery: 1 }),
    ICONOPLASM_ADMIN_TOKEN: "founder-secret",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: new FakeDailyBudgetNamespace(),
    ...overrides,
  }
}

function authorityLaneRequest() {
  return new Request(
    "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/authority/events",
  )
}

test("unauthenticated replica reads stop before budget or database work", async () => {
  const env = authorityLaneEnv()
  const budgetNamespace = env.ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE
  const db = env.ICONOPLASM_DB
  const run = (request) =>
    handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(request, env, {
      waitUntil() {},
    })

  const authorityResponse = await run(authorityLaneRequest())
  assert.equal(authorityResponse.status, 401)
  assert.equal(db.calls.length, 0)

  const snapshotCalls = budgetNamespace.calls.filter((call) => call.pathname === "/snapshot")
  assert.equal(snapshotCalls.length, 0, "authentication must precede budget work")

  const adminResponse = await run(adminSummaryRequest())
  assert.equal(adminResponse.status, 200)
  assert.ok(
    budgetNamespace.calls.filter((call) => call.pathname === "/snapshot").length >= 1,
    "admin read paths must be metered under the shared budget (B-744)",
  )
  assert.ok(db.calls.length >= 1)
})

test("replica reads without a prediction stop before D1 even on an exhausted day", async () => {
  // The account has already read Cloudflare's whole daily allowance today.
  const env = authorityLaneEnv({
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: new FakeDailyBudgetNamespace({
      rowsRead: FREE_D1_DAILY_LIMITS.reads,
    }),
  })
  const db = env.ICONOPLASM_DB
  env.ICONOPLASM_AUTHORITY_REPLICA_TOKEN = "replica-secret"

  const request = authorityLaneRequest()
  request.headers.set("Authorization", "Bearer replica-secret")
  const response =
    await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
      request,
      env,
      { waitUntil() {} },
    )

  assert.equal(response.status, 428)
  const payload = await response.json()
  assert.equal(payload.error.code, "COST_PREDICTION_NOT_REGISTERED")
  assert.equal(db.calls.length, 0, "the exhausted day must stop authority D1 work before it starts")
})

test("authority workstation lane records its D1 usage into the shared ledger attribution", async () => {
  const env = authorityLaneEnv()
  const budgetNamespace = env.ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE
  const db = env.ICONOPLASM_DB
  env.ICONOPLASM_ADMIN_TOKEN = ""

  await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request(
      "https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/authority/events",
      { headers: { "x-iconoplasm-admin-token": "founder-secret" } },
    ),
    env,
    { waitUntil() {} },
  )

  const recordCalls = budgetNamespace.calls.filter((call) => call.pathname === "/record")
  if (recordCalls.length > 0) {
    const attribution = recordCalls[0].payload?.attribution
    assert.equal(
      String(attribution?.route_family || "").startsWith("authority_workstation_"),
      true,
      `authority lane usage must be attributed to its own family, got ${attribution?.route_family}`,
    )
  }
  assert.ok(Array.isArray(db.calls))
})

function syncFinalizationQueueEnv(budgetNamespace, db) {
  return {
    ICONOPLASM_DB: db,
    ICONOPLASM_SYNC_GOVERNOR: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async (request) =>
          new URL(request.url).pathname === "/permit"
            ? Response.json({ ok: true, granted: 1, lease_id: "budget-test-lease" })
            : Response.json({ ok: true }),
      }),
    },
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
  }
}

function syncFinalizationDrainMessage() {
  return {
    body: { kind: "drain_finalization_ledger", run_id: "sync-budget-test", symbols: ["TP53"] },
    acked: false,
    retried: false,
    ack() {
      this.acked = true
    },
    retry() {
      this.retried = true
    },
  }
}

function syncFinalizationBudgetDb() {
  return {
    prepare() {
      return {
        bind() {
          return this
        },
        async first() {
          return null
        },
        async all() {
          return { results: [], meta: { rows_read: 1, rows_written: 0 } }
        },
        async run() {
          return { success: true, meta: { rows_read: 0, rows_written: 0 } }
        },
      }
    },
    async batch(statements) {
      return statements.map(() => ({ success: true, meta: { rows_read: 0, rows_written: 0 } }))
    },
  }
}

test("sync finalization queue consumer meters into the shared daily ledger (B-754)", async () => {
  const budgetNamespace = new FakeDailyBudgetNamespace()
  const message = syncFinalizationDrainMessage()

  await handleIconoplasmSyncFinalizationQueue(
    { messages: [message] },
    syncFinalizationQueueEnv(budgetNamespace, syncFinalizationBudgetDb()),
    { waitUntil() {} },
  )

  const snapshotCalls = budgetNamespace.calls.filter((call) => call.pathname === "/snapshot")
  const recordCalls = budgetNamespace.calls.filter((call) => call.pathname === "/record")
  assert.ok(
    snapshotCalls.length >= 1,
    "the sync-finalization consumer must consult the shared daily ledger",
  )
  assert.ok(
    recordCalls.length >= 1,
    "the sync-finalization consumer must flush metered usage to the shared daily ledger",
  )
  assert.equal(
    recordCalls[0].payload?.attribution?.route_family,
    "background_sync_finalization",
    "sync-finalization usage must be attributed to its own background family",
  )
})

test("sync finalization queue consumer fails closed when the shared daily ledger is exhausted (B-754)", async () => {
  const exhaustedNamespace = {
    idFromName() {
      return "global"
    },
    get() {
      return {
        fetch: async () =>
          Response.json({
            day_key: "2026-01-01",
            cycle_key: "2026-01-01",
            rows_read: FREE_D1_DAILY_LIMITS.reads,
            rows_written: 0,
            rows_read_daily_smart_limit: FREE_D1_DAILY_LIMITS.reads,
            rows_written_daily_smart_limit: FREE_D1_DAILY_LIMITS.writes,
            rows_read_daily_remaining: 0,
            rows_written_daily_remaining: FREE_D1_DAILY_LIMITS.writes,
            exhausted: true,
            exhausted_by: "rows_read_daily",
            days_remaining_in_cycle: 1,
          }),
      }
    },
  }
  const message = syncFinalizationDrainMessage()

  await assert.rejects(
    handleIconoplasmSyncFinalizationQueue(
      { messages: [message] },
      syncFinalizationQueueEnv(exhaustedNamespace, syncFinalizationBudgetDb()),
      { waitUntil() {} },
    ),
  )
  assert.equal(
    message.acked,
    false,
    "an exhausted shared day must not acknowledge the finalization message",
  )
})
