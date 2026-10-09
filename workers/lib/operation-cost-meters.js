// KV meters live in the same reservation authority and SQL transaction as D1 and
// Worker requests. Their only wall is Cloudflare's daily allowance; our work stops
// when the whole account reaches KV_ACCOUNT_CEILINGS (B-1026).
import { FREE_PLAN_DAILY_LIMITS } from "../../shared/iconoplasm-d1-budget-policy.js"

export const KV_COST_METERS = Object.freeze(["kv_reads", "kv_writes", "kv_deletes", "kv_lists"])
export const KV_DAILY_LIMITS = Object.freeze(
  Object.fromEntries(KV_COST_METERS.map((meter) => [meter, FREE_PLAN_DAILY_LIMITS[meter]])),
)
export { KV_ACCOUNT_CEILINGS } from "../../shared/iconoplasm-d1-budget-policy.js"
