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
