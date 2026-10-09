// Cloudflare Workers is currently Free (dashboard verified 2026-08-27). Paid
// R2 history and the old monthly product budgets are NOT D1 entitlements.
// Keep the provider's daily wall separate from our optional monthly allocation:
// unused quota yesterday cannot be borrowed today, even with a burst multiplier.
// Used by both the runtime governor and the out-of-band cost cockpit generator.
// This calculation creates no per-reader accounting requests or writes.
// https://developers.cloudflare.com/d1/platform/pricing/
// The Cloudflare Free plan's daily allowance for every provider meter we watch. Read by
// the CI account watcher and the operator ledger; nothing else may restate them.
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

// B-897: write reservations are shed on the provider's write meter. Background
// work stops at 70%, a person's own action at 90%, so readers' votes and
// discoveries always keep the last 10,000 rows.
export const D1_BACKGROUND_WRITE_CEILING = Math.floor(FREE_D1_DAILY_LIMITS.writes * 0.7)
export const D1_USER_ACTION_DAILY_WRITE_CEILING = Math.floor(FREE_D1_DAILY_LIMITS.writes * 0.9)

// The operation-cost ledger (replica pulls, releases, migrations) is batch work:
// it stops when the whole account reaches these. KV follows the write lanes'
// 70%, because the free plan's 1,000 KV writes a day are the scarcest meter.
export const OPERATOR_ACCOUNT_CEILINGS = Object.freeze({
  rows_read: criticalityShareLimit(FREE_PLAN_DAILY_LIMITS.rows_read, "sheddable_plus"),
  rows_written: D1_BACKGROUND_WRITE_CEILING,
  requests: criticalityShareLimit(FREE_PLAN_DAILY_LIMITS.requests, "sheddable_plus"),
})
export const KV_ACCOUNT_CEILINGS = Object.freeze({
  kv_reads: Math.floor(FREE_PLAN_DAILY_LIMITS.kv_reads * 0.7),
  kv_writes: Math.floor(FREE_PLAN_DAILY_LIMITS.kv_writes * 0.7),
  kv_deletes: Math.floor(FREE_PLAN_DAILY_LIMITS.kv_deletes * 0.7),
  kv_lists: Math.floor(FREE_PLAN_DAILY_LIMITS.kv_lists * 0.7),
})

// The account's use of a meter today: the latest provider sample plus our own
// tally since it, never below our own tally. Without a sample, our own tally.
export function accountUsage(localUsed, providerSampled, localAtSample) {
  const local = Math.max(0, Number(localUsed) || 0)
  const sampled = Number(providerSampled)
  if (!Number.isFinite(sampled) || sampled < 0) return local
  const since = Math.max(0, local - Math.max(0, Number(localAtSample) || 0))
  return Math.max(local, sampled + since)
}

// The tier is decided by who is waiting for the request, not by who sent it.
// Readers, votes and caretaker saves never enter this ledger. Inside it, only a
// player's portrait delivery has someone waiting right now: claiming the lease
// and completing it. Moderation, publication housekeeping, replication and
// rewrites can all be redone after the reset.
const CRITICAL_ROUTE_FAMILIES = new Set(["authority_generation_executor"])

// Admin diagnostics and summaries: a person can press the button again tomorrow.
const SHEDDABLE_ROUTE_FAMILIES = new Set([
  "admin_overview",
  "admin_coverage",
  "admin_public_stats_audit",
  "admin_assets",
  "admin_assets_summary",
  "admin_assets_storage_audit",
  "admin_assets_repair_scope",
  "admin_assets_state",
  "admin_blots_backlog",
  "admin_gallery",
])

// Between claiming and completing a lease, the drain publishes the generated
// portrait through the same routes a bulk sync uses. Only the caller knows which
// it is, so the caller declares it, as in Google SRE's design, where criticality
// travels with the request. Only these steps may be declared critical. The last
// two are the reconcile and read-model calls the workstation makes during a
// delivery's publication (it declares every admin call of that publication).
export const D1_CRITICALITY_DECLARABLE_FAMILIES = Object.freeze(
  new Set([
    "admin_ingest",
    "admin_catalog_upsert",
    "admin_catalog_reconcile",
    "admin_finalization_enqueue",
    "admin_finalization_process",
    "background_sync_finalization",
    "admin_reconcile",
    "admin_read_models",
  ]),
)

// Everything else in the ledger is batch: it retries after the reset.
export function d1CriticalityOfRouteFamily(routeFamily, declaredCriticality = null) {
  const family = String(routeFamily || "").trim()
  if (CRITICAL_ROUTE_FAMILIES.has(family)) return "critical"
  if (declaredCriticality === "critical" && D1_CRITICALITY_DECLARABLE_FAMILIES.has(family))
    return "critical"
  if (SHEDDABLE_ROUTE_FAMILIES.has(family)) return "sheddable"
  return "sheddable_plus"
}

// The meter a request of this criticality is refused on, given the day's
// snapshot, or null while its share has room. The snapshot carries the
// account's use of each meter and Cloudflare's daily wall for it.
export function d1CriticalityShedBy(snapshot, criticality) {
  const share = D1_CRITICALITY_SHARES[criticality] ?? D1_CRITICALITY_SHARES.sheddable_plus
  if (share >= 1) return null
  for (const [meter, used, limit] of [
    ["rows_read", snapshot?.account_rows_read, snapshot?.rows_read_daily_limit],
    ["rows_written", snapshot?.account_rows_written, snapshot?.rows_written_daily_limit],
  ]) {
    const allowance = Number(limit)
    if (!Number.isFinite(allowance) || allowance <= 0) continue
    if ((Number(used) || 0) >= Math.floor(allowance * share)) return `${meter}_${criticality}`
  }
  return null
}
