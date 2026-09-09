import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  FINALIZATION_ROW_COUNT_GUARD,
  FINALIZATION_UNFINISHED_GUARD,
} from "./operation-cost-migration-adapter.js"
import {
  FINALIZATION_QUEUE_MIGRATION_NAME,
  FINALIZATION_QUEUE_MIGRATION_STATEMENTS,
  FINALIZATION_STATUS_MIGRATION_NAME,
  FINALIZATION_STATUS_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

export function createFinalizationQueueMigrationCostAdapter({
  db,
  executable_sha256,
  schema_sha256,
}) {
  return createFinalizationIndexMigrationCostAdapter({
    db,
    executable_sha256,
    schema_sha256,
    migrationName: FINALIZATION_QUEUE_MIGRATION_NAME,
    migrationStatements: FINALIZATION_QUEUE_MIGRATION_STATEMENTS,
    indexCount: 2,
  })
}

export function createFinalizationStatusMigrationCostAdapter({
  db,
  executable_sha256,
  schema_sha256,
}) {
  return createFinalizationIndexMigrationCostAdapter({
    db,
    executable_sha256,
    schema_sha256,
    migrationName: FINALIZATION_STATUS_MIGRATION_NAME,
    migrationStatements: FINALIZATION_STATUS_MIGRATION_STATEMENTS,
    indexCount: 1,
  })
}

function createFinalizationIndexMigrationCostAdapter({
  db,
  executable_sha256,
  schema_sha256,
  migrationName,
  migrationStatements,
  indexCount,
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
        ...migrationStatements.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [migrationName],
        },
      ]
      // Each partial index scans the source once. The dispatch indexes are
      // disjoint; the status index contains every unfinished job exactly once.
      const bound = {
        // One status-index migration reads the table twice (guard + DDL),
        // and the two status guard ranges together read at most 2*(U+1).
        // The fixed allowance covers the capped schema guard and DDL metadata.
        // Keep the already-published dispatch-migration envelope unchanged.
        rows_read:
          (indexCount === 1
            ? 2 * args.max_rows + 2 * (args.max_unfinished + 1)
            : 8 * args.max_rows + 4 * (args.max_unfinished + 1)) + 8704,
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
      return { result: { migration: migrationName, applied: true }, actual }
    },
  }
}
