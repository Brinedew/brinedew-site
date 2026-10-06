// Independent KV allowances remain in the same reservation authority and SQL
// transaction as D1 and Worker requests. These are protected operator shares,
// not additional provider allowances or per-process counters.
export const KV_COST_METERS = Object.freeze(["kv_reads", "kv_writes", "kv_deletes", "kv_lists"])
export {
  KV_ACCOUNT_CEILINGS,
  KV_OPERATOR_LIMITS,
} from "../../shared/iconoplasm-d1-budget-policy.js"
