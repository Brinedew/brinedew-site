import { FREE_D1_DAILY_LIMITS } from "../../shared/iconoplasm-d1-budget-policy.js"

// The shared daily-budget object as it answers since B-1026: one wall per meter,
// Cloudflare's daily allowance (FREE_D1_DAILY_LIMITS), and the day is exhausted when the
// account's usage today reaches it. There is no monthly budget and no smoothing. A test
// that needs a spent or nearly spent day seeds the usage the account already has when
// the day first appears, then drives the request under test.
export class FakeDailyBudgetNamespace {
  constructor({ rowsRead = 0, rowsWritten = 0 } = {}) {
    this.seed = { rows_read: rowsRead, rows_written: rowsWritten }
    this.dayRows = new Map()
    this.attributionRows = new Map()
    this.calls = []
  }

  idFromName(name) {
    return String(name || "")
  }

  dayRow(dayKey, cycleKey) {
    if (!this.dayRows.has(dayKey)) {
      this.dayRows.set(dayKey, {
        day_key: dayKey,
        cycle_key: cycleKey,
        rows_read: this.seed.rows_read,
        rows_written: this.seed.rows_written,
        query_count: 0,
        request_count: 0,
        updated_at: null,
      })
    }
    return this.dayRows.get(dayKey)
  }

  cycleDayRows(cycleKey) {
    return Array.from(this.dayRows.values())
      .filter((item) => item.cycle_key === cycleKey)
      .sort((left, right) => String(left.day_key).localeCompare(String(right.day_key)))
      .map((row) => ({
        ...row,
        rows_read_daily_smart_limit: FREE_D1_DAILY_LIMITS.reads,
        rows_written_daily_smart_limit: FREE_D1_DAILY_LIMITS.writes,
        rows_read_daily_remaining: Math.max(0, FREE_D1_DAILY_LIMITS.reads - row.rows_read),
        rows_written_daily_remaining: Math.max(0, FREE_D1_DAILY_LIMITS.writes - row.rows_written),
      }))
  }

  snapshotOf(row, cycleKey, daysRemainingInCycle) {
    const cycleTotals = this.cycleDayRows(cycleKey).reduce(
      (totals, item) => {
        totals.rows_read += item.rows_read
        totals.rows_written += item.rows_written
        totals.query_count += item.query_count
        totals.request_count += item.request_count
        return totals
      },
      { rows_read: 0, rows_written: 0, query_count: 0, request_count: 0 },
    )
    // No provider sample here, so the account's use is the ledger's own tally.
    const readsGone = row.rows_read >= FREE_D1_DAILY_LIMITS.reads
    const writesGone = row.rows_written >= FREE_D1_DAILY_LIMITS.writes
    return {
      day_key: row.day_key,
      cycle_key: cycleKey,
      rows_read: row.rows_read,
      rows_written: row.rows_written,
      query_count: row.query_count,
      request_count: row.request_count,
      cycle_rows_read: cycleTotals.rows_read,
      cycle_rows_written: cycleTotals.rows_written,
      cycle_query_count: cycleTotals.query_count,
      cycle_request_count: cycleTotals.request_count,
      rows_read_monthly_limit: null,
      rows_written_monthly_limit: null,
      rows_read_monthly_remaining: null,
      rows_written_monthly_remaining: null,
      rows_read_daily_smart_limit: FREE_D1_DAILY_LIMITS.reads,
      rows_written_daily_smart_limit: FREE_D1_DAILY_LIMITS.writes,
      rows_read_daily_limit: FREE_D1_DAILY_LIMITS.reads,
      rows_written_daily_limit: FREE_D1_DAILY_LIMITS.writes,
      account_rows_read: row.rows_read,
      account_rows_written: row.rows_written,
      account_observed_at: null,
      rows_read_daily_remaining: Math.max(0, FREE_D1_DAILY_LIMITS.reads - row.rows_read),
      rows_written_daily_remaining: Math.max(0, FREE_D1_DAILY_LIMITS.writes - row.rows_written),
      days_remaining_in_cycle: daysRemainingInCycle,
      daily_burst_multiplier: 1,
      exhausted: readsGone || writesGone,
      exhausted_by: readsGone ? "rows_read_daily" : writesGone ? "rows_written_daily" : null,
      updated_at: row.updated_at,
    }
  }

  get(id) {
    return {
      fetch: async (request) => {
        const url = new URL(request.url)
        const payload = (await request.json().catch(() => ({}))) || {}
        const dayKey = String(payload?.day_key || "")
        const cycleKey = String(payload?.cycle_key || dayKey)
        const daysRemainingInCycle = Math.max(1, Number(payload?.days_remaining_in_cycle || 1) || 1)
        const row = this.dayRow(dayKey, cycleKey)
        if (url.pathname === "/record") {
          const deltaRowsRead = Math.max(0, Number(payload?.rows_read || 0) || 0)
          const deltaRowsWritten = Math.max(0, Number(payload?.rows_written || 0) || 0)
          const deltaQueryCount = Math.max(0, Number(payload?.query_count || 0) || 0)
          const deltaRequestCount = Math.max(0, Number(payload?.request_count || 0) || 0)
          row.rows_read += deltaRowsRead
          row.rows_written += deltaRowsWritten
          row.query_count += deltaQueryCount
          row.request_count += deltaRequestCount
          row.updated_at = "2026-04-08T00:00:00Z"
          if (payload?.attribution) {
            const attributionKey = [
              dayKey,
              cycleKey,
              String(payload.attribution.route_family || "unknown"),
              String(payload.attribution.budget_class || "unknown"),
              String(payload.attribution.actor_class || "unknown"),
              String(payload.attribution.source_class || "unknown"),
            ].join("|")
            const existingAttribution = this.attributionRows.get(attributionKey) || {
              day_key: dayKey,
              cycle_key: cycleKey,
              route_family: String(payload.attribution.route_family || "unknown"),
              budget_class: String(payload.attribution.budget_class || "unknown"),
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
            existingAttribution.query_count += deltaQueryCount
            existingAttribution.request_count += deltaRequestCount
            existingAttribution.updated_at = "2026-04-08T00:00:00Z"
            this.attributionRows.set(attributionKey, existingAttribution)
          }
        }
        const snapshot = this.snapshotOf(row, cycleKey, daysRemainingInCycle)
        this.calls.push({
          id,
          pathname: url.pathname,
          payload,
          snapshot,
        })
        if (url.pathname === "/report") {
          return Response.json({
            snapshot,
            cycle_days: this.cycleDayRows(cycleKey),
            daily_attribution: Array.from(this.attributionRows.values()).filter(
              (item) => item.day_key === dayKey,
            ),
            cycle_attribution: Array.from(this.attributionRows.values()).filter(
              (item) => item.cycle_key === cycleKey,
            ),
          })
        }
        return Response.json(snapshot)
      },
    }
  }
}
