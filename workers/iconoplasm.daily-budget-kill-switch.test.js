import assert from "node:assert/strict"
import test from "node:test"

import { handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate } from "./iconoplasm-stateful-runtime-inside-the-only-allowed-internal-worker-do-not-duplicate.js"

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
    throw new Error("metered ICONOPLASM_DB tests should flow through all() so rows_read meta is counted")
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

class FakeDailyBudgetNamespace {
  constructor() {
    this.dayRows = new Map()
    this.attributionRows = new Map()
    this.calls = []
  }

  idFromName(name) {
    return String(name || "")
  }

  get(id) {
    return {
      fetch: async (request) => {
        const url = new URL(request.url)
        const payload = (await request.json().catch(() => ({}))) || {}
        const dayKey = String(payload?.day_key || "")
        const cycleKey = String(payload?.cycle_key || dayKey)
        const daysRemainingInCycle = Math.max(1, Number(payload?.days_remaining_in_cycle || 30) || 30)
        const budgets = {
          rowsReadMonthlyLimit: Math.max(0, Number(payload?.budgets?.rowsReadMonthlyLimit || 0) || 0),
          rowsWrittenMonthlyLimit: Math.max(0, Number(payload?.budgets?.rowsWrittenMonthlyLimit || 0) || 0),
          dailyBurstMultiplier: Math.max(1, Number(payload?.budgets?.dailyBurstMultiplier || 1) || 1),
        }
        const row = this.dayRows.get(dayKey) || {
          cycle_key: cycleKey,
          rows_read: 0,
          rows_written: 0,
          query_count: 0,
          request_count: 0,
          updated_at: null,
        }
        const cycleRows = Array.from(this.dayRows.values()).filter((item) => item.cycle_key === cycleKey)
        if (url.pathname === "/record") {
          const deltaRowsRead = Math.max(0, Number(payload?.rows_read || 0) || 0)
          const deltaRowsWritten = Math.max(0, Number(payload?.rows_written || 0) || 0)
          const deltaRequestCount = Math.max(0, Number(payload?.request_count || 0) || 0)
          row.rows_read += deltaRowsRead
          row.rows_written += deltaRowsWritten
          row.query_count += deltaRowsRead > 0 || deltaRowsWritten > 0 ? 1 : 0
          row.request_count += deltaRequestCount
          row.updated_at = "2026-04-08T00:00:00Z"
          this.dayRows.set(dayKey, row)
          if (payload?.attribution) {
            const attributionKey = [
              dayKey,
              cycleKey,
              String(payload.attribution.route_family || "unknown"),
              String(payload.attribution.actor_class || "unknown"),
              String(payload.attribution.source_class || "unknown"),
            ].join("|")
            const existingAttribution = this.attributionRows.get(attributionKey) || {
              day_key: dayKey,
              cycle_key: cycleKey,
              route_family: String(payload.attribution.route_family || "unknown"),
              actor_class: String(payload.attribution.actor_class || "unknown"),
              source_class: String(payload.attribution.source_class || "unknown"),
              rows_read: 0,
              rows_written: 0,
              query_count: 0,
              request_count: 0,
              updated_at: null,
            }
            existingAttribution.rows_read += deltaRowsRead
            existingAttribution.rows_written += deltaRowsWritten
            existingAttribution.query_count += deltaRowsRead > 0 || deltaRowsWritten > 0 ? 1 : 0
            existingAttribution.request_count += deltaRequestCount
            existingAttribution.updated_at = "2026-04-08T00:00:00Z"
            this.attributionRows.set(attributionKey, existingAttribution)
          }
        }
        const currentRow = this.dayRows.get(dayKey) || row
        const cycleRowsAfterUpdate = Array.from(this.dayRows.values()).filter((item) => item.cycle_key === cycleKey)
        const cycleTotals = cycleRowsAfterUpdate.reduce(
          (totals, item) => {
            totals.rows_read += item.rows_read || 0
            totals.rows_written += item.rows_written || 0
            totals.query_count += item.query_count || 0
            totals.request_count += item.request_count || 0
            return totals
          },
          { rows_read: 0, rows_written: 0, query_count: 0, request_count: 0 },
        )
        const cycleRowsReadBeforeToday = Math.max(0, cycleTotals.rows_read - currentRow.rows_read)
        const cycleRowsWrittenBeforeToday = Math.max(0, cycleTotals.rows_written - currentRow.rows_written)
        const smartDailyReadLimit =
          budgets.rowsReadMonthlyLimit > 0
            ? Math.min(
                Math.max(0, budgets.rowsReadMonthlyLimit - cycleRowsReadBeforeToday),
                Math.max(
                  Math.ceil(
                    Math.max(0, budgets.rowsReadMonthlyLimit - cycleRowsReadBeforeToday) /
                      Math.max(1, daysRemainingInCycle),
                  ),
                  Math.ceil(
                    (Math.max(0, budgets.rowsReadMonthlyLimit - cycleRowsReadBeforeToday) /
                      Math.max(1, daysRemainingInCycle)) *
                      budgets.dailyBurstMultiplier,
                  ),
                ),
              )
            : null
        const smartDailyWriteLimit =
          budgets.rowsWrittenMonthlyLimit > 0
            ? Math.min(
                Math.max(0, budgets.rowsWrittenMonthlyLimit - cycleRowsWrittenBeforeToday),
                Math.max(
                  Math.ceil(
                    Math.max(0, budgets.rowsWrittenMonthlyLimit - cycleRowsWrittenBeforeToday) /
                      Math.max(1, daysRemainingInCycle),
                  ),
                  Math.ceil(
                    (Math.max(0, budgets.rowsWrittenMonthlyLimit - cycleRowsWrittenBeforeToday) /
                      Math.max(1, daysRemainingInCycle)) *
                      budgets.dailyBurstMultiplier,
                  ),
                ),
              )
            : null
        const snapshot = {
          day_key: dayKey,
          cycle_key: cycleKey,
          rows_read: currentRow.rows_read,
          rows_written: currentRow.rows_written,
          query_count: currentRow.query_count,
          request_count: currentRow.request_count,
          cycle_rows_read: cycleTotals.rows_read,
          cycle_rows_written: cycleTotals.rows_written,
          cycle_query_count: cycleTotals.query_count,
          cycle_request_count: cycleTotals.request_count,
          rows_read_monthly_limit: budgets.rowsReadMonthlyLimit || null,
          rows_written_monthly_limit: budgets.rowsWrittenMonthlyLimit || null,
          rows_read_monthly_remaining:
            budgets.rowsReadMonthlyLimit > 0
              ? Math.max(0, budgets.rowsReadMonthlyLimit - cycleTotals.rows_read)
              : null,
          rows_written_monthly_remaining:
            budgets.rowsWrittenMonthlyLimit > 0
              ? Math.max(0, budgets.rowsWrittenMonthlyLimit - cycleTotals.rows_written)
              : null,
          rows_read_daily_smart_limit: smartDailyReadLimit,
          rows_written_daily_smart_limit: smartDailyWriteLimit,
          rows_read_daily_remaining:
            smartDailyReadLimit !== null ? Math.max(0, smartDailyReadLimit - currentRow.rows_read) : null,
          rows_written_daily_remaining:
            smartDailyWriteLimit !== null ? Math.max(0, smartDailyWriteLimit - currentRow.rows_written) : null,
          days_remaining_in_cycle: daysRemainingInCycle,
          daily_burst_multiplier: budgets.dailyBurstMultiplier,
          exhausted:
            (budgets.rowsReadMonthlyLimit > 0 && cycleTotals.rows_read >= budgets.rowsReadMonthlyLimit) ||
            (budgets.rowsWrittenMonthlyLimit > 0 &&
              cycleTotals.rows_written >= budgets.rowsWrittenMonthlyLimit) ||
            (smartDailyReadLimit !== null && currentRow.rows_read >= smartDailyReadLimit) ||
            (smartDailyWriteLimit !== null && currentRow.rows_written >= smartDailyWriteLimit),
          exhausted_by:
            budgets.rowsReadMonthlyLimit > 0 && cycleTotals.rows_read >= budgets.rowsReadMonthlyLimit
              ? "rows_read_monthly"
              : budgets.rowsWrittenMonthlyLimit > 0 &&
                  cycleTotals.rows_written >= budgets.rowsWrittenMonthlyLimit
                ? "rows_written_monthly"
                : smartDailyReadLimit !== null && currentRow.rows_read >= smartDailyReadLimit
                  ? "rows_read_daily_smart"
                  : smartDailyWriteLimit !== null && currentRow.rows_written >= smartDailyWriteLimit
                    ? "rows_written_daily_smart"
                : null,
          updated_at: currentRow.updated_at,
        }
        this.calls.push({
          id,
          pathname: url.pathname,
          payload,
          snapshot,
        })
        if (url.pathname === "/report") {
          const dailyAttribution = Array.from(this.attributionRows.values()).filter((item) => item.day_key === dayKey)
          const cycleAttribution = Array.from(this.attributionRows.values()).filter((item) => item.cycle_key === cycleKey)
          return Response.json({
            snapshot,
            daily_attribution: dailyAttribution,
            cycle_attribution: cycleAttribution,
          })
        }
        return Response.json(snapshot)
      },
    }
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

test("smart daily Iconoplasm D1 budget fails closed when the monthly budget is spent", async () => {
  const db = new MeteredSummaryDb({ rowsReadPerQuery: 2 })
  const budgetNamespace = new FakeDailyBudgetNamespace()
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "founder-secret",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
    ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "2",
    ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "1000",
    ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_DO_NOT_SET_CASUALLY: "7",
    ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_DO_NOT_SET_CASUALLY: "10",
  }

  const first = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    adminSummaryRequest(),
    env,
    { waitUntil() {} },
  )
  const firstPayload = await first.json()
  assert.equal(first.status, 200)
  assert.equal(firstPayload?.ok, true)
  assert.equal(firstPayload?.candidate_assets, 12)

  const second = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    adminSummaryRequest(),
    env,
    { waitUntil() {} },
  )
  const secondPayload = await second.json()
  assert.equal(second.status, 503)
  assert.equal(secondPayload?.code, "ICONOPLASM_D1_DAILY_BUDGET_EXHAUSTED")
  assert.equal(secondPayload?.budget?.rows_read, 2)
  assert.equal(secondPayload?.budget?.rows_read_monthly_limit, 2)
  assert.equal(secondPayload?.budget?.exhausted_by, "rows_read_monthly")

  assert.equal(db.calls.filter((call) => call.type === "all").length, 1)
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    ["/snapshot", "/record", "/snapshot"],
  )
})

test("smart budget curiosity layer reports attributed daily usage", async () => {
  const db = new MeteredSummaryDb({ rowsReadPerQuery: 3 })
  const budgetNamespace = new FakeDailyBudgetNamespace()
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "founder-secret",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
    ICONOPLASM_D1_ROWS_READ_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "24000000000",
    ICONOPLASM_D1_ROWS_WRITTEN_HARD_MONTHLY_BUDGET_DO_NOT_SET_CASUALLY: "40000000",
    ICONOPLASM_D1_BILLING_CYCLE_DAY_OF_MONTH_DO_NOT_SET_CASUALLY: "7",
    ICONOPLASM_D1_DAILY_BURST_MULTIPLIER_DO_NOT_SET_CASUALLY: "3",
  }

  const summaryResponse = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
    adminSummaryRequest(),
    env,
    { waitUntil() {} },
  )
  assert.equal(summaryResponse.status, 200)

  const reportResponse = await handleIconoplasmRequestInsideTheOnlyAllowedInternalStatefulWorkerDoNotDuplicate(
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
  assert.equal(reportResponse.status, 200)
  assert.equal(reportPayload?.snapshot?.rows_read, 3)
  assert.equal(reportPayload?.snapshot?.cycle_rows_read, 3)
  assert.equal(Array.isArray(reportPayload?.daily_attribution), true)
  assert.deepEqual(reportPayload?.daily_attribution?.[0], {
    day_key: reportPayload.snapshot.day_key,
    cycle_key: reportPayload.snapshot.cycle_key,
    route_family: "admin_assets_summary",
    actor_class: "admin_token",
    source_class: "admin_ui",
    rows_read: 3,
    rows_written: 0,
    query_count: 1,
    request_count: 1,
    updated_at: "2026-04-08T00:00:00Z",
  })
})
