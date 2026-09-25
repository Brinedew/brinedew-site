import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  PUBLISH_STATE_UPDATED_INDEX_MIGRATION_NAME,
  PUBLISH_STATE_UPDATED_INDEX_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// 0109 adds idx_icono_publish_state_updated so the public change feed pages
// icono_publish_state by index instead of scanning ~19k rows per request.
// icono_publish_state has one row per published gene (19,160 on 2026-09-25);
// The admission ceiling (max_rows) is not an estimate.
// MEASURED on production 2026-09-25 (wrangler d1 insights): the CREATE INDEX
// alone read 38,573 rows and wrote 19,161 for 19,160 rows, i.e. D1 bills the
// index build as TWO table passes plus one index entry per row. With the row
// guard that is three passes. The first release used two and was refused with
// COST_VERIFIED_BOUND_EXCEEDED after the index had already applied.
export function createPublishStateIndexMigrationCostAdapter({
  db,
  executable_sha256,
  schema_sha256,
}) {
  return {
    resource: "iconoplasm",
    migration_protocol: "one-migration-per-release-v1",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).sort().join() !== "max_rows,max_schema_rows" ||
        !Number.isSafeInteger(args.max_rows) ||
        args.max_rows < 1 ||
        args.max_rows > 20000 ||
        !Number.isSafeInteger(args.max_schema_rows) ||
        args.max_schema_rows < 1 ||
        args.max_schema_rows > 512
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        {
          sql: "SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT ?)) <= ? THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted",
          parameters: [args.max_schema_rows + 1, args.max_schema_rows],
        },
        {
          sql: "SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM icono_publish_state LIMIT ?)) <= ? THEN 1 ELSE json('COST_MIGRATION_ROW_BOUND_EXCEEDED') END AS admitted",
          parameters: [args.max_rows + 1, args.max_rows],
        },
        ...PUBLISH_STATE_UPDATED_INDEX_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [PUBLISH_STATE_UPDATED_INDEX_MIGRATION_NAME],
        },
      ]
      const bound = {
        rows_read: 3 * (args.max_rows + 1) + 16 * args.max_schema_rows + 256,
        rows_written: args.max_rows + 32,
        requests: 1,
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ statements, executable_sha256, schema_sha256 })),
      )
      return {
        statements,
        bound,
        sha256: Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join(""),
      }
    },
    async dispatch(prepared) {
      const { actual } = await executeOperationCostD1Batch(db, prepared)
      return {
        result: { migration: PUBLISH_STATE_UPDATED_INDEX_MIGRATION_NAME, applied: true },
        actual,
      }
    },
  }
}
