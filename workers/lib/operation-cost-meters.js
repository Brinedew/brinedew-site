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

// SQLite work in Durable Objects shares one account allowance independently of
// D1. Reserve an operator share in the existing authority, retaining the other
// 80% for public traffic, other objects and recovery. These are SQL row units;
// they do not claim to meter DO invocation or duration charges.
export const DO_SQL_COST_METERS = Object.freeze(["do_rows_read", "do_rows_written"])
export const DO_SQL_OPERATOR_LIMITS = Object.freeze({
  do_rows_read: 1_000_000,
  do_rows_written: 20_000,
})
export const DO_SQL_ACCOUNT_CEILINGS = Object.freeze({
  do_rows_read: 4_000_000,
  do_rows_written: 80_000,
})
export const OPTIONAL_COST_METERS = Object.freeze([...KV_COST_METERS, ...DO_SQL_COST_METERS])
export const OPTIONAL_OPERATOR_LIMITS = Object.freeze({
  ...KV_OPERATOR_LIMITS,
  ...DO_SQL_OPERATOR_LIMITS,
})
