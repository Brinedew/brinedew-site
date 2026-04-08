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
    this.rows = new Map()
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
        const budgets = {
          rowsReadLimit: Math.max(0, Number(payload?.budgets?.rowsReadLimit || 0) || 0),
          rowsWrittenLimit: Math.max(0, Number(payload?.budgets?.rowsWrittenLimit || 0) || 0),
        }
        const row = this.rows.get(dayKey) || {
          rows_read: 0,
          rows_written: 0,
          query_count: 0,
          updated_at: null,
        }
        if (url.pathname === "/record") {
          const deltaRowsRead = Math.max(0, Number(payload?.rows_read || 0) || 0)
          const deltaRowsWritten = Math.max(0, Number(payload?.rows_written || 0) || 0)
          row.rows_read += Math.max(0, Number(payload?.rows_read || 0) || 0)
          row.rows_written += Math.max(0, Number(payload?.rows_written || 0) || 0)
          row.query_count += deltaRowsRead > 0 || deltaRowsWritten > 0 ? 1 : 0
          row.updated_at = "2026-04-08T00:00:00Z"
          this.rows.set(dayKey, row)
        }
        const snapshot = {
          day_key: dayKey,
          rows_read: row.rows_read,
          rows_written: row.rows_written,
          query_count: row.query_count,
          rows_read_limit: budgets.rowsReadLimit,
          rows_written_limit: budgets.rowsWrittenLimit,
          rows_read_remaining:
            budgets.rowsReadLimit > 0 ? Math.max(0, budgets.rowsReadLimit - row.rows_read) : null,
          rows_written_remaining:
            budgets.rowsWrittenLimit > 0
              ? Math.max(0, budgets.rowsWrittenLimit - row.rows_written)
              : null,
          exhausted:
            (budgets.rowsReadLimit > 0 && row.rows_read >= budgets.rowsReadLimit) ||
            (budgets.rowsWrittenLimit > 0 && row.rows_written >= budgets.rowsWrittenLimit),
          exhausted_by:
            budgets.rowsReadLimit > 0 && row.rows_read >= budgets.rowsReadLimit
              ? "rows_read"
              : budgets.rowsWrittenLimit > 0 && row.rows_written >= budgets.rowsWrittenLimit
                ? "rows_written"
                : null,
          updated_at: row.updated_at,
        }
        this.calls.push({
          id,
          pathname: url.pathname,
          payload,
          snapshot,
        })
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

test("hard daily Iconoplasm D1 budget fails closed on the next request after the cap is spent", async () => {
  const db = new MeteredSummaryDb({ rowsReadPerQuery: 2 })
  const budgetNamespace = new FakeDailyBudgetNamespace()
  const env = {
    ICONOPLASM_DB: db,
    ICONOPLASM_ADMIN_TOKEN: "founder-secret",
    ICONOPLASM_D1_DAILY_BUDGET_KILL_SWITCH_DO_NOT_DUPLICATE: budgetNamespace,
    ICONOPLASM_D1_ROWS_READ_HARD_DAILY_BUDGET_DO_NOT_SET_CASUALLY: "2",
    ICONOPLASM_D1_ROWS_WRITTEN_HARD_DAILY_BUDGET_DO_NOT_SET_CASUALLY: "1000",
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
  assert.equal(secondPayload?.budget?.rows_read_limit, 2)
  assert.equal(secondPayload?.budget?.exhausted_by, "rows_read")

  assert.equal(db.calls.filter((call) => call.type === "all").length, 1)
  assert.deepEqual(
    budgetNamespace.calls.map((call) => call.pathname),
    ["/snapshot", "/record", "/snapshot"],
  )
})
