import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  FINALIZATION_ROW_COUNT_GUARD,
  FINALIZATION_UNFINISHED_GUARD,
} from "./operation-cost-migration-adapter.js"
import {
  FINALIZATION_QUEUE_MIGRATION_NAME,
  FINALIZATION_QUEUE_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

export function createFinalizationQueueMigrationCostAdapter({
  db,
  executable_sha256,
  schema_sha256,
}) {
  return {
    resource: "iconoplasm",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).sort().join() !== "max_rows,max_unfinished" ||
        !Number.isSafeInteger(args.max_rows) ||
        args.max_rows < 1 ||
        args.max_rows > 25000 ||
        !Number.isSafeInteger(args.max_unfinished) ||
        args.max_unfinished < 0 ||
        args.max_unfinished > 5000
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        {
          sql: "SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT 1025)) <= 1024 THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted",
          parameters: [],
        },
        { sql: FINALIZATION_ROW_COUNT_GUARD, parameters: [args.max_rows + 1, args.max_rows] },
        {
          sql: FINALIZATION_UNFINISHED_GUARD,
          parameters: [args.max_unfinished + 1, args.max_unfinished + 1, args.max_unfinished],
        },
        ...FINALIZATION_QUEUE_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [FINALIZATION_QUEUE_MIGRATION_NAME],
        },
      ]
      // Both partial indexes scan the source once. Their populations are
      // disjoint, and together cannot exceed the guarded unfinished count.
      const bound = {
        rows_read: 8 * args.max_rows + 4 * (args.max_unfinished + 1) + 8704,
        rows_written: args.max_unfinished + 64,
        requests: 1,
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ statements, executable_sha256, schema_sha256 })),
      )
      return {
        statements,
        bound,
        sha256: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      }
    },
    async dispatch(prepared) {
      const { actual } = await executeOperationCostD1Batch(db, prepared)
      return { result: { migration: FINALIZATION_QUEUE_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
