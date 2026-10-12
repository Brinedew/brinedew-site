// ARCHITECTURE FENCE [IPD-013]
// B-1085: batch work is let in by its price, before it runs.
//
// Chesterton's fence, the 2026-10-11 vote outage: do not go back to a gate that
// only reads the meter, do not let a meter that can't be read wave batch work
// through, and do not add an admin route without a price. The app refuses to
// start when one has none (assertEveryAdminRoutePriced, below), so a new route
// can't skip this by being forgotten. Registry: architecture-fences.json;
// runbook: docs/ICONOPLASM_CAPACITY_AND_BACKGROUND_WORK_RUNBOOK.md.
//
// Cloudflare's usage meter is a rear-view mirror: it shows a minute one to two
// minutes late, and Cloudflare's own wall lags too. On 2026-10-11 a copy job
// wrote 62,000 rows in four minutes past an 85% stop that only read the meter,
// and readers lost their votes until 00:00 UTC. Shopify's API works the way this
// file does: "Before execution begins, an app's bucket must have enough capacity
// for the requested cost of a query."
//
// So a batch request names its price on each D1 meter, and is let in only when
//   the meter's day total + what batch work was let in since the meter's newest
//   minute + this price
// fits under its tier's stop (shared/iconoplasm-d1-budget-policy.js). A job of
// many pages also names its whole remaining price on its first page, and is
// refused before its first write when the day can't hold it. What was let in is
// one row a minute (migration 0127); minutes the meter already shows are in its
// total, so an over-priced request stops counting a minute or two later and
// nothing here drifts. A meter that can't be read stops batch work. Readers'
// own actions (critical) never come here: they run to Cloudflare's wall.
import {
  FREE_PLAN_DAILY_LIMITS,
  criticalityShareLimit,
} from "../../shared/iconoplasm-d1-budget-policy.js"
import { secondsUntilCloudflareDailyReset } from "../lib/cloudflare-availability.js"

export const BATCH_METERS = ["rows_read", "rows_written"]

// What one unit of each batch route costs, rounded up from measurements. A
// statement costs its table row plus every index and trigger it touches.
export const BATCH_PRICES = Object.freeze({
  // Register route, Drain-only window 2026-10-10 00:00-00:10 UTC, 174 portraits
  // (d1QueriesAdaptiveGroups per statement): ~54 written and ~150 read each,
  // card rebuild included.
  portrait: Object.freeze({ rows_written: 60, rows_read: 160 }),
  // A card rebuild without a new portrait: the gene rollup, its publish event
  // and winner rows, about 28 written per gene in that window. Doubled until a
  // republish-only window measures it.
  card: Object.freeze({ rows_written: 60, rows_read: 300 }),
  // One gene text: 62,037 rows written for 20,155 texts in the 2026-10-11 copy
  // (row, primary key, gene_id index), and 70,127 read.
  gene_text: Object.freeze({ rows_written: 4, rows_read: 4 }),
  // One page of the workstation's text read-back: 200 texts and their genes.
  text_page: Object.freeze({ rows_written: 0, rows_read: 450 }),
  // The supervote move: one statement over every open role (38 on 2026-10-10).
  supervote_move: Object.freeze({ rows_written: 200, rows_read: 400 }),
})

// The admission's own cost: this minute's row rewritten, and the few minutes
// since the meter's newest read back.
export const ADMISSION_COST = Object.freeze({ rows_written: 1, rows_read: 5 })

const IN_FLIGHT_SQL = `SELECT COALESCE(SUM(rows_written), 0) AS rows_written,
                              COALESCE(SUM(rows_read), 0) AS rows_read
                         FROM icono_batch_admissions WHERE minute >= ?`
const ADMIT_SQL = `INSERT INTO icono_batch_admissions (minute, rows_written, rows_read)
                   VALUES (?, ?, ?)
                   ON CONFLICT (minute) DO UPDATE SET
                     rows_written = rows_written + excluded.rows_written,
                     rows_read = rows_read + excluded.rows_read`
const FORGET_SQL = `DELETE FROM icono_batch_admissions WHERE minute < ?`

// "2026-10-11T10:56", the key of the minute an instant falls in.
const minuteOf = (instant) => new Date(instant).toISOString().slice(0, 16)

export function priceOf(unit, count = 1) {
  const price = BATCH_PRICES[unit]
  if (!price) throw new TypeError(`No batch price for ${unit}`)
  return { rows_written: price.rows_written * count, rows_read: price.rows_read * count }
}

const addPrices = (...prices) =>
  Object.fromEntries(
    BATCH_METERS.map((meter) => [
      meter,
      prices.reduce((sum, price) => sum + Number(price?.[meter] || 0), 0),
    ]),
  )

// Where today's batch spend stands: the meter's total, what batch work was let in
// that the meter hasn't shown yet, and each tier stop. `usage` is the reader's
// sample (operation-cost-account-usage.js); null means it couldn't be read.
export async function batchSpendNow(db, usage, criticality = "sheddable_plus", now = Date.now()) {
  if (!usage) return null
  const day = `${new Date(now).toISOString().slice(0, 10)}T00:00`
  // The meter's day starts at 00:00 UTC; minutes of the day before are not
  // today's. A sample that doesn't say where the meter's knowledge ends counts
  // every batch minute of the day as unseen.
  const counted = Date.parse(usage.meter_counted_before)
  const since = Number.isNaN(counted) ? day : [minuteOf(counted), day].sort().at(-1)
  const inFlight = await db.prepare(IN_FLIGHT_SQL).bind(since).first()
  return Object.fromEntries(
    BATCH_METERS.map((meter) => {
      const used = Number(usage[meter] || 0)
      const unseen = Number(inFlight?.[meter] || 0)
      return [
        meter,
        {
          used,
          unseen_batch: unseen,
          projected: used + unseen,
          wall: FREE_PLAN_DAILY_LIMITS[meter],
          stop: criticalityShareLimit(FREE_PLAN_DAILY_LIMITS[meter], criticality),
        },
      ]
    }),
  )
}

function refusal(code, message, detail, retryAfter) {
  return {
    ok: false,
    status: 503,
    retryAfter,
    body: {
      ok: false,
      code,
      error: { code, message },
      ...detail,
      retry_after_seconds: retryAfter,
      reset_at: new Date(Date.now() + retryAfter * 1000).toISOString(),
    },
  }
}

// The mark on the gate's middleware (app.js shedBatchWork), so the check below
// can see which routes carry it.
export const BATCH_GATE = Symbol("iconoplasm.batchGate")

// Every Hono route under /api/iconoplasm/admin/ must carry the gate, or be named
// in `unpriced` with its reason. Throws when the app is built, so CI's first test
// that builds the app fails before such a route can ship. Readers' own routes
// (/api/iconoplasm/caretaker/...) are critical and run to Cloudflare's wall.
export function assertEveryAdminRoutePriced(app, unpriced = {}) {
  const routes = new Map()
  for (const { method, path, handler } of app.routes) {
    if (!path.startsWith("/api/iconoplasm/admin/")) continue
    const key = `${method} ${path}`
    routes.set(key, routes.get(key) || Boolean(handler?.[BATCH_GATE]))
  }
  const missing = [...routes].filter(([key, gated]) => !gated && !unpriced[key]).map(([key]) => key)
  if (missing.length)
    throw new Error(
      `ARCHITECTURE FENCE [IPD-013]: ${missing.join(", ")} must name its D1 price through shedBatchWork (workers/iconoplasm/batch-admission.js, B-1085)`,
    )
}

// Lets one batch request in, or says why not. `price` is this request's cost;
// `job` (a job's first page) is the whole job's remaining cost, this request
// included. On admission the request's price is recorded before it runs.
export async function admitBatchWork(
  db,
  { usage, criticality = "sheddable_plus", price, job = null, now = Date.now() },
) {
  if (!usage)
    return refusal(
      "D1_METER_UNAVAILABLE",
      "Batch work waits while Cloudflare's usage meter can't be read; readers are unaffected.",
      {},
      60,
    )
  const spend = await batchSpendNow(db, usage, criticality, now)
  const cost = addPrices(price, ADMISSION_COST)
  const asked = job ? addPrices(job, ADMISSION_COST) : cost
  for (const meter of BATCH_METERS) {
    const { projected, stop, used, unseen_batch } = spend[meter]
    if (projected + asked[meter] <= stop) continue
    const what = meter.replace("_", " ")
    return refusal(
      "D1_BATCH_SHARE_SPENT",
      `${job ? "This job" : "This batch request"} costs ${asked[meter].toLocaleString("en-US")} D1 ${what}; with ${projected.toLocaleString("en-US")} spent today it would pass batch work's stop at ${stop.toLocaleString("en-US")}. Readers keep the rest until 00:00 UTC.`,
      { meter, used, unseen_batch, price: asked[meter], limit: stop },
      secondsUntilCloudflareDailyReset(now),
    )
  }
  await db.batch([
    db.prepare(ADMIT_SQL).bind(minuteOf(now), cost.rows_written, cost.rows_read),
    // Minutes of an earlier day never count again.
    db.prepare(FORGET_SQL).bind(`${new Date(now).toISOString().slice(0, 10)}T00:00`),
  ])
  return { ok: true, spend }
}
