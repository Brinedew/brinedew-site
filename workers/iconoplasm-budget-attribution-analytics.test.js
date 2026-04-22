import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

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
}

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
                : Math.max(0, Number(this.snapshot.rows_written_monthly_remaining || 0) - rowsWritten),
            rows_read_daily_remaining:
              this.snapshot.rows_read_daily_smart_limit == null
                ? null
                : Math.max(0, Number(this.snapshot.rows_read_daily_remaining || 0) - rowsRead),
            rows_written_daily_remaining:
              this.snapshot.rows_written_daily_smart_limit == null
                ? null
                : Math.max(0, Number(this.snapshot.rows_written_daily_remaining || 0) - rowsWritten),
          }
          this.snapshot.exhausted =
            (this.snapshot.rows_read_daily_smart_limit != null &&
              Number(this.snapshot.rows_read || 0) >= Number(this.snapshot.rows_read_daily_smart_limit || 0)) ||
            (this.snapshot.rows_written_daily_smart_limit != null &&
              Number(this.snapshot.rows_written || 0) >= Number(this.snapshot.rows_written_daily_smart_limit || 0))
          this.snapshot.exhausted_by = this.snapshot.exhausted ? "rows_written_daily_smart" : null
        }
        return Response.json(this.snapshot)
      },
    }
  }
}

function buildAnalyticsBinding() {
  const points = []
  return {
    points,
    writeDataPoint(point) {
      points.push(point)
    },
  }
}

test("successful sync-style admin mutations emit one Analytics Engine attribution datapoint", async () => {
  const db = new CatalogUpsertDb({ rowsWrittenPerRun: 2 })
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
    rows_read_monthly_limit: 24000000000,
    rows_written_monthly_limit: 50000,
    rows_read_monthly_remaining: 24000000000,
    rows_written_monthly_remaining: 49996,
    rows_read_daily_smart_limit: 100000,
    rows_written_daily_smart_limit: 10000,
    rows_read_daily_remaining: 100000,
    rows_written_daily_remaining: 9996,
    days_remaining_in_cycle: 20,
    daily_burst_multiplier: 3,
    exhausted: false,
    exhausted_by: null,
    updated_at: "2026-04-17T05:00:00Z",
  })
  const analytics = buildAnalyticsBinding()

  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/catalog/upsert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-iconoplasm-admin-token": "founder-secret",
      },
      body: JSON.stringify({
        defer_read_models: true,
        items: [{ gene_symbol: "TP53", full_name: "Tumor protein p53", tmh: false, aliases_json: [] }],
      }),
    }),
    {
      ICONOPLASM_DB: db,
      ICONOPLASM_ADMIN_TOKEN: "founder-secret",
      ICONOPLASM_BUDGET_ATTRIBUTION_ANALYTICS: analytics,
      ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
      ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "24000000000",
      ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "50000",
      ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_DO_NOT_SET_CASUALLY: "7",
      ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_DO_NOT_SET_CASUALLY: "3",
    },
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 200)
  assert.equal(payload?.ok, true)
  assert.equal(db.catalogUpsertRuns, 1)
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    ["/snapshot", "/record"],
  )
  assert.equal(analytics.points.length, 1)
  assert.deepEqual(analytics.points[0]?.blobs?.slice(0, 6), [
    "2026-04-07",
    "admin_catalog",
    "admin_sync",
    "admin_token",
    "workstation_sync",
    "ok",
  ])
  assert.equal(analytics.points[0]?.doubles?.[1], 2)
  assert.equal(analytics.points[0]?.doubles?.[3], 1)
  assert.equal(analytics.points[0]?.doubles?.[4], 200)
})

test("fail-closed limiter rejections still emit one Analytics Engine attribution datapoint", async () => {
  const analytics = buildAnalyticsBinding()
  const response = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    new Request("https://the-only-allowed-internal-stateful-worker-do-not-duplicate/api/iconoplasm/admin/catalog/upsert", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-iconoplasm-admin-token": "founder-secret",
      },
      body: JSON.stringify({
        defer_read_models: true,
        items: [{ gene_symbol: "TP53", full_name: "Tumor protein p53", tmh: false, aliases_json: [] }],
      }),
    }),
    {
      ICONOPLASM_DB: new CatalogUpsertDb({ rowsWrittenPerRun: 2 }),
      ICONOPLASM_ADMIN_TOKEN: "founder-secret",
      ICONOPLASM_BUDGET_ATTRIBUTION_ANALYTICS: analytics,
      ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: new FixedSnapshotBudgetNamespace({
        day_key: "2026-04-17",
        cycle_key: "2026-04-07",
        rows_read: 0,
        rows_written: 18,
        query_count: 3,
        request_count: 1,
        cycle_rows_read: 0,
        cycle_rows_written: 18,
        cycle_query_count: 3,
        cycle_request_count: 1,
        rows_read_monthly_limit: 24000000000,
        rows_written_monthly_limit: 100,
        rows_read_monthly_remaining: 24000000000,
        rows_written_monthly_remaining: 82,
        rows_read_daily_smart_limit: 1000,
        rows_written_daily_smart_limit: 20,
        rows_read_daily_remaining: 1000,
        rows_written_daily_remaining: 2,
        days_remaining_in_cycle: 20,
        daily_burst_multiplier: 3,
        exhausted: false,
        exhausted_by: null,
        updated_at: "2026-04-17T05:00:00Z",
      }),
      ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "24000000000",
      ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "100",
      ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_DO_NOT_SET_CASUALLY: "7",
      ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_DO_NOT_SET_CASUALLY: "3",
    },
    { waitUntil() {} },
  )
  const payload = await response.json()

  assert.equal(response.status, 503)
  assert.equal(payload?.code, "ICONOPLASM_ADMIN_MUTATION_LIMITER_ACTIVE")
  assert.equal(analytics.points.length, 1)
  assert.deepEqual(analytics.points[0]?.blobs?.slice(0, 6), [
    "2026-04-07",
    "admin_catalog",
    "admin_sync",
    "admin_token",
    "workstation_sync",
    "limited",
  ])
  assert.equal(analytics.points[0]?.blobs?.[8], "preflight")
  assert.equal(analytics.points[0]?.doubles?.[3], 1)
  assert.equal(analytics.points[0]?.doubles?.[4], 503)
  assert.equal(analytics.points[0]?.doubles?.[8], 1)
})
