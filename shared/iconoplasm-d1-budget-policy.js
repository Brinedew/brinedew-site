// Cloudflare Workers is currently Free (dashboard verified 2026-08-27). Paid
// R2 history and the old monthly product budgets are NOT D1 entitlements.
// Keep the provider's daily wall separate from our optional monthly allocation:
// unused quota yesterday cannot be borrowed today, even with a burst multiplier.
// Used by both the runtime governor and the out-of-band cost cockpit generator.
// This calculation creates no per-reader accounting requests or writes.
// https://developers.cloudflare.com/d1/platform/pricing/
export const FREE_D1_DAILY_LIMITS = Object.freeze({ reads: 5_000_000, writes: 100_000 })

// ARCHITECTURE FENCE [IPD-012]: the administrative/authoring ledger covers
// only its own traffic. Giving it the entire account allowance starves login,
// readers, migrations and other databases. This allocation is deliberately
// separate from provider entitlement; historical monthly settings cannot lift it.
export const D1_OPERATOR_DAILY_LIMITS = Object.freeze({ reads: 1_000_000, writes: 20_000 })

export function d1OperationalAllowance(options) {
  return Math.min(d1DailyAllowance(options), D1_OPERATOR_DAILY_LIMITS[options.resource])
}

export function d1DailyAllowance({
  resource,
  monthlyLimit = 0,
  usedBeforeDay = 0,
  daysRemaining = 1,
  burstMultiplier = 1,
}) {
  if (!Object.hasOwn(FREE_D1_DAILY_LIMITS, resource)) {
    throw new Error(`Unknown D1 budget resource: ${resource}`)
  }
  const hardLimit = FREE_D1_DAILY_LIMITS[resource]
  const monthly = Math.max(0, Number(monthlyLimit) || 0)
  if (!monthly) return hardLimit
  const remaining = Math.max(0, monthly - Math.max(0, Number(usedBeforeDay) || 0))
  const days = Math.max(1, Number(daysRemaining) || 1)
  const burst = Math.max(1, Number(burstMultiplier) || 1)
  const allocation = Math.min(remaining, Math.ceil(Math.ceil(remaining / days) * burst))
  return Math.min(hardLimit, allocation)
}

// B-1026: the operator ledger is shed by criticality, lowest tier first, after
// Google SRE's "Handling Overload" (CRITICAL / SHEDDABLE_PLUS / SHEDDABLE) and
// Stripe's reserved share for critical requests. A request is refused once the
// day's operator reads or writes reach its tier's share, so a diagnostic or a
// batch job can't spend the slice that player deliveries need. Readers, votes
// and caretaker saves are not in this ledger at all.
export const D1_CRITICALITY_SHARES = Object.freeze({
  critical: 1,
  sheddable_plus: 0.85,
  sheddable: 0.6,
})

// Player-requested portraits, and moderation that can't wait for the reset:
// suspending a caretaker, and publishing, rejecting or removing a portrait
// (admin_gallery_mutation*, one family for every gallery action).
const CRITICAL_ROUTE_FAMILIES = new Set([
  "authority_generation_executor",
  "admin_caretaker_mutation",
])

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

// Everything else in the ledger is batch (ingest, publication, replication,
// rewrites, finalization): it retries after the reset.
export function d1CriticalityOfRouteFamily(routeFamily) {
  const family = String(routeFamily || "").trim()
  if (CRITICAL_ROUTE_FAMILIES.has(family) || family.startsWith("admin_gallery_mutation"))
    return "critical"
  if (SHEDDABLE_ROUTE_FAMILIES.has(family)) return "sheddable"
  return "sheddable_plus"
}

// The meter a request of this criticality is refused on, given the day's
// snapshot, or null while its share has room.
export function d1CriticalityShedBy(snapshot, criticality) {
  const share = D1_CRITICALITY_SHARES[criticality] ?? D1_CRITICALITY_SHARES.sheddable_plus
  if (share >= 1) return null
  for (const [meter, used, limit] of [
    ["rows_read", snapshot?.rows_read, snapshot?.rows_read_daily_smart_limit],
    ["rows_written", snapshot?.rows_written, snapshot?.rows_written_daily_smart_limit],
  ]) {
    const allowance = Number(limit)
    if (!Number.isFinite(allowance) || allowance <= 0) continue
    if ((Number(used) || 0) >= Math.floor(allowance * share)) return `${meter}_${criticality}`
  }
  return null
}
