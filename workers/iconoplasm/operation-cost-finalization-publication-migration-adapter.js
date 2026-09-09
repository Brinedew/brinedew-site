import { OperationCostError } from "../lib/operation-cost-ledger.js"
import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import {
  FINALIZATION_PUBLICATION_MIGRATION_NAME,
  FINALIZATION_PUBLICATION_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

export function createFinalizationPublicationMigrationCostAdapter({
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
        Object.keys(args).sort().join() !== "max_schema_rows,max_terminal" ||
        !Number.isSafeInteger(args.max_schema_rows) ||
        args.max_schema_rows < 1 ||
        args.max_schema_rows > 1024 ||
        !Number.isSafeInteger(args.max_terminal) ||
        args.max_terminal < 0 ||
        args.max_terminal > 5000
      )
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      const statements = [
        {
          sql: `SELECT CASE WHEN (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT ?)) <= ?
          THEN 1 ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted`,
          parameters: [args.max_schema_rows + 1, args.max_schema_rows],
        },
        {
          sql: `SELECT CASE WHEN EXISTS(SELECT 1 FROM icono_sync_finalization_summary WHERE singleton=1)
          AND (SELECT COUNT(*) FROM (SELECT 1 FROM icono_sync_finalization_jobs INDEXED BY idx_icono_finalization_unfinished
          WHERE status <> 'completed' AND phase = 'completed' LIMIT ?)) <= ?
          THEN 1 ELSE json('COST_MIGRATION_FINALIZATION_HANDOFF_SOURCE_INVALID') END AS admitted`,
          parameters: [args.max_terminal + 1, args.max_terminal],
        },
        ...FINALIZATION_PUBLICATION_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations(name) VALUES (?)",
          parameters: [FINALIZATION_PUBLICATION_MIGRATION_NAME],
        },
      ]
      const bound = {
        rows_read: 4 * (args.max_terminal + 1) + 64 * args.max_schema_rows + 256,
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
        sha256: Array.from(new Uint8Array(digest), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join(""),
      }
    },
    async dispatch(prepared) {
      const { actual } = await executeOperationCostD1Batch(db, prepared)
      return {
        result: { migration: FINALIZATION_PUBLICATION_MIGRATION_NAME, applied: true },
        actual,
      }
    },
  }
}
