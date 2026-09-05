import { executeOperationCostD1Batch } from "./operation-cost-d1-meter.js"
import { OperationCostError } from "../lib/operation-cost-ledger.js"
import {
  AUTHORING_STREAM_MIGRATION_NAME,
  AUTHORING_STREAM_MIGRATION_STATEMENTS,
} from "../generated/operation-cost-migrations.js"

export const AUTHORING_LEASE_COUNT_GUARD = `SELECT CASE WHEN
  (SELECT COUNT(*) FROM (SELECT 1 FROM icono_manifestation_snapshot_leases LIMIT ?)) <= ?
  THEN 1 ELSE json('COST_MIGRATION_LEASE_BOUND_EXCEEDED') END AS admitted`

// Migration 0012 updates lease status. Unexpected triggers or indexes could
// multiply its cost, so schema drift must stop it in the same transaction.
export const AUTHORING_LEASE_SCHEMA_GUARD = `SELECT CASE WHEN
  (SELECT COUNT(*) FROM (SELECT 1 FROM sqlite_schema LIMIT ?)) <= ? THEN
  CASE WHEN NOT EXISTS (SELECT 1 FROM sqlite_schema WHERE type = 'trigger'
    AND tbl_name = 'icono_manifestation_snapshot_leases') AND
  (SELECT COUNT(*) FROM pragma_index_list('icono_manifestation_snapshot_leases')) = 2 AND
  (SELECT COUNT(*) FROM pragma_index_list('icono_manifestation_snapshot_leases')
    WHERE name IN ('sqlite_autoindex_icono_manifestation_snapshot_leases_1', 'uq_icono_open_snapshot_consumer')) = 2
  THEN 1 ELSE json('COST_MIGRATION_SCHEMA_CHANGED') END
  ELSE json('COST_MIGRATION_SCHEMA_BOUND_EXCEEDED') END AS admitted`

export function createAuthoringStreamMigrationCostAdapter({
  db,
  executable_sha256,
  schema_sha256,
}) {
  return {
    resource: "iconoplasm-authoring",
    executable_sha256,
    schema_sha256,
    async prepare(args) {
      if (
        !args ||
        Object.keys(args).some((key) => !["max_leases", "max_schema_rows"].includes(key)) ||
        !Number.isSafeInteger(args.max_leases) ||
        args.max_leases < 1 ||
        args.max_leases > 1000 ||
        !Number.isSafeInteger(args.max_schema_rows) ||
        args.max_schema_rows < 1 ||
        args.max_schema_rows > 1024
      ) {
        throw new OperationCostError("COST_MIGRATION_ARGUMENTS_INVALID")
      }
      const statements = [
        {
          sql: AUTHORING_LEASE_SCHEMA_GUARD,
          parameters: [args.max_schema_rows + 1, args.max_schema_rows],
        },
        { sql: AUTHORING_LEASE_COUNT_GUARD, parameters: [args.max_leases + 1, args.max_leases] },
        ...AUTHORING_STREAM_MIGRATION_STATEMENTS.map((sql) => ({ sql, parameters: [] })),
        {
          sql: "INSERT INTO d1_migrations (name) VALUES (?)",
          parameters: [AUTHORING_STREAM_MIGRATION_NAME],
        },
      ]
      // Lease update: at most one table write plus removal from the partial
      // open-consumer index per row. ADD COLUMN uses constant defaults. The
      // schema allowance covers repeated bounded schema validation by DDL.
      const bound = {
        rows_read: 16 * args.max_leases + 8 * args.max_schema_rows + 128,
        rows_written: 2 * args.max_leases + 16,
        requests: 1,
      }
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(JSON.stringify({ statements, executable_sha256, schema_sha256 })),
      )
      const sha256 = Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("")
      return { statements, bound, sha256 }
    },
    async dispatch(prepared) {
      const { actual } = await executeOperationCostD1Batch(db, prepared)
      return { result: { migration: AUTHORING_STREAM_MIGRATION_NAME, applied: true }, actual }
    },
  }
}
