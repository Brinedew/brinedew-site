// Cloudflare Workers is currently Free (dashboard verified 2026-08-27). Paid
// R2 history and the old monthly product budgets are NOT D1 entitlements.
// Keep the provider's daily wall separate from our optional monthly allocation:
// unused quota yesterday cannot be borrowed today, even with a burst multiplier.
// Used by batch admission (workers/iconoplasm/batch-admission.js), the release
// scripts and the out-of-band cost cockpit generator.
// This calculation creates no per-reader accounting requests or writes.
// https://developers.cloudflare.com/d1/platform/pricing/
// The Cloudflare Free plan's daily allowance for every provider meter we watch. Read by
// the CI account watcher and batch admission; nothing else may restate them.
export const FREE_PLAN_DAILY_LIMITS = Object.freeze({
  rows_read: 5_000_000,
  rows_written: 100_000,
  requests: 100_000,
  kv_reads: 100_000,
  kv_writes: 1_000,
  kv_deletes: 1_000,
  kv_lists: 1_000,
  do_rows_read: 5_000_000,
  do_rows_written: 100_000,
  do_requests: 100_000,
  do_duration_gb_seconds: 13_000,
  queue_operations: 10_000,
})
// Free-plan meters the CI account watcher doesn't sample, so they stay out of the table
// above, whose every key it checks. Cloudflare's pricing pages, read 2026-10-06: Browser
// Rendering "10 minutes per day"; Workers Logs "200,000 per day".
export const FREE_PLAN_UNSAMPLED_DAILY_LIMITS = Object.freeze({
  browser_rendering_seconds: 600,
  workers_log_events: 200_000,
})

// The gene-card materializer's share of browser time: 8 of the 10 minutes, so a manual
// render from the dashboard still has two.
export const BROWSER_RENDERING_OPERATOR_DAILY_SECONDS = 480

export const FREE_D1_DAILY_LIMITS = Object.freeze({
  reads: FREE_PLAN_DAILY_LIMITS.rows_read,
  writes: FREE_PLAN_DAILY_LIMITS.rows_written,
})

// B-1026, finished 2026-10-09: every meter has one wall, Cloudflare's daily
// allowance above, and our own work is shed by criticality against the account's
// real use of it, readers included. There is no private operator slice. A slice
// can't see readers, so it protected them less than shedding on the real meter
// does, and on 10-09 it stopped the Drain at 600k of the account's 5M reads while
// the account had used about 782k. Readers, votes and caretaker saves are never
// refused by us; when they fill the day, our batch work stops first by itself.
//
// Shed lowest tier first, after Google SRE's "Handling Overload" (CRITICAL /
// SHEDDABLE_PLUS / SHEDDABLE) and Stripe's reserved share for critical requests:
// a request is refused once the account's reads or writes reach its tier's share.
export const D1_CRITICALITY_SHARES = Object.freeze({
  critical: 1,
  sheddable_plus: 0.85,
  sheddable: 0.6,
})

// The account level at which work of a tier stops on a meter whose daily wall is
// `limit`.
export function criticalityShareLimit(limit, criticality) {
  const share = D1_CRITICALITY_SHARES[criticality] ?? D1_CRITICALITY_SHARES.sheddable_plus
  return Math.floor(Number(limit) * share)
}

// Releases and their migrations are batch work: they stop when the whole
// account reaches the batch share of each meter.
const batchShare = (limit) => criticalityShareLimit(limit, "sheddable_plus")
export const OPERATOR_ACCOUNT_CEILINGS = Object.freeze({
  rows_read: batchShare(FREE_PLAN_DAILY_LIMITS.rows_read),
  rows_written: batchShare(FREE_PLAN_DAILY_LIMITS.rows_written),
  requests: batchShare(FREE_PLAN_DAILY_LIMITS.requests),
})
export const KV_ACCOUNT_CEILINGS = Object.freeze({
  kv_reads: batchShare(FREE_PLAN_DAILY_LIMITS.kv_reads),
  kv_writes: batchShare(FREE_PLAN_DAILY_LIMITS.kv_writes),
  kv_deletes: batchShare(FREE_PLAN_DAILY_LIMITS.kv_deletes),
  kv_lists: batchShare(FREE_PLAN_DAILY_LIMITS.kv_lists),
})
