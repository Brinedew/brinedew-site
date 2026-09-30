import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  FINALIZATION_HANDOFF_RETIREMENT_MIGRATION_NAME,
  FINALIZATION_HANDOFF_RETIREMENT_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

// 0110 drops 0101's singleton handoff row and its three triggers (B-869).
// The work is schema-only: four sqlite_schema rows, one data row and the
// journal row. No statement scans a data table. Each DROP rescans
// sqlite_schema (362 rows on 2026-09-26), so the bound allows five full
// passes over the admitted 512-row schema.
export function createFinalizationHandoffRetirementMigrationCostAdapter({
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
        Object.keys(args).join() !== "max_schema_rows" ||
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
        ...FINALIZATION_HANDOFF_RETIREMENT_MIGRATION_STATEMENTS.map((sql) => ({
          sql,
          parameters: [],
        })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [FINALIZATION_HANDOFF_RETIREMENT_MIGRATION_NAME],
        },
      ]
      const bound = {
        rows_read: 8 * args.max_schema_rows + 256,
        rows_written: 32,
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
        result: { migration: FINALIZATION_HANDOFF_RETIREMENT_MIGRATION_NAME, applied: true },
        actual,
      }
    },
  }
}
