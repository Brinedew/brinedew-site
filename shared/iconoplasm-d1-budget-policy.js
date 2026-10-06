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
// Writes: 70,000 of the Free plan's 100,000 since 2026-10-06 (B-1035), leaving 30,000
// for readers, votes and caretaker saves, which this ledger never meters. 20,000 held
// a regeneration batch to about 250 genes a day (78 rows each, measured) while the
// owner queues about 800 portraits at once. It matches the online-migration ceiling.
export const D1_OPERATOR_DAILY_LIMITS = Object.freeze({ reads: 1_000_000, writes: 70_000 })

// Workers requests the operator's cost ledger may spend in a day, shed by the
// tiers below like the D1 allowance. A busy day measured on 2026-10-06: a 670-gene
// rewrite batch plus replica pulls spent the old 2,500, and an 870-gene Image Lab
// batch fetches each gene's prose and Tags (about 1,740 more). 10,000 is 10% of the
// Free plan's 100,000; the ledger's account ceiling still refuses operator work
// first when readers fill the account.
export const OPERATOR_DAILY_REQUEST_LIMIT = 10_000

// Readers' own D1 writes (discoveries, votes) may push the account to 90,000 of the
// Free plan's 100,000, so a reader always keeps a band that operator work, stopped at
// D1_OPERATOR_DAILY_LIMITS.writes (70,000), can't take (B-897).
export const D1_USER_ACTION_DAILY_WRITE_CEILING = 90_000

// Operator work also stops when the whole account, readers included, reaches these
// (the operation-cost ledger and its release scripts read them). Reads: 3.5M of the
// Free plan's 5M; Workers requests: 75,000 of 100,000.
export const OPERATOR_ACCOUNT_CEILINGS = Object.freeze({
  rows_read: 3_500_000,
  rows_written: D1_OPERATOR_DAILY_LIMITS.writes,
  requests: 75_000,
})

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
