import { OperationCostError } from "../lib/operation-cost-ledger.js"

export function createCatalogInitializationCostAdapter({
  kv,
  initialize,
  executable_sha256,
  schema_sha256,
}) {
  return {
    resource: "iconoplasm-kv",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        (Object.keys(args).length &&
          !(Object.keys(args).join() === "inspect_only" && args.inspect_only === true))
      ) {
        throw new OperationCostError("COST_CATALOG_INITIALIZATION_INVALID")
      }
      const bound = {
        rows_read: 0,
        rows_written: 0,
        requests: 1,
        kv_reads: 5,
        kv_writes: args.inspect_only ? 0 : 1,
        kv_deletes: 0,
        kv_lists: 0,
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(
          JSON.stringify({
            operation: "initialize-current-catalog-v1",
            bound,
            executable_sha256,
            schema_sha256,
          }),
        ),
      )
      return {
        bound,
        sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
      }
    },
    async dispatch({ bound }) {
      if (!kv || typeof initialize !== "function")
        throw new OperationCostError("COST_CATALOG_INITIALIZATION_INVALID")
      const actual = { ...bound, kv_reads: 0, kv_writes: 0 }
      // No D1, list, delete, arbitrary fetch or unmetered KV capability reaches
      // initialization. Count keys before sending, including failed reads.
      const scopedKv = {
        async get(key) {
          if (typeof key !== "string" || ++actual.kv_reads > bound.kv_reads)
            throw new OperationCostError("COST_KV_READ_BOUND_EXCEEDED")
          return kv.get(key)
        },
        async put(key, value) {
          if (
            typeof key !== "string" ||
            !/^iconoplasm:hydrated-catalog-artifact:/.test(key) ||
            ++actual.kv_writes > bound.kv_writes
          )
            throw new OperationCostError("COST_KV_WRITE_BOUND_EXCEEDED")
          return kv.put(key, value)
        },
      }
      return { result: await initialize(scopedKv, { inspectOnly: bound.kv_writes === 0 }), actual }
    },
  }
}
