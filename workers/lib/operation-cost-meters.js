// Independent KV allowances remain in the same reservation authority and SQL
// transaction as D1 and Worker requests. These are protected operator shares,
// not additional provider allowances or per-process counters.
export const KV_COST_METERS = Object.freeze(["kv_reads", "kv_writes", "kv_deletes", "kv_lists"])
export const KV_OPERATOR_LIMITS = Object.freeze({
  kv_reads: 10_000,
  kv_writes: 200,
  kv_deletes: 100,
  kv_lists: 100,
})
export const KV_ACCOUNT_CEILINGS = Object.freeze({
  kv_reads: 70_000,
  kv_writes: 700,
  kv_deletes: 700,
  kv_lists: 700,
})
